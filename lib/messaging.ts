// lib/messaging.ts
//
// SERVER-ONLY. Works out the two monthly messages and who each one is for:
//
//   * "reminder": the arrears reminder (default: the 7th of the month)
//   * "report":   the fund report (default: the 15th of the month)
//
// planMessages() only LOOKS: it works out who would get what, with the exact
// wording, and sends nothing. The admin sends each one by hand from the
// Reminders tab (a WhatsApp link per member). The app has no text-message
// provider: Africa's Talking was removed on 11 Nov 2026.
//
// Rules the plan follows:
//   * A member who already has a "sent" record this month (old records from
//     before the removal) is not offered it again.
//   * A member with a payment waiting for the admin's confirmation is NOT
//     offered a reminder (their balance may be wrong). They are listed instead.
//     They DO get the report, with a "being confirmed" note.
//   * A member with no phone is listed, never guessed at.

import type { SupabaseClient } from "@supabase/supabase-js";
import { nairobiCurrentMonthKey, nairobiTodayDateString } from "./dates.ts";
import { mergeSettingsWithDefaults } from "./settings.ts";
import { buildReminderCandidates, composeReminderMessage } from "./reminders.ts";
import { buildReportMessages, smsSegments } from "./report.ts";
import { buildDashboard } from "./dashboard.ts";
import { fetchAllRows } from "./pagination.ts";
import { countsTowardMonthlyDues } from "./payment-purpose.ts";

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
  /** True when the payment data is old enough that the admin should import a newer statement before sending. */
  stale: boolean;
}

export interface MessagePlan {
  kind: MessageKind;
  period: string; // "YYYY-MM"
  today: string; // "YYYY-MM-DD" (Nairobi)
  scheduledDay: number;
  template: string;
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
    .eq("contributes", true)
    .returns<MemberRow[]>();
  const members = (memberRows ?? []).map((m) => ({
    id: m.id,
    fullName: m.full_name,
    joinedOn: m.joined_on,
    primaryPhone: (m.member_phones ?? []).find((p) => p.is_primary)?.phone_number ?? null,
  }));

  const allocRows = await fetchAllRows((range) =>
    db.from("payment_allocations").select("member_id, amount, payments(paid_at, purpose)").range(range.from, range.to)
  );
  const allocations = (allocRows as unknown as { member_id: string; amount: number; payments: { paid_at: string; purpose?: string } | null }[]);
  const allocatedByMember: Record<string, number> = {};
  // Only payments for the MONTHLY contribution pay off monthly dues; boosters and the like do not.
  for (const a of allocations) {
    if (!countsTowardMonthlyDues(a.payments?.purpose)) continue;
    allocatedByMember[a.member_id] = (allocatedByMember[a.member_id] ?? 0) + Number(a.amount);
  }

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
      allocations: allocations.map((a) => ({ memberId: a.member_id, amount: a.amount, paidAt: a.payments?.paid_at ?? "", purpose: a.payments?.purpose })),
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
    messages,
    counts,
    totalSegments: messages.filter((m) => m.status === "ready").reduce((n, m) => n + m.segments, 0),
    dataFreshness: await loadDataFreshness(db, today, settings),
  };
}
