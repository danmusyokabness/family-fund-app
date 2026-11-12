// lib/pay.ts
//
// The "Pay" helper on a member's dashboard: how much to send for a number of
// months. Pure. It never moves money: the member pays from their own phone.
//
//   * Months owed = the balance divided by the monthly amount, rounded up
//     (a balance of 500 with a monthly amount of 300 is 2 months).
//   * Paying up to the months owed costs that many months, but never more than
//     the balance; paying exactly the months owed costs the exact balance.
//   * Paying beyond the months owed (or when nothing is owed) adds whole
//     months in advance.
//   * M-PESA Till payments are whole shillings, so the amount is rounded up.

export const MAX_PAY_MONTHS = 12;

export function monthsOwed(balance: number, monthlyAmount: number): number {
  if (!(balance > 0) || !(monthlyAmount > 0)) return 0;
  return Math.ceil(balance / monthlyAmount - 1e-9);
}

/** The months the helper starts on: what is owed, or one month if nothing is. */
export function defaultMonths(balance: number, monthlyAmount: number): number {
  return Math.min(MAX_PAY_MONTHS, Math.max(1, monthsOwed(balance, monthlyAmount)));
}

export function payAmount(months: number, balance: number, monthlyAmount: number): number {
  const m = Math.max(1, Math.min(MAX_PAY_MONTHS, Math.floor(months)));
  const owed = monthsOwed(balance, monthlyAmount);
  const exact = m <= owed ? Math.min(m * monthlyAmount, balance) : (owed > 0 ? balance : 0) + (m - owed) * monthlyAmount;
  return Math.ceil(exact - 1e-9);
}

/** The code that opens the M-PESA menu on a phone. */
export const MPESA_MENU_LINK = "tel:*334%23";
