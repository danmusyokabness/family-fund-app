import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatMonthKey,
  parseMonthKey,
  monthKeyFromDateString,
  addMonths,
  compareMonthKeys,
  monthsBetweenInclusive,
  formatMonthShort,
  formatMonthYear,
  fyRangeForMonth,
  monthKeyFromInstant,
} from "../lib/dates.ts";

test("formatMonthKey pads the month", () => {
  assert.equal(formatMonthKey(2026, 8), "2026-08");
  assert.equal(formatMonthKey(2026, 12), "2026-12");
});

test("formatMonthKey rejects an invalid month", () => {
  assert.throws(() => formatMonthKey(2026, 13));
  assert.throws(() => formatMonthKey(2026, 0));
});

test("parseMonthKey round-trips", () => {
  assert.deepEqual(parseMonthKey("2026-08"), { year: 2026, month: 8 });
});

test("parseMonthKey rejects garbage", () => {
  assert.throws(() => parseMonthKey("not-a-month"));
  assert.throws(() => parseMonthKey("2026-13"));
});

test("monthKeyFromDateString reads the month straight from the string, no timezone shifting", () => {
  assert.equal(monthKeyFromDateString("2026-08-01"), "2026-08");
  assert.equal(monthKeyFromDateString("2026-01-31"), "2026-01");
  // Even with a time component attached, as Postgres might return.
  assert.equal(monthKeyFromDateString("2026-12-01T00:00:00.000Z"), "2026-12");
});

test("addMonths moves forward within a year", () => {
  assert.equal(addMonths("2026-08", 1), "2026-09");
  assert.equal(addMonths("2026-08", 4), "2026-12");
});

test("addMonths rolls over a year boundary going forward", () => {
  assert.equal(addMonths("2026-11", 3), "2027-02");
  assert.equal(addMonths("2026-12", 1), "2027-01");
});

test("addMonths rolls over a year boundary going backward", () => {
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-08", -12), "2025-08");
});

test("compareMonthKeys", () => {
  assert.equal(compareMonthKeys("2026-08", "2026-09"), -1);
  assert.equal(compareMonthKeys("2026-09", "2026-08"), 1);
  assert.equal(compareMonthKeys("2026-08", "2026-08"), 0);
});

test("monthsBetweenInclusive within one year", () => {
  assert.deepEqual(monthsBetweenInclusive("2026-08", "2026-11"), [
    "2026-08", "2026-09", "2026-10", "2026-11",
  ]);
});

test("monthsBetweenInclusive crossing the FY boundary (Jul -> Aug)", () => {
  assert.deepEqual(monthsBetweenInclusive("2026-11", "2027-02"), [
    "2026-11", "2026-12", "2027-01", "2027-02",
  ]);
});

test("monthsBetweenInclusive with start after end returns empty", () => {
  assert.deepEqual(monthsBetweenInclusive("2026-09", "2026-08"), []);
});

test("monthsBetweenInclusive with a single month", () => {
  assert.deepEqual(monthsBetweenInclusive("2026-08", "2026-08"), ["2026-08"]);
});

test("formatMonthShort / formatMonthYear", () => {
  assert.equal(formatMonthShort("2026-08"), "Aug");
  assert.equal(formatMonthYear("2026-08"), "Aug 2026");
  assert.equal(formatMonthYear("2027-01"), "Jan 2027");
});

test("fyRangeForMonth: a month at the start of the FY (August)", () => {
  const fy = fyRangeForMonth("2026-08");
  assert.equal(fy.label, "FY 2026/2027");
  assert.equal(fy.startMonth, "2026-08");
  assert.equal(fy.endMonth, "2027-07");
});

test("fyRangeForMonth: a month at the end of the FY (July)", () => {
  const fy = fyRangeForMonth("2027-07");
  assert.equal(fy.label, "FY 2026/2027");
  assert.equal(fy.startMonth, "2026-08");
  assert.equal(fy.endMonth, "2027-07");
});

test("fyRangeForMonth: a month early in the calendar year belongs to the PREVIOUS FY", () => {
  // January 2027 is still inside FY 2026/2027 (Aug 2026 - Jul 2027), not FY 2027/2028.
  const fy = fyRangeForMonth("2027-01");
  assert.equal(fy.label, "FY 2026/2027");
});

test("fyRangeForMonth respects a custom FY start month", () => {
  // If the FY started in January instead, every month's FY is just its own calendar year.
  const fy = fyRangeForMonth("2026-03", 1);
  assert.equal(fy.label, "FY 2026/2026");
  assert.equal(fy.startMonth, "2026-01");
  assert.equal(fy.endMonth, "2026-12");
});

test("monthKeyFromInstant reads the month in Nairobi time, not UTC", () => {
  // 10pm UTC on 31 Aug is 1am on 1 Sep in Nairobi (UTC+3): September.
  assert.equal(monthKeyFromInstant("2026-08-31T22:00:00Z"), "2026-09");
  // 8pm UTC on 31 Aug is 11pm on 31 Aug in Nairobi: still August.
  assert.equal(monthKeyFromInstant("2026-08-31T20:00:00Z"), "2026-08");
});

test("monthKeyFromInstant handles Postgres-style timestamps and a year boundary", () => {
  assert.equal(monthKeyFromInstant("2026-09-28T09:15:00+00:00"), "2026-09");
  assert.equal(monthKeyFromInstant("2026-12-31T21:30:00+00:00"), "2027-01");
});

test("monthKeyFromInstant rejects a garbage timestamp", () => {
  assert.throws(() => monthKeyFromInstant("not a date"));
});
