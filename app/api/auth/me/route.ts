// app/api/auth/me/route.ts
//
// GET -> { member: {memberId, fullName} | null, isAdmin: boolean, isSuperAdmin: boolean }
// Read-only, no secrets exposed. isAdmin is true for the superadmin AND
// any member flagged as admin; isSuperAdmin is true only for the
// original username/password login — used by the UI to decide whether
// to show the "make/remove admin" controls.

import { NextResponse } from "next/server";
import { getMemberSession, getAdminContext } from "@/lib/auth";

export async function GET() {
  const [member, admin] = await Promise.all([getMemberSession(), getAdminContext()]);
  return NextResponse.json({ member, isAdmin: admin.isAdmin, isSuperAdmin: admin.isSuperAdmin });
}