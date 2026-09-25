// app/api/health/route.ts
//
// A simple, low-risk check used to confirm Step 1 is wired up correctly:
//   * every required environment variable is present (serverEnv() would
//     throw otherwise, and that throw is caught and reported below)
//   * the service-role key can actually reach Supabase and read a table
//
// It reveals only booleans and counts, never row contents, so it is safe
// to leave in place (the daily cron job in Step 9 replaces this as the
// real keep-alive; this route is mainly for manual/testing use).
//
// Try it at: /api/health

import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  let envOk = false;
  let envError: string | null = null;
  try {
    serverEnv();
    envOk = true;
  } catch (err) {
    envError = err instanceof Error ? err.message : String(err);
  }

  if (!envOk) {
    return NextResponse.json(
      { ok: false, env: { ok: false, error: envError }, database: { ok: false } },
      { status: 500 }
    );
  }

  let databaseOk = false;
  let databaseError: string | null = null;
  let settingsRowCount: number | null = null;

  try {
    const db = supabaseAdmin();
    const { count, error } = await db.from("settings").select("*", { count: "exact", head: true });
    if (error) throw error;
    databaseOk = true;
    settingsRowCount = count ?? 0;
  } catch (err) {
    databaseError = err instanceof Error ? err.message : String(err);
  }

  const ok = envOk && databaseOk;

  return NextResponse.json(
    {
      ok,
      env: { ok: envOk },
      database: {
        ok: databaseOk,
        error: databaseError,
        // Expected to be 0 right after Step 1 — settings are only
        // written once the Setup page (Step 4) is used.
        settingsRowCount,
      },
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 500 }
  );
}
