// lib/statement-csv.ts
//
// Maps the M-PESA statement CSV's columns (matched loosely by name, the
// same way lib/members-import.ts matches its columns) onto the
// RawStatementRow shape lib/statement-parser.ts expects. This is the
// CSV half of Step 7; lib/pdf-statement.ts is the PDF half — both feed
// the same parser and the same integrity check.

import { parseCsvWithHeader, findColumn } from "./csv.ts";
import type { RawStatementRow } from "./statement-parser.ts";

export function csvToStatementRows(csvText: string): RawStatementRow[] {
  const table = parseCsvWithHeader(csvText);
  const col = (candidates: string[]) => findColumn(table.headers, candidates);

  const completionCol = col(["completion time"]);
  const receiptCol = col(["receipt no"]);
  const detailsCol = col(["details"]);
  const statusCol = col(["transaction status", "status"]);
  const paidInCol = col(["paid in"]);
  const withdrawnCol = col(["withdrawn"]);
  const balanceCol = col(["balance"]);

  return table.rows.map((r) => ({
    completionTime: completionCol ? (r[completionCol] ?? "") : "",
    receiptNo: receiptCol ? (r[receiptCol] ?? "") : "",
    details: detailsCol ? (r[detailsCol] ?? "") : "",
    transactionStatus: statusCol ? (r[statusCol] ?? "") : "",
    paidIn: paidInCol ? (r[paidInCol] ?? "") : "",
    withdrawn: withdrawnCol ? (r[withdrawnCol] ?? "") : "",
    balance: balanceCol ? (r[balanceCol] ?? "") : "",
  }));
}
