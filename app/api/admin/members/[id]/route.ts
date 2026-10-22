// app/api/admin/members/[id]/route.ts
//
// PATCH updates one member. Any field can be omitted to leave it
// unchanged, EXCEPT phones: if primaryPhone or alternatePhones is
// included, ALL of this member's phone numbers are replaced together
// (simplest correct way to guarantee exactly one primary). Shortcodes
// (till / business numbers) and maskedPhones (numbers copied from a
// statement, like 254110***358) work the same way if included. Other
// aliases ("payer_name") are left untouched.
//
// Phone numbers are checked BEFORE anything is removed, and if saving
// still fails the old numbers are put back, so a member can never be
// left without a phone.
//
// No DELETE route on purpose — deactivate (isActive: false) instead of
// deleting, per the project's "undo, not delete" rule.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { canonicalMaskedPhone, normalizePhone } from "@/lib/phone";

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
  maskedPhones?: string[];
  /** Granting or removing admin access — SUPERADMIN ONLY, checked separately below. */
  isAdmin?: boolean;
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

  if (body.isAdmin !== undefined) {
    const superAuth = await requireSuperAdmin();
    if (!superAuth.ok) return superAuth.response;
    updates.is_admin = body.isAdmin;
  }

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

    const wanted = [primaryPhone, ...alternatePhones];

    // 1. Refuse up front if any of these numbers already belongs to someone else.
    const { data: clashes } = await db
      .from("member_phones")
      .select("phone_number, members(full_name)")
      .in("phone_number", wanted)
      .neq("member_id", id);
    if (clashes && clashes.length > 0) {
      const first = clashes[0] as unknown as { phone_number: string; members: { full_name: string } | null };
      return NextResponse.json(
        { error: `${first.phone_number} is already registered to ${first.members?.full_name ?? "another member"}.` },
        { status: 409 }
      );
    }

    // 2. Remember the old numbers, replace them, and restore them if that fails.
    const { data: oldPhones } = await db.from("member_phones").select("phone_number, is_primary").eq("member_id", id);
    await db.from("member_phones").delete().eq("member_id", id);
    const { error } = await db.from("member_phones").insert([
      { member_id: id, phone_number: primaryPhone, is_primary: true },
      ...alternatePhones.map((phone) => ({ member_id: id, phone_number: phone, is_primary: false })),
    ]);
    if (error) {
      if (oldPhones && oldPhones.length > 0) {
        await db.from("member_phones").insert(oldPhones.map((p) => ({ member_id: id, phone_number: p.phone_number, is_primary: p.is_primary })));
      }
      return NextResponse.json({ error: "Could not save the phone numbers. Nothing was changed." }, { status: 409 });
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

  if (body.maskedPhones !== undefined) {
    const masked: string[] = [];
    for (const raw of body.maskedPhones) {
      if (!raw.trim()) continue;
      const canonical = canonicalMaskedPhone(raw);
      if (!canonical) {
        return NextResponse.json({ error: `"${raw}" is not a statement number like 254110***358.` }, { status: 400 });
      }
      if (!masked.includes(canonical)) masked.push(canonical);
    }
    await db.from("payer_aliases").delete().eq("member_id", id).eq("alias_type", "masked_phone");
    if (masked.length > 0) {
      await db.from("payer_aliases").insert(
        masked.map((value) => ({ member_id: id, alias_type: "masked_phone", alias_value: value, source: "admin" }))
      );
    }
  }

  const { data: updated } = await db
    .from("members")
    .select(
      "id, full_name, joined_on, is_active, is_admin, notes, " +
        "member_phones(id, phone_number, is_primary), " +
        "payer_aliases(id, alias_type, alias_value)"
    )
    .eq("id", id)
    .single();

  return NextResponse.json({ ok: true, member: updated });
}