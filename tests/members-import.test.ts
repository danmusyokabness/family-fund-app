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