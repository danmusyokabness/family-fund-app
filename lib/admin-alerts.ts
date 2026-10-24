// lib/admin-alerts.ts
//
// The text message sent to the ADMIN (not the members) when the payment
// data is out of date. The automatic reminder and report are held back
// when the last statement import is too old, and that would be pointless
// if nobody noticed. So the admin is told:
//
//   * a heads-up two days BEFORE each monthly text is due ("please
//     import the latest statement before the 7th"), and
//   * a "held back" notice on each day a text is held, until the
//     statement is imported (the daily job then sends it).
//
// Nothing is sent when the data is already fresh. Pure: the cron route
// works out the facts, this only decides what to say.

export interface AdminAlertInput {
  /** Day of the month in Nairobi (1-31). */
  dayOfMonth: number;
  reminderDay: number;
  reportDay: number;
  freshness: { stale: boolean; ageDays: number | null };
  /** Set when this run held the automatic text back. */
  held: { reminder: boolean; report: boolean };
  fundName: string;
  /** The site address, with no trailing slash needed. */
  siteUrl: string;
}

export function ordinal(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** The day the heads-up goes out: two days before the text, but never before the 1st. */
export function headsUpDay(sendDay: number): number {
  return Math.max(1, sendDay - 2);
}

function ageWords(ageDays: number | null): string {
  return ageDays === null ? "no statement has been imported yet" : `payment data is ${ageDays} day(s) old`;
}

function link(siteUrl: string): string {
  return siteUrl ? ` ${siteUrl.replace(/\/+$/, "")}/admin` : "";
}

/** The message to send to the admin, or null if there is nothing to say. */
export function buildAdminAlert(input: AdminAlertInput): string | null {
  if (!input.freshness.stale) return null;

  const heldNames: string[] = [];
  if (input.held.reminder) heldNames.push("reminder");
  if (input.held.report) heldNames.push("report");
  if (heldNames.length > 0) {
    return (
      `${input.fundName}: the automatic ${heldNames.join(" and ")} text was held back because ${ageWords(input.freshness.ageDays)}. ` +
      `Import the latest M-PESA statement and it will go out on the next daily run.${link(input.siteUrl)}`
    );
  }

  const due: string[] = [];
  if (input.dayOfMonth === headsUpDay(input.reminderDay)) due.push(`reminder on the ${ordinal(input.reminderDay)}`);
  if (input.dayOfMonth === headsUpDay(input.reportDay)) due.push(`fund report on the ${ordinal(input.reportDay)}`);
  if (due.length === 0) return null;

  return (
    `${input.fundName}: the ${due.join(" and the ")} will go out soon, but ${ageWords(input.freshness.ageDays)}. ` +
    `Please import the latest M-PESA statement before then.${link(input.siteUrl)}`
  );
}
