import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMemberImportCsv } from "../lib/members-import.ts";

test("parses a clean row with just a name and primary phone", () => {
  const csv = "Primary Member Name,Primary Phone Number\nJane Mwangi,0712345678";
  const result = parseMemberImportCsv(csv);
  assert.equal(result.importableCount, 1);
  assert.equal(result.skippedCount, 0);
  const row = result.rows[0];
  assert.equal(row.fullName, "Jane Mwangi");
  assert.equal(row.primaryPhone, "254712345678");
  assert.deepEqual(row.alternatePhones, []);
  assert.deepEqual(row.errors, []);
});

test("picks up an alternate phone from an extra column", () => {
  const csv =
    "Primary Member Name,Primary Phone Number,Alternate Payment Phone\n" +
    "John Otieno,0722334455,0733445566";
  const result = parseMemberImportCsv(csv);
  const row = result.rows[0];
  assert.equal(row.primaryPhone, "254722334455");
  assert.deepEqual(row.alternatePhones, ["254733445566"]);
});

test("classifies a short digit string as a business/shortcode alias, not a phone", () => {
  const csv =
    "Primary Member Name,Primary Phone Number,Alternate Payment Phone,Business Number\n" +
    "Mary Wafula,0744556677,,8760493";
  const result = parseMemberImportCsv(csv);
  const row = result.rows[0];
  assert.deepEqual(row.shortcodes, ["8760493"]);
  assert.deepEqual(row.alternatePhones, []);
  assert.equal(row.errors.length, 0);
});

test("handles a row with both an alternate phone AND a business number", () => {
  const csv =
    "Primary Member Name,Primary Phone Number,Alternate Payment Phone,Business Number\n" +
    "Peter Kioko,0755667788,254707543351,8760493";
  const result = parseMemberImportCsv(csv);
  const row = result.rows[0];
  assert.deepEqual(row.alternatePhones, ["254707543351"]);
  assert.deepEqual(row.shortcodes, ["8760493"]);
});

test("a missing name is a fatal error, row is not importable", () => {
  const csv = "Primary Member Name,Primary Phone Number\n,0712345678";
  const result = parseMemberImportCsv(csv);
  assert.equal(result.importableCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.ok(result.rows[0].errors.some((e) => e.includes("name")));
});

test("an invalid primary phone is a fatal error", () => {
  const csv = "Primary Member Name,Primary Phone Number\nJane Doe,12345";
  const result = parseMemberImportCsv(csv);
  assert.equal(result.importableCount, 0);
  assert.ok(result.rows[0].errors.some((e) => e.includes("not a recognisable phone number")));
});

test("a missing primary phone is a fatal error", () => {
  const csv = "Primary Member Name,Primary Phone Number\nJane Doe,";
  const result = parseMemberImportCsv(csv);
  assert.equal(result.importableCount, 0);
  assert.ok(result.rows[0].errors.some((e) => e.includes("Missing primary phone")));
});

test("an alternate phone identical to the primary is dropped with a warning, not an error", () => {
  const csv =
    "Primary Member Name,Primary Phone Number,Alternate Payment Phone\n" +
    "Jane Doe,0712345678,0712345678";
  const result = parseMemberImportCsv(csv);
  const row = result.rows[0];
  assert.equal(row.errors.length, 0);
  assert.deepEqual(row.alternatePhones, []);
  assert.ok(row.warnings.length > 0);
});

test("an unrecognisable extra value is a warning, not a fatal error, and doesn't stop the row importing", () => {
  const csv =
    "Primary Member Name,Primary Phone Number,Notes\n" + "Jane Doe,0712345678,some free text here";
  const result = parseMemberImportCsv(csv);
  const row = result.rows[0];
  assert.equal(row.errors.length, 0);
  assert.equal(result.importableCount, 1);
  assert.ok(row.warnings.some((w) => w.includes("some free text here")));
});

test("a full multi-row sheet: mix of clean, warned, and skipped rows", () => {
  const csv = [
    "Primary Member Name,Primary Phone Number,Alternate Payment Phone",
    "Jane Mwangi,0712345678,",
    "John Otieno,0722334455,0733445566",
    ",0700000000,", // missing name -> skipped
    "Bad Phone Person,notaphone,", // bad phone -> skipped
  ].join("\n");
  const result = parseMemberImportCsv(csv);
  assert.equal(result.rows.length, 4);
  assert.equal(result.importableCount, 2);
  assert.equal(result.skippedCount, 2);
  // Row numbers should map back to real spreadsheet rows (header is row 1).
  assert.equal(result.rows[0].rowNumber, 2);
  assert.equal(result.rows[3].rowNumber, 5);
});
import { planMemberMerge, sameFirstName } from "../lib/members-import.ts";

test("a masked number copied from a statement becomes a payer number, not a warning", () => {
  const csv = "Primary Member Name,Primary Phone Number,Alternate Payment Phone Number\nMarion Wafula,0722000001,254110***358";
  const row = parseMemberImportCsv(csv).rows[0];
  assert.deepEqual(row.maskedPhones, ["254110***358"]);
  assert.deepEqual(row.alternatePhones, []);
  assert.deepEqual(row.warnings, []);
});

test("one cell can hold several numbers of different kinds, separated by commas, semicolons, slashes or new lines", () => {
  const csv = 'Name,Phone,Other\nTrizah Musyoka,0700000009,"0711111111, 0722222222; 8760493 / 0110***358"';
  const row = parseMemberImportCsv(csv).rows[0];
  assert.deepEqual(row.alternatePhones, ["254711111111", "254722222222"]);
  assert.deepEqual(row.shortcodes, ["8760493"]);
  assert.deepEqual(row.maskedPhones, ["254110***358"]);
});

test("any number of extra columns is read: three alternates, a till number and a masked number in one row", () => {
  const csv = "Name,Phone,Alt 1,Alt 2,Alt 3,Till,Seen on statement\nJoseph Karani,0710000001,0710000002,0710000003,0710000004,1234567,254710***074";
  const row = parseMemberImportCsv(csv).rows[0];
  assert.deepEqual(row.alternatePhones, ["254710000002", "254710000003", "254710000004"]);
  assert.deepEqual(row.shortcodes, ["1234567"]);
  assert.deepEqual(row.maskedPhones, ["254710***074"]);
});

test("the same masked number written two ways is kept once", () => {
  const csv = "Name,Phone,A,B\nAnn One,0700000001,0110***358,254110***358";
  assert.deepEqual(parseMemberImportCsv(csv).rows[0].maskedPhones, ["254110***358"]);
});

test("planMemberMerge adds only what is new and never touches what is already there", () => {
  const owners = new Map([["254722000001", "m1"]]);
  const plan = planMemberMerge(
    { alternatePhones: ["254711111111", "254722000001"], shortcodes: ["8760493", "1111111"], maskedPhones: ["254110***358"] },
    "m1",
    { phones: ["254722000001"], shortcodes: ["8760493"], maskedPhones: [] },
    owners
  );
  assert.deepEqual(plan.addPhones, ["254711111111"]);
  assert.deepEqual(plan.addShortcodes, ["1111111"]);
  assert.deepEqual(plan.addMaskedPhones, ["254110***358"]);
  assert.deepEqual(plan.phoneConflicts, []);
});

test("planMemberMerge refuses an alternate number that belongs to a different member", () => {
  const owners = new Map([["254733333333", "someone-else"]]);
  const plan = planMemberMerge(
    { alternatePhones: ["254733333333"], shortcodes: [], maskedPhones: [] },
    "m1",
    { phones: [], shortcodes: [], maskedPhones: [] },
    owners
  );
  assert.deepEqual(plan.addPhones, []);
  assert.deepEqual(plan.phoneConflicts, ["254733333333"]);
});

test("sameFirstName: a changed surname still counts as the same person, a different first name does not", () => {
  assert.equal(sameFirstName("Joseph Karani", "JOSEPH KATAKA"), true);
  assert.equal(sameFirstName("Joseph Karani", "Josephine Karani"), false);
  assert.equal(sameFirstName("", "Anyone"), false);
});
