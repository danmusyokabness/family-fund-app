// lib/health.ts
//
// The checks behind the admin "Health" tab: plain-language answers to
// "is the app looking after itself?" Pure functions: the API route
// gathers the facts, these turn them into green / amber / red lines.

export type CheckStatus = "ok" | "warn" | "bad";

export interface HealthCheck {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface HealthInput {
  /** The current moment, ISO. */
  now: string;
  /** The most recent run of the daily job, or null if it has never run. */
  lastDailyRun: { startedAt: string; ok: boolean | null; details: unknown } | null;
  freshness: { ageDays: number | null; maxAgeDays: number; stale: boolean };
  needsConfirmation: number;
  unmatched: number;
  /** Names of active members with no phone number. */
  membersWithoutPhone: string[];
  /** When the last full backup was downloaded, or null. */
  lastBackupAt: string | null;
  /** Private messages from members that the admin has not read yet. */
  unreadMessages: number;
  /**
   * The last imported statement's closing balance, and what the fund's own
   * records say the balance was at the end of that statement's last day.
   * Null when there is nothing to compare (no statement with a closing balance yet).
   */
  statementCheck: { closingBalance: number; asOfDate: string; ledgerBalance: number } | null;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export function buildHealthChecks(input: HealthInput): HealthCheck[] {
  const checks: HealthCheck[] = [];
  const now = new Date(input.now).getTime();

  // 1. The daily job (keeps the database awake)
  if (!input.lastDailyRun) {
    checks.push({
      key: "daily_job",
      label: "Daily job",
      status: "warn",
      detail: "It has not run yet. It runs every morning at about 08:00 Nairobi time once the site is deployed; check Vercel > Settings > Cron Jobs if this stays here.",
    });
  } else {
    const hours = Math.floor((now - new Date(input.lastDailyRun.startedAt).getTime()) / HOUR);
    if (input.lastDailyRun.ok === false) {
      const err = (input.lastDailyRun.details as { error?: string } | null)?.error;
      checks.push({ key: "daily_job", label: "Daily job", status: "bad", detail: `The last run (${hours} hour(s) ago) failed${err ? `: ${err}` : "."}` });
    } else if (hours > 36) {
      checks.push({ key: "daily_job", label: "Daily job", status: "warn", detail: `It last ran ${Math.floor(hours / 24)} day(s) ago. It should run every day; check Vercel > Settings > Cron Jobs.` });
    } else {
      checks.push({ key: "daily_job", label: "Daily job", status: "ok", detail: `Ran ${hours} hour(s) ago.` });
    }
  }

  // 2. How current is the payment data?
  if (input.freshness.ageDays === null) {
    checks.push({ key: "freshness", label: "Payment data", status: "warn", detail: "No statement has been imported yet." });
  } else if (input.freshness.stale) {
    checks.push({
      key: "freshness",
      label: "Payment data",
      status: "warn",
      detail: `Last updated ${input.freshness.ageDays} day(s) ago. Import the latest statement so balances and reminders are accurate (the limit is ${input.freshness.maxAgeDays} day(s), changeable in Setup).`,
    });
  } else {
    checks.push({
      key: "freshness",
      label: "Payment data",
      status: "ok",
      detail: input.freshness.ageDays === 0 ? "Updated today." : `Last updated ${input.freshness.ageDays} day(s) ago.`,
    });
  }

  // 2a. Does the total in the account match the bank's own figure?
  if (input.statementCheck) {
    const { closingBalance, asOfDate, ledgerBalance } = input.statementCheck;
    const difference = Math.round((ledgerBalance - closingBalance) * 100) / 100;
    const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
    checks.push(
      Math.abs(difference) < 0.01
        ? {
            key: "balance_match",
            label: "Total in account matches M-PESA",
            status: "ok",
            detail: `KES ${money(ledgerBalance)} on ${asOfDate}, the same as the last statement's closing balance.`,
          }
        : {
            key: "balance_match",
            label: "Total in account matches M-PESA",
            status: "warn",
            detail:
              `On ${asOfDate} the app says KES ${money(ledgerBalance)} but the last statement ends at KES ${money(closingBalance)}: ` +
              `${difference > 0 ? "the app is KES " + money(difference) + " too high" : "the app is KES " + money(-difference) + " too low"}. ` +
              "Look for a payment recorded twice or wrongly, a missing payment or expense, or an opening balance that was never recorded (Payments tab).",
          }
    );
  }

  // 2c. Messages from members waiting for the admin
  checks.push(
    input.unreadMessages > 0
      ? {
          key: "messages",
          label: "Messages from members",
          status: "warn",
          detail: `${input.unreadMessages} private message(s) are waiting for you in the Messages tab.`,
        }
      : { key: "messages", label: "Messages from members", status: "ok", detail: "No unread messages." }
  );

  // 4. Payments waiting for the admin
  const waiting = input.needsConfirmation + input.unmatched;
  checks.push(
    waiting > 0
      ? {
          key: "waiting",
          label: "Payments waiting for you",
          status: "warn",
          detail: `${input.needsConfirmation} need confirming and ${input.unmatched} are unmatched. Until you sort them they are not counted for any member, and members with a payment waiting are not offered a reminder.`,
        }
      : { key: "waiting", label: "Payments waiting for you", status: "ok", detail: "Nothing is waiting." }
  );

  // 5. Members who cannot be reached or log in
  checks.push(
    input.membersWithoutPhone.length > 0
      ? {
          key: "no_phone",
          label: "Members without a phone",
          status: "warn",
          detail: `${input.membersWithoutPhone.join(", ")}. They cannot log in or be sent a reminder until a phone number is added on the Members tab.`,
        }
      : { key: "no_phone", label: "Members without a phone", status: "ok", detail: "Every active member has a phone number." }
  );

  // 6. Backups (the free database plan keeps no downloadable backups)
  if (!input.lastBackupAt) {
    checks.push({ key: "backup", label: "Backup", status: "warn", detail: "No backup has been downloaded yet. Use the backup button below, and repeat about once a month." });
  } else {
    const days = Math.floor((now - new Date(input.lastBackupAt).getTime()) / DAY);
    checks.push(
      days > 35
        ? { key: "backup", label: "Backup", status: "warn", detail: `The last backup was ${days} days ago. Download a fresh one below.` }
        : { key: "backup", label: "Backup", status: "ok", detail: days === 0 ? "Downloaded today." : `Downloaded ${days} day(s) ago.` }
    );
  }

  return checks;
}

export function overallStatus(checks: HealthCheck[]): CheckStatus {
  if (checks.some((c) => c.status === "bad")) return "bad";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "ok";
}

/**
 * The next date a monthly message is due: this month if the scheduled day has
 * not passed yet (today counts), otherwise next month. "YYYY-MM-DD".
 */
export function nextScheduledDate(today: string, day: number): string {
  const [y, m, d] = today.split("-").map(Number);
  const targetDay = Math.min(Math.max(day, 1), 28);
  const thisMonth = d <= targetDay;
  const year = thisMonth ? y : m === 12 ? y + 1 : y;
  const month = thisMonth ? m : m === 12 ? 1 : m + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}
