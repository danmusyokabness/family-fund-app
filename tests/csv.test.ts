import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseCsvWithHeader, findColumn } from "../lib/csv.ts";

test("parses a simple CSV", () => {
  const rows = parseCsv("a,b,c\n1,2,3");
  assert.deepEqual(rows, [
    ["a", "b", "c"],
    ["1", "2", "3"],
  ]);
});

test("handles CRLF line endings", () => {
  const rows = parseCsv("a,b\r\n1,2\r\n");
  assert.deepEqual(rows, [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("handles a quoted field containing a comma", () => {
  const rows = parseCsv('Name,Note\n"Smith, John",hello');
  assert.deepEqual(rows, [
    ["Name", "Note"],
    ["Smith, John", "hello"],
  ]);
});

test("handles an escaped quote inside a quoted field", () => {
  const rows = parseCsv('Note\n"She said ""hi"""');
  assert.deepEqual(rows, [["Note"], ['She said "hi"']]);
});

test("drops trailing blank rows from a spreadsheet export", () => {
  const rows = parseCsv("a,b\n1,2\n,\n,\n");
  assert.deepEqual(rows, [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("parseCsvWithHeader turns rows into objects keyed by header", () => {
  const table = parseCsvWithHeader("Name,Phone\nEsther,0712345678");
  assert.deepEqual(table.headers, ["Name", "Phone"]);
  assert.deepEqual(table.rows, [{ Name: "Esther", Phone: "0712345678" }]);
});

test("findColumn matches case-insensitively and by substring", () => {
  const headers = ["Primary Member Name", "Primary Phone Number", "Alternate Payment Phone"];
  assert.equal(findColumn(headers, ["primary member name"]), "Primary Member Name");
  assert.equal(findColumn(headers, ["phone number"]), "Primary Phone Number");
  assert.equal(findColumn(headers, ["not a real column"]), null);
});