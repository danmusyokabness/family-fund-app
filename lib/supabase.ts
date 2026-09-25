// =====================================================================
// lib/supabase.ts
//
// SERVER-ONLY. This file creates a Supabase client using the
// service-role key, which bypasses Row Level Security entirely.
//
//   * Never import this file from a Client Component ("use client").
//   * Only import it from: Route Handlers (app/api/**/route.ts),
//     Server Components, and server-side scripts (e.g. the cron job).
//   * Every route that uses it is responsible for checking who is
//     calling (requireAdmin / requireMember / a secret header) BEFORE
//     touching the database — this client itself enforces nothing.
//
// Usage:
//   import { supabaseAdmin } from "@/lib/supabase";
//   const db = supabaseAdmin();
//   const { data, error } = await db.from("members").select("*");
// =====================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

let cachedClient: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error("supabaseAdmin() was called from browser code. This must only run on the server.");
  }

  if (cachedClient) return cachedClient;

  const env = serverEnv();

  cachedClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      // This is a server-side service client, not a per-user browser
      // session, so there is no session to persist or refresh.
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedClient;
}
