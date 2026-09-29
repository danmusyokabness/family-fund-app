import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDashboard, type DashboardInput, type DashboardMember } from "../lib/dashboard.ts";

const oldMember: DashboardMember = { id: "A", fullName: "Old Member", joinedOn: "2026-08-01", dateOfBirth: "1950-03-01" };
const youngMember: DashboardMember = { id: "B", fullName: "Young Member", joinedOn: "2026-08-01", dateOfBirth: "1990-01-01" };
const lateNoDob: DashboardMember = { id: "C", fullName: "Zed Latecomer", joinedOn: "2026-09-01", dateOfBirth: null };
const earlyNoDob: DashboardMember = { id: "D", fullName: "Alpha Nodob", joinedOn: "2026-08-01", dateOfBirth: null };

function input(overrides: Partial<DashboardInput>): DashboardInput {
  return {
    members: [],
    allocations: [],
    payments: [],
    expensesTotal: 0,
    targetAmount: 300,
    asOfMonth: "2026-09",
    viewerMemberId: null,
    ...overrides,
  };
}

test("members are sorted eldest first; anyone without a birth date comes after, alphabetically", () => {
  const result = buildDashboard(input({ members: [lateNoDob, youngMember, earlyNoDob, oldMember] }));
  assert.deepEqual(
    result.rows.map((r) => r.fullName),
    ["Old Member", "Young Member", "Alpha Nodob", "Zed Latecomer"]
  );
});

test("grid cells: paid, prepaid ahead, unpaid, before joining, and future months", () => {
  const result = buildDashboard(
    input({
      members: [oldMember, youngMember, lateNoDob, earlyNoDob],
      allocations: [
        { memberId: "A", amount: 600, paidAt: "2026-09-03T08:00:00Z" },
        { memberId: "B", amount: 1000, paidAt: "2026-09-05T08:00:00Z" },
      ],
    })
  );
  assert.equal(result.months.length, 12);
  assert.equal(result.months[0], "2026-08");

  const [a, b, d, c] = result.rows; // old, young, Alpha (no dob), Zed (no dob)

  assert.deepEqual(a.cells.slice(0, 3).map((x) => x.status), ["paid", "paid", "future"]);
  assert.equal(a.fyTotal, 600);
  assert.equal(a.balance, 0);

  // 1000 with two months due (600): 400 spills ahead — Oct fully prepaid, Nov part-prepaid.
  assert.deepEqual(
    b.cells.slice(0, 5).map((x) => [x.status, x.paid]),
    [["paid", 300], ["paid", 300], ["prepaid", 300], ["prepaid", 100], ["future", 0]]
  );
  assert.equal(b.credit, 400);
  assert.equal(b.balance, 0);

  // Joined in September: August is before joining, September is owed.
  assert.deepEqual(c.cells.slice(0, 3).map((x) => x.status), ["before_joining", "unpaid", "future"]);
  assert.equal(c.balance, 300);

  assert.deepEqual(d.cells.slice(0, 2).map((x) => x.status), ["unpaid", "unpaid"]);
  assert.equal(d.balance, 600);
});

test("column totals add up what the ledger shows covered in each month", () => {
  const result = buildDashboard(
    input({
      members: [oldMember, youngMember],
      allocations: [
        { memberId: "A", amount: 600, paidAt: "2026-09-03T08:00:00Z" },
        { memberId: "B", amount: 1000, paidAt: "2026-09-05T08:00:00Z" },
      ],
    })
  );
  assert.deepEqual(result.columnTotals.slice(0, 6), [600, 600, 300, 100, 0, 0]);
});

test("'me': balance, credit, unpaid wording and cash contributed this financial year", () => {
  const result = buildDashboard(
    input({
      members: [oldMember, earlyNoDob],
      allocations: [{ memberId: "A", amount: 600, paidAt: "2026-09-03T08:00:00Z" }],
      viewerMemberId: "D",
    })
  );
  assert.equal(result.me?.fullName, "Alpha Nodob");
  assert.equal(result.me?.balance, 600);
  assert.equal(result.me?.unpaidSummary, "Aug, Sep");
  assert.equal(result.me?.fyContributed, 0);
  assert.equal(result.rows.filter((r) => r.isMe).length, 1);
});

test("the superadmin (no member) sees no personal figures and no highlighted row", () => {
  const result = buildDashboard(input({ members: [oldMember], viewerMemberId: null }));
  assert.equal(result.me, null);
  assert.equal(result.rows.some((r) => r.isMe), false);
});

test("group cash figures: collected this month excludes ignored payments, adjustments and opening balances; fund total counts everything real minus expenses", () => {
  const result = buildDashboard(
    input({
      members: [oldMember],
      payments: [
        { amount: 600, kind: "mpesa", paidAt: "2026-09-03T08:00:00Z", matchStatus: "matched" },
        { amount: 300, kind: "manual", paidAt: "2026-09-10T08:00:00Z", matchStatus: "unmatched" },
        { amount: 500, kind: "adjustment", paidAt: "2026-09-12T08:00:00Z", matchStatus: "matched" },
        { amount: 1000, kind: "opening", paidAt: "2026-08-01T08:00:00Z", matchStatus: "matched" },
        { amount: 300, kind: "mpesa", paidAt: "2026-09-15T08:00:00Z", matchStatus: "ignored" },
        { amount: 300, kind: "mpesa", paidAt: "2026-08-20T08:00:00Z", matchStatus: "matched" },
      ],
      expensesTotal: 35,
    })
  );
  // September: 600 + 300 (an unmatched payment is still real money in) = 900.
  assert.equal(result.group.monthCollected, 900);
  // 600 + 300 + 500 + 1000 + 300 = 2700, minus 35 of charges.
  assert.equal(result.group.fundTotal, 2665);
});

test("a payment just after midnight in Nairobi is counted in the new month, not the old one", () => {
  const result = buildDashboard(
    input({
      members: [oldMember],
      asOfMonth: "2026-09",
      payments: [
        // 10pm UTC on 31 Aug = 1am 1 Sep in Nairobi: September.
        { amount: 300, kind: "mpesa", paidAt: "2026-08-31T22:00:00Z", matchStatus: "matched" },
        // 8pm UTC on 30 Sep = 11pm 30 Sep in Nairobi: still September.
        { amount: 300, kind: "mpesa", paidAt: "2026-09-30T20:00:00Z", matchStatus: "matched" },
        // 9pm UTC on 30 Sep = midnight 1 Oct in Nairobi: October, not this month.
        { amount: 300, kind: "mpesa", paidAt: "2026-09-30T21:00:00Z", matchStatus: "matched" },
      ],
    })
  );
  assert.equal(result.group.monthCollected, 600);
});

test("cash contributed this year respects the financial-year boundary, in Nairobi time", () => {
  const member: DashboardMember = { id: "A", fullName: "Old Member", joinedOn: "2026-08-01", dateOfBirth: null };
  const allocations = [
    // 9pm UTC on 31 Jul 2027 = midnight 1 Aug 2027 Nairobi: belongs to FY 2027/2028.
    { memberId: "A", amount: 300, paidAt: "2027-07-31T21:00:00Z" },
    { memberId: "A", amount: 300, paidAt: "2027-07-15T08:00:00Z" },
  ];
  const oldYear = buildDashboard(input({ members: [member], allocations, asOfMonth: "2027-08", selectedFyMonth: "2026-10", viewerMemberId: "A" }));
  const newYear = buildDashboard(input({ members: [member], allocations, asOfMonth: "2027-08", viewerMemberId: "A" }));
  assert.equal(oldYear.fy.label, "FY 2026/2027");
  assert.equal(oldYear.me?.fyContributed, 300);
  assert.equal(newYear.fy.label, "FY 2027/2028");
  assert.equal(newYear.me?.fyContributed, 300);
});

test("arrears carried over from an earlier financial year are reported as 'brought forward'", () => {
  const member: DashboardMember = { id: "A", fullName: "Old Member", joinedOn: "2025-08-01", dateOfBirth: null };
  // Joined Aug 2025; today is Sep 2026 -> 14 months due (4200). Only 1000 paid, oldest first:
  // FY 2025/2026 (3600 due) gets all 1000, leaving 2600 unpaid from that year.
  const result = buildDashboard(
    input({
      members: [member],
      allocations: [{ memberId: "A", amount: 1000, paidAt: "2025-09-01T08:00:00Z" }],
      asOfMonth: "2026-09",
    })
  );
  const row = result.rows[0];
  assert.equal(row.broughtForward, 2600);
  assert.equal(row.balance, 3200);
  // In the new year's own columns, nothing has been covered yet.
  assert.equal(row.fyTotal, 0);
  assert.deepEqual(row.cells.slice(0, 2).map((c) => c.status), ["unpaid", "unpaid"]);
});

test("choosing an earlier financial year shows that year's months", () => {
  const member: DashboardMember = { id: "A", fullName: "Old Member", joinedOn: "2025-08-01", dateOfBirth: null };
  const result = buildDashboard(
    input({
      members: [member],
      allocations: [{ memberId: "A", amount: 3900, paidAt: "2025-09-01T08:00:00Z" }],
      asOfMonth: "2026-09",
      selectedFyMonth: "2025-10",
    })
  );
  assert.equal(result.fy.label, "FY 2025/2026");
  assert.equal(result.months[0], "2025-08");
  assert.equal(result.rows[0].cells.every((c) => c.status === "paid"), true);
  assert.equal(result.rows[0].fyTotal, 3600);
  assert.equal(result.rows[0].broughtForward, 0);
});

test("the list of selectable years runs from the earliest member's first year to the current one", () => {
  const member: DashboardMember = { id: "A", fullName: "Old Member", joinedOn: "2025-08-01", dateOfBirth: null };
  const result = buildDashboard(input({ members: [member], asOfMonth: "2026-09" }));
  assert.deepEqual(
    result.fyOptions.map((o) => o.label),
    ["FY 2025/2026", "FY 2026/2027"]
  );
});

test("with no members yet, the year list is just the current year and nothing crashes", () => {
  const result = buildDashboard(input({ members: [], asOfMonth: "2026-09" }));
  assert.deepEqual(result.fyOptions.map((o) => o.label), ["FY 2026/2027"]);
  assert.deepEqual(result.rows, []);
  assert.equal(result.group.fundTotal, 0);
});

test("money allocated to someone who is not in the member list (e.g. deactivated) adds no row and does not crash", () => {
  const result = buildDashboard(
    input({
      members: [oldMember],
      allocations: [{ memberId: "GONE", amount: 300, paidAt: "2026-09-03T08:00:00Z" }],
    })
  );
  assert.equal(result.rows.length, 1);
});
