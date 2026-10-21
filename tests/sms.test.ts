import { test } from "node:test";
import assert from "node:assert/strict";

// serverEnv() requires every one of these to be set, even though sms.ts
// itself only cares about a few. Fake-but-valid-shaped values are used
// so the test never touches a real database or a real SMS provider.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.ADMIN_USERNAME ??= "test-admin";
process.env.ADMIN_PASSWORD ??= "test-password";
process.env.SESSION_SECRET ??= "test-session-secret";
process.env.CRON_SECRET ??= "test-cron-secret";

const { sendSms, toProviderPhone } = await import("../lib/sms.ts");

test("with SMS_LIVE unset (the default), nothing is actually sent — a dry run every time", async () => {
  delete process.env.SMS_LIVE;
  const result = await sendSms("254712345678", "Test message");
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.providerResponse, undefined);
});

test("with SMS_LIVE explicitly false, still a dry run", async () => {
  process.env.SMS_LIVE = "false";
  const result = await sendSms("254712345678", "Test message");
  assert.equal(result.dryRun, true);
});

test("with SMS_LIVE=true but no Africa's Talking credentials, it fails clearly rather than pretending to send", async () => {
  process.env.SMS_LIVE = "true";
  delete process.env.AT_API_KEY;
  delete process.env.AT_USERNAME;
  const result = await sendSms("254712345678", "Test message");
  assert.equal(result.ok, false);
  assert.equal(result.dryRun, false);
  assert.ok(result.error?.includes("not configured"));
  process.env.SMS_LIVE = "false"; // reset for any other test file run in the same process
});

test("toProviderPhone adds the + that Africa's Talking expects, and accepts every common way of typing a number", () => {
  assert.equal(toProviderPhone("254712345678"), "+254712345678");
  assert.equal(toProviderPhone("0712345678"), "+254712345678");
  assert.equal(toProviderPhone("+254 712 345 678"), "+254712345678");
  assert.equal(toProviderPhone("254110000000"), "+254110000000");
});

test("toProviderPhone refuses anything that is not a full Kenyan mobile number", () => {
  assert.equal(toProviderPhone(""), null);
  assert.equal(toProviderPhone("12345"), null);
  assert.equal(toProviderPhone("254727***905"), null);
  assert.equal(toProviderPhone("254312345678"), null);
});

test("a live send to an invalid number fails clearly instead of reaching the provider", async () => {
  process.env.SMS_LIVE = "true";
  process.env.AT_API_KEY = "fake-key-never-used";
  process.env.AT_USERNAME = "fake-user";
  const result = await sendSms("not-a-number", "Test message");
  assert.equal(result.ok, false);
  assert.equal(result.dryRun, false);
  assert.ok(result.error?.includes("not a valid"));
  delete process.env.AT_API_KEY;
  delete process.env.AT_USERNAME;
  process.env.SMS_LIVE = "false";
});
