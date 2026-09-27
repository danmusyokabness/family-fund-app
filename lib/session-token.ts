// lib/session-token.ts
//
// The pure, testable half of the login system: turns a plain object into
// a signed string, and turns a signed string back into that object (or
// null if it's been tampered with, signed by a different secret, or has
// expired). No cookies, no database, no Next.js — just HMAC signing with
// Node's built-in crypto, so it needs no extra dependency and can be
// tested directly. lib/auth.ts wraps this with actual cookies and the
// database checks a real login needs.
//
// Token shape: "<base64url payload>.<base64url HMAC-SHA256 signature>"

import { createHmac, timingSafeEqual } from "node:crypto";

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64url");
}

function sign(payloadPart: string, secret: string): string {
  return base64url(createHmac("sha256", secret).update(payloadPart).digest());
}

export function createSessionToken(payload: object, secret: string): string {
  const payloadPart = base64url(JSON.stringify(payload));
  return `${payloadPart}.${sign(payloadPart, secret)}`;
}

/**
 * Verifies a token's signature and expiry, and returns its payload if
 * valid. Returns null for anything wrong — malformed, wrong secret,
 * tampered payload, or (if the payload has a numeric `exp`) expired.
 * Never throws: a broken cookie should just mean "not logged in", not a
 * server error.
 */
export function verifySessionToken<T = Record<string, unknown>>(token: string, secret: string): T | null {
  if (!token || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadPart, providedSigPart] = parts;

  let providedSig: Buffer;
  let expectedSig: Buffer;
  try {
    providedSig = Buffer.from(providedSigPart, "base64url");
    expectedSig = Buffer.from(sign(payloadPart, secret), "base64url");
  } catch {
    return null;
  }

  // Constant-time comparison, and only ever on equal-length buffers —
  // timingSafeEqual throws on a length mismatch rather than returning false.
  if (providedSig.length !== expectedSig.length || !timingSafeEqual(providedSig, expectedSig)) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (
    payload &&
    typeof payload === "object" &&
    "exp" in payload &&
    typeof (payload as { exp: unknown }).exp === "number" &&
    Date.now() / 1000 > (payload as { exp: number }).exp
  ) {
    return null; // expired
  }

  return payload as T;
}