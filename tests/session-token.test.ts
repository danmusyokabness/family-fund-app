import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionToken, verifySessionToken } from "../lib/session-token.ts";

const SECRET = "test-secret-do-not-use-in-real-life";

test("a token round-trips back to its original payload", () => {
  const token = createSessionToken({ kind: "member", memberId: "abc-123" }, SECRET);
  const payload = verifySessionToken<{ kind: string; memberId: string }>(token, SECRET);
  assert.deepEqual(payload, { kind: "member", memberId: "abc-123" });
});

test("a token verified with the wrong secret is rejected", () => {
  const token = createSessionToken({ kind: "admin" }, SECRET);
  assert.equal(verifySessionToken(token, "a-different-secret"), null);
});

test("a tampered payload is rejected", () => {
  const token = createSessionToken({ kind: "member", memberId: "abc-123" }, SECRET);
  const [payloadPart, sigPart] = token.split(".");
  const tamperedPayload = Buffer.from(
    JSON.stringify({ kind: "member", memberId: "someone-elses-id" })
  ).toString("base64url");
  const tampered = `${tamperedPayload}.${sigPart}`;
  assert.equal(verifySessionToken(tampered, SECRET), null);
});

test("an expired token is rejected", () => {
  const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
  const token = createSessionToken({ kind: "member", exp: oneHourAgo }, SECRET);
  assert.equal(verifySessionToken(token, SECRET), null);
});

test("a token that has not expired yet is accepted", () => {
  const oneHourFromNow = Math.floor(Date.now() / 1000) + 3600;
  const token = createSessionToken({ kind: "member", exp: oneHourFromNow }, SECRET);
  assert.notEqual(verifySessionToken(token, SECRET), null);
});

test("a payload with no exp field never expires", () => {
  const token = createSessionToken({ kind: "member" }, SECRET);
  assert.notEqual(verifySessionToken(token, SECRET), null);
});

test("garbage input is rejected without throwing", () => {
  assert.equal(verifySessionToken("", SECRET), null);
  assert.equal(verifySessionToken("not-a-real-token", SECRET), null);
  assert.equal(verifySessionToken("a.b.c", SECRET), null);
  assert.equal(verifySessionToken("!!!.???", SECRET), null);
});