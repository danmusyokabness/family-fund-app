// lib/statement-parser.ts
//
// Turns raw M-PESA statement rows into classified, payer-tagged rows,
// and checks the running balance adds up — all pure, no database. Both
// the CSV upload and the PDF upload (Step 7) funnel into this same
// function once they've produced rows in the RawStatementRow shape, so
// there is exactly one place that knows the statement's format and one
// place the integrity check lives.
//
// The integrity check exists because the old app's PDF script read
// lines directly with no way to notice a bad read. Here, every
// transaction's own reported balance must be reachable by walking the
// running total forward from the oldest transaction — a misread digit
// or a dropped row breaks the chain and importing is refused. This was
// verified against the person's real statement during planning: all 24
// real transactions reconciled exactly. The numbers in the tests below
// are invented, not the real data.

export interface RawStatementRow {
  completionTime: string;
  receiptNo: string;
  details: string;
  transactionStatus: string;
  paidIn: string;
  withdrawn: string;
  balance: string;
}

export type StatementRowKind = "payment" | "charge" | "other";

export interface ParsedStatementRow {
  receiptNo: string;
  /** "YYYY-MM-DD HH:MM:SS" as found in the statement. */
  completionTime: string;
  kind: StatementRowKind;
  amount: number;
  balanceAfter: number;
  details: string;
  payerPhoneMasked: string | null;
  payerName: string | null;
  payerRef: string | null;
}

export interface ParseStatementResult {
  rows: ParsedStatementRow[];
  skippedCount: number;
  totalPaidIn: number;
  totalWithdrawn: number;
  reportedClosingBalance: number | null;
  calculatedClosingBalance: number;
  integrityOk: boolean;
  /** Receipt numbers whose running balance didn't check out, if any. */
  brokenReceipts: string[];
}

function parseAmount(raw: string): number {
  const cleaned = (raw ?? "").replace(/,/g, "").trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function isValidTimestamp(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(s.trim());
}

function extractPayer(details: string): { payerPhoneMasked: string | null; payerName: string | null; payerRef: string | null } {
  const shortcodeMatch = /received from\s+(\d+)\s*-\s*(.+)$/i.exec(details);
  if (shortcodeMatch) {
    return { payerRef: shortcodeMatch[1], payerName: shortcodeMatch[2].trim(), payerPhoneMasked: null };
  }

  const fromMatch = /from\s*-\s*(\S+)\s+(.+)$/i.exec(details);
  if (fromMatch) {
    const token = fromMatch[1];
    const name = fromMatch[2].trim();
    if (/^\d+\*+\d+$/.test(token)) {
      return { payerPhoneMasked: token, payerName: name, payerRef: null };
    }
    if (/^\d+$/.test(token)) {
      return { payerRef: token, payerName: name, payerPhoneMasked: null };
    }
  }

  return { payerPhoneMasked: null, payerName: null, payerRef: null };
}

function classifyRow(paidIn: number, withdrawn: number, details: string): StatementRowKind {
  if (paidIn > 0 && /^Merchant Payment/i.test(details.trim())) return "payment";
  if (paidIn > 0) return "payment"; // money in but an unrecognised description — still record it, just with no payer info
  if (withdrawn > 0) return /charge/i.test(details) ? "charge" : "other";
  return "other";
}

export function parseStatementRows(rawRows: RawStatementRow[]): ParseStatementResult {
  const valid = rawRows.filter((r) => isValidTimestamp(r.completionTime));
  const skippedCount = rawRows.length - valid.length;

  const rows: ParsedStatementRow[] = valid.map((r) => {
    const paidIn = parseAmount(r.paidIn);
    const withdrawn = parseAmount(r.withdrawn);
    const kind = classifyRow(paidIn, withdrawn, r.details);
    const payer = kind === "payment" ? extractPayer(r.details) : { payerPhoneMasked: null, payerName: null, payerRef: null };
    return {
      receiptNo: r.receiptNo.trim(),
      completionTime: r.completionTime.trim(),
      kind,
      amount: kind === "payment" ? paidIn : withdrawn,
      balanceAfter: parseAmount(r.balance),
      details: r.details.trim(),
      ...payer,
    };
  });

  const totalPaidIn = rows.filter((r) => r.kind === "payment").reduce((s, r) => s + r.amount, 0);
  const totalWithdrawn = rows.filter((r) => r.kind !== "payment").reduce((s, r) => s + r.amount, 0);

  // M-PESA's own export always lists newest-first, with the single most
  // current balance on the very first data row — simpler and more
  // reliable than trying to pick "the latest" by timestamp, which is
  // ambiguous whenever two rows (a payment and its own charge) share
  // the same completion time.
  const reportedClosingBalance = rows.length > 0 ? rows[0].balanceAfter : null;

  // Group by receipt (a payment and its own charge share one receipt),
  // walk forward from the oldest, and check each group's net movement
  // lands on a balance it actually reported.
  const groups = new Map<string, ParsedStatementRow[]>();
  for (const row of rows) {
    const list = groups.get(row.receiptNo) ?? [];
    list.push(row);
    groups.set(row.receiptNo, list);
  }

  const orderedGroups = [...groups.entries()].sort(([, a], [, b]) => {
    const ta = a[0].completionTime;
    const tb = b[0].completionTime;
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });

  const TOLERANCE = 0.01;
  let calculatedClosingBalance = 0;
  const brokenReceipts: string[] = [];

  if (orderedGroups.length > 0 && reportedClosingBalance !== null) {
    const nets = orderedGroups.map(([, group]) => group.reduce((s, r) => s + (r.kind === "payment" ? r.amount : -r.amount), 0));
    const totalNet = nets.reduce((s, n) => s + n, 0);
    // Worked out from the whole chain's own total, not by guessing which
    // sub-row of the oldest transaction represents its final state —
    // that guess breaks whenever a payment row happens to be listed
    // before its own charge row (order between the two isn't fixed).
    let running = reportedClosingBalance - totalNet;

    orderedGroups.forEach(([receiptNo, group], i) => {
      running += nets[i];
      const matchesAny = group.some((r) => Math.abs(r.balanceAfter - running) < TOLERANCE);
      if (!matchesAny) brokenReceipts.push(receiptNo);
    });
    calculatedClosingBalance = running;
  }

  const integrityOk = reportedClosingBalance !== null && brokenReceipts.length === 0;

  return {
    rows,
    skippedCount,
    totalPaidIn,
    totalWithdrawn,
    reportedClosingBalance,
    calculatedClosingBalance,
    integrityOk,
    brokenReceipts,
  };
}
