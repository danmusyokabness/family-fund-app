// lib/payment-matching.ts
//
// Given one incoming payment's payer details and the full list of
// members (with their registered phones and remembered aliases), works
// out who it belongs to — or that it needs a human to decide. No
// database access here; the API route (Step 5) loads members once and
// calls this per payment, so this stays testable on its own.
//
// The order of checks follows the project plan (section 6.2):
//   1. A remembered payer (a masked phone or business number the admin
//      confirmed before) — the strongest signal, auto-matched.
//   2. The payer's phone matches a member's REGISTERED phone (primary
//      or alternate) — also auto-matched.
//   3. Nothing usable so far, but the payer's first name matches
//      exactly one member — a SUGGESTION only ("needs_confirmation"),
//      never counted until the admin confirms it.
//   4. Anything ambiguous (two members tie on the same signal) or
//      nothing at all — "unmatched", with candidates listed if any
//      exist, so the admin isn't starting from nothing.

import { maskedPhoneMatches } from "./phone.ts";

export interface MemberAlias {
  aliasType: "masked_phone" | "shortcode" | "payer_name";
  aliasValue: string;
}

export interface MemberForMatching {
  id: string;
  fullName: string;
  /** Canonical registered phones (primary + alternates), e.g. "254712345678". */
  phones: string[];
  aliases: MemberAlias[];
}

export interface PaymentForMatching {
  /** M-PESA's masked payer number, e.g. "254727***905" or "0740***425". Null if not applicable. */
  payerPhoneMasked: string | null;
  /** The name M-PESA reports for the payer, if any. */
  payerName: string | null;
  /** A business/shortcode number the payment came from, if any (e.g. "8760493"). */
  payerRef: string | null;
}

export interface MatchCandidate {
  memberId: string;
  reason: string;
}

export type MatchOutcome =
  | { status: "matched"; memberId: string; reason: string }
  | { status: "needs_confirmation"; suggestedMemberId: string; reason: string }
  | { status: "unmatched"; candidates: MatchCandidate[] };

function normalizeName(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

function firstToken(name: string): string {
  return normalizeName(name).split(" ")[0] ?? "";
}

export function matchPayment(payment: PaymentForMatching, members: MemberForMatching[]): MatchOutcome {
  // ---- 1 & 2: remembered aliases and registered phones, together -----
  // (A remembered "masked_phone" alias and an actual registered phone
  // are both strong, exact signals — the only difference is where the
  // fact came from, so they're checked together and both auto-match.)
  const strongMatches: MatchCandidate[] = [];

  for (const member of members) {
    let matchedHow: string | null = null;

    if (payment.payerRef) {
      const shortcodeHit = member.aliases.some(
        (a) => a.aliasType === "shortcode" && a.aliasValue === payment.payerRef
      );
      if (shortcodeHit) matchedHow = "business number on file";
    }

    if (!matchedHow && payment.payerPhoneMasked) {
      const rememberedHit = member.aliases.some(
        (a) => a.aliasType === "masked_phone" && a.aliasValue === payment.payerPhoneMasked
      );
      if (rememberedHit) {
        matchedHow = "remembered payer";
      } else {
        const phoneHit = member.phones.some((p) => maskedPhoneMatches(payment.payerPhoneMasked!, p));
        if (phoneHit) matchedHow = "phone match";
      }
    }

    if (matchedHow) strongMatches.push({ memberId: member.id, reason: matchedHow });
  }

  if (strongMatches.length === 1) {
    return { status: "matched", memberId: strongMatches[0].memberId, reason: strongMatches[0].reason };
  }
  if (strongMatches.length > 1) {
    return { status: "unmatched", candidates: strongMatches };
  }

  // ---- 3: name fallback, suggestion only -------------------------------
  if (payment.payerName) {
    const payerFirst = firstToken(payment.payerName);
    if (payerFirst) {
      const nameMatches: MatchCandidate[] = members
        .filter((m) => firstToken(m.fullName) === payerFirst)
        .map((m) => ({ memberId: m.id, reason: `first name matches "${payment.payerName}"` }));

      if (nameMatches.length === 1) {
        return {
          status: "needs_confirmation",
          suggestedMemberId: nameMatches[0].memberId,
          reason: nameMatches[0].reason,
        };
      }
      if (nameMatches.length > 1) {
        return { status: "unmatched", candidates: nameMatches };
      }
    }
  }

  // ---- 4: nothing at all ------------------------------------------------
  return { status: "unmatched", candidates: [] };
}
