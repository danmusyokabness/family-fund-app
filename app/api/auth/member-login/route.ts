// app/api/auth/member-login/route.ts
//
// POST { fullName, phone } -> checks the phone against member_phones
// (primary or alternate, doesn't matter — any registered phone works),
// then checks the name matches that member, and if both agree, logs
// them in. Deliberately gives the same generic error either way a
// check fails, so a wrong guess doesn't reveal which part was wrong.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizePhone } from "@/lib/phone";
import { checkLoginThrottle, recordLoginAttempt, setMemberSessionCookie } from "@/lib/auth";

function getClientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : null;
}

function normalizeName(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

const GENERIC_ERROR = "Name or phone number not recognised.";

export async function POST(req: NextRequest) {
  let body: { fullName?: string; phone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const fullNameInput = (body.fullName ?? "").trim();
  const phoneInput = (body.phone ?? "").trim();
  if (!fullNameInput || !phoneInput) {
    return NextResponse.json({ error: "Enter your name and phone number." }, { status: 400 });
  }

  const normalizedPhone = normalizePhone(phoneInput);
  // Throttle by the normalised phone when we can, otherwise by whatever
  // was typed — either way, repeatedly guessing still gets rate-limited.
  const identifier = normalizedPhone ?? normalizeName(phoneInput);
  const ip = getClientIp(req);

  const throttle = await checkLoginThrottle("member", identifier);
  if (throttle.blocked) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in about ${throttle.retryAfterMinutes} minutes.` },
      { status: 429 }
    );
  }

  if (!normalizedPhone) {
    await recordLoginAttempt("member", identifier, false, ip);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  const db = supabaseAdmin();

  const { data: phoneRow } = await db
    .from("member_phones")
    .select("member_id")
    .eq("phone_number", normalizedPhone)
    .maybeSingle();

  if (!phoneRow) {
    await recordLoginAttempt("member", identifier, false, ip);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  const { data: member } = await db
    .from("members")
    .select("id, full_name, is_active")
    .eq("id", phoneRow.member_id)
    .maybeSingle();

  if (!member || !member.is_active) {
    await recordLoginAttempt("member", identifier, false, ip);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  if (normalizeName(member.full_name) !== normalizeName(fullNameInput)) {
    await recordLoginAttempt("member", identifier, false, ip);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  await recordLoginAttempt("member", identifier, true, ip);
  await setMemberSessionCookie(member.id, member.full_name);

  return NextResponse.json({ ok: true, member: { id: member.id, fullName: member.full_name } });
}