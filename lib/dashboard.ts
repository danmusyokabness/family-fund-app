// lib/dashboard.ts
//
// Turns raw members, payment allocations and payments into everything
// the member dashboard shows: the four summary cards and the full
// ledger grid. Pure — no database, no cookies — so the numbers can be
// tested with plain data. The API route loads the rows and calls this.
//
// Two different kinds of "total" are used on purpose, and they are kept
// apart so the dashboard never mixes them up:
//
//  * LEDGER numbers (each member's balance, the grid cells, "brought
//    forward") come from the FIFO engine in lib/ledger.ts: every
//    allocated shilling fills the member's oldest unpaid month first.
//
//  * CASH numbers ("contributed this year", "collected this month",
//    "total in account") are about when money actually ARRIVED, read
//    straight from the payment dates in Nairobi time. A member who
//    pays three months at once in September has 900 of cash in
//    September, however the ledger spreads it across months.
//
// Who is a "member" here: only active members appear in the grid.
// Money paid by, or allocated to, an inactive member still counts in
// the fund's cash totals — it is real money in the Till.

import {
  compareMonthKeys,
  DEFAULT_FY_START_MONTH,
  addMonths,
  fyRangeForMonth,
  monthKeyFromDateString,
  monthKeyFromInstant,
  monthsBetweenInclusive,
  type FYRange,
  type MonthKey,
} from "./dates.ts";
import {
  computeMemberLedger,
  groupMonthsByFY,
  summarizeUnpaidMonths,
  type MonthStatus,
} from "./ledger.ts";

export interface DashboardMember {
  id: string;
  fullName: string;
  /** "YYYY-MM-DD" — the first day of the month they started owing. */
  joinedOn: string;
  /** "YYYY-MM-DD" from the linked family-tree node, or null if not known yet. Used only for sorting. */
  dateOfBirth: string | null;
}

export interface DashboardAllocation {
  memberId: string;
  amount: number;
  /** When the payment behind this allocation arrived (ISO timestamp). */
  paidAt: string;
}

export interface DashboardPayment {
  amount: number;
  kind: string; // "mpesa" | "manual" | "adjustment" | "opening"
  paidAt: string;
  matchStatus: string; // "matched" | "needs_confirmation" | "unmatched" | "ignored"
}

export interface DashboardInput {
  members: DashboardMember[];
  allocations: DashboardAllocation[];
  payments: DashboardPayment[];
  /** Total of every fund expense (charges, withdrawals, other outflows). */
  expensesTotal: number;
  targetAmount: number;
  fyStartMonth?: number;
  /** "Today" as a Nairobi month. */
  asOfMonth: MonthKey;
  /** Any month inside the financial year to show. Defaults to the current one. */
  selectedFyMonth?: MonthKey | null;
  /** The logged-in member, or null for the superadmin (who has no personal figures). */
  viewerMemberId: string | null;
}

export type CellStatus = MonthStatus | "future";

export interface DashboardCell {
  status: CellStatus;
  paid: number;
  due: number;
}

export interface DashboardRow {
  memberId: string;
  fullName: string;
  isMe: boolean;
  cells: DashboardCell[];
  /** Unpaid from financial years before the selected one. */
  broughtForward: number;
  /** Total covered in the months of the selected year. */
  fyTotal: number;
  /** Everything this member has ever paid in. */
  allTimeTotal: number;
  /** What they owe right now, across all years (never negative). */
  balance: number;
  /** Money paid ahead of what is due so far. */
  credit: number;
}

export interface DashboardResult {
  asOfMonth: MonthKey;
  fy: FYRange;
  fyOptions: { label: string; startMonth: MonthKey }[];
  months: MonthKey[];
  targetAmount: number;
  me: {
    memberId: string;
    fullName: string;
    balance: number;
    credit: number;
    unpaidSummary: string;
    /** Cash contributed during the selected financial year. */
    fyContributed: number;
  } | null;
  group: {
    /** Cash collected during the current month. */
    monthCollected: number;
    /** Everything paid in, minus everything spent — what should be in the Till. */
    fundTotal: number;
  };
  rows: DashboardRow[];
  /** Per month of the selected year: how much the ledger shows covered, across all shown members. */
  columnTotals: number[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Eldest first by known date of birth; anyone without one comes after, alphabetically. */
function compareEldestFirst(a: DashboardMember, b: DashboardMember): number {
  if (a.dateOfBirth && b.dateOfBirth) {
    if (a.dateOfBirth !== b.dateOfBirth) return a.dateOfBirth < b.dateOfBirth ? -1 : 1;
  } else if (a.dateOfBirth) {
    return -1;
  } else if (b.dateOfBirth) {
    return 1;
  }
  return a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" });
}

export function buildDashboard(input: DashboardInput): DashboardResult {
  const fyStartMonth = input.fyStartMonth ?? DEFAULT_FY_START_MONTH;
  const fy = fyRangeForMonth(input.selectedFyMonth ?? input.asOfMonth, fyStartMonth);
  const months = monthsBetweenInclusive(fy.startMonth, fy.endMonth);

  // ---- Everything each member has ever had allocated -------------------
  const allocatedByMember = new Map<string, number>();
  for (const a of input.allocations) {
    allocatedByMember.set(a.memberId, (allocatedByMember.get(a.memberId) ?? 0) + Number(a.amount));
  }

  // ---- The grid ------------------------------------------------------------
  const sortedMembers = [...input.members].sort(compareEldestFirst);

  const rows: DashboardRow[] = sortedMembers.map((member) => {
    const joinedMonth = monthKeyFromDateString(member.joinedOn);
    const totalAllocated = allocatedByMember.get(member.id) ?? 0;

    const ledger = computeMemberLedger({
      joinedOn: joinedMonth,
      targetAmount: input.targetAmount,
      totalAllocated,
      asOfMonth: input.asOfMonth,
      fyStartMonth,
    });

    const dueByMonth = new Map(ledger.months.map((m) => [m.month, m]));
    const prepaidByMonth = new Map(ledger.prepaidMonths.map((m) => [m.month, m]));

    const cells: DashboardCell[] = months.map((month) => {
      if (compareMonthKeys(month, joinedMonth) < 0) {
        return { status: "before_joining", paid: 0, due: 0 };
      }
      const due = dueByMonth.get(month);
      if (due) return { status: due.status, paid: round2(due.paid), due: due.due };
      const prepaid = prepaidByMonth.get(month);
      if (prepaid) return { status: "prepaid", paid: round2(prepaid.paid), due: prepaid.due };
      return { status: "future", paid: 0, due: 0 };
    });

    const broughtForward = groupMonthsByFY(ledger.months, fyStartMonth)
      .filter((g) => compareMonthKeys(g.startMonth, fy.startMonth) < 0)
      .reduce((sum, g) => sum + g.balance, 0);

    return {
      memberId: member.id,
      fullName: member.fullName,
      isMe: member.id === input.viewerMemberId,
      cells,
      broughtForward: round2(broughtForward),
      fyTotal: round2(cells.reduce((sum, c) => sum + c.paid, 0)),
      allTimeTotal: round2(totalAllocated),
      balance: round2(ledger.balance),
      credit: round2(ledger.creditBalance),
    };
  });

  const columnTotals = months.map((_, i) => round2(rows.reduce((sum, r) => sum + r.cells[i].paid, 0)));

  // ---- "Me" -----------------------------------------------------------------
  let me: DashboardResult["me"] = null;
  if (input.viewerMemberId) {
    const myRow = rows.find((r) => r.memberId === input.viewerMemberId);
    const myMember = sortedMembers.find((m) => m.id === input.viewerMemberId);
    if (myRow && myMember) {
      const myLedger = computeMemberLedger({
        joinedOn: monthKeyFromDateString(myMember.joinedOn),
        targetAmount: input.targetAmount,
        totalAllocated: allocatedByMember.get(myMember.id) ?? 0,
        asOfMonth: input.asOfMonth,
        fyStartMonth,
      });
      const fyContributed = input.allocations
        .filter((a) => a.memberId === input.viewerMemberId)
        .filter((a) => {
          const month = monthKeyFromInstant(a.paidAt);
          return compareMonthKeys(month, fy.startMonth) >= 0 && compareMonthKeys(month, fy.endMonth) <= 0;
        })
        .reduce((sum, a) => sum + Number(a.amount), 0);

      me = {
        memberId: myMember.id,
        fullName: myMember.fullName,
        balance: myRow.balance,
        credit: myRow.credit,
        unpaidSummary: summarizeUnpaidMonths(myLedger.unpaidMonths),
        fyContributed: round2(fyContributed),
      };
    }
  }

  // ---- Group cash figures ---------------------------------------------------
  // An ignored payment is money that is not a contribution, so it is left out of both.
  const countedPayments = input.payments.filter((p) => p.matchStatus !== "ignored");

  const monthCollected = countedPayments
    .filter((p) => p.kind === "mpesa" || p.kind === "manual")
    .filter((p) => monthKeyFromInstant(p.paidAt) === input.asOfMonth)
    .reduce((sum, p) => sum + Number(p.amount), 0);

  const fundTotal = countedPayments.reduce((sum, p) => sum + Number(p.amount), 0) - input.expensesTotal;

  // ---- Which financial years can be chosen -------------------------------------
  const currentFy = fyRangeForMonth(input.asOfMonth, fyStartMonth);
  const earliestJoined = input.members
    .map((m) => monthKeyFromDateString(m.joinedOn))
    .sort(compareMonthKeys)[0];
  const firstFy = earliestJoined ? fyRangeForMonth(earliestJoined, fyStartMonth) : currentFy;

  const fyOptions: { label: string; startMonth: MonthKey }[] = [];
  let cursor = compareMonthKeys(firstFy.startMonth, currentFy.startMonth) <= 0 ? firstFy.startMonth : currentFy.startMonth;
  // 100 years of financial years is far more than needed; this only guards against a bad input looping forever.
  for (let i = 0; i < 100; i++) {
    const range = fyRangeForMonth(cursor, fyStartMonth);
    fyOptions.push({ label: range.label, startMonth: range.startMonth });
    if (range.startMonth === currentFy.startMonth) break;
    cursor = addMonths(range.startMonth, 12);
  }

  return {
    asOfMonth: input.asOfMonth,
    fy,
    fyOptions,
    months,
    targetAmount: input.targetAmount,
    me,
    group: { monthCollected: round2(monthCollected), fundTotal: round2(fundTotal) },
    rows,
    columnTotals,
  };
}
