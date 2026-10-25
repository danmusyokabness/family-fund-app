// lib/full-ledger.ts
//
// The FULL LEDGER: every movement of money in the fund's account, in
// order, organised by month and by category, with a running balance.
// The dashboard ledger shows only members' contributions month by month;
// this one also shows opening balances, adjustments, withdrawals,
// M-PESA transaction charges and other expenses.
//
// It is built from exactly the same two sources as the "Total in
// account" figure (EVERY payment that arrived, minus every expense), so its
// final balance always equals that figure and the M-PESA balance. A
// payment the admin chose not to credit to any member ("ignored") is still
// money in the account, so it is listed, as "Other income".
//
// Money in is shown by what it is for (see lib/payment-purpose.ts):
// monthly contributions, boosters, recoveries of spending, donations, other
// income. A recovery can be linked to the withdrawal it puts back; that
// withdrawal then shows how much has been recovered so far.
//
// Pure: plain data in, plain data out. No phone numbers and no M-PESA
// receipt numbers are included, so it is safe to show to every member.

import { monthKeyFromInstant, type MonthKey } from "./dates.ts";

export type LedgerCategory =
  | "contribution"
  | "booster"
  | "recovery"
  | "donation"
  | "other_income"
  | "opening"
  | "adjustment"
  | "withdrawal"
  | "charge"
  | "other";

export const LEDGER_CATEGORY_LABEL: Record<LedgerCategory, string> = {
  contribution: "Contribution",
  booster: "Extra contribution (booster)",
  recovery: "Recovery of spending",
  donation: "Donation from outside",
  other_income: "Other income",
  opening: "Opening balance",
  adjustment: "Adjustment",
  withdrawal: "Withdrawal",
  charge: "Transaction charge",
  other: "Other expense",
};

/** The order categories are listed in summaries. */
export const LEDGER_CATEGORY_ORDER: LedgerCategory[] = [
  "contribution",
  "booster",
  "recovery",
  "donation",
  "other_income",
  "opening",
  "adjustment",
  "withdrawal",
  "charge",
  "other",
];

export interface FullLedgerPayment {
  id: string;
  amount: number; // signed: an adjustment can be negative
  kind: string; // mpesa | manual | adjustment | opening
  paidAt: string; // ISO timestamp
  matchStatus: string; // matched | needs_confirmation | unmatched | ignored
  /** Names of the members the payment was counted for (empty until it is matched). */
  memberNames: string[];
  note: string | null;
  /** What the money is for (see lib/payment-purpose.ts). Missing means "monthly". */
  purpose?: string;
  /** For a recovery payment: the expense (withdrawal) it puts back. */
  relatedExpenseId?: string | null;
}

export interface FullLedgerExpense {
  id: string;
  kind: string; // charge | withdrawal | other
  amount: number; // always positive: money that left the fund
  occurredAt: string;
  description: string | null;
}

export interface LedgerEntry {
  id: string;
  /** Nairobi date, "YYYY-MM-DD", and time, "HH:MM". */
  date: string;
  time: string;
  month: MonthKey;
  category: LedgerCategory;
  /** Who it was from, or what it was for. */
  label: string;
  /** A short extra line, or null. */
  detail: string | null;
  /** Signed: money in is positive, money out is negative. */
  money: number;
  /** The fund's balance straight after this entry. */
  balanceAfter: number;
  /** A contribution not yet counted for a member (waiting for the admin). */
  awaitingMember: boolean;
}

export interface LedgerMonth {
  month: MonthKey;
  /** Newest first. */
  entries: LedgerEntry[];
  moneyIn: number;
  moneyOut: number;
  /** Positive amounts per category (adjustments are the net, which may be negative). */
  byCategory: Record<LedgerCategory, number>;
  closingBalance: number;
}

export interface FullLedger {
  /** Newest month first. */
  months: LedgerMonth[];
  totalIn: number;
  totalOut: number;
  byCategory: Record<LedgerCategory, number>;
  /** Equals the dashboard's "Total in account". */
  balance: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const emptyCategories = (): Record<LedgerCategory, number> => ({
  contribution: 0,
  booster: 0,
  recovery: 0,
  donation: 0,
  other_income: 0,
  opening: 0,
  adjustment: 0,
  withdrawal: 0,
  charge: 0,
  other: 0,
});
const kes = (n: number) => `KES ${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

function nairobiDateAndTime(iso: string): { date: string; time: string } {
  const shifted = new Date(new Date(iso).getTime() + 3 * 60 * 60 * 1000).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) };
}

interface Raw {
  id: string;
  at: string;
  category: LedgerCategory;
  label: string;
  detail: string | null;
  money: number;
  awaitingMember: boolean;
}

export function buildFullLedger(input: { payments: FullLedgerPayment[]; expenses: FullLedgerExpense[] }): FullLedger {
  const raws: Raw[] = [];

  // Which expense each recovery payment puts back, and how much has been recovered so far.
  const expenseLabel = new Map<string, string>();
  for (const e of input.expenses) expenseLabel.set(e.id, e.description?.trim() || (e.kind === "withdrawal" ? "Withdrawal" : "Expense"));
  const recoveredByExpense = new Map<string, number>();
  for (const p of input.payments) {
    if (p.purpose === "recovery" && p.relatedExpenseId) {
      recoveredByExpense.set(p.relatedExpenseId, (recoveredByExpense.get(p.relatedExpenseId) ?? 0) + Number(p.amount));
    }
  }

  for (const p of input.payments) {
    const money = Number(p.amount);
    const names = p.memberNames.filter(Boolean);
    const purpose = p.purpose ?? "monthly";

    if (p.kind === "opening") {
      raws.push({ id: `p-${p.id}`, at: p.paidAt, category: "opening", label: "Opening balance", detail: p.note, money, awaitingMember: false });
    } else if (p.kind === "adjustment") {
      raws.push({ id: `p-${p.id}`, at: p.paidAt, category: "adjustment", label: p.note?.trim() || "Adjustment", detail: null, money, awaitingMember: false });
    } else if (purpose === "booster") {
      raws.push({ id: `p-${p.id}`, at: p.paidAt, category: "booster", label: names.length > 0 ? names.join(", ") : "Extra contribution", detail: "Not part of monthly dues", money, awaitingMember: false });
    } else if (purpose === "recovery") {
      const replaces = p.relatedExpenseId ? expenseLabel.get(p.relatedExpenseId) : null;
      raws.push({
        id: `p-${p.id}`,
        at: p.paidAt,
        category: "recovery",
        label: names.length > 0 ? names.join(", ") : "Recovery contribution",
        detail: replaces ? `Replaces: ${replaces}` : "Puts back money spent",
        money,
        awaitingMember: false,
      });
    } else if (purpose === "donation") {
      raws.push({ id: `p-${p.id}`, at: p.paidAt, category: "donation", label: "Donation from outside", detail: null, money, awaitingMember: false });
    } else if (purpose === "other" || p.matchStatus === "ignored") {
      // Real money in the account that is credited to no member.
      raws.push({ id: `p-${p.id}`, at: p.paidAt, category: "other_income", label: "Other income", detail: "Stray payment, credited to no member", money, awaitingMember: false });
    } else {
      const awaiting = names.length === 0;
      raws.push({
        id: `p-${p.id}`,
        at: p.paidAt,
        category: "contribution",
        label: awaiting ? (p.matchStatus === "needs_confirmation" ? "Payment awaiting confirmation" : "Payment not yet matched to a member") : names.join(", "),
        detail: p.kind === "manual" ? "Recorded by the admin" : null,
        money,
        awaitingMember: awaiting,
      });
    }
  }

  for (const e of input.expenses) {
    const amount = Number(e.amount);
    const description = e.description?.trim() || null;
    const recovered = recoveredByExpense.get(e.id) ?? 0;
    const recoveredNote = recovered > 0 ? `${kes(recovered)} of ${kes(amount)} recovered so far` : null;
    if (e.kind === "charge") {
      raws.push({ id: `e-${e.id}`, at: e.occurredAt, category: "charge", label: "M-PESA transaction charge", detail: description, money: -amount, awaitingMember: false });
    } else if (e.kind === "withdrawal") {
      raws.push({ id: `e-${e.id}`, at: e.occurredAt, category: "withdrawal", label: description ?? "Withdrawal", detail: recoveredNote, money: -amount, awaitingMember: false });
    } else {
      raws.push({ id: `e-${e.id}`, at: e.occurredAt, category: "other", label: description ?? "Other expense", detail: recoveredNote, money: -amount, awaitingMember: false });
    }
  }

  // Oldest first, so the running balance can be added up in order. At the same
  // moment money IN comes before money OUT (a payment and the charge on it
  // arrive together, and the statement shows the payment first).
  raws.sort((a, b) => {
    const byTime = new Date(a.at).getTime() - new Date(b.at).getTime();
    if (byTime !== 0) return byTime;
    const aOut = a.money < 0 ? 1 : 0;
    const bOut = b.money < 0 ? 1 : 0;
    return aOut - bOut || a.id.localeCompare(b.id);
  });

  let balance = 0;
  const entries: LedgerEntry[] = raws.map((r) => {
    balance = round2(balance + r.money);
    const { date, time } = nairobiDateAndTime(r.at);
    return {
      id: r.id,
      date,
      time,
      month: monthKeyFromInstant(r.at),
      category: r.category,
      label: r.label,
      detail: r.detail,
      money: round2(r.money),
      balanceAfter: balance,
      awaitingMember: r.awaitingMember,
    };
  });

  const byMonth = new Map<MonthKey, LedgerEntry[]>();
  for (const entry of entries) {
    const list = byMonth.get(entry.month) ?? [];
    list.push(entry);
    byMonth.set(entry.month, list);
  }

  const months: LedgerMonth[] = [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0)) // newest month first
    .map(([month, list]) => {
      const byCategory = emptyCategories();
      let moneyIn = 0;
      let moneyOut = 0;
      for (const e of list) {
        if (e.money >= 0) moneyIn += e.money;
        else moneyOut += -e.money;
        byCategory[e.category] += e.category === "adjustment" ? e.money : Math.abs(e.money);
      }
      for (const c of LEDGER_CATEGORY_ORDER) byCategory[c] = round2(byCategory[c]);
      return {
        month,
        entries: [...list].reverse(), // newest first for reading
        moneyIn: round2(moneyIn),
        moneyOut: round2(moneyOut),
        byCategory,
        closingBalance: list[list.length - 1].balanceAfter,
      };
    });

  const byCategory = emptyCategories();
  let totalIn = 0;
  let totalOut = 0;
  for (const m of months) {
    totalIn += m.moneyIn;
    totalOut += m.moneyOut;
    for (const c of LEDGER_CATEGORY_ORDER) byCategory[c] += m.byCategory[c];
  }
  for (const c of LEDGER_CATEGORY_ORDER) byCategory[c] = round2(byCategory[c]);

  return { months, totalIn: round2(totalIn), totalOut: round2(totalOut), byCategory, balance };
}

/**
 * The fund's balance at the end of the given Nairobi date ("YYYY-MM-DD"):
 * the running balance after the last entry on or before it (0 if none).
 * Used to compare the ledger with a bank statement's closing balance.
 */
export function balanceAsOf(ledger: FullLedger, date: string): number {
  for (const month of ledger.months) {
    for (const entry of month.entries) {
      // Months and entries are newest first, so the first one on or before the date is the latest such entry.
      if (entry.date <= date) return entry.balanceAfter;
    }
  }
  return 0;
}

// ---------------------------------------------------------------------
// "Other income and notes": everything in the account that is NOT a
// member's monthly dues, for the notes section under the main ledger, plus
// the sum that shows how it all adds up to the Total in account.
// ---------------------------------------------------------------------
export interface OtherIncomeSummary {
  /** Newest first: boosters, recoveries, donations, other income (stray payments) and payments still waiting to be matched. */
  items: LedgerEntry[];
  /** Added up. */
  total: number;
  /** Monthly contributions that are already credited to members. */
  monthlyContributions: number;
  /** Opening balance and adjustments, net (0 when there are none). */
  openingAndAdjustments: number;
  /** Withdrawals + transaction charges + other expenses. */
  spent: number;
  /** The Total in account. monthlyContributions + total + openingAndAdjustments - spent always equals it. */
  balance: number;
}

export function summariseOtherIncome(ledger: FullLedger): OtherIncomeSummary {
  const items: LedgerEntry[] = [];
  for (const month of ledger.months) {
    for (const entry of month.entries) {
      const otherIncome =
        entry.category === "booster" ||
        entry.category === "recovery" ||
        entry.category === "donation" ||
        entry.category === "other_income" ||
        (entry.category === "contribution" && entry.awaitingMember);
      if (otherIncome) items.push(entry);
    }
  }
  const total = round2(items.reduce((sum, e) => sum + e.money, 0));
  const awaiting = round2(items.filter((e) => e.category === "contribution").reduce((sum, e) => sum + e.money, 0));
  const c = ledger.byCategory;
  return {
    items,
    total,
    monthlyContributions: round2(c.contribution - awaiting),
    openingAndAdjustments: round2(c.opening + c.adjustment),
    spent: round2(c.withdrawal + c.charge + c.other),
    balance: ledger.balance,
  };
}
