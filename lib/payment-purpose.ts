// lib/payment-purpose.ts
//
// WHAT A PAYMENT IS FOR. Two questions are kept apart on purpose:
//
//   1. WHAT IS THE MONEY FOR?  (the "purpose", below)
//   2. WHO GAVE IT?            (the allocations: one member, several, or nobody)
//
// And one rule sits above both: ALL money that really arrived in the
// account counts in "Total in account", whatever its purpose and whether
// or not anyone can be credited with it. That total must always equal the
// M-PESA balance.
//
// Only payments with purpose "monthly" count toward a member's monthly
// dues (the month-by-month ledger). Everything else is real money in the
// fund but does not tick off anyone's months.
//
//   monthly   A member's regular monthly contribution. The default for
//             everything that arrives from a statement.
//   booster   An extra, voluntary contribution to strengthen the fund. The
//             giver is credited (it shows in their total contributed) but
//             it does not pay off their monthly dues.
//   recovery  A contribution to put back money spent in an emergency. It can
//             be linked to the withdrawal it replaces, so the fund can show
//             how much of that spending has been recovered.
//   donation  A gift from someone outside the family. Nobody is credited.
//   other     Any other money in that is not a monthly contribution: a
//             stray payment that cannot be attributed, an M-PESA reversal,
//             interest. Counted in the account, credited to nobody.

export const PAYMENT_PURPOSES = ["monthly", "booster", "recovery", "donation", "other"] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

export const PURPOSE_LABEL: Record<PaymentPurpose, string> = {
  monthly: "Monthly contribution",
  booster: "Extra contribution (booster)",
  recovery: "Recovery of spending",
  donation: "Donation from outside",
  other: "Other income",
};

/** Short wording for badges and ledger lines. */
export const PURPOSE_SHORT: Record<PaymentPurpose, string> = {
  monthly: "Monthly",
  booster: "Booster",
  recovery: "Recovery",
  donation: "Donation",
  other: "Other income",
};

export function isPaymentPurpose(value: unknown): value is PaymentPurpose {
  return typeof value === "string" && (PAYMENT_PURPOSES as readonly string[]).includes(value);
}

/** True when this payment pays off a member's monthly dues. Anything unknown or missing counts as monthly (the default). */
export function countsTowardMonthlyDues(purpose: string | null | undefined): boolean {
  return purpose === undefined || purpose === null || purpose === "" || purpose === "monthly";
}
