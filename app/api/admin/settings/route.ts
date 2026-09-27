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

  return NextResponse.json({ settings: mergeSettingsWithDefaults(stored) });
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