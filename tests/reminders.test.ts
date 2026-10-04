import { test } from "node:test";
import assert from "node:assert/strict";
import { fillTemplate } from "../lib/message-templates.ts";
import { buildReminderCandidates, composeReminderMessage } from "../lib/reminders.ts";

test("fillTemplate substitutes every placeholder", () => {
  assert.equal(fillTemplate("Hi {name}, you owe {amount}", { name: "Jane", amount: "300" }), "Hi Jane, you owe 300");
});

test("fillTemplate leaves an unknown placeholder untouched", () => {
  assert.equal(fillTemplate("Hi {name} {mystery}", { name: "Jane" }), "Hi Jane {mystery}");
});

const members = [
  { id: "A", fullName: "Jane Doe", joinedOn: "2026-08-01", primaryPhone: "254712345678" },
  { id: "B", fullName: "Fully Paid", joinedOn: "2026-08-01", primaryPhone: "254722345678" },
  { id: "C", fullName: "No Phone Person", joinedOn: "2026-08-01", primaryPhone: null },
];

test("buildReminderCandidates: only members with a balance AND a phone are included", () => {
  const result = buildReminderCandidates({
    members,
    allocatedByMember: { A: 0, B: 300, C: 0 },
    targetAmount: 300,
    asOfMonth: "2026-08",
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].memberId, "A");
  assert.equal(result.candidates[0].balance, 300);
});

test("buildReminderCandidates: skip reasons are reported, not silently dropped", () => {
  const result = buildReminderCandidates({
    members,
    allocatedByMember: { A: 0, B: 300, C: 0 },
    targetAmount: 300,
    asOfMonth: "2026-08",
  });
  const reasons = Object.fromEntries(result.skipped.map((s) => [s.memberId, s.reason]));
  assert.equal(reasons.B, "no_balance_due");
  assert.equal(reasons.C, "no_phone"); // C owes 300 (0 allocated against 1 month due) but has no phone to text
});

test("a member with both no balance due and no phone is still only reported once, as no_balance_due taking priority", () => {
  const result = buildReminderCandidates({
    members: [{ id: "C", fullName: "No Phone Person", joinedOn: "2026-08-01", primaryPhone: null }],
    allocatedByMember: { C: 300 },
    targetAmount: 300,
    asOfMonth: "2026-08",
  });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.skipped[0].reason, "no_balance_due");
});

test("a member who owes but has no phone is reported as no_phone", () => {
  const result = buildReminderCandidates({
    members: [{ id: "C", fullName: "No Phone Person", joinedOn: "2026-08-01", primaryPhone: null }],
    allocatedByMember: {},
    targetAmount: 300,
    asOfMonth: "2026-08",
  });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.skipped[0].reason, "no_phone");
});

test("composeReminderMessage fills every placeholder and uses only the first name", () => {
  const msg = composeReminderMessage("{fund_name}: Hi {first_name}, you owe KES {balance} ({unpaid_months}). Till {till_number}. {site_url}", {
    fundName: "Family Fund",
    fullName: "Esther Nakhanu",
    balance: 900,
    unpaidSummary: "Aug, Sep, Oct",
    tillNumber: "123456",
    siteUrl: "https://example.com",
  });
  assert.equal(msg, "Family Fund: Hi Esther, you owe KES 900 (Aug, Sep, Oct). Till 123456. https://example.com");
});

test("composeReminderMessage rounds a fractional balance", () => {
  const msg = composeReminderMessage("KES {balance}", {
    fundName: "X", fullName: "A B", balance: 299.5, unpaidSummary: "", tillNumber: "1", siteUrl: "",
  });
  assert.equal(msg, "KES 300");
});
