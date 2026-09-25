// =====================================================================
// lib/env.ts
//
// Single place that reads process.env, so:
//   * every other file gets typed values instead of "string | undefined"
//   * a missing variable fails immediately, with a clear message, instead
//     of causing a confusing crash somewhere deep in a route
//   * it is obvious, in one file, exactly which variables the app uses
//
// Import from here, never read process.env directly anywhere else:
//   import { serverEnv, publicEnv } from "@/lib/env";
// =====================================================================

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env.local and fill it in (see the README for what each value is).`
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : undefined;
}

function optionalBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  return value.trim().toLowerCase() === "true";
}

// ---------------------------------------------------------------------
// Values that are safe to reach the browser. Keep this list short and
// never put a secret here, even temporarily.
// ---------------------------------------------------------------------
export const publicEnv = {
  supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL"),
};

// ---------------------------------------------------------------------
// Server-only values. This function must only ever be called from
// server code (route handlers, server components, cron jobs) — never
// from a file that also runs in the browser. Calling it lazily (as a
// function, not a top-level constant) means a route that doesn't need
// e.g. Africa's Talking credentials won't crash just because they are
// still blank early in the project.
// ---------------------------------------------------------------------
export function serverEnv() {
  if (typeof window !== "undefined") {
    // Defence in depth: if this ever gets bundled into client code,
    // fail loudly instead of silently leaking undefined secrets.
    throw new Error("serverEnv() was called from browser code. This must only run on the server.");
  }

  return {
    supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),

    adminUsername: required("ADMIN_USERNAME"),
    adminPassword: required("ADMIN_PASSWORD"),

    sessionSecret: required("SESSION_SECRET"),
    cronSecret: required("CRON_SECRET"),

    // Optional until Step 8 (SMS) / Step 11 (Daraja) are wired up.
    atApiKey: optional("AT_API_KEY"),
    atUsername: optional("AT_USERNAME"),
    atSenderId: optional("AT_SENDER_ID"),
    smsLive: optionalBoolean("SMS_LIVE", false),

    darajaConsumerKey: optional("DARAJA_CONSUMER_KEY"),
    darajaConsumerSecret: optional("DARAJA_CONSUMER_SECRET"),
    darajaShortcode: optional("DARAJA_SHORTCODE"),
    darajaPasskey: optional("DARAJA_PASSKEY"),
    darajaEnv: optional("DARAJA_ENV") ?? "sandbox",
  };
}
