import { test } from "node:test";
import assert from "node:assert/strict";
import { matchPayment, type MemberForMatching } from "../lib/payment-matching.ts";

function member(id: string, fullName: string, phones: string[] = [], aliases: MemberForMatching["aliases"] = []): MemberForMatching {
  return { id, fullName, phones, aliases };
}

test("matches by a registered phone (masked pattern)", () => {
  const members = [member("m1", "Tonny Musyoka", ["254727533905"])];
  const outcome = matchPayment({ payerPhoneMasked: "254727***905", payerName: "TONNY MUSYOKA", payerRef: null }, members);
  assert.deepEqual(outcome, { status: "matched", memberId: "m1", reason: "phone match" });
});

test("matches by a remembered masked-phone alias, even without a full registered phone", () => {
  const members = [member("m1", "Salome Kataka", [], [{ aliasType: "masked_phone", aliasValue: "0740***425" }])];
  const outcome = matchPayment({ payerPhoneMasked: "0740***425", payerName: null, payerRef: null }, members);
  assert.deepEqual(outcome, { status: "matched", memberId: "m1", reason: "remembered payer" });
});

test("matches by a business/shortcode number", () => {
  const members = [member("m1", "Trizah Musyoka", [], [{ aliasType: "shortcode", aliasValue: "8760493" }])];
  const outcome = matchPayment({ payerPhoneMasked: null, payerName: "TRIZAH MUKUTA MUSYOKA", payerRef: "8760493" }, members);
  assert.deepEqual(outcome, { status: "matched", memberId: "m1", reason: "business number on file" });
});

test("two members sharing the same masked-phone pattern: ambiguous, not auto-matched", () => {
  const members = [
    member("m1", "Tonny Musyoka", ["254727533905"]),
    member("m2", "Maqueline Wafula", ["254727626362"]),
  ];
  // Both start 254727, but neither ends in 905 except m1 — not actually ambiguous.
  // Now make a genuinely ambiguous case: same prefix AND same suffix digits.
  const ambiguous = [
    member("a1", "Person One", ["254712345678"]),
    member("a2", "Person Two", ["254712999678"]),
  ];
  const outcome = matchPayment({ payerPhoneMasked: "254712***678", payerName: null, payerRef: null }, ambiguous);
  assert.equal(outcome.status, "unmatched");
  if (outcome.status === "unmatched") {
    assert.equal(outcome.candidates.length, 2);
  }
  // Sanity check the non-ambiguous pair from the top of this test still resolves cleanly.
  const clean = matchPayment({ payerPhoneMasked: "254727***905", payerName: null, payerRef: null }, members);
  assert.deepEqual(clean, { status: "matched", memberId: "m1", reason: "phone match" });
});

test("falls back to a first-name match when the phone doesn't match anyone", () => {
  const members = [member("m1", "Esther Nakhanu", ["254721411002"])];
  const outcome = matchPayment({ payerPhoneMasked: "254799***999", payerName: "ESTHER SOMEOTHER", payerRef: null }, members);
  assert.deepEqual(outcome, {
    status: "needs_confirmation",
    suggestedMemberId: "m1",
    reason: 'first name matches "ESTHER SOMEOTHER"',
  });
});

test("a name-only match (no phone at all) still only suggests, never auto-matches", () => {
  const members = [member("m1", "Hellen Nafula", ["254712782772"])];
  const outcome = matchPayment({ payerPhoneMasked: null, payerName: "Hellen K.", payerRef: null }, members);
  assert.equal(outcome.status, "needs_confirmation");
});

test("two members with the same first name: ambiguous, goes to unmatched with both candidates", () => {
  const members = [member("m1", "Moses Busolo", []), member("m2", "Moses Karani", [])];
  const outcome = matchPayment({ payerPhoneMasked: null, payerName: "Moses K", payerRef: null }, members);
  assert.equal(outcome.status, "unmatched");
  if (outcome.status === "unmatched") {
    assert.equal(outcome.candidates.length, 2);
  }
});

test("nothing matches at all: unmatched with no candidates", () => {
  const members = [member("m1", "Rael Kataka", ["254718105514"])];
  const outcome = matchPayment({ payerPhoneMasked: "254799***111", payerName: "Nobody Here", payerRef: null }, members);
  assert.deepEqual(outcome, { status: "unmatched", candidates: [] });
});

test("a registered phone match wins over a coincidental first-name match", () => {
  // Payer's real phone belongs to Hellen, but their M-PESA name happens
  // to start the same as a different member — the phone signal is
  // stronger and should win outright, no ambiguity.
  const members = [
    member("hellen", "Hellen Nafula", ["254712782772"]),
    member("someone-else", "Hellen Wanjiru", []),
  ];
  const outcome = matchPayment(
    { payerPhoneMasked: "254712***772", payerName: "HELLEN WANJIRU", payerRef: null },
    members
  );
  assert.deepEqual(outcome, { status: "matched", memberId: "hellen", reason: "phone match" });
});

test("an empty member list never throws, just returns unmatched", () => {
  const outcome = matchPayment({ payerPhoneMasked: "254712***772", payerName: "Someone", payerRef: null }, []);
  assert.deepEqual(outcome, { status: "unmatched", candidates: [] });
});
