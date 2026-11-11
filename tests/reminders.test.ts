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
// lib/messaging.ts: who is offered a message, who is skipped and why.
// A tiny fake database stands in for Supabase.
// ---------------------------------------------------------------------
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.ADMIN_USERNAME ??= "test-admin";
process.env.ADMIN_PASSWORD ??= "test-password";
process.env.SESSION_SECRET ??= "test-session-secret";
process.env.CRON_SECRET ??= "test-cron-secret";

const { planMessages } = await import("../lib/messaging.ts");
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

test("once a record of a sent message exists for this month, that member is not offered it again", async () => {
  const tables = TABLES();
  tables.sms_log.push({ member_id: "owes", kind: "reminder", period: PERIOD, status: "sent" });
  const plan = await planMessages(fakeDb(tables, []), "reminder", SETTINGS);
  assert.equal(statusOf(plan, "owes"), "already_sent");
  assert.equal(plan.counts.ready, 0);
});

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

test("fresh payment data is not stale; old payment data is flagged, and planning never sends or writes anything", async () => {
  const inserted: { table: string; row: Row }[] = [];
  const fresh = await planMessages(fakeDb(TABLES(), inserted), "reminder", SETTINGS);
  assert.equal(fresh.dataFreshness.stale, false);
  assert.equal(fresh.dataFreshness.ageDays, 0);
  const tables = TABLES();
  tables.imports = [{ status: "confirmed", created_at: daysAgo(10) }];
  const old = await planMessages(fakeDb(tables, inserted), "reminder", SETTINGS);
  assert.equal(old.dataFreshness.stale, true);
  assert.equal(old.dataFreshness.ageDays, 10);
  assert.equal(inserted.length, 0);
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
  freshness: { ageDays: 1, maxAgeDays: 4, stale: false },
  needsConfirmation: 0,
  unmatched: 0,
  membersWithoutPhone: [],
  lastBackupAt: hoursBefore(24 * 3),
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

test("health: old or missing payment data is amber", () => {
  assert.equal(statusOfCheck({ ...HEALTHY, freshness: { ageDays: 9, maxAgeDays: 4, stale: true } }, "freshness"), "warn");
  assert.equal(statusOfCheck({ ...HEALTHY, freshness: { ageDays: null, maxAgeDays: 4, stale: true } }, "freshness"), "warn");
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
