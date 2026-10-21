import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReportMessages, composeReportMessage, formatKes, formatReportDate, smsSegments } from "../lib/report.ts";

const TEMPLATE =
  "{fund_name} {date}: collected this month KES {month_collected}. Total in account KES {fund_total}. Your balance: KES {balance} owing. {site_url}";

test("formatKes rounds to whole shillings with thousands separators and ignores the computer's locale", () => {
  assert.equal(formatKes(0), "0");
  assert.equal(formatKes(999), "999");
  assert.equal(formatKes(12064.86), "12,065");
  assert.equal(formatKes(1234567), "1,234,567");
  assert.equal(formatKes(-1500), "-1,500");
});

test("formatReportDate writes a readable date and leaves anything else untouched", () => {
  assert.equal(formatReportDate("2026-10-15"), "15 Oct 2026");
  assert.equal(formatReportDate("2026-01-05"), "5 Jan 2026");
  assert.equal(formatReportDate("not a date"), "not a date");
});

test("smsSegments counts 160 characters as one message and 153 per part after that", () => {
  assert.equal(smsSegments(""), 0);
  assert.equal(smsSegments("a".repeat(160)), 1);
  assert.equal(smsSegments("a".repeat(161)), 2);
  assert.equal(smsSegments("a".repeat(306)), 2);
  assert.equal(smsSegments("a".repeat(307)), 3);
});

test("a member who owes money gets the standard report with their own balance", () => {
  const message = composeReportMessage({
    template: TEMPLATE, fundName: "Family Fund", reportDate: "2026-10-15", monthCollected: 4200, fundTotal: 16048.41,
    balance: 600, hasPendingPayment: false, siteUrl: "https://example.test",
  });
  assert.equal(
    message,
    "Family Fund 15 Oct 2026: collected this month KES 4,200. Total in account KES 16,048. Your balance: KES 600 owing. https://example.test"
  );
});

test("a fully paid member never sees 'KES 0 owing': they are told their account is up to date", () => {
  const message = composeReportMessage({
    template: TEMPLATE, fundName: "Family Fund", reportDate: "2026-10-15", monthCollected: 4200, fundTotal: 16048.41,
    balance: 0, hasPendingPayment: false, siteUrl: "https://example.test",
  });
  assert.ok(message.includes("Your account is up to date. Thank you!"));
  assert.ok(!message.includes("owing"));
});

test("a member with a payment awaiting confirmation gets a 'being confirmed' note", () => {
  const message = composeReportMessage({
    template: TEMPLATE, fundName: "Family Fund", reportDate: "2026-10-15", monthCollected: 4200, fundTotal: 16048.41,
    balance: 300, hasPendingPayment: true, siteUrl: "https://example.test",
  });
  assert.ok(message.endsWith("A payment from you is being confirmed."));
});

test("a custom message can place {balance_line} and {pending_note} itself, and the note is not added twice", () => {
  const message = composeReportMessage({
    template: "{fund_name}: {balance_line} {pending_note}", fundName: "FF", reportDate: "2026-10-15", monthCollected: 0, fundTotal: 0,
    balance: 300, hasPendingPayment: true, siteUrl: "",
  });
  assert.equal(message, "FF: Your balance: KES 300 owing. A payment from you is being confirmed.");
});

test("buildReportMessages gives EVERY member a message, including fully paid ones, and never mentions anyone else", () => {
  const messages = buildReportMessages({
    members: [
      { id: "m1", fullName: "Test One", joinedOn: "2026-08-01", primaryPhone: "254700000001" },
      { id: "m2", fullName: "Test Two", joinedOn: "2026-08-01", primaryPhone: "254700000002" },
      { id: "m3", fullName: "Test Three", joinedOn: "2026-08-01", primaryPhone: null },
    ],
    allocatedByMember: { m1: 900, m2: 300 },
    targetAmount: 300,
    asOfMonth: "2026-10",
    monthCollected: 1200,
    fundTotal: 1150.5,
    pendingMemberIds: new Set(["m2"]),
    template: TEMPLATE,
    fundName: "Family Fund",
    reportDate: "2026-10-15",
    siteUrl: "https://example.test",
  });
  assert.equal(messages.length, 3);

  const [one, two, three] = messages;
  assert.equal(one.balance, 0);
  assert.ok(one.message.includes("up to date"));
  assert.equal(two.balance, 600);
  assert.equal(two.hasPendingPayment, true);
  assert.ok(two.message.includes("being confirmed"));
  assert.equal(three.phone, null); // nothing to send, the admin sees this
  assert.equal(three.balance, 900);

  for (const msg of messages) {
    assert.ok(!msg.message.includes("Test One") && !msg.message.includes("Test Two") && !msg.message.includes("Test Three"));
    assert.ok(msg.segments >= 1);
  }
});
