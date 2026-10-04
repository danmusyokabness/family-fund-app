import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatementRows, type RawStatementRow } from "../lib/statement-parser.ts";

function row(partial: Partial<RawStatementRow>): RawStatementRow {
  return {
    completionTime: "",
    receiptNo: "",
    details: "",
    transactionStatus: "Completed",
    paidIn: "",
    withdrawn: "",
    balance: "",
    ...partial,
  };
}

// A small, invented statement: three transactions (newest first, as a
// real M-PESA export is ordered), each with a payment row and its own
// charge row. Balances are hand-computed so the whole chain reconciles
// cleanly — this is the "everything is fine" case.
const CLEAN_ROWS: RawStatementRow[] = [
  // R3 — newest. Charge row first (the true final balance), matching
  // the real export's convention of the top row being the current balance.
  row({ completionTime: "2026-09-20 10:00:00", receiptNo: "R3", details: "Pay Bill Charge", withdrawn: "0.50", balance: "1,796.50" }),
  row({ completionTime: "2026-09-20 10:00:00", receiptNo: "R3", details: "Merchant Payment from - 254712***678 Jane Doe", paidIn: "300.00", balance: "1,797.00" }),
  // R2
  row({ completionTime: "2026-09-10 09:00:00", receiptNo: "R2", details: "Merchant Payment Online from - 0740***425 Salome Kataka", paidIn: "500.00", balance: "1,498.00" }),
  row({ completionTime: "2026-09-10 09:00:00", receiptNo: "R2", details: "Pay Bill Charge", withdrawn: "1.00", balance: "1,497.00" }),
  // R1 — oldest
  row({ completionTime: "2026-08-05 08:00:00", receiptNo: "R1", details: "Merchant Payment received from 8760493 - TRIZAH MUSYOKA", paidIn: "1000.00", balance: "1,000.00" }),
  row({ completionTime: "2026-08-05 08:00:00", receiptNo: "R1", details: "Pay Bill Charge", withdrawn: "2.00", balance: "998.00" }),
];

// Junk rows a real export file actually contains, that should be skipped.
const JUNK_ROWS: RawStatementRow[] = [
  row({ completionTime: "Completion Time", receiptNo: "Receipt No." }), // a repeated header
  row({ completionTime: "", details: "No Records Found." }),
];

test("skips header/junk rows and keeps only real transaction rows", () => {
  const result = parseStatementRows([...JUNK_ROWS, ...CLEAN_ROWS]);
  assert.equal(result.skippedCount, 2);
  assert.equal(result.rows.length, 6);
});

test("classifies a payment row and a charge row correctly", () => {
  const result = parseStatementRows(CLEAN_ROWS);
  const kinds = result.rows.map((r) => r.kind);
  assert.deepEqual(kinds, ["charge", "payment", "payment", "charge", "payment", "charge"]);
});

test("strips thousands separators from amounts", () => {
  const result = parseStatementRows([row({ completionTime: "2026-09-01 00:00:00", receiptNo: "X", details: "Merchant Payment from - 254700***111 A B", paidIn: "1,200.00", balance: "1,200.00" })]);
  assert.equal(result.rows[0].amount, 1200);
});

test("extracts a masked-phone payer (254-prefixed)", () => {
  const result = parseStatementRows([CLEAN_ROWS[1]]); // Jane Doe row
  assert.equal(result.rows[0].payerPhoneMasked, "254712***678");
  assert.equal(result.rows[0].payerName, "Jane Doe");
  assert.equal(result.rows[0].payerRef, null);
});

test("extracts a masked-phone payer (0-prefixed local format)", () => {
  const result = parseStatementRows([CLEAN_ROWS[2]]); // Salome row
  assert.equal(result.rows[0].payerPhoneMasked, "0740***425");
  assert.equal(result.rows[0].payerName, "Salome Kataka");
});

test("extracts a business/shortcode payer", () => {
  const result = parseStatementRows([CLEAN_ROWS[4]]); // Trizah row
  assert.equal(result.rows[0].payerRef, "8760493");
  assert.equal(result.rows[0].payerName, "TRIZAH MUSYOKA");
  assert.equal(result.rows[0].payerPhoneMasked, null);
});

test("a payment with an unrecognised description still records the money, with no payer info", () => {
  const result = parseStatementRows([row({ completionTime: "2026-09-01 00:00:00", receiptNo: "X", details: "Something unexpected", paidIn: "50.00", balance: "50.00" })]);
  assert.equal(result.rows[0].kind, "payment");
  assert.equal(result.rows[0].amount, 50);
  assert.equal(result.rows[0].payerPhoneMasked, null);
});

test("a clean, reconciling statement passes the integrity check", () => {
  const result = parseStatementRows(CLEAN_ROWS);
  assert.equal(result.integrityOk, true);
  assert.deepEqual(result.brokenReceipts, []);
  assert.equal(result.reportedClosingBalance, 1796.5);
  assert.equal(result.calculatedClosingBalance, 1796.5);
  assert.equal(result.totalPaidIn, 1800);
  assert.equal(result.totalWithdrawn, 3.5);
});

test("a corrupted balance is caught, not silently accepted", () => {
  const corrupted = CLEAN_ROWS.map((r) => (r.receiptNo === "R2" && r.details.includes("Charge") ? { ...r, balance: "1,490.00" } : r));
  const result = parseStatementRows(corrupted);
  assert.equal(result.integrityOk, false);
  assert.ok(result.brokenReceipts.includes("R2"));
});

test("an empty statement does not crash", () => {
  const result = parseStatementRows([]);
  assert.equal(result.rows.length, 0);
  assert.equal(result.reportedClosingBalance, null);
  assert.equal(result.integrityOk, false);
});
