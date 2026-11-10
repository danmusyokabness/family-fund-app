// lib/cancel-out.ts
//
// "Cancel out": when money was taken out of the fund and later put back, the
// superadmin can erase the withdrawal(s), the deposit(s) that put it back and
// the M-PESA fee(s) charged on those deposits in one step, WITHOUT changing
// the Total in account. Pure: no database, no web code.
//
// The arithmetic. Erasing a withdrawal W adds W to the Total in account,
// erasing a deposit D takes D away, and erasing the fee F charged on that
// deposit adds F back. So the Total stays put only when D - F = W. Deposits
// are whole shillings but fees can have cents, so D - F is usually a few cents
// more than W. That small leftover (never negative, always under KES 1 per
// deposit) is kept as one plain "Rounding" line, so the books stay exact to
// the cent.
//
// What can be cancelled out:
//   * withdrawals and "other" expenses;
//   * a HANGING fee: an M-PESA fee whose deposit was erased earlier (the server
//     decides which fees are hanging and marks them orphanFee). A fee that
//     still has its deposit can never be chosen on its own: it goes with that
//     deposit. A hanging fee counts like money taken out, so a deposit that was
//     later paid in to cover it can be erased against it; whatever is left over
//     stays in the fund as one plain line;
//   * deposits that arrived as M-PESA or manual payments and are NOT credited
//     to a member's monthly dues (removing one of those would change that
//     member's ledger). A put-back is normally a recovery, booster or
//     other-income deposit.

export interface CancelOutExpense {
  id: string;
  kind: string;
  amount: number;
  /** True only for an M-PESA fee whose deposit is already gone (decided by the server). */
  orphanFee?: boolean;
}

export interface CancelOutDeposit {
  id: string;
  kind: string;
  amount: number;
  /** True when this payment pays off a member's monthly dues (a purpose "monthly" payment credited to someone). */
  creditedToMonthlyDues: boolean;
  /** M-PESA fee(s) charged on this deposit (same receipt), in KES. Leave out when there is none. */
  fee?: number;
}

export const MAX_PER_SIDE = 20;

/** The leftover must stay under this many cents for every deposit (KES 1 each), so only true rounding can be absorbed. */
export const ROUNDING_CENTS_PER_DEPOSIT = 100;

export const toCents = (amount: number): number => Math.round(Number(amount) * 100);

const kes = (cents: number): string =>
  (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 });

export type CancelOutCheck =
  | {
      ok: true;
      /** What was taken out, in cents. */
      totalCents: number;
      /** M-PESA fees on the deposits, in cents. */
      feeCents: number;
      /** What the deposits bring in beyond the withdrawals once their fees are paid: kept as one plain line. 0 = nothing to keep. */
      leftoverCents: number;
      /** True when the leftover is only rounding (under KES 1 per deposit); false when it is real extra money (only possible with a hanging fee). */
      leftoverIsRounding: boolean;
    }
  | { ok: false; error: string };

export function checkCancelOut(expenses: CancelOutExpense[], deposits: CancelOutDeposit[]): CancelOutCheck {
  if (expenses.length === 0) return { ok: false, error: "Choose at least one withdrawal or hanging fee." };
  if (deposits.length === 0) return { ok: false, error: "Choose at least one deposit." };
  if (expenses.length > MAX_PER_SIDE || deposits.length > MAX_PER_SIDE) {
    return { ok: false, error: `Choose at most ${MAX_PER_SIDE} entries on each side.` };
  }
  if (new Set(expenses.map((e) => e.id)).size !== expenses.length || new Set(deposits.map((d) => d.id)).size !== deposits.length) {
    return { ok: false, error: "The same entry was chosen twice." };
  }

  for (const e of expenses) {
    if (e.kind === "charge" && !e.orphanFee) return { ok: false, error: "An M-PESA fee cannot be chosen on its own while its deposit is still recorded. It is removed together with that deposit." };
    if (e.kind !== "withdrawal" && e.kind !== "other" && e.kind !== "charge") return { ok: false, error: "Only withdrawals, other expenses and hanging fees can be cancelled out." };
    if (!(toCents(e.amount) > 0)) return { ok: false, error: "A withdrawal with no amount cannot be cancelled out." };
  }
  for (const d of deposits) {
    if (d.kind !== "mpesa" && d.kind !== "manual") return { ok: false, error: "Only deposits can be cancelled out, not opening balances or adjustments." };
    if (!(toCents(d.amount) > 0)) return { ok: false, error: "Only money paid in can be cancelled out." };
    if (d.fee !== undefined && !(toCents(d.fee) >= 0)) return { ok: false, error: "A fee cannot be negative." };
    if (d.creditedToMonthlyDues) {
      return {
        ok: false,
        error: "One of those deposits pays off a member's monthly dues, so removing it would change that member's ledger. Change its type first on the Payments tab, or choose a different deposit.",
      };
    }
  }

  const out = expenses.reduce((sum, e) => sum + toCents(e.amount), 0);
  const back = deposits.reduce((sum, d) => sum + toCents(d.amount), 0);
  const fees = deposits.reduce((sum, d) => sum + toCents(d.fee ?? 0), 0);
  const net = back - fees; // what the deposits really left in the fund
  const leftover = net - out;
  const hasHangingFee = expenses.some((e) => e.kind === "charge");
  const roundingLimit = deposits.length * ROUNDING_CENTS_PER_DEPOSIT;

  if (leftover < 0) {
    return {
      ok: false,
      error:
        `The withdrawals are KES ${kes(out)}, but the deposits (KES ${kes(back)}${fees > 0 ? `, less KES ${kes(fees)} in M-PESA fees` : ""}) leave only KES ${kes(net)} in the fund, ` +
        `KES ${kes(-leftover)} short. The Total in account would change, so this is refused. Add the deposit that covers the rest.`,
    };
  }
  if (leftover >= roundingLimit && !hasHangingFee) {
    return {
      ok: false,
      error:
        `The deposits leave KES ${kes(net)} in the fund (after KES ${kes(fees)} in fees) but the withdrawals are only KES ${kes(out)}, ` +
        `KES ${kes(leftover)} more. That is too much to be rounding, so nothing was changed. Check that the right entries are chosen.`,
    };
  }
  return { ok: true, totalCents: out, feeCents: fees, leftoverCents: leftover, leftoverIsRounding: leftover < roundingLimit };
}
