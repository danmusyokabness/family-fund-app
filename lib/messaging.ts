// lib/messaging.ts
//
// SERVER-ONLY. Plans and sends the two scheduled texts, using the same
// code whether it is the daily cron job or the admin pressing a button:
//
//   * "reminder": the 7th-of-the-month arrears reminder
//   * "report":   the 15th-of-the-month fund report
//
// planMessages() only LOOKS: it works out who would get what, and sends
// nothing. sendMessages() plans again from scratch (it never trusts text
// sent from the browser), then sends what is "ready" and records every
// attempt in sms_log. One real text per member per kind per month is
// also enforced by a unique index in the database.
//
// Safety rules:
//   * With SMS_LIVE off, "sending" only records a dry run.
//   * A member who already received this month's text is never texted again.
//   * A member with a payment waiting for the admin's confirmation is NOT
//     sent a reminder (their balance may be wrong). They are listed instead.
//     They DO get the report, with a "being confirmed" note.
//   * A member with no phone is listed, never guessed at.

import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "./env.ts";
import { nairobiCurrentMonthKey, nairobiTodayDateString } from "./dates.ts";
import { mergeSettingsWithDefaults } from "./settings.ts";
import { buildReminderCandidates, composeReminderMessage } from "./reminders.ts";
import { buildReportMessages, smsSegments } from "./report.ts";
import { buildDashboard } from "./dashboard.ts";
import { fetchAllRows } from "./pagination.ts";
import { sendSms } from "./sms.ts";
import { buildAdminAlert } from "./admin-alerts.ts";
import { normalizePhone } from "./phone.ts";

export type MessageKind = "reminder" | "report";
export type PlanStatus = "ready" | "already_sent" | "no_phone" | "no_balance_due" | "pending_confirmation";

export interface PlannedMessage {
  memberId: string;
  fullName: string;
  phone: string | null;
  message: string;
  segments: number;
  balance: number;
  status: PlanStatus;
}

export interface DataFreshness {
  /** When payment data last changed: the latest confirmed statement import (or live Daraja payment). Null if never. */
  lastUpdatedAt: string | null;
  /** Whole days since then, in Nairobi time. Null if never. */
  ageDays: number | null;
  /** The limit from Setup; 0 means "never hold". */
  maxAgeDays: number;
  /** True when an AUTOMATIC text should wait for fresher data. */
  stale: boolean;
}

export interface MessagePlan {
  kind: MessageKind;
  period: string; // "YYYY-MM"
  today: string; // "YYYY-MM-DD" (Nairobi)
  scheduledDay: number;
  template: string;
  /** True only when SMS_LIVE=true AND the Africa's Talking details are present. */
  live: boolean;
  liveNote: string;
  messages: PlannedMessage[];
  counts: Record<PlanStatus, number>;
  totalSegments: number;
  dataFreshness: DataFreshness;
}

interface MemberRow {
  id: string;
  full_name: string;
  joined_on: string;
  member_phones: { phone_number: string; is_primary: boolean }[] | null;
}

function liveStatus(): { live: boolean; liveNote: string } {
  const env = serverEnv();
  if (!env.smsLive) {
    return { live: false, liveNote: "Live sending is OFF (SMS_LIVE is not true). Sending only records a dry run; no real text leaves." };
  }
  if (!env.atApiKey || !env.atUsername) {
    return { live: false, liveNote: "SMS_LIVE is on but the Africa's Talking key or username is missing, so sending will fail." };
  }
  return { live: true, liveNote: "Live sending is ON. Real texts will be sent and charged to your Africa's Talking balance." };
}

export async function loadSettings(db: SupabaseClient): Promise<Record<string, string>> {
  const { data } = await db.from("settings").select("key, value");
  const stored: Record<string, string> = {};
  for (const r of data ?? []) stored[r.key] = r.value;
  return mergeSettingsWithDefaults(stored);
}

function nairobiDateOf(iso: string): string {
  return new Date(new Date(iso).getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function daysBetween(fromDate: string, toDate: string): number {
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/**
 * How current is the payment data? Until live M-PESA intake (Daraja) is
 * running, new payments only arrive when the admin imports a statement, so
 * the date of the last import is how fresh everything is.
 */
export async function loadDataFreshness(db: SupabaseClient, today: string, settings: Record<string, string>): Promise<DataFreshness> {
  const { data: imports } = await db.from("imports").select("created_at").eq("status", "confirmed").order("created_at", { ascending: false }).limit(1);
  const { data: live } = await db.from("payments").select("created_at").eq("source", "daraja").order("created_at", { ascending: false }).limit(1);

  const stamps = [...(imports ?? []), ...(live ?? [])].map((r) => String(r.created_at)).filter(Boolean).sort();
  const lastUpdatedAt = stamps.length > 0 ? stamps[stamps.length - 1] : null;
  const ageDays = lastUpdatedAt ? Math.max(0, daysBetween(nairobiDateOf(lastUpdatedAt), today)) : null;
  const maxAgeDays = Number(settings.auto_send_max_import_age_days ?? 4);
  const limit = Number.isFinite(maxAgeDays) ? maxAgeDays : 4;
  return { lastUpdatedAt, ageDays, maxAgeDays: limit, stale: limit > 0 && (ageDays === null || ageDays > limit) };
}

export async function planMessages(db: SupabaseClient, kind: MessageKind, settingsIn?: Record<string, string>): Promise<MessagePlan> {
  const settings = settingsIn ?? (await loadSettings(db));
  const today = nairobiTodayDateString();
  const period = nairobiCurrentMonthKey();

  const { data: memberRows } = await db
    .from("members")
    .select("id, full_name, joined_on, member_phones(phone_number, is_primary)")
    .eq("is_active", true)
    .returns<MemberRow[]>();
  const members = (memberRows ?? []).map((m) => ({
    id: m.id,
    fullName: m.full_name,
    joinedOn: m.joined_on,
    primaryPhone: (m.member_phones ?? []).find((p) => p.is_primary)?.phone_number ?? null,
  }));

  const allocRows = await fetchAllRows((range) =>
    db.from("payment_allocations").select("member_id, amount, payments(paid_at)").range(range.from, range.to)
  );
  const allocations = (allocRows as unknown as { member_id: string; amount: number; payments: { paid_at: string } | null }[]);
  const allocatedByMember: Record<string, number> = {};
  for (const a of allocations) allocatedByMember[a.member_id] = (allocatedByMember[a.member_id] ?? 0) + Number(a.amount);

  const { data: pendingRows } = await db.from("payments").select("suggested_member_id").eq("match_status", "needs_confirmation");
  const pendingIds = new Set<string>((pendingRows ?? []).map((r) => r.suggested_member_id).filter(Boolean) as string[]);

  const { data: sentRows } = await db
    .from("sms_log")
    .select("member_id")
    .eq("kind", kind)
    .eq("period", period)
    .eq("status", "sent");
  const alreadySent = new Set<string>((sentRows ?? []).map((r) => r.member_id).filter(Boolean) as string[]);

  const targetAmount = Number(settings.target_amount);
  const messages: PlannedMessage[] = [];

  if (kind === "reminder") {
    const { candidates, skipped } = buildReminderCandidates({ members, allocatedByMember, targetAmount, asOfMonth: period });
    for (const c of candidates) {
      const message = composeReminderMessage(settings.reminder_message_template, {
        fundName: settings.fund_name,
        fullName: c.fullName,
        balance: c.balance,
        unpaidSummary: c.unpaidSummary,
        tillNumber: settings.till_number,
        siteUrl: settings.site_url,
      });
      const status: PlanStatus = alreadySent.has(c.memberId) ? "already_sent" : pendingIds.has(c.memberId) ? "pending_confirmation" : "ready";
      messages.push({ memberId: c.memberId, fullName: c.fullName, phone: c.phone, message, segments: smsSegments(message), balance: c.balance, status });
    }
    for (const s of skipped) {
      messages.push({ memberId: s.memberId, fullName: s.fullName, phone: null, message: "", segments: 0, balance: 0, status: s.reason });
    }
  } else {
    // Group figures come from the same calculation as the dashboard.
    const paymentRows = await fetchAllRows((range) =>
      db.from("payments").select("amount, kind, paid_at, match_status").range(range.from, range.to)
    );
    const expenseRows = await fetchAllRows((range) => db.from("fund_expenses").select("amount").range(range.from, range.to));
    const dashboard = buildDashboard({
      members: members.map((m) => ({ id: m.id, fullName: m.fullName, joinedOn: m.joinedOn, dateOfBirth: null })),
      allocations: allocations.map((a) => ({ memberId: a.member_id, amount: a.amount, paidAt: a.payments?.paid_at ?? "" })),
      payments: (paymentRows as unknown as { amount: number; kind: string; paid_at: string; match_status: string }[]).map((p) => ({
        amount: p.amount,
        kind: p.kind,
        paidAt: p.paid_at,
        matchStatus: p.match_status,
      })),
      expensesTotal: (expenseRows as unknown as { amount: number }[]).reduce((sum, e) => sum + Number(e.amount), 0),
      targetAmount,
      fyStartMonth: Number(settings.fy_start_month),
      asOfMonth: period,
      viewerMemberId: null,
    });

    const reports = buildReportMessages({
      members,
      allocatedByMember,
      targetAmount,
      asOfMonth: period,
      monthCollected: dashboard.group.monthCollected,
      fundTotal: dashboard.group.fundTotal,
      pendingMemberIds: pendingIds,
      template: settings.report_message_template,
      fundName: settings.fund_name,
      reportDate: today,
      siteUrl: settings.site_url,
    });
    for (const r of reports) {
      const status: PlanStatus = !r.phone ? "no_phone" : alreadySent.has(r.memberId) ? "already_sent" : "ready";
      messages.push({ memberId: r.memberId, fullName: r.fullName, phone: r.phone, message: r.message, segments: r.segments, balance: r.balance, status });
    }
  }

  const counts: Record<PlanStatus, number> = { ready: 0, already_sent: 0, no_phone: 0, no_balance_due: 0, pending_confirmation: 0 };
  for (const m of messages) counts[m.status]++;
  const order: Record<PlanStatus, number> = { ready: 0, pending_confirmation: 1, no_phone: 2, already_sent: 3, no_balance_due: 4 };
  messages.sort((a, b) => order[a.status] - order[b.status] || a.fullName.localeCompare(b.fullName));

  return {
    kind,
    period,
    today,
    scheduledDay: Number(kind === "reminder" ? settings.reminder_day : settings.report_day) || (kind === "reminder" ? 7 : 15),
    template: kind === "reminder" ? settings.reminder_message_template : settings.report_message_template,
    ...liveStatus(),
    messages,
    counts,
    totalSegments: messages.filter((m) => m.status === "ready").reduce((n, m) => n + m.segments, 0),
    dataFreshness: await loadDataFreshness(db, today, settings),
  };
}

export interface SendSummary {
  kind: MessageKind;
  period: string;
  attempted: number;
  sent: number; // real texts, or dry runs when live sending is off
  dryRun: boolean;
  failed: number;
  failures: { fullName: string; error: string }[];
  /** Set when an automatic send was held back, with the reason. Nothing was sent. */
  held?: string;
}

/**
 * Sends everything that is "ready" (optionally only for the given members).
 * Plans again from scratch so the text always comes from the server.
 */
export async function sendMessages(
  db: SupabaseClient,
  kind: MessageKind,
  options: { memberIds?: string[]; settings?: Record<string, string>; automatic?: boolean } = {}
): Promise<SendSummary> {
  const plan = await planMessages(db, kind, options.settings);

  // An AUTOMATIC send waits when the payment data is too old: texts built on
  // old data would remind people who have already paid. A send the admin
  // starts by hand is never held (the screen shows the same warning).
  if (options.automatic && plan.dataFreshness.stale) {
    const f = plan.dataFreshness;
    const held =
      f.ageDays === null
        ? "No statement has ever been imported, so the automatic text was held back."
        : `The last statement import was ${f.ageDays} day(s) ago (limit ${f.maxAgeDays}), so the automatic text was held back. Import the latest statement and it will go out on the next daily run.`;
    return { kind, period: plan.period, attempted: 0, sent: 0, dryRun: !plan.live, failed: 0, failures: [], held };
  }

  const chosen = options.memberIds ? new Set(options.memberIds) : null;
  const toSend = plan.messages.filter((m) => m.status === "ready" && m.phone && (!chosen || chosen.has(m.memberId)));

  let sent = 0;
  let failed = 0;
  let dryRun = !plan.live;
  const failures: { fullName: string; error: string }[] = [];

  for (const m of toSend) {
    const result = await sendSms(m.phone as string, m.message);
    const status = result.ok ? (result.dryRun ? "dry_run" : "sent") : "failed";
    if (result.ok && !result.dryRun) dryRun = false;

    const { error: logError } = await db.from("sms_log").insert({
      kind,
      period: plan.period,
      member_id: m.memberId,
      to_phone: m.phone,
      message: m.message,
      status,
      error: result.error ?? null,
      provider_response: result.providerResponse ? JSON.stringify(result.providerResponse) : null,
    });

    if (status === "failed") {
      failed++;
      failures.push({ fullName: m.fullName, error: result.error ?? "The text could not be sent." });
    } else if (logError && status === "sent") {
      // The text WENT but could not be recorded: say so loudly, as a retry could text them twice.
      sent++;
      failures.push({ fullName: m.fullName, error: `Sent, but could not be recorded in the log (${logError.message}). Do not send again to this member.` });
    } else {
      sent++;
    }
  }

  return { kind, period: plan.period, attempted: toSend.length, sent, dryRun, failed, failures };
}

/**
 * Everyone who should be told to import the statement: the phone number
 * saved in Setup, plus the primary phone of every active member who is an
 * admin. Each number appears once, in canonical form.
 */
export async function adminAlertPhones(db: SupabaseClient, settings: Record<string, string>): Promise<string[]> {
  const phones = new Set<string>();
  const fromSetup = normalizePhone(settings.admin_alert_phone ?? "");
  if (fromSetup) phones.add(fromSetup);

  const { data } = await db
    .from("members")
    .select("member_phones(phone_number, is_primary)")
    .eq("is_active", true)
    .eq("is_admin", true)
    .returns<{ member_phones: { phone_number: string; is_primary: boolean }[] | null }[]>();
  for (const m of data ?? []) {
    const primary = (m.member_phones ?? []).find((p) => p.is_primary)?.phone_number;
    const canonical = primary ? normalizePhone(primary) : null;
    if (canonical) phones.add(canonical);
  }
  return [...phones];
}

export interface AdminAlertResult {
  message: string;
  recipients: number;
  /** True when nothing real was sent (live sending off). */
  dryRun: boolean;
  failed: number;
}

/** Sends the "import the statement" alert, if there is one to send. Never throws: an alert must not stop the daily job. */
export async function sendAdminAlert(
  db: SupabaseClient,
  settings: Record<string, string>,
  run: { dayOfMonth: number; reminders: SendSummary | null; report: SendSummary | null; freshness: DataFreshness }
): Promise<AdminAlertResult | null> {
  try {
    const message = buildAdminAlert({
      dayOfMonth: run.dayOfMonth,
      reminderDay: Number(settings.reminder_day) || 7,
      reportDay: Number(settings.report_day) || 15,
      freshness: run.freshness,
      held: { reminder: Boolean(run.reminders?.held), report: Boolean(run.report?.held) },
      fundName: settings.fund_name,
      siteUrl: settings.site_url,
    });
    if (!message) return null;

    const phones = await adminAlertPhones(db, settings);
    if (phones.length === 0) return null;

    let failed = 0;
    let dryRun = true;
    for (const phone of phones) {
      const result = await sendSms(phone, message);
      if (!result.ok) failed++;
      else if (!result.dryRun) dryRun = false;
    }
    return { message, recipients: phones.length, dryRun, failed };
  } catch {
    return null;
  }
}
