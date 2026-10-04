// app/api/cron/daily/route.ts
//
// Runs once a day (configured in vercel.json). Two jobs in one route,
// since Vercel's free plan allows only one daily cron slot:
//
//   1. Keep-alive: a real query, so Supabase's free tier never sees a
//      week of inactivity and pauses again.
//   2. Reminders: if today falls within reminder_day..reminder_day+2
//      (Nairobi time), sends the 7th-style reminder to every member
//      with a balance above zero who hasn't already been sent one this
//      period. The 3-day catch-up window means a missed day never
//      skips a whole month. Respects SMS_LIVE — with it off (the
//      default), this runs exactly the same logic and logs exactly the
//      same way, just without a real message leaving.
//
// Two ways in: Vercel's own call (Authorization: Bearer CRON_SECRET,
// which Vercel sends automatically for a configured cron) or an admin
// session, so the admin UI's "Run now" button can trigger the same code.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { serverEnv } from "@/lib/env";
import { getAdminSession } from "@/lib/auth";
import { nairobiTodayDateString, nairobiCurrentMonthKey } from "@/lib/dates";
import { mergeSettingsWithDefaults } from "@/lib/settings";
import { buildReminderCandidates, composeReminderMessage } from "@/lib/reminders";
import { sendSms } from "@/lib/sms";
import { fetchAllRows } from "@/lib/pagination";
import type { SupabaseClient } from "@supabase/supabase-js";

const REMINDER_WINDOW_DAYS = 3;

interface MemberPhoneRow {
  phone_number: string;
  is_primary: boolean;
}
interface MemberRow {
  id: string;
  full_name: string;
  joined_on: string;
  member_phones: MemberPhoneRow[] | null;
}

async function runReminders(db: SupabaseClient, settings: Record<string, string>, period: string) {
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
    db.from("payment_allocations").select("member_id, amount").range(range.from, range.to)
  );
  const allocatedByMember: Record<string, number> = {};
  for (const a of allocRows as { member_id: string; amount: number }[]) {
    allocatedByMember[a.member_id] = (allocatedByMember[a.member_id] ?? 0) + Number(a.amount);
  }

  const { candidates } = buildReminderCandidates({
    members,
    allocatedByMember,
    targetAmount: Number(settings.target_amount),
    asOfMonth: period,
  });

  const { data: alreadySent } = await db
    .from("sms_log")
    .select("member_id")
    .eq("kind", "reminder")
    .eq("period", period)
    .eq("status", "sent");
  const sentIds = new Set((alreadySent ?? []).map((r) => r.member_id));

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const c of candidates) {
    if (sentIds.has(c.memberId)) {
      skipped++;
      continue;
    }

    const message = composeReminderMessage(settings.reminder_message_template, {
      fundName: settings.fund_name,
      fullName: c.fullName,
      balance: c.balance,
      unpaidSummary: c.unpaidSummary,
      tillNumber: settings.till_number,
      siteUrl: settings.site_url,
    });

    const result = await sendSms(c.phone, message);
    const status = result.ok ? (result.dryRun ? "dry_run" : "sent") : "failed";

    await db.from("sms_log").insert({
      kind: "reminder",
      period,
      member_id: c.memberId,
      to_phone: c.phone,
      message,
      status,
      error: result.error ?? null,
      provider_response: result.providerResponse ? JSON.stringify(result.providerResponse) : null,
    });

    if (status === "sent" || status === "dry_run") sent++;
    else failed++;
  }

  return { candidateCount: candidates.length, sent, skipped, failed };
}

export async function GET(req: NextRequest) {
  const env = serverEnv();
  const authHeader = req.headers.get("authorization");
  const isCronCall = authHeader === `Bearer ${env.cronSecret}`;
  const isAdmin = await getAdminSession();
  if (!isCronCall && !isAdmin) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const startedAt = new Date().toISOString();
  const db = supabaseAdmin();

  // 1. Keep-alive — a real query against the database.
  await db.from("settings").select("key").limit(1);

  const today = nairobiTodayDateString();
  const dayOfMonth = Number(today.split("-")[2]);
  const period = nairobiCurrentMonthKey();

  const { data: settingsRows } = await db.from("settings").select("key, value");
  const stored: Record<string, string> = {};
  for (const r of settingsRows ?? []) stored[r.key] = r.value;
  const settings = mergeSettingsWithDefaults(stored);

  const reminderDay = Number(settings.reminder_day) || 7;
  const inReminderWindow = dayOfMonth >= reminderDay && dayOfMonth < reminderDay + REMINDER_WINDOW_DAYS;

  let reminders: Awaited<ReturnType<typeof runReminders>> | null = null;
  let ok = true;
  let errorMessage: string | null = null;

  try {
    if (inReminderWindow) {
      reminders = await runReminders(db, settings, period);
    }
  } catch (err) {
    ok = false;
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  await db.from("job_runs").insert({
    job: "daily",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    ok,
    details: { today, period, inReminderWindow, reminders, error: errorMessage },
  });

  return NextResponse.json({ ok, today, period, inReminderWindow, reminders, error: errorMessage });
}
