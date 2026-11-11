// app/api/cron/daily/route.ts
//
// Runs once a day (configured in vercel.json). Its one job is the
// keep-alive: a real query, so Supabase's free tier never sees a week of
// inactivity and pauses the database again. Each run is recorded in
// job_runs so the Health tab can show that it is still running.
//
// The app sends no texts by itself any more (Africa's Talking was removed on
// 11 Nov 2026). Reminders and reports are sent by hand from the Reminders tab.
//
// Two ways in: Vercel's own call (Authorization: Bearer CRON_SECRET,
// which Vercel sends automatically for a configured cron) or an admin
// session ("Run now").

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { serverEnv } from "@/lib/env";
import { getAdminSession } from "@/lib/auth";
import { nairobiTodayDateString, nairobiCurrentMonthKey } from "@/lib/dates";

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

  // Keep-alive: a real query against the database.
  const { error: pingError } = await db.from("settings").select("key").limit(1);
  const ok = !pingError;
  const errorMessage = pingError ? "The database did not answer the keep-alive query." : null;

  const today = nairobiTodayDateString();
  const period = nairobiCurrentMonthKey();

  await db.from("job_runs").insert({
    job: "daily",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    ok,
    details: { today, period, error: errorMessage },
  });

  return NextResponse.json({ ok, today, period, error: errorMessage });
}
