// lib/phone.ts
//
// Turns messy real-world phone number strings into one canonical form,
// and matches M-PESA's *masked* payer numbers (e.g. "254712***772" or
// "0740***425") against a member's full registered number.
//
// Canonical form is always "2547XXXXXXXX" or "2541XXXXXXXX" — 12 digits,
// no "+", no spaces. This is what gets stored in member_phones.phone_number.

const CANONICAL_PHONE_RE = /^254[17]\d{8}$/;

/**
 * Normalises a Kenyan phone number to canonical form (2547XXXXXXXX /
 * 2541XXXXXXXX), accepting the common ways people type or paste one:
 *   0712345678, +254712345678, 254712345678, 254 712 345 678,
 *   0110000000, 254110000000, 712345678
 * Returns null for anything that isn't a recognisable full Kenyan
 * mobile number (it deliberately does NOT try to guess at short or
 * masked numbers — see maskedPhoneMatches for those).
 */
export function normalizePhone(input: string): string | null {
  if (!input) return null;

  // Strip everything except digits and a leading "+".
  let s = input.trim().replace(/[^\d+]/g, "");
  if (s.startsWith("+")) s = s.slice(1);

  let candidate: string | null = null;

  if (/^254\d{9}$/.test(s)) {
    candidate = s;
  } else if (/^0\d{9}$/.test(s)) {
    candidate = "254" + s.slice(1);
  } else if (/^\d{9}$/.test(s)) {
    // A 9-digit number with no leading 0 or 254, e.g. someone typed
    // "712345678". Only accepted if it starts with 7 or 1, matching a
    // real Kenyan mobile prefix, to avoid quietly accepting garbage.
    if (s[0] === "7" || s[0] === "1") {
      candidate = "254" + s;
    }
  }

  if (candidate && CANONICAL_PHONE_RE.test(candidate)) {
    return candidate;
  }
  return null;
}

export function isValidPhone(input: string): boolean {
  return normalizePhone(input) !== null;
}

/**
 * Does a masked M-PESA payer number plausibly refer to this full,
 * registered (canonical) phone number?
 *
 * M-PESA statements mask the middle of a payer's number and show it in
 * one of two layouts, both keeping the first few digits and the last 3:
 *   "254727***905"  (254-prefixed: 6 leading digits shown)
 *   "0740***425"    (local 0-prefixed: 4 leading digits shown)
 *
 * This checks that the registered number starts with the masked
 * number's visible leading digits (converted to canonical form) AND
 * ends with its visible trailing digits. Anything it can't confidently
 * interpret returns false rather than guessing — a false "no match"
 * just means the payment goes to the review queue instead of being
 * wrongly auto-matched.
 */
export function maskedPhoneMatches(masked: string, fullPhoneCanonical: string): boolean {
  if (!CANONICAL_PHONE_RE.test(fullPhoneCanonical)) return false;

  const parts = /^(\d+)\*+(\d+)$/.exec(masked.trim());
  if (!parts) return false;
  const [, leading, trailing] = parts;

  let prefix: string;
  if (leading.startsWith("254")) {
    prefix = leading;
  } else if (leading.startsWith("0")) {
    prefix = "254" + leading.slice(1);
  } else {
    // An unrecognised leading format (e.g. no 0 and no 254) — don't guess.
    return false;
  }

  // Require the visible parts to leave at least one masked digit between
  // them; otherwise this isn't really a "masked number" at all and
  // matching on it would be little better than matching on nothing.
  if (prefix.length + trailing.length >= fullPhoneCanonical.length) return false;

  return fullPhoneCanonical.startsWith(prefix) && fullPhoneCanonical.endsWith(trailing);
}
