// app/api/auth/admin-login/route.ts
//
// POST { username, password } -> checks against ADMIN_USERNAME /
// ADMIN_PASSWORD (set in Vercel's environment variables, never in the
// database). Uses a constant-time comparison so a wrong guess can't be
// narrowed down by how long the check took to fail.

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { checkLoginThrottle, recordLoginAttempt, setAdminSessionCookie } from "@/lib/auth";

function getClientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : null;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on mismatched lengths rather than returning
  // false, so that has to be checked first — but doing so on the raw
  // lengths (not the compared values) leaks nothing useful to an attacker.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function POST(req: NextRequest) {
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  if (!username || !password) {
    return NextResponse.json({ error: "Enter your username and password." }, { status: 400 });
  }

  const identifier = username.toLowerCase();
  const ip = getClientIp(req);

  const throttle = await checkLoginThrottle("admin", identifier);
  if (throttle.blocked) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in about ${throttle.retryAfterMinutes} minutes.` },
      { status: 429 }
    );
  }

  const env = serverEnv();
  const ok = safeEqual(username, env.adminUsername) && safeEqual(password, env.adminPassword);

  await recordLoginAttempt("admin", identifier, ok, ip);

  if (!ok) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  await setAdminSessionCookie();
  return NextResponse.json({ ok: true });
}