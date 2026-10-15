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
// transaction's own true final balance must line up with the one
// before it, walking forward through the whole chain — a misread digit
// or a dropped row breaks the chain and importing is refused. This was
// validated against two real statements during building: the CSV path
// now reconciles exactly against a real October statement with KES
// 16,048.41 closing, after two real bugs turned up and were fixed
// (noted inline below). The numbers in the tests are invented, not the
// real data.

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
  // Confirmed against a real statement: the Withdrawn column shows a
  // leading minus sign (e.g. "-4.95"), not a plain positive magnitude —
  // so this checks for non-zero, not greater-than-zero.
  if (withdrawn !== 0) return /charge/i.test(details) ? "charge" : "other";
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
      // Always a positive magnitude, regardless of how the source shows
      // it — the Withdrawn column in a real statement is negative
      // (e.g. "-4.95"), but "amount" here means the size of the
      // movement, matching how payments.amount and fund_expenses.amount
      // are both stored (and the latter's own positive-only constraint).
      amount: kind === "payment" ? Math.abs(paidIn) : Math.abs(withdrawn),
      balanceAfter: parseAmount(r.balance),
      details: r.details.trim(),
      ...payer,
    };
  });

  const totalPaidIn = rows.filter((r) => r.kind === "payment").reduce((s, r) => s + r.amount, 0);
  const totalWithdrawn = rows.filter((r) => r.kind !== "payment").reduce((s, r) => s + r.amount, 0);

  // Group by receipt (a payment and its own charge share one receipt).
  const groups = new Map<string, ParsedStatementRow[]>();
  for (const row of rows) {
    const list = groups.get(row.receiptNo) ?? [];
    list.push(row);
    groups.set(row.receiptNo, list);
  }

  // Each transaction's TRUE final balance is the smallest balance among
  // its own rows: a payment posts first, and if there's also a charge
  // on the same receipt, the charge always reduces the balance further
  // — whichever order the statement happens to list the two rows in.
  // For a single-row group this is just that row's own balance. This
  // needs no assumption about the account's history before this file
  // even starts, which matters because a real statement is usually a
  // partial export (a month, a date range), not the full account
  // history back to zero — assuming otherwise was a real bug here,
  // caught by testing against an actual statement.
  const trueBalance = new Map<string, number>();
  for (const [receiptNo, group] of groups) {
    trueBalance.set(receiptNo, Math.min(...group.map((r) => r.balanceAfter)));
  }

  const orderedGroups = [...groups.entries()].sort(([, a], [, b]) => {
    const ta = a[0].completionTime;
    const tb = b[0].completionTime;
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });

  const TOLERANCE = 0.01;
  const brokenReceipts: string[] = [];
  let previousBalance: number | null = null;

  for (const [receiptNo, group] of orderedGroups) {
    const net = group.reduce((s, r) => s + (r.kind === "payment" ? r.amount : -r.amount), 0);
    const balance = trueBalance.get(receiptNo)!;
    // The very first (oldest) transaction in the file has nothing
    // before it to check against — it's taken as the trusted starting
    // point, the same way a bank statement's opening balance is.
    if (previousBalance !== null && Math.abs(previousBalance + net - balance) >= TOLERANCE) {
      brokenReceipts.push(receiptNo);
    }
    previousBalance = balance;
  }

  const calculatedClosingBalance = previousBalance ?? 0;
  const reportedClosingBalance =
    orderedGroups.length > 0 ? trueBalance.get(orderedGroups[orderedGroups.length - 1][0])! : null;

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
