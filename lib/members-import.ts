// lib/members-import.ts
//
// Turns the CSV exported from a "Member_Mapping"-style sheet (a name
// column, a primary phone column, and any number of other columns that
// might hold an alternate phone or an M-PESA business/shortcode number)
// into a clean, validated list ready to preview or commit.
//
// Column headers are matched loosely (case-insensitive, "contains"), not
// exact strings — so this keeps working if a sheet's columns are named
// slightly differently, rather than breaking on the first renamed header.
// Any column beyond "name" and "primary phone" is inspected cell by cell:
// a value that looks like a phone becomes an alternate phone, a short
// run of digits that isn't a valid phone becomes a business/shortcode
// alias, and anything else is recorded as a warning rather than
// silently dropped or silently guessed at.

import { parseCsvWithHeader, findColumn } from "./csv.ts";
import { normalizePhone } from "./phone.ts";

export interface ParsedMemberRow {
  rowNumber: number; // 1-based, matching a spreadsheet row (header = row 1)
  fullName: string;
  primaryPhone: string | null; // normalised, or null if invalid/missing
  alternatePhones: string[]; // normalised
  shortcodes: string[]; // e.g. an M-PESA business number, kept as typed
  warnings: string[]; // non-fatal: row is still importable
  errors: string[]; // fatal: this row will be skipped
}

export interface ParseMemberImportResult {
  headers: string[];
  rows: ParsedMemberRow[];
  importableCount: number;
  skippedCount: number;
}

const NAME_COLUMN_CANDIDATES = ["primary member name", "member name", "full name", "name"];
const PRIMARY_PHONE_COLUMN_CANDIDATES = ["primary phone", "phone number", "phone"];

export function parseMemberImportCsv(csvText: string): ParseMemberImportResult {
  const table = parseCsvWithHeader(csvText);

  const nameColumn = findColumn(table.headers, NAME_COLUMN_CANDIDATES);
  const primaryPhoneColumn = findColumn(table.headers, PRIMARY_PHONE_COLUMN_CANDIDATES);

  // Every other column is treated as "extra" — a possible alternate
  // phone or business number, classified per cell below.
  const extraColumns = table.headers.filter((h) => h !== nameColumn && h !== primaryPhoneColumn);

  const rows: ParsedMemberRow[] = table.rows.map((rawRow, index) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const fullName = (nameColumn ? rawRow[nameColumn] : "").trim();
    if (!fullName) errors.push("Missing name.");

    const primaryPhoneRaw = (primaryPhoneColumn ? rawRow[primaryPhoneColumn] : "").trim();
    const primaryPhone = primaryPhoneRaw ? normalizePhone(primaryPhoneRaw) : null;
    if (!primaryPhoneRaw) {
      errors.push("Missing primary phone number.");
    } else if (!primaryPhone) {
      errors.push(`"${primaryPhoneRaw}" is not a recognisable phone number.`);
    }

    const alternatePhones: string[] = [];
    const shortcodes: string[] = [];

    for (const col of extraColumns) {
      const value = rawRow[col]?.trim();
      if (!value) continue;

      const normalized = normalizePhone(value);
      if (normalized) {
        if (normalized === primaryPhone) {
          warnings.push(`"${value}" in column "${col}" is the same as the primary phone — skipped.`);
        } else if (alternatePhones.includes(normalized)) {
          warnings.push(`"${value}" in column "${col}" is a duplicate alternate — skipped.`);
        } else {
          alternatePhones.push(normalized);
        }
        continue;
      }

      // Not a valid phone. A short run of digits (an M-PESA business/
      // shortcode number, e.g. "8760493") is still useful to keep.
      if (/^\d{5,9}$/.test(value)) {
        shortcodes.push(value);
        continue;
      }

      warnings.push(`Could not interpret "${value}" in column "${col}" — ignored.`);
    }

    return {
      rowNumber: index + 2, // +1 for 1-based, +1 for the header row
      fullName,
      primaryPhone,
      alternatePhones,
      shortcodes,
      warnings,
      errors,
    };
  });

  const importableCount = rows.filter((r) => r.errors.length === 0).length;

  return {
    headers: table.headers,
    rows,
    importableCount,
    skippedCount: rows.length - importableCount,
  };
}