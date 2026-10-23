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

test("fund total counts every real payment (ignored ones left out) minus expenses", () => {
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
  // 600 + 300 + 500 + 1000 + 300 = 2700, minus 35 of charges. The ignored 300 is not counted.
  assert.equal(result.group.fundTotal, 2665);
});

test("group total this month is what the ledger covers for this month, money paid in advance included", () => {
  // Joined Aug; September is the current month. 900 in total: Aug 300, Sep 300, Oct (ahead) 300.
  const result = buildDashboard(
    input({ members: [oldMember], allocations: [{ memberId: "A", amount: 900, paidAt: "2026-08-05T08:00:00Z" }] })
  );
  assert.equal(result.group.monthCollected, 300);
});

test("group total this month does not care WHEN the money arrived: all paid up, the figure is members x target every month", () => {
  const members: DashboardMember[] = [oldMember, youngMember, earlyNoDob];
  // Everyone paid 3,000 back in August, long before September.
  const allocations = members.map((m) => ({ memberId: m.id, amount: 3000, paidAt: "2026-08-02T08:00:00Z" }));
  for (const asOfMonth of ["2026-09", "2026-10", "2026-12", "2027-03"]) {
    const result = buildDashboard(input({ members, allocations, asOfMonth }));
    assert.equal(result.group.monthCollected, 900, `3 paid-up members x 300 in ${asOfMonth}`);
  }
});

test("a member who owes this month lowers the group total by what is missing", () => {
  const result = buildDashboard(
    input({
      members: [oldMember, youngMember],
      allocations: [
        { memberId: "A", amount: 3000, paidAt: "2026-08-02T08:00:00Z" }, // paid ahead
        { memberId: "B", amount: 300, paidAt: "2026-08-02T08:00:00Z" }, // only August: owes September
      ],
    })
  );
  assert.equal(result.group.monthCollected, 300);
});

test("a partly paid month counts only the part paid, and a member who has not joined yet adds nothing", () => {
  const result = buildDashboard(
    input({
      members: [oldMember, lateNoDob],
      asOfMonth: "2026-08",
      allocations: [{ memberId: "A", amount: 100, paidAt: "2026-08-02T08:00:00Z" }],
    })
  );
  assert.equal(result.group.monthCollected, 100); // A paid 100 of 300; C joins in September
});

test("the group total for this month is the same whichever financial year is being viewed", () => {
  const allocations = [{ memberId: "A", amount: 900, paidAt: "2026-08-05T08:00:00Z" }];
  const current = buildDashboard(input({ members: [oldMember], allocations, asOfMonth: "2027-08" }));
  const looking_back = buildDashboard(input({ members: [oldMember], allocations, asOfMonth: "2027-08", selectedFyMonth: "2026-10" }));
  assert.equal(looking_back.group.monthCollected, current.group.monthCollected);
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

// ---------------------------------------------------------------------
// The full ledger (lib/full-ledger.ts)
// ---------------------------------------------------------------------
import { buildFullLedger, type FullLedgerExpense, type FullLedgerPayment } from "../lib/full-ledger.ts";

const pay = (id: string, amount: number, paidAt: string, extra: Partial<FullLedgerPayment> = {}): FullLedgerPayment => ({
  id, amount, kind: "mpesa", paidAt, matchStatus: "matched", memberNames: ["Test Member"], note: null, ...extra,
});
const exp = (id: string, kind: string, amount: number, occurredAt: string, description: string | null = null): FullLedgerExpense => ({
  id, kind, amount, occurredAt, description,
});

test("full ledger: its final balance is exactly the dashboard's 'Total in account', ignored payments left out of both", () => {
  const payments = [
    pay("1", 600, "2026-09-03T08:00:00Z"),
    pay("2", 300, "2026-09-10T08:00:00Z", { kind: "manual", matchStatus: "unmatched", memberNames: [] }),
    pay("3", 500, "2026-09-12T08:00:00Z", { kind: "adjustment", note: "Correction" }),
    pay("4", 1000, "2026-08-01T08:00:00Z", { kind: "opening" }),
    pay("5", 300, "2026-09-15T08:00:00Z", { matchStatus: "ignored" }),
  ];
  const expenses = [exp("a", "charge", 4.95, "2026-09-03T08:00:00Z"), exp("b", "withdrawal", 200, "2026-09-20T08:00:00Z", "Hospital bill"), exp("c", "other", 30, "2026-09-21T08:00:00Z", "Bank fee")];
  const ledger = buildFullLedger({ payments, expenses });
  const dashboard = buildDashboard(
    input({
      members: [oldMember],
      payments: payments.map((p) => ({ amount: p.amount, kind: p.kind as "mpesa", paidAt: p.paidAt, matchStatus: p.matchStatus as "matched" })),
      expensesTotal: expenses.reduce((n, e) => n + e.amount, 0),
    })
  );
  assert.equal(ledger.balance, dashboard.group.fundTotal);
  assert.equal(ledger.balance, 2165.05);
});

test("full ledger: every kind of movement is categorised and labelled for people to read", () => {
  const ledger = buildFullLedger({
    payments: [
      pay("1", 300, "2026-09-03T08:00:00Z", { memberNames: ["Ann One", "Bea Two"] }),
      pay("2", 300, "2026-09-04T08:00:00Z", { memberNames: [], matchStatus: "needs_confirmation" }),
      pay("3", 300, "2026-09-05T08:00:00Z", { memberNames: [], matchStatus: "unmatched" }),
      pay("4", 1000, "2026-08-01T08:00:00Z", { kind: "opening" }),
    ],
    expenses: [exp("a", "charge", 3.3, "2026-09-03T08:00:00Z", "Pay merchant Charge"), exp("b", "withdrawal", 500, "2026-09-06T08:00:00Z", "Funeral support"), exp("c", "other", 20, "2026-09-07T08:00:00Z")],
  });
  const all = ledger.months.flatMap((m) => m.entries);
  const byId = (id: string) => all.find((e) => e.id === id)!;
  assert.equal(byId("p-1").label, "Ann One, Bea Two");
  assert.equal(byId("p-1").category, "contribution");
  assert.equal(byId("p-2").label, "Payment awaiting confirmation");
  assert.equal(byId("p-2").awaitingMember, true);
  assert.equal(byId("p-3").label, "Payment not yet matched to a member");
  assert.equal(byId("p-4").category, "opening");
  assert.equal(byId("e-a").category, "charge");
  assert.equal(byId("e-a").detail, "Pay merchant Charge");
  assert.equal(byId("e-a").money, -3.3);
  assert.equal(byId("e-b").label, "Funeral support");
  assert.equal(byId("e-b").category, "withdrawal");
  assert.equal(byId("e-c").label, "Other expense");
  assert.equal(ledger.byCategory.contribution, 900);
  assert.equal(ledger.byCategory.withdrawal, 500);
  assert.equal(ledger.byCategory.charge, 3.3);
  assert.equal(ledger.byCategory.other, 20);
  assert.equal(ledger.byCategory.opening, 1000);
});

test("full ledger: the running balance follows time, and a payment comes before the charge taken at the same moment", () => {
  const ledger = buildFullLedger({
    payments: [pay("1", 900, "2026-09-29T15:36:54Z"), pay("2", 105, "2026-09-24T05:03:16Z")],
    expenses: [exp("a", "charge", 4.95, "2026-09-29T15:36:54Z")],
  });
  const september = ledger.months[0].entries; // newest first
  assert.deepEqual(september.map((e) => e.id), ["e-a", "p-1", "p-2"]);
  assert.deepEqual(september.map((e) => e.balanceAfter), [1000.05, 1005, 105]);
});

test("full ledger: months are newest first, grouped by NAIROBI month, with money in/out and a closing balance", () => {
  const ledger = buildFullLedger({
    payments: [pay("1", 300, "2026-09-30T21:30:00Z"), pay("2", 300, "2026-09-10T08:00:00Z")], // the first is 00:30 on 1 October in Nairobi
    expenses: [exp("a", "withdrawal", 100, "2026-10-05T08:00:00Z", "Help")],
  });
  assert.deepEqual(ledger.months.map((m) => m.month), ["2026-10", "2026-09"]);
  const october = ledger.months[0];
  assert.equal(october.entries.find((e) => e.id === "p-1")?.date, "2026-10-01");
  assert.equal(october.entries.find((e) => e.id === "p-1")?.time, "00:30");
  assert.equal(october.moneyIn, 300);
  assert.equal(october.moneyOut, 100);
  assert.equal(october.closingBalance, 500);
  assert.equal(ledger.months[1].closingBalance, 300);
  assert.equal(ledger.totalIn, 600);
  assert.equal(ledger.totalOut, 100);
});

test("full ledger: an empty fund gives an empty ledger, and entries carry no phone numbers or receipt numbers", () => {
  const empty = buildFullLedger({ payments: [], expenses: [] });
  assert.deepEqual(empty.months, []);
  assert.equal(empty.balance, 0);
  const one = buildFullLedger({ payments: [pay("1", 300, "2026-09-03T08:00:00Z")], expenses: [] });
  const keys = Object.keys(one.months[0].entries[0]).sort();
  assert.deepEqual(keys, ["awaitingMember", "balanceAfter", "category", "date", "detail", "id", "label", "money", "month", "time"]);
});
