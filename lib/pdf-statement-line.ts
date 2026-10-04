// lib/pdf-statement-line.ts
//
// Turns one reconstructed line of text from a PDF statement page into a
// RawStatementRow — the same shape lib/statement-parser.ts already
// expects from a CSV. Kept as its own small pure function, separate
// from the actual PDF-reading code in lib/pdf-statement.ts, so the
// text-parsing logic can be tested on its own with plain strings. The
// PDF-reading half (turning a PDF into these lines in the first place)
// could not be tested the same way — there was no real sample PDF
// available — so it is the one part of this project shipped without
// having been run against real input. See the project README for how
// to verify it before trusting it with real data.

import type { RawStatementRow } from "./statement-parser";

const DATETIME_RE = /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/;
const AMOUNT_RE = /-?[\d,]+\.\d{2}/g;
const STATUS_WORDS = ["Completed", "Pending", "Failed", "Cancelled"];

/**
 * Parses one line of text reconstructed from a PDF page into a
 * RawStatementRow, or null if the line doesn't look like a data row at
 * all (a page header, a column heading, page-number footer, etc).
 *
 * Assumes the same column meaning already confirmed from the real CSV
 * export: a completion timestamp, a receipt code, a free-text details
 * column, a status word, and up to three trailing currency amounts
 * (Paid In, Withdrawn, Balance — exactly one of the first two is
 * actually present on any real row, so two trailing numbers means a
 * charge/withdrawal row and three means a payment row).
 */
export function parseStatementTextLine(line: string): RawStatementRow | null {
  const trimmed = line.trim();
  const dateMatch = DATETIME_RE.exec(trimmed);
  if (!dateMatch) return null;

  const completionTime = dateMatch[0];
  const afterDate = trimmed.slice(dateMatch.index + completionTime.length).trim();

  const amounts = afterDate.match(AMOUNT_RE) ?? [];
  if (amounts.length === 0) return null;

  // Receipt code: the first token right after the date.
  const receiptMatch = /^(\S+)\s+(.*)$/.exec(afterDate);
  if (!receiptMatch) return null;
  const receiptNo = receiptMatch[1];
  let rest = receiptMatch[2];

  // Strip the trailing amounts (and anything after the first one) off
  // the "rest" text, since that's where the details/status columns end
  // and the number columns begin.
  const firstAmountIdx = rest.search(AMOUNT_RE);
  const beforeAmounts = firstAmountIdx >= 0 ? rest.slice(0, firstAmountIdx).trim() : rest.trim();

  let status = "";
  let details = beforeAmounts;
  for (const word of STATUS_WORDS) {
    if (beforeAmounts.endsWith(word)) {
      status = word;
      details = beforeAmounts.slice(0, beforeAmounts.length - word.length).trim();
      break;
    }
  }

  // Last 1-3 amounts are Paid In / Withdrawn / Balance, right-aligned:
  // the LAST one is always the running balance, and whichever of the
  // two before it exist is Paid In then Withdrawn, in that order —
  // exactly one of those two is ever really present on a real row.
  const trailing = amounts.slice(-3);
  const balance = trailing[trailing.length - 1] ?? "";
  let paidIn = "";
  let withdrawn = "";
  if (trailing.length === 3) {
    paidIn = trailing[0];
    withdrawn = trailing[1];
  } else if (trailing.length === 2) {
    // One amount column before the balance — which one it is depends on
    // the details text, same rule as the CSV path uses.
    if (/^Merchant Payment/i.test(details)) {
      paidIn = trailing[0];
    } else {
      withdrawn = trailing[0];
    }
  }

  if (!receiptNo || !completionTime) return null;

  return {
    completionTime,
    receiptNo,
    details,
    transactionStatus: status,
    paidIn,
    withdrawn,
    balance,
  };
}
