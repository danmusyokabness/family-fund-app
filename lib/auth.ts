// lib/auth.ts
//
// SERVER-ONLY. The actual login system: signed cookies for members and
// the admin, login-attempt throttling, and the two guard functions every
// protected route and page uses:
//
//   In a page (redirect-based):
//     const member = await getMemberSession();
//     if (!member) redirect("/login");
//
//   In an API route (JSON 401-based):
//     const auth = await requireMember();
//     if (!auth.ok) return auth.response;
//     // auth.member is available from here on
//
// Every route checks this itself — there is no middleware.ts and nothing
// relies on one. See lib/session-token.ts for the pure signing/verifying
// logic this file wraps with real cookies and database lookups.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSessionToken, verifySessionToken } from "./session-token";
import { serverEnv } from "./env";
import { supabaseAdmin } from "./supabase";

export const MEMBER_SESSION_COOKIE = "ff_member_session";
export const ADMIN_SESSION_COOKIE = "ff_admin_session";

// D6 in the project plan: a member's login is remembered for 90 days.
const MEMBER_SESSION_DAYS = 90;
// Not specified by a decision in the plan — 14 days is a reasonable
// default for the one admin account; easy to change here if it's not.
const ADMIN_SESSION_DAYS = 14;

// Section 8 of the project plan: "after 5 wrong tries the login locks
// for 15 minutes".
const MAX_LOGIN_ATTEMPTS = 5;
const THROTTLE_WINDOW_MINUTES = 15;

interface MemberSessionPayload {
  kind: "member";
  memberId: string;
  fullName: string;
  iat: number;
  exp: number;
}

interface AdminSessionPayload {
  kind: "admin";
  iat: number;
  exp: number;
}

function secondsFromNow(days: number): number {
  return Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;
}

// ---- Setting and reading the session cookies ---------------------------

export async function setMemberSessionCookie(memberId: string, fullName: string): Promise<void> {
  const env = serverEnv();
  const payload: MemberSessionPayload = {
    kind: "member",
    memberId,
    fullName,
    iat: Math.floor(Date.now() / 1000),
    exp: secondsFromNow(MEMBER_SESSION_DAYS),
  };
  const token = createSessionToken(payload, env.sessionSecret);
  const store = await cookies();
  store.set(MEMBER_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MEMBER_SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function setAdminSessionCookie(): Promise<void> {
  const env = serverEnv();
  const payload: AdminSessionPayload = {
    kind: "admin",
    iat: Math.floor(Date.now() / 1000),
    exp: secondsFromNow(ADMIN_SESSION_DAYS),
  };
  const token = createSessionToken(payload, env.sessionSecret);
  const store = await cookies();
  store.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function clearMemberSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(MEMBER_SESSION_COOKIE);
}

export async function clearAdminSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(ADMIN_SESSION_COOKIE);
}

export async function getMemberSession(): Promise<{ memberId: string; fullName: string } | null> {
  const env = serverEnv();
  const store = await cookies();
  const token = store.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = verifySessionToken<MemberSessionPayload>(token, env.sessionSecret);
  if (!payload || payload.kind !== "member") return null;
  return { memberId: payload.memberId, fullName: payload.fullName };
}

/**
 * Checks the superadmin cookie only (the original username/password
 * login). Most code should use getAdminSession() / requireAdmin()
 * instead, which also recognise a member flagged as admin — this one is
 * for the one place that specifically needs "superadmin, not just any
 * admin": granting or removing another member's admin access.
 */
export async function getSuperAdminSession(): Promise<boolean> {
  const env = serverEnv();
  const store = await cookies();
  const token = store.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return false;
  const payload = verifySessionToken<AdminSessionPayload>(token, env.sessionSecret);
  return payload !== null && payload.kind === "admin";
}

export interface AdminContext {
  isAdmin: boolean;
  isSuperAdmin: boolean;
  /** The member's id, only when admin access comes from being a flagged member (not the superadmin). */
  memberId: string | null;
}

/**
 * The one place that decides "is this visitor an admin", counting BOTH
 * the superadmin login AND any member with members.is_admin = true.
 * The superadmin is checked first so a logged-in member never needs an
 * extra database lookup just to confirm what their own cookie already proves.
 */
export async function getAdminContext(): Promise<AdminContext> {
  const isSuperAdmin = await getSuperAdminSession();
  if (isSuperAdmin) {
    return { isAdmin: true, isSuperAdmin: true, memberId: null };
  }

  const member = await getMemberSession();
  if (!member) {
    return { isAdmin: false, isSuperAdmin: false, memberId: null };
  }

  const db = supabaseAdmin();
  const { data } = await db.from("members").select("is_admin").eq("id", member.memberId).maybeSingle();
  const isAdmin = data?.is_admin === true;
  return { isAdmin, isSuperAdmin: false, memberId: isAdmin ? member.memberId : null };
}

/** Convenience boolean version of getAdminContext(), for page guards that don't need the detail. */
export async function getAdminSession(): Promise<boolean> {
  return (await getAdminContext()).isAdmin;
}

// ---- Guards for API routes ---------------------------------------------

type GuardResult<T = object> = ({ ok: true } & T) | { ok: false; response: NextResponse };

export async function requireMember(): Promise<GuardResult<{ member: { memberId: string; fullName: string } }>> {
  const member = await getMemberSession();
  if (!member) {
    return { ok: false, response: NextResponse.json({ error: "Not logged in." }, { status: 401 }) };
  }
  return { ok: true, member };
}

/** Admin OR member-admin — what most admin routes should use. */
export async function requireAdmin(): Promise<GuardResult<{ admin: AdminContext }>> {
  const admin = await getAdminContext();
  if (!admin.isAdmin) {
    return { ok: false, response: NextResponse.json({ error: "Admin login required." }, { status: 401 }) };
  }
  return { ok: true, admin };
}

/** Superadmin only — for the one action a member-admin should NOT be able to do: granting admin access. */
export async function requireSuperAdmin(): Promise<GuardResult> {
  const isSuperAdmin = await getSuperAdminSession();
  if (!isSuperAdmin) {
    return { ok: false, response: NextResponse.json({ error: "Superadmin login required." }, { status: 403 }) };
  }
  return { ok: true };
}

// ---- Login-attempt throttling -------------------------------------------

export interface ThrottleStatus {
  blocked: boolean;
  retryAfterMinutes?: number;
}

/** Checks recent FAILED attempts for this identifier (a phone number or admin username). */
export async function checkLoginThrottle(kind: "member" | "admin", identifier: string): Promise<ThrottleStatus> {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - THROTTLE_WINDOW_MINUTES * 60 * 1000).toISOString();

  const { count, error } = await db
    .from("login_attempts")
    .select("*", { count: "exact", head: true })
    .eq("kind", kind)
    .eq("identifier", identifier)
    .eq("succeeded", false)
    .gte("created_at", since);

  if (error) {
    // Fail OPEN, not closed: a transient database problem here should
    // not be able to lock every family member out of the site. It's
    // still logged, so it's visible rather than silently ignored.
    console.error("checkLoginThrottle query failed:", error.message ?? error);
    return { blocked: false };
  }

  if ((count ?? 0) >= MAX_LOGIN_ATTEMPTS) {
    return { blocked: true, retryAfterMinutes: THROTTLE_WINDOW_MINUTES };
  }
  return { blocked: false };
}

export async function recordLoginAttempt(
  kind: "member" | "admin",
  identifier: string,
  succeeded: boolean,
  ip: string | null
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db.from("login_attempts").insert({ kind, identifier, succeeded, ip });
  if (error) {
    console.error("recordLoginAttempt insert failed:", error.message ?? error);
  }
}