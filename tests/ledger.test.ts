import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMemberLedger, groupMonthsByFY, summarizeUnpaidMonths } from "../lib/ledger.ts";

const TARGET = 300;

test("a member with zero payments owes every due month", () => {
  const result = computeMemberLedger({
    joinedOn: "2026-08",
    targetAmount: TARGET,
    totalAllocated: 0,
    asOfMonth: "2026-08",
  });
  assert.equal(result.months.length, 1);
  assert.equal(result.months[0].status, "unpaid");
  assert.equal(result.totalDue, 300);
  assert.equal(result.totalPaid, 0);
  assert.equal(result.balance, 300);
  assert.equal(result.creditBalance, 0);
  assert.deepEqual(result.unpaidMonths, ["2026-08"]);
});

test("late joiner: only owes from their own joining month, not before", () => {
  // Joined October, "today" is December: October, November, December are due (900),
  // but a single 300 payment should only cover the OLDEST due month (October).
  const result = computeMemberLedger({
    joinedOn: "2026-10",
    targetAmount: TARGET,
    totalAllocated: 300,
    asOfMonth: "2026-12",
  });
  assert.deepEqual(
    result.months.map((m) => m.month),
    ["2026-10", "2026-11", "2026-12"]
  );
  assert.equal(result.months[0].status, "paid");
  assert.equal(result.months[1].status, "unpaid");
  assert.equal(result.months[2].status, "unpaid");
  assert.equal(result.totalDue, 900);
  assert.equal(result.totalPaid, 300);
  assert.equal(result.balance, 600);
  assert.deepEqual(result.unpaidMonths, ["2026-11", "2026-12"]);
});

test("multi-month payment: a single 1000 payment fills months oldest-first and spills into credit", () => {
  // Only August is due (300). The other 700 becomes credit ahead:
  // 300 fully prepays September, 300 fully prepays October, 100 partially prepays November.
  const result = computeMemberLedger({
    joinedOn: "2026-08",
    targetAmount: TARGET,
    totalAllocated: 1000,
    asOfMonth: "2026-08",
  });
  assert.equal(result.months.length, 1);
  assert.equal(result.months[0].status, "paid");
  assert.equal(result.totalDue, 300);
  assert.equal(result.totalPaid, 300);
  assert.equal(result.balance, 0);
  assert.equal(result.creditBalance, 700);

  assert.deepEqual(
    result.prepaidMonths.map((m) => [m.month, m.paid, m.status]),
    [
      ["2026-09", 300, "prepaid"],
      ["2026-10", 300, "prepaid"],
      ["2026-11", 100, "prepaid"],
    ]
  );
});

test("overpayment with multiple due months already covered", () => {
  // Two months due (Aug, Sep = 600). A 1500 payment covers both, plus 900 credit ahead
  // (three more fully prepaid months: Oct, Nov, Dec).
  const result = computeMemberLedger({
    joinedOn: "2026-08",
    targetAmount: TARGET,
    totalAllocated: 1500,
    asOfMonth: "2026-09",
  });
  assert.equal(result.balance, 0);
  assert.equal(result.creditBalance, 900);
  assert.equal(result.months.every((m) => m.status === "paid"), true);
  assert.deepEqual(
    result.prepaidMonths.map((m) => m.month),
    ["2026-10", "2026-11", "2026-12"]
  );
});

test("partial month: the most recent due month can be partially covered", () => {
  // Three months due (Aug, Sep, Oct = 900). 700 paid: Aug and Sep fully paid (600),
  // Oct gets the remaining 100 and is "partial", not "unpaid".
  const result = computeMemberLedger({
    joinedOn: "2026-08",
    targetAmount: TARGET,
    totalAllocated: 700,
    asOfMonth: "2026-10",
  });
  assert.deepEqual(
    result.months.map((m) => [m.month, m.paid, m.status]),
    [
      ["2026-08", 300, "paid"],
      ["2026-09", 300, "paid"],
      ["2026-10", 100, "partial"],
    ]
  );
  assert.equal(result.balance, 200);
  assert.deepEqual(result.unpaidMonths, ["2026-10"]);
});

test("arrears carried across a financial-year boundary", () => {
  // Joined Aug 2025 (FY 2025/2026). "Today" is Sep 2026 (FY 2026/2027).
  // FY 2025/2026 (Aug25-Jul26, 12 months = 3600) is fully paid.
  // FY 2026/2027: only Aug26 and Sep26 are due so far (600). Aug26 is paid, Sep26 is not.
  const result = computeMemberLedger({
    joinedOn: "2025-08",
    targetAmount: TARGET,
    totalAllocated: 3900,
    asOfMonth: "2026-09",
  });

  assert.equal(result.months.length, 14); // 12 months of FY1 + Aug/Sep of FY2
  assert.equal(result.totalDue, 4200);
  assert.equal(result.totalPaid, 3900);
  assert.equal(result.balance, 300);
  assert.deepEqual(result.unpaidMonths, ["2026-09"]);

  const byFY = groupMonthsByFY(result.months);
  assert.equal(byFY.length, 2);

  const fy1 = byFY.find((g) => g.label === "FY 2025/2026")!;
  assert.equal(fy1.due, 3600);
  assert.equal(fy1.paid, 3600);
  assert.equal(fy1.balance, 0);

  const fy2 = byFY.find((g) => g.label === "FY 2026/2027")!;
  assert.equal(fy2.due, 600);
  assert.equal(fy2.paid, 300);
  assert.equal(fy2.balance, 300);
});

test("a member who joins in a future month has no due months yet", () => {
  const result = computeMemberLedger({
    joinedOn: "2027-01",
    targetAmount: TARGET,
    totalAllocated: 0,
    asOfMonth: "2026-12",
  });
  assert.deepEqual(result.months, []);
  assert.equal(result.totalDue, 0);
  assert.equal(result.balance, 0);
});

test("computeMemberLedger rejects an invalid target amount", () => {
  assert.throws(() =>
    computeMemberLedger({ joinedOn: "2026-08", targetAmount: 0, totalAllocated: 0, asOfMonth: "2026-08" })
  );
});

test("computeMemberLedger rejects a negative total allocated", () => {
  assert.throws(() =>
    computeMemberLedger({ joinedOn: "2026-08", targetAmount: 300, totalAllocated: -1, asOfMonth: "2026-08" })
  );
});

// ---- summarizeUnpaidMonths: the wording used in the 7th reminder --------

test("summarizeUnpaidMonths: fully paid", () => {
  assert.equal(summarizeUnpaidMonths([]), "");
});

test("summarizeUnpaidMonths: a short list is spelled out", () => {
  assert.equal(summarizeUnpaidMonths(["2026-08", "2026-09", "2026-10"]), "Aug, Sep, Oct");
});

test("summarizeUnpaidMonths: exactly 4 months is still spelled out", () => {
  assert.equal(
    summarizeUnpaidMonths(["2026-08", "2026-09", "2026-10", "2026-11"]),
    "Aug, Sep, Oct, Nov"
  );
});

test("summarizeUnpaidMonths: more than 4 months is summarised with a start date", () => {
  assert.equal(
    summarizeUnpaidMonths(["2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]),
    "6 months unpaid since Aug 2026"
  );
});
