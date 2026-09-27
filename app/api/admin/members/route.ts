// app/api/admin/members/route.ts
//
// GET  -> every member with their phones and any shortcode/business-number aliases.
// POST -> creates one member (full name, joining month, a primary phone,
//         optional alternate phones and business/shortcode numbers).

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizePhone } from "@/lib/phone";

function toFirstOfMonth(input: string): string | null {
  const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(input.trim());
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${match[1]}-${match[2]}-01`;
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("members")
    .select(
      "id, full_name, joined_on, is_active, notes, created_at, " +
        "member_phones(id, phone_number, is_primary), " +
        "payer_aliases(id, alias_type, alias_value)"
    )
    .order("full_name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Could not load members." }, { status: 500 });
  }
  return NextResponse.json({ members: data ?? [] });
}

interface CreateMemberBody {
  fullName?: string;
  joinedOn?: string; // "YYYY-MM" or "YYYY-MM-DD"
  primaryPhone?: string;
  alternatePhones?: string[];
  shortcodes?: string[];
  notes?: string;
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: CreateMemberBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const fullName = (body.fullName ?? "").trim();
  if (!fullName) {
    return NextResponse.json({ error: "Full name is required." }, { status: 400 });
  }

  const joinedOn = toFirstOfMonth(body.joinedOn ?? "");
  if (!joinedOn) {
    return NextResponse.json({ error: "Joining month is required, as YYYY-MM." }, { status: 400 });
  }

  const primaryPhone = normalizePhone(body.primaryPhone ?? "");
  if (!primaryPhone) {
    return NextResponse.json({ error: "A valid primary phone number is required." }, { status: 400 });
  }

  const alternatePhones = [...new Set((body.alternatePhones ?? []).map(normalizePhone).filter(Boolean))].filter(
    (p) => p !== primaryPhone
  ) as string[];

  const shortcodes = [...new Set((body.shortcodes ?? []).map((s) => s.trim()).filter(Boolean))];

  const db = supabaseAdmin();

  const { data: member, error: memberError } = await db
    .from("members")
    .insert({ full_name: fullName, joined_on: joinedOn, notes: body.notes?.trim() || null })
    .select("id, full_name, joined_on, is_active, notes")
    .single();

  if (memberError || !member) {
    return NextResponse.json({ error: "Could not create the member." }, { status: 500 });
  }

  const phoneRows = [
    { member_id: member.id, phone_number: primaryPhone, is_primary: true },
    ...alternatePhones.map((phone) => ({ member_id: member.id, phone_number: phone, is_primary: false })),
  ];

  const { error: phonesError } = await db.from("member_phones").insert(phoneRows);
  if (phonesError) {
    // Most likely cause: one of these phone numbers is already registered
    // to a different member (phone_number is unique). Roll the member
    // back rather than leaving a member with no phone at all.
    await db.from("members").delete().eq("id", member.id);
    return NextResponse.json(
      { error: "Could not save phone numbers — one of them may already be registered to another member." },
      { status: 409 }
    );
  }

  if (shortcodes.length > 0) {
    await db.from("payer_aliases").insert(
      shortcodes.map((value) => ({
        member_id: member.id,
        alias_type: "shortcode",
        alias_value: value,
        source: "admin",
      }))
    );
  }

  return NextResponse.json({ ok: true, member });
}