// app/api/health/route.ts
//
// A simple, low-risk check used to confirm Step 1 is wired up correctly:
//   * every required environment variable is present (serverEnv() would
//     throw otherwise, and that throw is caught and reported below)
//   * the service-role key can actually reach Supabase and read a table
//
// This version talks to Supabase's REST API directly with a plain fetch,
// rather than going through the @supabase/supabase-js client. That's
// deliberate: when something is misconfigured (wrong URL, wrong key, or
// the project itself being unreachable), the client's error object can
// come back in a shape this code didn't expect and show nothing useful.
// A raw fetch always gives us a real HTTP status code and response body
// to look at, which makes the actual problem obvious instead of guessed.
//
// It reveals only booleans, counts and the bare Supabase response, never
// anything about your members or payments, so it is safe to leave in
// place (the daily cron job in Step 9 replaces this as the real
// keep-alive; this route is mainly for manual/testing use).
//
// Try it at: /api/health

import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name || "Unknown error (no message)";
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export async function GET() {
  // ---- 1. Environment variables ---------------------------------------
  let env: ReturnType<typeof serverEnv>;
  try {
    env = serverEnv();
  } catch (err) {
    return NextResponse.json(
      { ok: false, env: { ok: false, error: describeError(err) }, database: { ok: false } },
      { status: 500 }
    );
  }

  // ---- 2. A direct, raw request to Supabase's REST API ----------------
  // This asks for zero rows from "settings" but with Prefer: count=exact,
  // so Supabase reports the row count in a response header without us
  // needing to read any actual data.
  const url = `${env.supabaseUrl.replace(/\/$/, "")}/rest/v1/settings?select=key&limit=0`;

  let databaseOk = false;
  let httpStatus: number | null = null;
  let responseBody: string | null = null;
  let settingsRowCount: number | null = null;
  let fetchError: string | null = null;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        apikey: env.supabaseServiceRoleKey,
        Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
        Prefer: "count=exact",
      },
      // Never cache a health check.
      cache: "no-store",
    });

    httpStatus = res.status;
    const bodyText = await res.text();
    // Keep the response short in the JSON we return, in case Supabase
    // ever sends back something long (e.g. an HTML error page).
    responseBody = bodyText.slice(0, 500);

    if (res.ok) {
      databaseOk = true;
      // Supabase returns counts like "0-(-1)/17" in Content-Range.
      const contentRange = res.headers.get("content-range");
      const match = contentRange?.match(/\/(\d+)$/);
      settingsRowCount = match ? Number(match[1]) : null;
    }
  } catch (err) {
    // This branch means the request itself never got a response at all —
    // e.g. the URL is wrong, or the project can't be reached.
    fetchError = describeError(err);
  }

  const ok = databaseOk;

  return NextResponse.json(
    {
      ok,
      env: { ok: true },
      database: {
        ok: databaseOk,
        httpStatus,
        // Populated only when the request failed AFTER getting a response
        // from Supabase (e.g. wrong key, table missing, RLS blocking it).
        responseBody: databaseOk ? null : responseBody,
        // Populated only when the request could not be sent/received at
        // all (e.g. wrong URL, project unreachable).
        fetchError,
        settingsRowCount,
      },
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 500 }
  );
}