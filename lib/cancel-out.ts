// lib/cancel-out.ts
//
// "Cancel out": when money was taken out of the fund and later put back, the
// admin can remove the withdrawal(s) and the deposit(s) that put it back in
// one step, WITHOUT changing the Total in account. That is only true when
// the two sides are equal, so this refuses anything unequal. Pure: no
// database, no web code.
//
// What can be cancelled out:
//   * withdrawals and "other" expenses (never M-PESA transaction charges,
//     which are real costs that stay on the books);
//   * deposits that arrived as M-PESA or manual payments and are NOT credited
//     to a member's monthly dues (removing one of those would change that
//     member's ledger). A put-back is normally a recovery, booster or
//     other-income deposit.

export interface CancelOutExpense {
  id: string;
  kind: string;
  amount: number;
}

export interface CancelOutDeposit {
  id: string;
  kind: string;
  amount: number;
  /** True when this payment pays off a member's monthly dues (a purpose "monthly" payment credited to someone). */
  creditedToMonthlyDues: boolean;
}

export const MAX_PER_SIDE = 20;

export const toCents = (amount: number): number => Math.round(Number(amount) * 100);

const kes = (cents: number): string =>
  (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 });

export type CancelOutCheck = { ok: true; totalCents: number } | { ok: false; error: string };

export function checkCancelOut(expenses: CancelOutExpense[], deposits: CancelOutDeposit[]): CancelOutCheck {
  if (expenses.length === 0) return { ok: false, error: "Choose at least one withdrawal." };
  if (deposits.length === 0) return { ok: false, error: "Choose at least one deposit." };
  if (expenses.length > MAX_PER_SIDE || deposits.length > MAX_PER_SIDE) {
    return { ok: false, error: `Choose at most ${MAX_PER_SIDE} entries on each side.` };
  }
  if (new Set(expenses.map((e) => e.id)).size !== expenses.length || new Set(deposits.map((d) => d.id)).size !== deposits.length) {
    return { ok: false, error: "The same entry was chosen twice." };
  }

  for (const e of expenses) {
    if (e.kind === "charge") return { ok: false, error: "M-PESA transaction charges are real costs and cannot be cancelled out." };
    if (e.kind !== "withdrawal" && e.kind !== "other") return { ok: false, error: "Only withdrawals and other expenses can be cancelled out." };
    if (!(toCents(e.amount) > 0)) return { ok: false, error: "A withdrawal with no amount cannot be cancelled out." };
  }
  for (const d of deposits) {
    if (d.kind !== "mpesa" && d.kind !== "manual") return { ok: false, error: "Only deposits can be cancelled out, not opening balances or adjustments." };
    if (!(toCents(d.amount) > 0)) return { ok: false, error: "Only money paid in can be cancelled out." };
    if (d.creditedToMonthlyDues) {
      return {
        ok: false,
        error: "One of those deposits pays off a member's monthly dues, so removing it would change that member's ledger. Change its type first on the Payments tab, or choose a different deposit.",
      };
    }
  }

  const out = expenses.reduce((sum, e) => sum + toCents(e.amount), 0);
  const back = deposits.reduce((sum, d) => sum + toCents(d.amount), 0);
  if (out !== back) {
    const difference = out - back;
    return {
      ok: false,
      error:
        `The withdrawals add up to KES ${kes(out)} but the deposits to KES ${kes(back)}. They must be equal so the Total in account does not change ` +
        `(${difference > 0 ? "the withdrawals are KES " + kes(difference) + " more" : "the deposits are KES " + kes(difference) + " more"}).`,
    };
  }
  return { ok: true, totalCents: out };
}
