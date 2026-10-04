// app/api/admin/sms-log/route.ts
//
// GET -> the most recent SMS attempts (including dry runs), newest first.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("sms_log")
    .select("id, kind, period, to_phone, message, status, error, created_at, members(full_name)")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: "Could not load the SMS log." }, { status: 500 });
  return NextResponse.json({ log: data ?? [] });
}
