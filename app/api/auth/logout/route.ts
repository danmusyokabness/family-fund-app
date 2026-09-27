// app/api/auth/logout/route.ts
//
// POST { type: "member" | "admin" } clears that one session cookie.
// POST with no body (or an unrecognised type) clears both, which is the
// safer default on a shared family computer where an admin might also
// be logged in as a member in the same browser.

import { NextRequest, NextResponse } from "next/server";
import { clearAdminSessionCookie, clearMemberSessionCookie } from "@/lib/auth";

export async function POST(req: NextRequest) {
  let body: { type?: string } = {};
  try {
    body = await req.json();
  } catch {
    // No body / not JSON — fine, we just clear both below.
  }

  if (body.type === "admin") {
    await clearAdminSessionCookie();
  } else if (body.type === "member") {
    await clearMemberSessionCookie();
  } else {
    await clearMemberSessionCookie();
    await clearAdminSessionCookie();
  }

  return NextResponse.json({ ok: true });
}