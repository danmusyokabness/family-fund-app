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

test("fund total counts EVERY payment that arrived, including ones not credited to any member, minus expenses", () => {
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
  // 600 + 300 + 500 + 1000 + 300 (not credited to anyone, but still in the account) + 300 = 3000, minus 35 of charges.
  assert.equal(result.group.fundTotal, 2965);
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

test("full ledger: its final balance is exactly the dashboard's 'Total in account', money not credited to a member included in both", () => {
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
  // 600 + 300 + 500 + 1000 + 300 (ignored, but real money) = 2700, minus 234.95 spent.
  assert.equal(ledger.balance, 2465.05);
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

// ---------------------------------------------------------------------
// Payment purposes, and money that cannot be credited to anyone
// ---------------------------------------------------------------------
import { balanceAsOf } from "../lib/full-ledger.ts";
import { countsTowardMonthlyDues, isPaymentPurpose, PAYMENT_PURPOSES } from "../lib/payment-purpose.ts";

test("a stray payment nobody can be credited with still counts in the total in account and shows as other income (the 105 case)", () => {
  const payments = [pay("1", 16048.41 - 105, "2026-09-10T08:00:00Z"), pay("2", 105, "2026-09-24T05:03:16Z", { matchStatus: "ignored", memberNames: [] })];
  const ledger = buildFullLedger({ payments, expenses: [] });
  assert.equal(ledger.balance, 16048.41);
  const stray = ledger.months[0].entries.find((e) => e.id === "p-2")!;
  assert.equal(stray.category, "other_income");
  assert.equal(stray.label, "Other income");
  assert.equal(stray.money, 105);
  const dashboard = buildDashboard(
    input({ members: [oldMember], payments: payments.map((p) => ({ amount: p.amount, kind: "mpesa", paidAt: p.paidAt, matchStatus: p.matchStatus })) })
  );
  assert.equal(dashboard.group.fundTotal, 16048.41);
});

test("payment purposes: five of them, with 'monthly' as the default, and anything unknown is rejected", () => {
  assert.deepEqual([...PAYMENT_PURPOSES], ["monthly", "booster", "recovery", "donation", "other"]);
  assert.equal(isPaymentPurpose("booster"), true);
  assert.equal(isPaymentPurpose("gift"), false);
  assert.equal(isPaymentPurpose(undefined), false);
  assert.equal(countsTowardMonthlyDues(undefined), true);
  assert.equal(countsTowardMonthlyDues(null), true);
  assert.equal(countsTowardMonthlyDues("monthly"), true);
  assert.equal(countsTowardMonthlyDues("booster"), false);
  assert.equal(countsTowardMonthlyDues("recovery"), false);
});

test("a booster is credited to the giver but does NOT pay off any month; their monthly dues stay as they were", () => {
  const allocations = [
    { memberId: "A", amount: 300, paidAt: "2026-08-05T08:00:00Z", purpose: "monthly" }, // pays August only
    { memberId: "A", amount: 5000, paidAt: "2026-09-05T08:00:00Z", purpose: "booster" }, // extra, not for the months
  ];
  const result = buildDashboard(input({ members: [oldMember], allocations, viewerMemberId: "A" }));
  const row = result.rows[0];
  assert.equal(row.balance, 300); // September is still owed: the booster did not pay it
  assert.equal(row.credit, 0);
  assert.equal(result.group.monthCollected, 0);
  assert.ok(result.me && result.me.fyContributed >= 5300, "their total contributed includes the booster");
});

test("an allocation with no purpose (older data) is treated as monthly, so nothing changes for existing members", () => {
  const withPurpose = buildDashboard(input({ members: [oldMember], allocations: [{ memberId: "A", amount: 900, paidAt: "2026-08-05T08:00:00Z", purpose: "monthly" }] }));
  const without = buildDashboard(input({ members: [oldMember], allocations: [{ memberId: "A", amount: 900, paidAt: "2026-08-05T08:00:00Z" }] }));
  assert.deepEqual(without.rows, withPurpose.rows);
});

test("full ledger: boosters, recoveries and donations are their own categories and all count in the balance", () => {
  const ledger = buildFullLedger({
    payments: [
      pay("1", 300, "2026-09-03T08:00:00Z"),
      pay("2", 2000, "2026-09-04T08:00:00Z", { purpose: "booster", memberNames: ["Ann One"] }),
      pay("3", 500, "2026-09-05T08:00:00Z", { purpose: "donation", memberNames: [] }),
      pay("4", 700, "2026-09-06T08:00:00Z", { purpose: "other", memberNames: [] }),
    ],
    expenses: [],
  });
  assert.equal(ledger.balance, 3500);
  assert.equal(ledger.byCategory.contribution, 300);
  assert.equal(ledger.byCategory.booster, 2000);
  assert.equal(ledger.byCategory.donation, 500);
  assert.equal(ledger.byCategory.other_income, 700);
  const booster = ledger.months[0].entries.find((e) => e.id === "p-2")!;
  assert.equal(booster.label, "Ann One");
  assert.equal(booster.detail, "Not part of monthly dues");
});

test("full ledger: a recovery payment names the withdrawal it replaces, and the withdrawal shows how much has been recovered", () => {
  const ledger = buildFullLedger({
    payments: [
      pay("1", 3000, "2026-09-20T08:00:00Z", { purpose: "recovery", memberNames: ["Ann One"], relatedExpenseId: "w1" }),
      pay("2", 1500, "2026-09-25T08:00:00Z", { purpose: "recovery", memberNames: ["Bea Two"], relatedExpenseId: "w1" }),
    ],
    expenses: [exp("w1", "withdrawal", 10000, "2026-09-10T08:00:00Z", "Hospital bill")],
  });
  const entries = ledger.months[0].entries;
  assert.equal(entries.find((e) => e.id === "p-1")!.detail, "Replaces: Hospital bill");
  assert.equal(entries.find((e) => e.id === "e-w1")!.detail, "KES 4,500 of KES 10,000 recovered so far");
  assert.equal(ledger.byCategory.recovery, 4500);
  assert.equal(ledger.balance, -5500); // 4500 in, 10000 out
});

test("balanceAsOf gives the fund's balance at the end of a date, for comparing with a statement", () => {
  const ledger = buildFullLedger({
    payments: [pay("1", 1000, "2026-09-03T08:00:00Z"), pay("2", 300, "2026-09-20T08:00:00Z")],
    expenses: [exp("a", "charge", 10, "2026-09-20T08:00:00Z")],
  });
  assert.equal(balanceAsOf(ledger, "2026-09-02"), 0);
  assert.equal(balanceAsOf(ledger, "2026-09-03"), 1000);
  assert.equal(balanceAsOf(ledger, "2026-09-19"), 1000);
  assert.equal(balanceAsOf(ledger, "2026-09-20"), 1290);
  assert.equal(balanceAsOf(ledger, "2026-12-31"), 1290);
});

// ---------------------------------------------------------------------
// The "Other income and notes" section under the main ledger
// ---------------------------------------------------------------------
import { summariseOtherIncome } from "../lib/full-ledger.ts";

test("other income notes: boosters, recoveries, donations, stray payments and unmatched payments, newest first; credited monthly money is left out", () => {
  const ledger = buildFullLedger({
    payments: [
      pay("m1", 300, "2026-09-03T08:00:00Z"), // a normal, credited monthly contribution
      pay("b1", 2000, "2026-09-04T08:00:00Z", { purpose: "booster", memberNames: ["Ann One"] }),
      pay("s1", 105, "2026-09-24T05:00:00Z", { matchStatus: "ignored", memberNames: [], purpose: "other" }), // the stray payment
      pay("u1", 300, "2026-09-26T08:00:00Z", { matchStatus: "unmatched", memberNames: [] }), // waiting to be matched
      pay("d1", 500, "2026-09-10T08:00:00Z", { purpose: "donation", memberNames: [] }),
    ],
    expenses: [],
  });
  const summary = summariseOtherIncome(ledger);
  assert.deepEqual(summary.items.map((e) => e.id), ["p-u1", "p-s1", "p-d1", "p-b1"]); // newest first, m1 not included
  assert.equal(summary.total, 2905);
  assert.equal(summary.monthlyContributions, 300);
});

test("other income notes: the sum shown always adds up to the Total in account", () => {
  const ledger = buildFullLedger({
    payments: [
      pay("o", 1000, "2026-08-01T08:00:00Z", { kind: "opening" }),
      pay("a", -50, "2026-08-02T08:00:00Z", { kind: "adjustment", note: "Correction" }),
      pay("m1", 6000, "2026-09-03T08:00:00Z"),
      pay("b1", 2000, "2026-09-04T08:00:00Z", { purpose: "booster", memberNames: ["Ann One"] }),
      pay("r1", 1500, "2026-09-05T08:00:00Z", { purpose: "recovery", memberNames: ["Bea Two"], relatedExpenseId: "w1" }),
      pay("s1", 105, "2026-09-24T05:00:00Z", { matchStatus: "ignored", memberNames: [], purpose: "other" }),
      pay("u1", 300, "2026-09-26T08:00:00Z", { matchStatus: "needs_confirmation", memberNames: [] }),
    ],
    expenses: [exp("w1", "withdrawal", 4000, "2026-09-01T08:00:00Z", "Hospital bill"), exp("c1", "charge", 56.59, "2026-09-03T08:00:00Z"), exp("x1", "other", 20, "2026-09-07T08:00:00Z", "Bank fee")],
  });
  const s = summariseOtherIncome(ledger);
  assert.equal(Math.round((s.monthlyContributions + s.total + s.openingAndAdjustments - s.spent) * 100) / 100, s.balance);
  assert.equal(s.balance, ledger.balance);
  assert.equal(s.monthlyContributions, 6000);
  assert.equal(s.total, 2000 + 1500 + 105 + 300);
  assert.equal(s.openingAndAdjustments, 950);
  assert.equal(s.spent, 4076.59);
});

test("other income notes: nothing to list when all money is credited monthly contributions", () => {
  const summary = summariseOtherIncome(buildFullLedger({ payments: [pay("m1", 300, "2026-09-03T08:00:00Z")], expenses: [exp("c", "charge", 3.3, "2026-09-03T08:00:00Z")] }));
  assert.deepEqual(summary.items, []);
  assert.equal(summary.total, 0);
  assert.equal(summary.monthlyContributions, 300);
  assert.equal(summary.balance, 296.7);
});

test("a stray payment is described as other income, in plain words", () => {
  const ledger = buildFullLedger({ payments: [pay("s1", 105, "2026-09-24T05:00:00Z", { matchStatus: "ignored", memberNames: [], purpose: "other" })], expenses: [] });
  const entry = ledger.months[0].entries[0];
  assert.equal(entry.label, "Other income");
  assert.equal(entry.detail, "Stray payment, credited to no member");
});

// ---------------------------------------------------------------------
// Cancel out: erase a withdrawal, the deposit that put it back and the fee on that deposit
// ---------------------------------------------------------------------
import { checkCancelOut, toCents } from "../lib/cancel-out.ts";

const wd = (id: string, amount: number, kind = "withdrawal", orphanFee = false) => ({ id, kind, amount, orphanFee });
const dep = (id: string, amount: number, extra: Partial<{ kind: string; creditedToMonthlyDues: boolean; fee: number }> = {}) => ({ id, kind: "manual", amount, creditedToMonthlyDues: false, ...extra });

test("cancel out: a withdrawal and the deposit that put it back, equal amounts, no fee, is allowed with nothing left over", () => {
  assert.deepEqual(checkCancelOut([wd("w", 10000)], [dep("d", 10000)]), { ok: true, totalCents: 1000000, feeCents: 0, leftoverCents: 0, leftoverIsRounding: true });
});

test("cancel out: the fee charged on the deposit is part of the sum (deposit minus fee equals withdrawal)", () => {
  // a deposit of 1,010 with a fee of 10 leaves exactly the 1,000 that was taken out
  assert.deepEqual(checkCancelOut([wd("w", 1000)], [dep("d", 1010, { fee: 10 })]), { ok: true, totalCents: 100000, feeCents: 1000, leftoverCents: 0, leftoverIsRounding: true });
  // a deposit that only equals the withdrawal cannot also pay the fee: refused, and the message names the shortfall
  const short = checkCancelOut([wd("w", 1000)], [dep("d", 1000, { fee: 5.5 })]);
  assert.equal(short.ok, false);
  if (!short.ok) assert.ok(short.error.includes("KES 5.50 short"), short.error);
});

test("cancel out: fees with cents and whole-shilling deposits leave a few cents, which are kept as rounding and never lost", () => {
  // withdrawal 100, deposit 101, fee 0.55 -> 100.45 reaches the fund: 0.45 is rounding
  const result = checkCancelOut([wd("w", 100)], [dep("d", 101, { fee: 0.55 })]);
  assert.deepEqual(result, { ok: true, totalCents: 10000, feeCents: 55, leftoverCents: 45, leftoverIsRounding: true });
  // the books after: withdrawal gone (+100), deposit gone (-101), fee gone (+0.55), rounding line added (+0.45) -> unchanged
  assert.equal(toCents(100) - toCents(101) + toCents(0.55) + 45, 0);
});

test("cancel out: a leftover of KES 1 or more per deposit is too much to be rounding and is refused", () => {
  const result = checkCancelOut([wd("w", 100)], [dep("d", 102, { fee: 0.55 })]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.error.includes("too much to be rounding"), result.error);
  assert.equal(checkCancelOut([wd("w", 100)], [dep("a", 60, { fee: 0.3 }), dep("b", 41.2, { fee: 0.2 })]).ok, true); // two deposits may each carry up to KES 1
});

test("cancel out: one withdrawal put back in several deposits is allowed when they add up exactly (cents are exact)", () => {
  assert.equal(checkCancelOut([wd("w", 10000)], [dep("a", 6000), dep("b", 4000)]).ok, true);
  assert.equal(checkCancelOut([wd("w1", 0.1), wd("w2", 0.2)], [dep("d", 0.3)]).ok, true); // 0.1 + 0.2 is not 0.3 in plain arithmetic
  assert.equal(toCents(0.1) + toCents(0.2), toCents(0.3));
});

test("cancel out: money that does not add up is refused, and the message says by how much (so the total in account cannot move)", () => {
  const result = checkCancelOut([wd("w", 10000)], [dep("d", 9000)]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error.includes("KES 10,000") && result.error.includes("KES 9,000"), result.error);
    assert.ok(result.error.includes("KES 1,000 short"), result.error);
  }
});

test("cancel out: a hanging fee (its deposit already erased) can be cancelled against a deposit paid in to cover it; the extra stays as other income", () => {
  // the owner's case: a deposit of 105 and a hanging fee of 93 -> 12 stays in the fund
  const result = checkCancelOut([wd("fee", 93, "charge", true)], [dep("d", 105)]);
  assert.deepEqual(result, { ok: true, totalCents: 9300, feeCents: 0, leftoverCents: 1200, leftoverIsRounding: false });
  // erasing the fee (+93) and the deposit (-105) and adding the 12 line leaves the total exactly as it was
  assert.equal(93 * 100 - 105 * 100 + 1200, 0);
  // a deposit that does not cover the fee is refused, naming the shortfall
  const short = checkCancelOut([wd("fee", 93, "charge", true)], [dep("d", 90)]);
  assert.equal(short.ok, false);
  if (!short.ok) assert.ok(short.error.includes("KES 3 short"), short.error);
});

test("cancel out: a big leftover is only allowed together with a hanging fee, and a fee that still has its deposit can never be chosen on its own", () => {
  assert.equal(checkCancelOut([wd("w", 93)], [dep("d", 105)]).ok, false); // 12 extra with no hanging fee is not rounding
  const notHanging = checkCancelOut([wd("fee", 93, "charge", false)], [dep("d", 93)]);
  assert.equal(notHanging.ok, false);
  if (!notHanging.ok) assert.ok(notHanging.error.includes("still recorded"), notHanging.error);
});

test("cancel out: a fee can never be chosen on its own, and opening balances, adjustments and member-credited monthly deposits can never be cancelled", () => {
  const onlyFee = checkCancelOut([wd("c", 4.95, "charge")], [dep("d", 4.95)]);
  assert.equal(onlyFee.ok, false);
  if (!onlyFee.ok) assert.ok(onlyFee.error.includes("still recorded"), onlyFee.error);
  assert.equal(checkCancelOut([wd("w", 100, "mystery")], [dep("d", 100)]).ok, false);
  assert.equal(checkCancelOut([wd("w", 100)], [dep("d", 100, { kind: "opening" })]).ok, false);
  assert.equal(checkCancelOut([wd("w", 100)], [dep("d", 100, { kind: "adjustment" })]).ok, false);
  const credited = checkCancelOut([wd("w", 300)], [dep("d", 300, { creditedToMonthlyDues: true })]);
  assert.equal(credited.ok, false);
  if (!credited.ok) assert.ok(credited.error.includes("monthly dues"));
  assert.equal(checkCancelOut([wd("w", 100, "other")], [dep("d", 100)]).ok, true); // an "other" expense may be cancelled
});

test("cancel out: both sides are needed, with no repeats and no zero amounts", () => {
  assert.equal(checkCancelOut([], [dep("d", 100)]).ok, false);
  assert.equal(checkCancelOut([wd("w", 100)], []).ok, false);
  assert.equal(checkCancelOut([wd("w", 100), wd("w", 100)], [dep("a", 100), dep("b", 100)]).ok, false); // the same withdrawal twice
  assert.equal(checkCancelOut([wd("w", 0)], [dep("d", 0)]).ok, false);
  assert.equal(checkCancelOut(Array.from({ length: 21 }, (_, i) => wd(`w${i}`, 1)), [dep("d", 21)]).ok, false); // too many at once
});

test("cancel out: removing the pair leaves the Total in account and every figure derived from it exactly as it was", () => {
  const base = [pay("m1", 16000, "2026-09-03T08:00:00Z")];
  const withPair = {
    payments: [...base, pay("back", 5000, "2026-09-20T08:00:00Z", { kind: "manual", purpose: "recovery", memberNames: ["Ann One"], relatedExpenseId: "w1" })],
    expenses: [exp("w1", "withdrawal", 5000, "2026-09-10T08:00:00Z", "Emergency")],
  };
  const withoutPair = { payments: base, expenses: [] as FullLedgerExpense[] };
  assert.equal(buildFullLedger(withPair).balance, 16000);
  assert.equal(buildFullLedger(withoutPair).balance, 16000);
  const dashboardWith = buildDashboard(input({ members: [oldMember], payments: withPair.payments.map((p) => ({ amount: p.amount, kind: p.kind as "mpesa", paidAt: p.paidAt, matchStatus: p.matchStatus as "matched" })), expensesTotal: 5000 }));
  const dashboardWithout = buildDashboard(input({ members: [oldMember], payments: base.map((p) => ({ amount: p.amount, kind: p.kind as "mpesa", paidAt: p.paidAt, matchStatus: p.matchStatus as "matched" })), expensesTotal: 0 }));
  assert.equal(dashboardWith.group.fundTotal, dashboardWithout.group.fundTotal);
});

test("cancel out: erasing withdrawal, deposit and fee and adding the rounding line leaves the full ledger balance exactly as it was, with no label left behind", () => {
  const base = [pay("m1", 16000, "2026-09-03T08:00:00Z")];
  // before: withdrawal 100, a deposit of 101 that put it back, and the 0.55 fee on that deposit
  const before = {
    payments: [...base, pay("back", 101, "2026-09-20T08:00:00Z", { kind: "manual", purpose: "recovery", memberNames: ["Ann One"], relatedExpenseId: "w1" })],
    expenses: [exp("w1", "withdrawal", 100, "2026-09-10T08:00:00Z", "Emergency"), exp("fee1", "charge", 0.55, "2026-09-20T08:00:00Z", "Pay Bill Charge")],
  };
  // after: all three erased, one plain rounding line of 0.45
  const after = {
    payments: [...base, pay("round", 0.45, "2026-09-20T08:00:00Z", { kind: "manual", purpose: "other", matchStatus: "ignored", note: "Rounding" })],
    expenses: [] as FullLedgerExpense[],
  };
  assert.equal(buildFullLedger(before).balance, buildFullLedger(after).balance);
  const lines = JSON.stringify(buildFullLedger(after));
  assert.ok(!lines.includes("Emergency") && !lines.includes("Pay Bill Charge") && !lines.includes("Ann One"), "nothing about the erased entries may remain");
});

// ---------------------------------------------------------------------
// The Pay helper: how much to send for a number of months (lib/pay.ts)
// ---------------------------------------------------------------------
import { defaultMonths, monthsOwed, payAmount, MAX_PAY_MONTHS } from "../lib/pay.ts";

test("pay helper: months owed rounds up, and nothing is owed when the balance is zero or the monthly amount is unknown", () => {
  assert.equal(monthsOwed(300, 300), 1);
  assert.equal(monthsOwed(500, 300), 2);
  assert.equal(monthsOwed(600, 300), 2);
  assert.equal(monthsOwed(0, 300), 0);
  assert.equal(monthsOwed(-300, 300), 0); // credit ahead
  assert.equal(monthsOwed(500, 0), 0);
  assert.equal(defaultMonths(600, 300), 2);
  assert.equal(defaultMonths(0, 300), 1); // nothing owed: offer one month in advance
  assert.equal(defaultMonths(300 * 40, 300), MAX_PAY_MONTHS);
});

test("pay helper: paying what is owed costs exactly the balance, fewer months cost whole months, extra months are in advance", () => {
  // owes 500 with a monthly amount of 300 (2 months owed)
  assert.equal(payAmount(1, 500, 300), 300);
  assert.equal(payAmount(2, 500, 300), 500); // exactly the balance, not 600
  assert.equal(payAmount(3, 500, 300), 800); // balance + one month ahead
  // owes exactly two months
  assert.equal(payAmount(2, 600, 300), 600);
  // nothing owed or credit ahead: whole months in advance
  assert.equal(payAmount(1, 0, 300), 300);
  assert.equal(payAmount(3, -300, 300), 900);
  // M-PESA Till payments are whole shillings: a balance with cents is rounded up, never down
  assert.equal(payAmount(1, 250.4, 300), 251);
  // the number of months is kept sensible
  assert.equal(payAmount(0, 0, 300), 300);
  assert.equal(payAmount(99, 0, 300), MAX_PAY_MONTHS * 300);
});

