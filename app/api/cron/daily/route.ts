// app/api/cron/daily/route.ts
//
// Runs once a day (configured in vercel.json). Three jobs in one route,
// since Vercel's free plan allows only one daily cron slot:
//
//   1. Keep-alive: a real query, so Supabase's free tier never sees a
//      week of inactivity and pauses again.
//   2. Reminders: if today falls within reminder_day..reminder_day+2
//      (Nairobi time), sends the arrears reminder to every member with a
//      balance above zero who has not already been sent one this month.
//   3. Fund report: the same for report_day..report_day+2, to every
//      member with a phone.
//
// The 3-day catch-up window means a missed day never skips a whole
// month, and the database allows only one real text per member, per kind,
// per month, so running twice never texts anyone twice. Respects SMS_LIVE:
// with it off (the default) everything is logged as a dry run.
//
// The planning and sending are in lib/messaging.ts, shared with the
// admin screen's "Send now" buttons.
//
// Two ways in: Vercel's own call (Authorization: Bearer CRON_SECRET,
// which Vercel sends automatically for a configured cron) or an admin
// session ("Run now").

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { serverEnv } from "@/lib/env";
import { getAdminSession } from "@/lib/auth";
import { nairobiTodayDateString, nairobiCurrentMonthKey } from "@/lib/dates";
import { loadSettings, sendMessages, type SendSummary } from "@/lib/messaging";

const WINDOW_DAYS = 3;

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

  // 1. Keep-alive: a real query against the database.
  await db.from("settings").select("key").limit(1);

  const today = nairobiTodayDateString();
  const dayOfMonth = Number(today.split("-")[2]);
  const period = nairobiCurrentMonthKey();
  const settings = await loadSettings(db);

  const reminderDay = Number(settings.reminder_day) || 7;
  const reportDay = Number(settings.report_day) || 15;
  const inReminderWindow = dayOfMonth >= reminderDay && dayOfMonth < reminderDay + WINDOW_DAYS;
  const inReportWindow = dayOfMonth >= reportDay && dayOfMonth < reportDay + WINDOW_DAYS;

  let reminders: SendSummary | null = null;
  let report: SendSummary | null = null;
  let ok = true;
  const errors: string[] = [];

  // Each job is independent: a problem with one must not stop the other.
  if (inReminderWindow) {
    try {
      reminders = await sendMessages(db, "reminder", { settings, automatic: true });
    } catch (err) {
      ok = false;
      errors.push(`reminders: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (inReportWindow) {
    try {
      report = await sendMessages(db, "report", { settings, automatic: true });
    } catch (err) {
      ok = false;
      errors.push(`report: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const errorMessage = errors.length > 0 ? errors.join(" | ") : null;
  await db.from("job_runs").insert({
    job: "daily",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    ok,
    details: { today, period, inReminderWindow, inReportWindow, reminders, report, error: errorMessage },
  });

  return NextResponse.json({ ok, today, period, inReminderWindow, inReportWindow, reminders, report, error: errorMessage });
}
