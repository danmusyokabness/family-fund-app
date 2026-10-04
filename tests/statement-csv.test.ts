import { test } from "node:test";
import assert from "node:assert/strict";
import { csvToStatementRows } from "../lib/statement-csv.ts";
import { parseStatementRows } from "../lib/statement-parser.ts";

test("maps real-shaped CSV headers onto the raw row shape, loosely matched", () => {
  const csv = [
    "Receipt No.,Completion Time,Details,Transaction Status,Paid In,Withdrawn,Balance",
    'R1,2026-09-01 08:00:00,"Merchant Payment from - 254712***678 Jane Doe",Completed,300.00,,1500.00',
  ].join("\n");
  const rows = csvToStatementRows(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].receiptNo, "R1");
  assert.equal(rows[0].completionTime, "2026-09-01 08:00:00");
  assert.equal(rows[0].paidIn, "300.00");
});

test("the result feeds straight into parseStatementRows", () => {
  const csv = [
    "Receipt No.,Completion Time,Details,Transaction Status,Paid In,Withdrawn,Balance",
    'R1,2026-09-01 08:00:00,"Merchant Payment from - 254712***678 Jane Doe",Completed,300.00,,300.00',
  ].join("\n");
  const result = parseStatementRows(csvToStatementRows(csv));
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].payerPhoneMasked, "254712***678");
});

test("a missing column is just left blank, not a crash", () => {
  const csv = "Receipt No.,Completion Time\nR1,2026-09-01 08:00:00";
  const rows = csvToStatementRows(csv);
  assert.equal(rows[0].paidIn, "");
  assert.equal(rows[0].details, "");
});
