import { test } from "node:test";
import assert from "node:assert/strict";
import { readTablePage, detectDirection, splitIntoWords, maskText, describeItemsForDebug, type PdfTextItem } from "../lib/pdf-table.ts";
import { parseStatementRows } from "../lib/statement-parser.ts";

// ---------------------------------------------------------------------
// A fake statement page laid out like the real one first seen on
// 21 Oct 2026: a spreadsheet-style table where every cell wraps onto
// several lines (the date and the time are on DIFFERENT lines, and the
// details text wraps over up to three), amounts are right-aligned, plus
// section titles, a second empty table and a footer. Names, numbers and
// amounts are invented. Positions are in points, measured from the top.
// ---------------------------------------------------------------------

const LINE = 9.5;
const CHAR = 4.6;

// Column geometry (points): where text starts (left-aligned columns) or ends (right-aligned).
const COL = {
  receiptLeft: 64,
  completionLeft: 115,
  detailsLeft: 167,
  statusLeft: 245,
  paidInRight: 345,
  withdrawnRight: 397,
  balanceRight: 449,
  typeLeft: 455,
  otherLeft: 501,
};
// Header label centres, as printed on the real statement.
const HEADER_CENTRES = { receipt: 87, completion: 139, details: 203, status: 268, paidIn: 319, withdrawn: 371, balance: 422, type: 474, other: 526 };

function text(str: string, x: number, y: number): PdfTextItem {
  return { str, x, y, width: str.length * CHAR };
}
function rightAligned(str: string, right: number, y: number): PdfTextItem {
  const width = str.length * CHAR;
  return { str, x: right - width, y, width };
}
function centred(str: string, centre: number, y: number): PdfTextItem {
  const width = str.length * CHAR;
  return { str, x: centre - width / 2, y, width };
}

interface FakeRow {
  receipt: string;
  date: string;
  time: string;
  details: string[];
  paidIn?: string;
  withdrawn?: string;
  balance: string;
  type: string[];
  other: string[];
}

// `coarse` imitates PDF libraries that hand over whole phrases instead of single words:
// "Receipt No." as one piece, "Completion Time" on one line, and the date and time together.
function buildPage(rows: FakeRow[], opts: { flip?: boolean; withHeader?: boolean; coarse?: boolean } = {}): PdfTextItem[] {
  const items: PdfTextItem[] = [];
  const withHeader = opts.withHeader !== false;

  items.push(text("Page", 500, 20), text("1", 520, 20), text("of", 530, 20), text("2", 545, 20));
  items.push(text("M-PESA", 250, 50), text("STATEMENT", 290, 50));
  items.push(text("Account", 220, 150), text("Type", 250, 150), text("-", 270, 150), text("Merchant", 280, 150), text("Account", 320, 150));

  let y = 175;
  if (withHeader && opts.coarse) {
    const h = HEADER_CENTRES;
    items.push(centred("Receipt No.", h.receipt, y), centred("Completion Time", h.completion, y), centred("Details", h.details, y));
    items.push(centred("Transaction Status", h.status, y), centred("Paid In", h.paidIn, y), centred("Withdrawn", h.withdrawn, y));
    items.push(centred("Balance", h.balance, y), centred("Transaction Type", h.type, y), centred("Other Party", h.other, y));
    y += 24;
  } else if (withHeader) {
    const h = HEADER_CENTRES;
    items.push(text("Receipt", h.receipt - 16, y), text("No.", h.receipt + 12, y));
    items.push(centred("Completion", h.completion, y), centred("Time", h.completion, y + 8));
    items.push(centred("Details", h.details, y));
    items.push(centred("Transaction", h.status, y), centred("Status", h.status, y + 8));
    items.push(text("Paid", h.paidIn - 14, y), text("In", h.paidIn + 8, y));
    items.push(centred("Withdrawn", h.withdrawn, y));
    items.push(centred("Balance", h.balance, y));
    items.push(centred("Transaction", h.type, y), centred("Type", h.type, y + 8));
    items.push(text("Other", h.other - 18, y), text("Party", h.other + 6, y));
    y += 24;
  }

  for (const r of rows) {
    items.push(text(r.receipt, COL.receiptLeft, y));
    if (opts.coarse) items.push(text(`${r.date} ${r.time}`, COL.completionLeft, y));
    else items.push(text(r.date, COL.completionLeft, y), text(r.time, COL.completionLeft, y + LINE));
    r.details.forEach((line, i) => items.push(text(line, COL.detailsLeft, y + i * LINE)));
    items.push(text("Completed", COL.statusLeft, y));
    if (r.paidIn) items.push(rightAligned(r.paidIn, COL.paidInRight, y));
    if (r.withdrawn) items.push(rightAligned(r.withdrawn, COL.withdrawnRight, y));
    items.push(rightAligned(r.balance, COL.balanceRight, y));
    r.type.forEach((line, i) => items.push(text(line, COL.typeLeft, y + i * LINE)));
    r.other.forEach((line, i) => items.push(text(line, COL.otherLeft, y + i * LINE)));
    const lines = Math.max(r.details.length, r.type.length, r.other.length, 2);
    y += lines * LINE + 6;
  }

  // A second, empty table and the footer, which must never be mistaken for rows.
  y += 20;
  items.push(text("Account", 220, y), text("Type", 250, y), text("-", 270, y), text("Utility", 280, y), text("Account", 315, y));
  y += 15;
  items.push(text("Receipt", 70, y), text("No.", 100, y), centred("Completion", 139, y), centred("Details", 203, y));
  items.push(centred("Transaction", 268, y), text("Paid", 305, y), text("In", 327, y), centred("Withdrawn", 371, y));
  items.push(centred("Balance", 422, y), centred("Transaction", 474, y), text("Other", 508, y), text("Party", 532, y));
  items.push(text("No", 300, y + 14), text("Records", 312, y + 14), text("Found.", 340, y + 14));
  items.push(text("Disclaimer:", 64, 677), text("Any", 103, 677), text("personal", 118, 677), text("information", 148, 677));
  items.push(text("Statement", 70, 720), text("Verification", 112, 720), text("Code", 160, 720), text("P9XWWGK2", 70, 732));

  if (opts.flip) return items.map((i) => ({ ...i, y: 792 - i.y })); // height counted from the bottom, like some PDF libraries do
  return items;
}

// Newest first, like the real statement. Balances are hand-computed so the whole chain reconciles.
const ROWS: FakeRow[] = [
  { receipt: "QAA1B2C3D4", date: "2026-09-29", time: "18:36:54", details: ["Pay merchant Charge"], withdrawn: "-4.95", balance: "4,983.55", type: ["Pay Merchant", "with OD online"], other: ["1138423 -", "Test Fund"] },
  { receipt: "QAA1B2C3D4", date: "2026-09-29", time: "18:36:54", details: ["Merchant Payment Online", "from - 254700***111", "TEST PERSON ONE"], paidIn: "900.00", balance: "4,988.50", type: ["Pay Merchant", "with OD online"], other: ["1138423 -", "Test Fund"] },
  { receipt: "QAA9Z8Y7X6", date: "2026-09-24", time: "08:03:16", details: ["Merchant Payment from -", "254711***222 TEST", "PERSON TWO"], paidIn: "105.00", balance: "4,088.50", type: ["Pay Merchant"], other: ["1138423 -", "Test Fund"] },
  { receipt: "QAB5M4N3P2", date: "2026-09-16", time: "06:58:35", details: ["Pay merchant Charge"], withdrawn: "-16.50", balance: "3,983.50", type: ["Pay Merchant"], other: ["1138423 -", "Test Fund"] },
  { receipt: "QAB5M4N3P2", date: "2026-09-16", time: "06:58:35", details: ["Merchant Payment from -", "254722***333 TEST", "PERSON THREE"], paidIn: "3,000.00", balance: "4,000.00", type: ["Pay Merchant"], other: ["1138423 -", "Test Fund"] },
  { receipt: "QAC8K7J6H5", date: "2026-09-12", time: "11:48:43", details: ["Merchant Payment from -", "254733***444 Test", "Person Four"], paidIn: "300.00", balance: "1,000.00", type: ["Pay Merchant"], other: ["1138423 -", "Test Fund"] },
];
// The balances above reconcile, oldest transaction to newest:
//   300 paid in            -> 1,000.00   (the first transaction in a statement is trusted as the starting point)
//   3,000 in, 16.50 charge -> 4,000.00, then 3,983.50
//   105 in                 -> 4,088.50
//   900 in, 4.95 charge    -> 4,988.50, then 4,983.55  (the closing balance)

test("detectDirection learns which way is down from a time sitting below its date", () => {
  const down = buildPage(ROWS);
  assert.equal(detectDirection(down), 1);
  const up = buildPage(ROWS, { flip: true });
  assert.equal(detectDirection(up), -1);
  assert.equal(detectDirection([text("hello", 1, 1)]), null);
});

test("every transaction is rebuilt from its wrapped cells: receipt, date AND time, joined details, amounts", () => {
  const { rows } = readTablePage(buildPage(ROWS));
  assert.equal(rows.length, 6);

  assert.equal(rows[0].receiptNo, "QAA1B2C3D4");
  assert.equal(rows[0].completionTime, "2026-09-29 18:36:54");
  assert.equal(rows[0].details, "Pay merchant Charge");
  assert.equal(rows[0].withdrawn, "-4.95");
  assert.equal(rows[0].paidIn, "");
  assert.equal(rows[0].balance, "4,983.55");
  assert.equal(rows[0].transactionStatus, "Completed");

  assert.equal(rows[1].details, "Merchant Payment Online from - 254700***111 TEST PERSON ONE");
  assert.equal(rows[1].paidIn, "900.00");
  assert.equal(rows[1].withdrawn, "");
  assert.equal(rows[1].balance, "4,988.50");

  assert.equal(rows[2].details, "Merchant Payment from - 254711***222 TEST PERSON TWO");
  assert.equal(rows[4].paidIn, "3,000.00");
});

test("the empty second table, its header, section titles and the page footer never become rows or leak into the last row", () => {
  const { rows } = readTablePage(buildPage(ROWS));
  assert.equal(rows.length, 6);
  const last = rows[rows.length - 1];
  assert.equal(last.details, "Merchant Payment from - 254733***444 Test Person Four");
  assert.ok(!last.details.includes("Utility"));
  assert.ok(!last.details.includes("Disclaimer"));
  assert.ok(rows.every((r) => !r.receiptNo.includes("P9XWWGK2")));
});

test("works the same when the PDF library counts height from the bottom of the page", () => {
  const down = readTablePage(buildPage(ROWS)).rows;
  const up = readTablePage(buildPage(ROWS, { flip: true })).rows;
  assert.deepEqual(up, down);
});

test("the rebuilt rows flow through the real statement parser and pass the balance integrity check", () => {
  const { rows } = readTablePage(buildPage(ROWS));
  const parsed = parseStatementRows(rows);
  assert.equal(parsed.rows.length, 6);
  assert.equal(parsed.integrityOk, true);
  assert.deepEqual(parsed.brokenReceipts, []);
  assert.equal(parsed.totalPaidIn, 900 + 105 + 3000 + 300);
  assert.equal(parsed.reportedClosingBalance, 4983.55);

  const payments = parsed.rows.filter((r) => r.kind === "payment");
  const charges = parsed.rows.filter((r) => r.kind === "charge");
  assert.equal(payments.length, 4);
  assert.equal(charges.length, 2);
  assert.equal(payments[0].payerPhoneMasked, "254700***111");
  assert.equal(payments[0].payerName, "TEST PERSON ONE");
  // A charge shown as a negative number is stored as a positive amount.
  assert.equal(charges[0].amount, 4.95);
});

test("a misread digit is caught: corrupting one balance breaks the integrity check", () => {
  const corrupted = ROWS.map((r) => ({ ...r }));
  corrupted[2] = { ...corrupted[2], balance: "4,188.50" }; // should be 4,088.50
  const { rows } = readTablePage(buildPage(corrupted));
  const parsed = parseStatementRows(rows);
  assert.equal(parsed.integrityOk, false);
});

test("a continuation page with no header repeats the column layout learned from the previous page", () => {
  const first = readTablePage(buildPage(ROWS.slice(0, 3)));
  assert.ok(first.centres);
  const second = readTablePage(buildPage(ROWS.slice(3), { withHeader: false }), {
    centres: first.centres,
    direction: first.direction,
  });
  assert.equal(second.rows.length, 3);
  assert.equal(second.rows[0].receiptNo, "QAB5M4N3P2");
});

test("a page with no table at all (for example a picture-only PDF) yields no rows rather than garbage", () => {
  const onlyFooter: PdfTextItem[] = [text("Disclaimer:", 64, 677), text("Any", 103, 677), text("personal", 118, 677)];
  const result = readTablePage(onlyFooter);
  assert.equal(result.rows.length, 0);
  assert.equal(result.headerFound, false);
});

test("whole-phrase text pieces (header as 'Receipt No.', date and time together) are read just like single words", () => {
  const fine = readTablePage(buildPage(ROWS)).rows;
  const coarse = readTablePage(buildPage(ROWS, { coarse: true })).rows;
  assert.equal(coarse.length, 6);
  assert.deepEqual(
    coarse.map((r) => ({ ...r, details: r.details })),
    fine
  );
  assert.equal(coarse[0].completionTime, "2026-09-29 18:36:54");
  assert.ok(parseStatementRows(coarse).integrityOk);
});

test("splitIntoWords splits phrases into positioned words and leaves single words alone", () => {
  const words = splitIntoWords([
    { str: "Receipt No.", x: 100, y: 10, width: 55 },
    { str: "Details", x: 200, y: 10, width: 30 },
    { str: "   ", x: 300, y: 10, width: 5 },
  ]);
  assert.deepEqual(words.map((w) => w.str), ["Receipt", "No.", "Details"]);
  assert.ok(words[1].x > words[0].x);
  assert.ok(words[0].x === 100 && words[2].x === 200);
});

test("maskText hides names, numbers and amounts but keeps the statement's own structural words", () => {
  assert.equal(maskText("UIT3W8YRNG"), "AAA9A9AAAA");
  assert.equal(maskText("254727***362"), "999999***999");
  assert.equal(maskText("MAQLINE WAFULA"), "AAAAAAA AAAAAA");
  assert.equal(maskText("Merchant Payment Online from - 254727***362"), "Merchant Payment Online from - 999999***999");
  assert.equal(maskText("16,048.41"), "99,999.99");
  assert.equal(maskText("Receipt No."), "Receipt No.");
});

test("the failure diagnostic shows layout but contains no names, phone numbers or amounts", () => {
  const page = buildPage(ROWS);
  const report = describeItemsForDebug([page]);
  assert.ok(report.includes("header \"Receipt\" found: yes"));
  assert.ok(!report.includes("TEST PERSON"));
  assert.ok(!report.includes("254700"));
  assert.ok(!report.includes("4,983.55"));
  assert.ok(!report.includes("QAA1B2C3D4"));
});
