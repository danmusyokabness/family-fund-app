// app/api/admin/members/[id]/route.ts
//
// PATCH updates one member. Any field can be omitted to leave it
// unchanged, EXCEPT phones: if primaryPhone or alternatePhones is
// included, ALL of this member's phone numbers are replaced together
// (simplest correct way to guarantee exactly one primary). Shortcodes
// work the same way if included. Existing "masked_phone" or
// "payer_name" aliases (learned automatically from payments in later
// steps) are left untouched either way.
//
// No DELETE route on purpose — deactivate (isActive: false) instead of
// deleting, per the project's "undo, not delete" rule.

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

interface UpdateMemberBody {
  fullName?: string;
  joinedOn?: string;
  isActive?: boolean;
  notes?: string;
  primaryPhone?: string;
  alternatePhones?: string[];
  shortcodes?: string[];
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: UpdateMemberBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const db = supabaseAdmin();

  const { data: existing } = await db.from("members").select("id").eq("id", id).maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};

  if (body.fullName !== undefined) {
    const fullName = body.fullName.trim();
    if (!fullName) return NextResponse.json({ error: "Full name cannot be empty." }, { status: 400 });
    updates.full_name = fullName;
  }

  if (body.joinedOn !== undefined) {
    const joinedOn = toFirstOfMonth(body.joinedOn);
    if (!joinedOn) return NextResponse.json({ error: "Joining month must be YYYY-MM." }, { status: 400 });
    updates.joined_on = joinedOn;
  }

  if (body.isActive !== undefined) updates.is_active = body.isActive;
  if (body.notes !== undefined) updates.notes = body.notes.trim() || null;

  if (Object.keys(updates).length > 0) {
    const { error } = await db.from("members").update(updates).eq("id", id);
    if (error) return NextResponse.json({ error: "Could not update the member." }, { status: 500 });
  }

  if (body.primaryPhone !== undefined || body.alternatePhones !== undefined) {
    const primaryPhone = normalizePhone(body.primaryPhone ?? "");
    if (!primaryPhone) {
      return NextResponse.json({ error: "A valid primary phone number is required." }, { status: 400 });
    }
    const alternatePhones = [
      ...new Set((body.alternatePhones ?? []).map(normalizePhone).filter(Boolean)),
    ].filter((p) => p !== primaryPhone) as string[];

    await db.from("member_phones").delete().eq("member_id", id);
    const { error } = await db.from("member_phones").insert([
      { member_id: id, phone_number: primaryPhone, is_primary: true },
      ...alternatePhones.map((phone) => ({ member_id: id, phone_number: phone, is_primary: false })),
    ]);
    if (error) {
      return NextResponse.json(
        { error: "Could not save phone numbers — one of them may already be registered to another member." },
        { status: 409 }
      );
    }
  }

  if (body.shortcodes !== undefined) {
    await db.from("payer_aliases").delete().eq("member_id", id).eq("alias_type", "shortcode");
    const shortcodes = [...new Set(body.shortcodes.map((s) => s.trim()).filter(Boolean))];
    if (shortcodes.length > 0) {
      await db.from("payer_aliases").insert(
        shortcodes.map((value) => ({ member_id: id, alias_type: "shortcode", alias_value: value, source: "admin" }))
      );
    }
  }

  const { data: updated } = await db
    .from("members")
    .select(
      "id, full_name, joined_on, is_active, notes, " +
        "member_phones(id, phone_number, is_primary), " +
        "payer_aliases(id, alias_type, alias_value)"
    )
    .eq("id", id)
    .single();

  return NextResponse.json({ ok: true, member: updated });
}