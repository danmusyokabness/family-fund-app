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
import { csvCell, toCsv } from "../lib/export.ts";

test("csvCell: plain text, numbers, booleans and empties", () => {
  assert.equal(csvCell("hello"), "hello");
  assert.equal(csvCell(4.95), "4.95");
  assert.equal(csvCell(-16.5), "-16.5");
  assert.equal(csvCell(true), "yes");
  assert.equal(csvCell(false), "no");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("csvCell: commas, quotes and new lines are quoted so a cell can never break the columns", () => {
  assert.equal(csvCell("Smith, John"), '"Smith, John"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line one\nline two"), '"line one\nline two"');
});

test("csvCell: text that starts like a spreadsheet formula is defused, but real numbers are left alone", () => {
  assert.equal(csvCell("=HYPERLINK(\"http://evil\")"), "\"'=HYPERLINK(\"\"http://evil\"\")\"");
  assert.equal(csvCell("+254700000001"), "'+254700000001");
  assert.equal(csvCell("-5 off"), "'-5 off");
  assert.equal(csvCell("@cmd"), "'@cmd");
  assert.equal(csvCell(-5), "-5");
});

test("toCsv: a header row, then one line per row, with Windows line endings", () => {
  const csv = toCsv(["Name", "Amount"], [["Ann", 300], ["Bea, B", 4.95]]);
  assert.equal(csv, 'Name,Amount\r\nAnn,300\r\n"Bea, B",4.95\r\n');
});
