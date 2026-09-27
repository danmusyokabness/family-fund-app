// lib/ledger.ts
//
// The core money logic for one member, as a pure function: given a
// joining month, a target amount, the total the member has ever had
// allocated to them, and "today" (as a Nairobi month), it works out
// which months are covered, which are still owed, and any credit ahead.
//
// Deliberately has NO database access and NO knowledge of individual
// payments or dates paid — it treats every allocated shilling as one
// pool and fills the member's due months oldest-first (D2 in the
// project plan). Whether a given payment was 300 or 3000 does not
// matter here; only the running total does. This makes it trivial to
// test with plain numbers, and guarantees the same rules are applied
// everywhere the ledger is shown or a balance is calculated.
//
// "Collected this month" / "contributed this FY" style CASH totals
// (based on when money actually arrived) are a different, much
// simpler calculation done separately in Step 5/6 directly from the
// payments table — see the project README, section 7.

import {
  addMonths,
  compareMonthKeys,
  formatMonthYear,
  fyRangeForMonth,
  monthsBetweenInclusive,
  type MonthKey,
  DEFAULT_FY_START_MONTH,
} from "./dates.ts";

export type MonthStatus = "before_joining" | "unpaid" | "partial" | "paid" | "prepaid";

export interface LedgerMonth {
  month: MonthKey;
  due: number;
  paid: number;
  status: MonthStatus;
}

export interface LedgerResult {
  /** Every due month from joining through "asOf", each showing what was applied to it. */
  months: LedgerMonth[];
  /** Future months already covered by credit ahead, shown separately from due months. */
  prepaidMonths: LedgerMonth[];
  /** target x number of due months. */
  totalDue: number;
  /** How much of totalDue has actually been covered (capped at totalDue). */
  totalPaid: number;
  /** totalDue - totalPaid. Never negative — a member is never shown as "owing" a negative amount. */
  balance: number;
  /** Money left over after every due month is fully covered (0 if none). */
  creditBalance: number;
  /** Due months that are not fully covered, oldest first. */
  unpaidMonths: MonthKey[];
}

export interface ComputeMemberLedgerInput {
  /** The member's joining month. */
  joinedOn: MonthKey;
  /** The monthly contribution target (a fund-wide setting, passed in — never hard-coded here). */
  targetAmount: number;
  /** Sum of every payment allocation this member has ever had, all time. */
  totalAllocated: number;
  /** "Today", as a Nairobi MonthKey — the last month that can be "due". */
  asOfMonth: MonthKey;
  fyStartMonth?: number;
  /** Safety cap on how many future months to list as prepaid, in case of a very large credit. */
  maxPrepaidMonths?: number;
}

export function computeMemberLedger(input: ComputeMemberLedgerInput): LedgerResult {
  const { joinedOn, targetAmount, totalAllocated, asOfMonth } = input;
  const maxPrepaidMonths = input.maxPrepaidMonths ?? 24;

  if (targetAmount <= 0) throw new Error("targetAmount must be positive");
  if (totalAllocated < 0) throw new Error("totalAllocated cannot be negative");

  const dueMonthKeys = monthsBetweenInclusive(joinedOn, asOfMonth);

  let pool = totalAllocated;
  const months: LedgerMonth[] = dueMonthKeys.map((month) => {
    const due = targetAmount;
    const paid = Math.min(pool, due);
    pool -= paid;
    const status: MonthStatus = paid <= 0 ? "unpaid" : paid < due ? "partial" : "paid";
    return { month, due, paid, status };
  });

  // Whatever is left in the pool after every due month is fully covered
  // becomes credit ahead. Show it as prepaid future months too, capped
  // so an unusually large one-off payment can't generate an unbounded list.
  const prepaidMonths: LedgerMonth[] = [];
  let cursor = dueMonthKeys.length > 0 ? dueMonthKeys[dueMonthKeys.length - 1] : joinedOn;
  while (pool > 0 && prepaidMonths.length < maxPrepaidMonths) {
    cursor = addMonths(cursor, 1);
    const due = targetAmount;
    const paid = Math.min(pool, due);
    pool -= paid;
    prepaidMonths.push({ month: cursor, due, paid, status: "prepaid" });
  }

  const totalDue = dueMonthKeys.length * targetAmount;
  const totalPaid = Math.min(totalAllocated, totalDue);
  const balance = Math.max(0, totalDue - totalPaid);
  const creditBalance = Math.max(0, totalAllocated - totalDue);
  const unpaidMonths = months
    .filter((m) => m.status === "unpaid" || m.status === "partial")
    .map((m) => m.month);

  return { months, prepaidMonths, totalDue, totalPaid, balance, creditBalance, unpaidMonths };
}

/**
 * Groups a due-months array by financial year, for showing "brought
 * forward", an FY subtotal, and the ledger grid's year tabs.
 */
export interface FYGroup {
  label: string;
  startMonth: MonthKey;
  endMonth: MonthKey;
  months: LedgerMonth[];
  due: number;
  paid: number;
  /** Balance owed for just this FY's own months (ignores other FYs). */
  balance: number;
}

export function groupMonthsByFY(months: LedgerMonth[], fyStartMonth: number = DEFAULT_FY_START_MONTH): FYGroup[] {
  const groups = new Map<string, FYGroup>();

  for (const m of months) {
    const range = fyRangeForMonth(m.month, fyStartMonth);
    let group = groups.get(range.label);
    if (!group) {
      group = {
        label: range.label,
        startMonth: range.startMonth,
        endMonth: range.endMonth,
        months: [],
        due: 0,
        paid: 0,
        balance: 0,
      };
      groups.set(range.label, group);
    }
    group.months.push(m);
    group.due += m.due;
    group.paid += m.paid;
  }

  for (const group of groups.values()) {
    group.balance = Math.max(0, group.due - group.paid);
  }

  // Sorted oldest FY first, by comparing each group's own start month.
  return [...groups.values()].sort((a, b) => compareMonthKeys(a.startMonth, b.startMonth));
}

/**
 * Renders the "unpaid: Aug, Sep, Oct" / "6 months unpaid since Aug 2026"
 * wording used in the 7th reminder (project README, section 7).
 */
export function summarizeUnpaidMonths(unpaidMonths: MonthKey[]): string {
  if (unpaidMonths.length === 0) return "";
  if (unpaidMonths.length <= 4) {
    return unpaidMonths.map((m) => formatMonthYearShort(m)).join(", ");
  }
  const first = unpaidMonths[0];
  return `${unpaidMonths.length} months unpaid since ${formatMonthYear(first)}`;
}

// Short month name without a repeated year, e.g. "Aug" — used inside a
// same-year list like "Aug, Sep, Oct" so the wording matches the README.
function formatMonthYearShort(month: MonthKey): string {
  return formatMonthYear(month).split(" ")[0];
}
