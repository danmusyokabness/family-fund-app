// app/api/auth/me/route.ts
//
// GET -> { member: {memberId, fullName} | null, isAdmin: boolean }
// Read-only, no secrets exposed. Used by client components that need to
// know the current login state without a full page reload (pages
// themselves check getMemberSession()/getAdminSession() directly).

import { NextResponse } from "next/server";
import { getMemberSession, getAdminSession } from "@/lib/auth";

export async function GET() {
  const [member, isAdmin] = await Promise.all([getMemberSession(), getAdminSession()]);
  return NextResponse.json({ member, isAdmin });
}