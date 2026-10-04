import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatementTextLine } from "../lib/pdf-statement-line.ts";

test("parses a payment row (three trailing amounts: paid in, withdrawn-blank-skipped, balance)", () => {
  const line = "2026-09-20 10:00:00 R3 Merchant Payment from - 254712***678 Jane Doe Completed 300.00 1,797.00";
  const row = parseStatementTextLine(line);
  assert.ok(row);
  assert.equal(row!.completionTime, "2026-09-20 10:00:00");
  assert.equal(row!.receiptNo, "R3");
  assert.equal(row!.details, "Merchant Payment from - 254712***678 Jane Doe");
  assert.equal(row!.transactionStatus, "Completed");
  assert.equal(row!.paidIn, "300.00");
  assert.equal(row!.withdrawn, "");
  assert.equal(row!.balance, "1,797.00");
});

test("parses a charge row (withdrawn + balance only)", () => {
  const line = "2026-09-20 10:00:01 R3 Pay Bill Charge Completed 0.50 1,796.50";
  const row = parseStatementTextLine(line);
  assert.ok(row);
  assert.equal(row!.details, "Pay Bill Charge");
  assert.equal(row!.paidIn, "");
  assert.equal(row!.withdrawn, "0.50");
  assert.equal(row!.balance, "1,796.50");
});

test("parses a business/shortcode payment row", () => {
  const line = "2026-08-05 08:00:00 R1 Merchant Payment received from 8760493 - TRIZAH MUSYOKA Completed 1000.00 1,000.00";
  const row = parseStatementTextLine(line);
  assert.ok(row);
  assert.equal(row!.details, "Merchant Payment received from 8760493 - TRIZAH MUSYOKA");
  assert.equal(row!.paidIn, "1000.00");
});

test("a line with no date at all is not a data row", () => {
  assert.equal(parseStatementTextLine("Completion Time Receipt No. Details"), null);
  assert.equal(parseStatementTextLine("M-PESA Statement for August 2026"), null);
  assert.equal(parseStatementTextLine(""), null);
});

test("a line with a date but no amounts is not a data row", () => {
  assert.equal(parseStatementTextLine("Printed on 2026-09-28 10:00:00 for account holder"), null);
});

test("handles a line with no status word present", () => {
  const line = "2026-09-20 10:00:00 R3 Merchant Payment from - 254712***678 Jane Doe 300.00 1,797.00";
  const row = parseStatementTextLine(line);
  assert.ok(row);
  assert.equal(row!.transactionStatus, "");
  assert.equal(row!.details, "Merchant Payment from - 254712***678 Jane Doe");
});

test("the resulting row feeds straight into parseStatementRows without changes", async () => {
  const { parseStatementRows } = await import("../lib/statement-parser.ts");
  const line = "2026-09-20 10:00:00 R3 Merchant Payment from - 254712***678 Jane Doe Completed 300.00 1,797.00";
  const row = parseStatementTextLine(line);
  const result = parseStatementRows([row!]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].kind, "payment");
  assert.equal(result.rows[0].payerPhoneMasked, "254712***678");
});
