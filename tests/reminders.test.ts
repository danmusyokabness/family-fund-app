import { test } from "node:test";
import assert from "node:assert/strict";
import { fillTemplate } from "../lib/message-templates.ts";
import { buildReminderCandidates, composeReminderMessage } from "../lib/reminders.ts";

test("fillTemplate substitutes every placeholder", () => {
  assert.equal(fillTemplate("Hi {name}, you owe {amount}", { name: "Jane", amount: "300" }), "Hi Jane, you owe 300");
});

test("fillTemplate leaves an unknown placeholder untouched", () => {
  assert.equal(fillTemplate("Hi {name} {mystery}", { name: "Jane" }), "Hi Jane {mystery}");
});

const members = [
  { id: "A", fullName: "Jane Doe", joinedOn: "2026-08-01", primaryPhone: "254712345678" },
  { id: "B", fullName: "Fully Paid", joinedOn: "2026-08-01", primaryPhone: "254722345678" },
  { id: "C", fullName: "No Phone Person", joinedOn: "2026-08-01", primaryPhone: null },
];

test("buildReminderCandidates: only members with a balance AND a phone are included", () => {
  const result = buildReminderCandidates({
    members,
    allocatedByMember: { A: 0, B: 300, C: 0 },
    targetAmount: 300,
    asOfMonth: "2026-08",
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].memberId, "A");
  assert.equal(result.candidates[0].balance, 300);
});

test("buildReminderCandidates: skip reasons are reported, not silently dropped", () => {
  const result = buildReminderCandidates({
    members,
    allocatedByMember: { A: 0, B: 300, C: 0 },
    targetAmount: 300,
    asOfMonth: "2026-08",
  });
  const reasons = Object.fromEntries(result.skipped.map((s) => [s.memberId, s.reason]));
  assert.equal(reasons.B, "no_balance_due");
  assert.equal(reasons.C, "no_phone"); // C owes 300 (0 allocated against 1 month due) but has no phone to text
});

test("a member with both no balance due and no phone is still only reported once, as no_balance_due taking priority", () => {
  const result = buildReminderCandidates({
    members: [{ id: "C", fullName: "No Phone Person", joinedOn: "2026-08-01", primaryPhone: null }],
    allocatedByMember: { C: 300 },
    targetAmount: 300,
    asOfMonth: "2026-08",
  });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.skipped[0].reason, "no_balance_due");
});

test("a member who owes but has no phone is reported as no_phone", () => {
  const result = buildReminderCandidates({
    members: [{ id: "C", fullName: "No Phone Person", joinedOn: "2026-08-01", primaryPhone: null }],
    allocatedByMember: {},
    targetAmount: 300,
    asOfMonth: "2026-08",
  });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.skipped[0].reason, "no_phone");
});

test("composeReminderMessage fills every placeholder and uses only the first name", () => {
  const msg = composeReminderMessage("{fund_name}: Hi {first_name}, you owe KES {balance} ({unpaid_months}). Till {till_number}. {site_url}", {
    fundName: "Family Fund",
    fullName: "Esther Nakhanu",
    balance: 900,
    unpaidSummary: "Aug, Sep, Oct",
    tillNumber: "123456",
    siteUrl: "https://example.com",
  });
  assert.equal(msg, "Family Fund: Hi Esther, you owe KES 900 (Aug, Sep, Oct). Till 123456. https://example.com");
});

test("composeReminderMessage rounds a fractional balance", () => {
  const msg = composeReminderMessage("KES {balance}", {
    fundName: "X", fullName: "A B", balance: 299.5, unpaidSummary: "", tillNumber: "1", siteUrl: "",
  });
  assert.equal(msg, "KES 300");
});

// ---------------------------------------------------------------------
// lib/messaging.ts: who is texted, who is skipped, and that nobody is
// ever texted twice. A tiny fake database stands in for Supabase.
// ---------------------------------------------------------------------
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.ADMIN_USERNAME ??= "test-admin";
process.env.ADMIN_PASSWORD ??= "test-password";
process.env.SESSION_SECRET ??= "test-session-secret";
process.env.CRON_SECRET ??= "test-cron-secret";
delete process.env.SMS_LIVE;

const { planMessages, sendMessages } = await import("../lib/messaging.ts");
const { mergeSettingsWithDefaults } = await import("../lib/settings.ts");
const { nairobiCurrentMonthKey } = await import("../lib/dates.ts");

type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>, inserted: { table: string; row: Row }[]) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const query: Record<string, unknown> = {
        select: () => query,
        returns: () => query,
        range: () => query,
        order: (column: string, options?: { ascending?: boolean }) => {
          const direction = options?.ascending === false ? -1 : 1;
          rows = [...rows].sort((a, b) => String(a[column]).localeCompare(String(b[column])) * direction);
          return query;
        },
        limit: (count: number) => {
          rows = rows.slice(0, count);
          return query;
        },
        eq: (column: string, value: unknown) => {
          rows = rows.filter((r) => r[column] === value);
          return query;
        },
        insert: (row: Row) => {
          inserted.push({ table, row });
          return Promise.resolve({ error: null });
        },
        then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }),
      };
      return query;
    },
  } as never;
}

const PERIOD = nairobiCurrentMonthKey();
const SETTINGS = mergeSettingsWithDefaults({ fund_name: "Test Fund", till_number: "111111", target_amount: "300", site_url: "https://example.test" });
const phones = (n: string | null) => (n ? [{ phone_number: n, is_primary: true }] : []);
const TABLES = (): Record<string, Row[]> => ({
  members: [
    { id: "owes", full_name: "Alice Owes", joined_on: "2020-01-01", is_active: true, member_phones: phones("254700000001") },
    { id: "nophone", full_name: "Bob NoPhone", joined_on: "2020-01-01", is_active: true, member_phones: phones(null) },
    { id: "paid", full_name: "Cara Paid", joined_on: "2020-01-01", is_active: true, member_phones: phones("254700000003") },
    { id: "sent", full_name: "Dan Sent", joined_on: "2020-01-01", is_active: true, member_phones: phones("254700000004") },
    { id: "pending", full_name: "Eve Pending", joined_on: "2020-01-01", is_active: true, member_phones: phones("254700000005") },
  ],
  payment_allocations: [{ member_id: "paid", amount: 1000000000, payments: { paid_at: "2026-09-01T00:00:00.000Z" } }],
  payments: [{ suggested_member_id: "pending", match_status: "needs_confirmation", amount: 300, kind: "mpesa", paid_at: "2026-09-02T00:00:00.000Z" }],
  sms_log: [{ member_id: "sent", kind: "reminder", period: PERIOD, status: "sent" }],
  fund_expenses: [],
  imports: [{ status: "confirmed", created_at: new Date().toISOString() }], // a statement was imported just now
});
const statusOf = (plan: { messages: { memberId: string; status: string }[] }, id: string) => plan.messages.find((m) => m.memberId === id)?.status;

test("reminder plan: owes -> ready; no phone, already sent, awaiting confirmation and fully paid are all kept out, with the reason", async () => {
  const plan = await planMessages(fakeDb(TABLES(), []), "reminder", SETTINGS);
  assert.equal(plan.period, PERIOD);
  assert.equal(statusOf(plan, "owes"), "ready");
  assert.equal(statusOf(plan, "nophone"), "no_phone");
  assert.equal(statusOf(plan, "sent"), "already_sent");
  assert.equal(statusOf(plan, "pending"), "pending_confirmation");
  assert.equal(statusOf(plan, "paid"), "no_balance_due");
  assert.equal(plan.counts.ready, 1);
  assert.equal(plan.live, false); // SMS_LIVE is off: nothing real can leave
  assert.ok(plan.messages.find((m) => m.memberId === "owes")!.message.includes("Alice")); // first name in the wording
});

test("report plan: EVERYONE with a phone gets one (fully paid included); a reminder already sent does not count as a report sent", async () => {
  const plan = await planMessages(fakeDb(TABLES(), []), "report", SETTINGS);
  assert.equal(statusOf(plan, "owes"), "ready");
  assert.equal(statusOf(plan, "paid"), "ready");
  assert.equal(statusOf(plan, "sent"), "ready");
  assert.equal(statusOf(plan, "pending"), "ready");
  assert.equal(statusOf(plan, "nophone"), "no_phone");
  const paid = plan.messages.find((m) => m.memberId === "paid")!;
  assert.ok(paid.message.includes("Your balance: KES 0"));
  assert.ok(paid.message.includes("paid ahead")); // a huge advance payment is reported as such, not as a plain zero
  const pending = plan.messages.find((m) => m.memberId === "pending")!;
  assert.ok(pending.message.includes("being confirmed"));
  // No report names any member at all.
  for (const m of plan.messages) {
    for (const other of plan.messages) assert.ok(!m.message.includes(other.fullName.split(" ")[0]) || m.message === "", `${m.fullName}'s report must not name ${other.fullName}`);
  }
});

test("sending with live sending OFF records dry runs, only for members who are ready", async () => {
  const inserted: { table: string; row: Row }[] = [];
  const summary = await sendMessages(fakeDb(TABLES(), inserted), "reminder", { settings: SETTINGS });
  assert.equal(summary.dryRun, true);
  assert.equal(summary.attempted, 1);
  assert.equal(summary.sent, 1);
  const logged = inserted.filter((i) => i.table === "sms_log").map((i) => i.row);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].member_id, "owes");
  assert.equal(logged[0].status, "dry_run");
  assert.equal(logged[0].kind, "reminder");
  assert.equal(logged[0].period, PERIOD);
});

test("asking to send to a member who is NOT ready (awaiting confirmation, already sent) sends nothing for them", async () => {
  const inserted: { table: string; row: Row }[] = [];
  const summary = await sendMessages(fakeDb(TABLES(), inserted), "reminder", { memberIds: ["pending", "sent", "paid"], settings: SETTINGS });
  assert.equal(summary.attempted, 0);
  assert.equal(inserted.filter((i) => i.table === "sms_log").length, 0);
});

test("choosing only some members sends only to them", async () => {
  const inserted: { table: string; row: Row }[] = [];
  const summary = await sendMessages(fakeDb(TABLES(), inserted), "report", { memberIds: ["owes", "paid"], settings: SETTINGS });
  assert.equal(summary.attempted, 2);
  assert.deepEqual(
    inserted.filter((i) => i.table === "sms_log").map((i) => i.row.member_id).sort(),
    ["owes", "paid"]
  );
});

test("once a real text has been recorded for this month, that member is never offered it again", async () => {
  const tables = TABLES();
  tables.sms_log.push({ member_id: "owes", kind: "reminder", period: PERIOD, status: "sent" });
  const plan = await planMessages(fakeDb(tables, []), "reminder", SETTINGS);
  assert.equal(statusOf(plan, "owes"), "already_sent");
  assert.equal(plan.counts.ready, 0);
  const inserted: { table: string; row: Row }[] = [];
  const summary = await sendMessages(fakeDb(tables, inserted), "reminder", { settings: SETTINGS });
  assert.equal(summary.attempted, 0);
});

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

test("fresh payment data: not stale, and an automatic send goes ahead", async () => {
  const inserted: { table: string; row: Row }[] = [];
  const db = fakeDb(TABLES(), inserted);
  const plan = await planMessages(db, "reminder", SETTINGS);
  assert.equal(plan.dataFreshness.stale, false);
  assert.equal(plan.dataFreshness.ageDays, 0);
  const summary = await sendMessages(db, "reminder", { settings: SETTINGS, automatic: true });
  assert.equal(summary.held, undefined);
  assert.equal(summary.attempted, 1);
});

test("old payment data: an AUTOMATIC send is held back with a clear reason and nothing is logged; a send started by hand still works", async () => {
  const tables = TABLES();
  tables.imports = [{ status: "confirmed", created_at: daysAgo(10) }];
  const inserted: { table: string; row: Row }[] = [];
  const db = fakeDb(tables, inserted);

  const plan = await planMessages(db, "reminder", SETTINGS);
  assert.equal(plan.dataFreshness.stale, true);
  assert.equal(plan.dataFreshness.ageDays, 10);

  const held = await sendMessages(db, "reminder", { settings: SETTINGS, automatic: true });
  assert.equal(held.attempted, 0);
  assert.ok(held.held && held.held.includes("10 day(s) ago"));
  assert.equal(inserted.length, 0);

  const manual = await sendMessages(db, "reminder", { settings: SETTINGS });
  assert.equal(manual.attempted, 1);
});

test("no statement ever imported counts as stale; a limit of 0 turns the hold off", async () => {
  const tables = TABLES();
  tables.imports = [];
  const plan = await planMessages(fakeDb(tables, []), "reminder", SETTINGS);
  assert.equal(plan.dataFreshness.stale, true);
  assert.equal(plan.dataFreshness.ageDays, null);

  const off = mergeSettingsWithDefaults({ ...SETTINGS, auto_send_max_import_age_days: "0" });
  const planOff = await planMessages(fakeDb(tables, []), "reminder", off);
  assert.equal(planOff.dataFreshness.stale, false);
});

test("the import-age limit is a real setting with a safe default", async () => {
  assert.equal(mergeSettingsWithDefaults({}).auto_send_max_import_age_days, "4");
});

// ---------------------------------------------------------------------
// lib/health.ts: the checks behind the Health tab
// ---------------------------------------------------------------------
import { buildHealthChecks, overallStatus, nextScheduledDate, type HealthInput } from "../lib/health.ts";

const NOW = "2026-10-22T09:00:00.000Z";
const hoursBefore = (h: number) => new Date(new Date(NOW).getTime() - h * 3600 * 1000).toISOString();
const HEALTHY: HealthInput = {
  now: NOW,
  lastDailyRun: { startedAt: hoursBefore(5), ok: true, details: { reminders: null, report: null } },
  smsLive: true,
  atConfigured: true,
  freshness: { ageDays: 1, maxAgeDays: 4, stale: false },
  needsConfirmation: 0,
  unmatched: 0,
  membersWithoutPhone: [],
  lastBackupAt: hoursBefore(24 * 3),
  alertPhoneCount: 1,
  statementCheck: { closingBalance: 16048.41, asOfDate: "2026-10-02", ledgerBalance: 16048.41 },
  unreadMessages: 0,
};
const statusOfCheck = (input: HealthInput, key: string) => buildHealthChecks(input).find((c) => c.key === key)?.status;

test("health: everything in order is all green", () => {
  const checks = buildHealthChecks(HEALTHY);
  assert.ok(checks.every((c) => c.status === "ok"), JSON.stringify(checks.filter((c) => c.status !== "ok")));
  assert.equal(overallStatus(checks), "ok");
});

test("health: the daily job is amber if it never ran or went quiet, red if its last run failed", () => {
  assert.equal(statusOfCheck({ ...HEALTHY, lastDailyRun: null }, "daily_job"), "warn");
  assert.equal(statusOfCheck({ ...HEALTHY, lastDailyRun: { startedAt: hoursBefore(60), ok: true, details: null } }, "daily_job"), "warn");
  const failed = buildHealthChecks({ ...HEALTHY, lastDailyRun: { startedAt: hoursBefore(2), ok: false, details: { error: "reminders: boom" } } }).find((c) => c.key === "daily_job");
  assert.equal(failed?.status, "bad");
  assert.ok(failed?.detail.includes("boom"));
});

test("health: an automatic text that was held back for old data is surfaced with its reason", () => {
  const input: HealthInput = { ...HEALTHY, lastDailyRun: { startedAt: hoursBefore(3), ok: true, details: { reminders: { held: "The last statement import was 9 day(s) ago." }, report: null } } };
  const held = buildHealthChecks(input).find((c) => c.key === "held");
  assert.equal(held?.status, "warn");
  assert.ok(held?.detail.includes("9 day(s) ago"));
});

test("health: old or missing payment data is amber", () => {
  assert.equal(statusOfCheck({ ...HEALTHY, freshness: { ageDays: 9, maxAgeDays: 4, stale: true } }, "freshness"), "warn");
  assert.equal(statusOfCheck({ ...HEALTHY, freshness: { ageDays: null, maxAgeDays: 4, stale: true } }, "freshness"), "warn");
});

test("health: texting is red when live without credentials, amber when switched off, green when ready", () => {
  assert.equal(statusOfCheck({ ...HEALTHY, smsLive: true, atConfigured: false }, "sms"), "bad");
  assert.equal(statusOfCheck({ ...HEALTHY, smsLive: false }, "sms"), "warn");
  assert.equal(statusOfCheck(HEALTHY, "sms"), "ok");
});

test("health: payments waiting and members without a phone are listed in plain words", () => {
  const checks = buildHealthChecks({ ...HEALTHY, needsConfirmation: 2, unmatched: 1, membersWithoutPhone: ["Ann One", "Bea Two"] });
  const waiting = checks.find((c) => c.key === "waiting");
  assert.equal(waiting?.status, "warn");
  assert.ok(waiting?.detail.includes("2 need confirming") && waiting.detail.includes("1 are unmatched"));
  const noPhone = checks.find((c) => c.key === "no_phone");
  assert.ok(noPhone?.detail.includes("Ann One, Bea Two"));
});

test("health: a backup is amber if never taken or over 35 days old", () => {
  assert.equal(statusOfCheck({ ...HEALTHY, lastBackupAt: null }, "backup"), "warn");
  assert.equal(statusOfCheck({ ...HEALTHY, lastBackupAt: hoursBefore(24 * 40) }, "backup"), "warn");
  assert.equal(statusOfCheck({ ...HEALTHY, lastBackupAt: hoursBefore(24 * 34) }, "backup"), "ok");
});

test("health: amber when nobody is set up to be reminded to import the statement", () => {
  assert.equal(statusOfCheck({ ...HEALTHY, alertPhoneCount: 0 }, "alerts"), "warn");
  assert.equal(statusOfCheck({ ...HEALTHY, alertPhoneCount: 2 }, "alerts"), "ok");
});

test("health: the total in the account is compared with the statement's closing balance, and a difference is spelled out", () => {
  assert.equal(statusOfCheck(HEALTHY, "balance_match"), "ok");
  const off = buildHealthChecks({ ...HEALTHY, statementCheck: { closingBalance: 16048.41, asOfDate: "2026-10-02", ledgerBalance: 15943.41 } }).find((c) => c.key === "balance_match");
  assert.equal(off?.status, "warn");
  assert.ok(off?.detail.includes("KES 105 too low"), off?.detail);
  assert.ok(off?.detail.includes("2026-10-02"));
  const high = buildHealthChecks({ ...HEALTHY, statementCheck: { closingBalance: 1000, asOfDate: "2026-10-02", ledgerBalance: 1300 } }).find((c) => c.key === "balance_match");
  assert.ok(high?.detail.includes("KES 300 too high"));
  // Nothing to compare yet: no line at all, rather than a false alarm.
  assert.equal(buildHealthChecks({ ...HEALTHY, statementCheck: null }).some((c) => c.key === "balance_match"), false);
});

test("a booster does not pay off monthly dues in the reminders either: the member still owes", async () => {
  const tables = TABLES();
  tables.payment_allocations = [{ member_id: "owes", amount: 1000000000, payments: { paid_at: "2026-09-01T00:00:00.000Z", purpose: "booster" } }];
  const plan = await planMessages(fakeDb(tables, []), "reminder", SETTINGS);
  assert.equal(statusOfPlan(plan, "owes"), "ready");
  tables.payment_allocations = [{ member_id: "owes", amount: 1000000000, payments: { paid_at: "2026-09-01T00:00:00.000Z", purpose: "monthly" } }];
  const paidPlan = await planMessages(fakeDb(tables, []), "reminder", SETTINGS);
  assert.equal(statusOfPlan(paidPlan, "owes"), "no_balance_due");
});
const statusOfPlan = (plan: { messages: { memberId: string; status: string }[] }, id: string) => plan.messages.find((m) => m.memberId === id)?.status;

test("health: unread private messages from members make the Messages line amber", () => {
  assert.equal(statusOfCheck(HEALTHY, "messages"), "ok");
  const waiting = buildHealthChecks({ ...HEALTHY, unreadMessages: 3 }).find((c) => c.key === "messages");
  assert.equal(waiting?.status, "warn");
  assert.ok(waiting?.detail.includes("3 private message(s)"));
});

test("a private message to the admin texts the admin (a dry run while live sending is off) and never throws", async () => {
  const { notifyAdminsOfPrivateMessage } = await import("../lib/messaging.ts");
  const tables = { ...ADMIN_TABLES(), settings: [{ key: "fund_name", value: "Test Fund" }] };
  const result = await notifyAdminsOfPrivateMessage(fakeDb(tables, []), "Ann One");
  assert.deepEqual(result, { recipients: 1 }); // the one active member-admin
  assert.equal(await notifyAdminsOfPrivateMessage(fakeDb({ members: [], settings: [] }, []), "Ann One"), null); // nobody to tell
});

test("health: the overall status is the worst single check", () => {
  assert.equal(overallStatus([{ key: "a", label: "a", status: "ok", detail: "" }, { key: "b", label: "b", status: "warn", detail: "" }]), "warn");
  assert.equal(overallStatus([{ key: "a", label: "a", status: "warn", detail: "" }, { key: "b", label: "b", status: "bad", detail: "" }]), "bad");
});

test("nextScheduledDate: this month if the day has not passed (today counts), otherwise next month, across a year end", () => {
  assert.equal(nextScheduledDate("2026-10-03", 7), "2026-10-07");
  assert.equal(nextScheduledDate("2026-10-07", 7), "2026-10-07");
  assert.equal(nextScheduledDate("2026-10-22", 7), "2026-11-07");
  assert.equal(nextScheduledDate("2026-12-22", 15), "2027-01-15");
  assert.equal(nextScheduledDate("2026-10-22", 31), "2026-10-28"); // clamped so it exists in every month
});

// ---------------------------------------------------------------------
// lib/admin-alerts.ts + sendAdminAlert: telling the admin to import the statement
// ---------------------------------------------------------------------
import { buildAdminAlert, headsUpDay, ordinal, type AdminAlertInput } from "../lib/admin-alerts.ts";
const { sendAdminAlert, adminAlertPhones } = await import("../lib/messaging.ts");

const ALERT_BASE: AdminAlertInput = {
  dayOfMonth: 3,
  reminderDay: 7,
  reportDay: 15,
  freshness: { stale: true, ageDays: 9 },
  held: { reminder: false, report: false },
  fundName: "Test Fund",
  siteUrl: "https://example.test/",
};

test("ordinal and headsUpDay: 1st, 2nd, 3rd, 11th... and two days before, never before the 1st", () => {
  assert.deepEqual([1, 2, 3, 4, 7, 11, 12, 13, 15, 21, 22, 23].map(ordinal), ["1st", "2nd", "3rd", "4th", "7th", "11th", "12th", "13th", "15th", "21st", "22nd", "23rd"]);
  assert.equal(headsUpDay(7), 5);
  assert.equal(headsUpDay(15), 13);
  assert.equal(headsUpDay(2), 1);
  assert.equal(headsUpDay(1), 1);
});

test("admin alert: nothing is sent while the payment data is fresh", () => {
  assert.equal(buildAdminAlert({ ...ALERT_BASE, dayOfMonth: 5, freshness: { stale: false, ageDays: 1 } }), null);
  assert.equal(buildAdminAlert({ ...ALERT_BASE, freshness: { stale: false, ageDays: 0 }, held: { reminder: true, report: false } }), null);
});

test("admin alert: a heads-up two days before the reminder and before the report, only on those days", () => {
  const reminderHeadsUp = buildAdminAlert({ ...ALERT_BASE, dayOfMonth: 5 });
  assert.ok(reminderHeadsUp?.includes("reminder on the 7th"));
  assert.ok(reminderHeadsUp?.includes("9 day(s) old"));
  assert.ok(reminderHeadsUp?.includes("https://example.test/admin"));
  const reportHeadsUp = buildAdminAlert({ ...ALERT_BASE, dayOfMonth: 13 });
  assert.ok(reportHeadsUp?.includes("fund report on the 15th"));
  assert.equal(buildAdminAlert({ ...ALERT_BASE, dayOfMonth: 4 }), null);
  assert.equal(buildAdminAlert({ ...ALERT_BASE, dayOfMonth: 6 }), null);
});

test("admin alert: both texts due close together are mentioned in one message", () => {
  const msg = buildAdminAlert({ ...ALERT_BASE, dayOfMonth: 5, reportDay: 7 });
  assert.ok(msg?.includes("reminder on the 7th") && msg.includes("fund report on the 7th"));
});

test("admin alert: when a text was held back, say so (this takes precedence over the heads-up), and handle 'never imported'", () => {
  const held = buildAdminAlert({ ...ALERT_BASE, dayOfMonth: 7, held: { reminder: true, report: false } });
  assert.ok(held?.includes("automatic reminder text was held back"));
  assert.ok(held?.includes("next daily run"));
  const both = buildAdminAlert({ ...ALERT_BASE, dayOfMonth: 15, held: { reminder: true, report: true } });
  assert.ok(both?.includes("reminder and report"));
  const never = buildAdminAlert({ ...ALERT_BASE, freshness: { stale: true, ageDays: null }, held: { reminder: true, report: false } });
  assert.ok(never?.includes("no statement has been imported yet"));
});

const ADMIN_TABLES = (): Record<string, Row[]> => ({
  members: [
    { id: "a", full_name: "Admin Member", is_active: true, is_admin: true, member_phones: [{ phone_number: "254700000001", is_primary: true }] },
    { id: "b", full_name: "Plain Member", is_active: true, is_admin: false, member_phones: [{ phone_number: "254700000002", is_primary: true }] },
    { id: "c", full_name: "Gone Admin", is_active: false, is_admin: true, member_phones: [{ phone_number: "254700000003", is_primary: true }] },
  ],
});

test("adminAlertPhones: the Setup phone plus active member-admins, each once, nobody else", async () => {
  const phones = await adminAlertPhones(fakeDb(ADMIN_TABLES(), []), { admin_alert_phone: "0711 222 333" });
  assert.deepEqual([...phones].sort(), ["254700000001", "254711222333"]);
  const same = await adminAlertPhones(fakeDb(ADMIN_TABLES(), []), { admin_alert_phone: "0700000001" });
  assert.deepEqual(same, ["254700000001"]); // the same person is not texted twice
  assert.deepEqual(await adminAlertPhones(fakeDb(ADMIN_TABLES(), []), { admin_alert_phone: "not a number" }), ["254700000001"]);
});

test("sendAdminAlert: sends (as a dry run while live sending is off) when data is stale and someone should be told", async () => {
  const result = await sendAdminAlert(fakeDb(ADMIN_TABLES(), []), { ...SETTINGS, admin_alert_phone: "0711222333" }, {
    dayOfMonth: 7,
    reminders: { kind: "reminder", period: PERIOD, attempted: 0, sent: 0, dryRun: true, failed: 0, failures: [], held: "old data" },
    report: null,
    freshness: { lastUpdatedAt: null, ageDays: 9, maxAgeDays: 4, stale: true },
  });
  assert.ok(result);
  assert.equal(result?.recipients, 2);
  assert.equal(result?.dryRun, true);
  assert.ok(result?.message.includes("held back"));
});

test("sendAdminAlert: says nothing when the data is fresh, or when there is nobody to tell", async () => {
  const fresh = await sendAdminAlert(fakeDb(ADMIN_TABLES(), []), SETTINGS, {
    dayOfMonth: 7, reminders: null, report: null, freshness: { lastUpdatedAt: null, ageDays: 0, maxAgeDays: 4, stale: false },
  });
  assert.equal(fresh, null);
  const nobody = await sendAdminAlert(fakeDb({ members: [] }, []), SETTINGS, {
    dayOfMonth: 5, reminders: null, report: null, freshness: { lastUpdatedAt: null, ageDays: 9, maxAgeDays: 4, stale: true },
  });
  assert.equal(nobody, null);
});
