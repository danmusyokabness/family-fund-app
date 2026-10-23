// lib/export.ts
//
// Turns rows into a CSV file that opens correctly in Excel and Google
// Sheets. Pure: no database, no web code.
//
// Two safety details:
//   * A text cell that begins with =, +, - or @ is prefixed with an
//     apostrophe, so a spreadsheet can never run it as a formula (a name
//     or description someone typed could otherwise do that).
//   * Cells with a comma, a quote or a new line are quoted properly.
//
// Numbers are written as numbers and never altered.

export type CsvValue = string | number | boolean | null | undefined;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "yes" : "no";

  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Header row plus data rows, joined with Windows line endings (what Excel expects). */
export function toCsv(columns: string[], rows: CsvValue[][]): string {
  const lines = [columns.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))];
  return lines.join("\r\n") + "\r\n";
}
