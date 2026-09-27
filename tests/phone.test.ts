import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, isValidPhone, maskedPhoneMatches } from "../lib/phone.ts";

test("normalizePhone accepts the common formats and they all agree", () => {
  const expected = "254712345678";
  assert.equal(normalizePhone("0712345678"), expected);
  assert.equal(normalizePhone("+254712345678"), expected);
  assert.equal(normalizePhone("254712345678"), expected);
  assert.equal(normalizePhone("0712 345 678"), expected);
  assert.equal(normalizePhone("0712-345-678"), expected);
  assert.equal(normalizePhone("712345678"), expected);
});

test("normalizePhone accepts the newer 01... prefix", () => {
  assert.equal(normalizePhone("0110000000"), "254110000000");
  assert.equal(normalizePhone("254110000000"), "254110000000");
});

test("normalizePhone rejects invalid numbers", () => {
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone("12345"), null);
  assert.equal(normalizePhone("0312345678"), null); // not a mobile prefix (0-3)
  assert.equal(normalizePhone("025712345678"), null); // too long / malformed
  assert.equal(normalizePhone("not a phone number"), null);
});

test("isValidPhone mirrors normalizePhone", () => {
  assert.equal(isValidPhone("0712345678"), true);
  assert.equal(isValidPhone("0000000000"), false);
});

test("maskedPhoneMatches: 254-prefixed masked format (real statement example)", () => {
  // From the real statement: "254727***905" should match Tonny's registered 254727533905.
  assert.equal(maskedPhoneMatches("254727***905", "254727533905"), true);
});

test("maskedPhoneMatches: 0-prefixed local masked format (real statement example)", () => {
  // From the real statement: "0740***425" should match Salome's registered 254740744425.
  assert.equal(maskedPhoneMatches("0740***425", "254740744425"), true);
});

test("maskedPhoneMatches: same prefix, different suffix does not match", () => {
  // Maqueline (254727626362) shares the same leading "254727" as Tonny above,
  // but the masked suffix must also agree.
  assert.equal(maskedPhoneMatches("254727***905", "254727626362"), false);
});

test("maskedPhoneMatches: wrong prefix does not match even with the same suffix", () => {
  assert.equal(maskedPhoneMatches("254712***905", "254727533905"), false);
});

test("maskedPhoneMatches: rejects an unregistered/invalid full number", () => {
  assert.equal(maskedPhoneMatches("254727***905", "not-a-phone"), false);
});

test("maskedPhoneMatches: rejects a string with no mask at all", () => {
  assert.equal(maskedPhoneMatches("254727533905", "254727533905"), false);
});

test("maskedPhoneMatches: rejects when the visible parts would cover the whole number", () => {
  // A degenerate "mask" that reveals everything isn't really a mask — don't match on it.
  assert.equal(maskedPhoneMatches("254727533***905", "254727533905"), false);
});
