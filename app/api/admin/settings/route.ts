// app/api/admin/settings/route.ts
//
// GET  -> every setting, merged with defaults for anything never saved.
// POST -> validates a full submission (see lib/settings.ts) and saves it.
//         Rejects the whole submission if anything is invalid — never
//         partially saves, so settings can't end up in a half-valid state.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { mergeSettingsWithDefaults, validateSettingsInput } from "@/lib/settings";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const db = supabaseAdmin();
  const { data, error } = await db.from("settings").select("key, value");
  if (error) {
    return NextResponse.json({ error: "Could not load settings." }, { status: 500 });
  }

  const stored: Record<string, string> = {};
  for (const row of data ?? []) stored[row.key] = row.value;

  const settings = mergeSettingsWithDefaults(stored);

  // If site_url has never been saved, suggest Vercel's own production
  // domain rather than leaving the field blank with no hint. Vercel sets
  // this automatically on every deploy; it's just a starting suggestion —
  // still fully editable, and needed at all because a custom domain or a
  // non-Vercel host wouldn't be known here otherwise.
  if (!stored.site_url && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    settings.site_url = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }

  return NextResponse.json({ settings });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { values, errors } = validateSettingsInput(body);
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: "Some values need fixing.", fieldErrors: errors }, { status: 400 });
  }

  const db = supabaseAdmin();
  const rows = Object.entries(values).map(([key, value]) => ({ key, value }));

  const { error } = await db.from("settings").upsert(rows, { onConflict: "key" });
  if (error) {
    return NextResponse.json({ error: "Could not save settings." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, settings: mergeSettingsWithDefaults(values) });
}