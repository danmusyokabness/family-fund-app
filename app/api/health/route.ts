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

// Turns any thrown value into a readable string. A real JS Error has
// .message, but Supabase's own errors are plain objects shaped like
// { message, code, details, hint } and are NOT instances of Error, so
// `err instanceof Error` misses them and falls back to the useless
// "[object Object]". This checks for a usable .message field first,
// on anything, before giving up and stringifying the whole thing.
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    const e = err as { message: string; code?: string; details?: string; hint?: string };
    const parts = [e.message, e.code && `code: ${e.code}`, e.details, e.hint].filter(Boolean);
    return parts.join(" | ");
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export async function GET() {
  let envOk = false;
  let envError: string | null = null;
  try {
    serverEnv();
    envOk = true;
  } catch (err) {
    envError = describeError(err);
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
    databaseError = describeError(err);
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