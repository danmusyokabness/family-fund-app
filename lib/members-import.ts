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
import { canonicalMaskedPhone, normalizePhone } from "./phone.ts";

export interface ParsedMemberRow {
  rowNumber: number; // 1-based, matching a spreadsheet row (header = row 1)
  fullName: string;
  primaryPhone: string | null; // normalised, or null if invalid/missing
  alternatePhones: string[]; // normalised
  shortcodes: string[]; // e.g. an M-PESA business number or till number, kept as typed
  maskedPhones: string[]; // numbers copied from a statement, e.g. "254110***358" (standard form)
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
    const maskedPhones: string[] = [];

    // A cell may hold several numbers, separated by a comma, semicolon,
    // slash, bar or new line. Every column after name and primary phone
    // is read, so there is no limit on how many alternates a row can have.
    const cells: { col: string; value: string }[] = [];
    for (const col of extraColumns) {
      for (const part of (rawRow[col] ?? "").split(/[,;|/\n]+/)) {
        const value = part.trim();
        if (value) cells.push({ col, value });
      }
    }

    for (const { col, value } of cells) {
      const masked = canonicalMaskedPhone(value);
      if (masked) {
        if (!maskedPhones.includes(masked)) maskedPhones.push(masked);
        continue;
      }

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
        if (!shortcodes.includes(value)) shortcodes.push(value);
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
      maskedPhones,
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

// ---------------------------------------------------------------------
// Re-importing a sheet for members who ALREADY exist must not skip them
// (that left no way to add a newly found number). Instead the new
// numbers are added to the existing member and nothing is ever removed.
// ---------------------------------------------------------------------
export interface ExistingMemberState {
  phones: string[]; // every registered phone, canonical
  shortcodes: string[];
  maskedPhones: string[]; // standard form
}

export interface MergePlan {
  addPhones: string[];
  addShortcodes: string[];
  addMaskedPhones: string[];
  /** Alternate numbers that already belong to a DIFFERENT member, so cannot be added. */
  phoneConflicts: string[];
}

/**
 * @param phoneOwners  phone number -> id of the member it belongs to (for every member)
 */
export function planMemberMerge(
  row: Pick<ParsedMemberRow, "alternatePhones" | "shortcodes" | "maskedPhones">,
  memberId: string,
  existing: ExistingMemberState,
  phoneOwners: Map<string, string>
): MergePlan {
  const addPhones: string[] = [];
  const phoneConflicts: string[] = [];
  for (const phone of row.alternatePhones) {
    if (existing.phones.includes(phone)) continue;
    const owner = phoneOwners.get(phone);
    if (owner && owner !== memberId) phoneConflicts.push(phone);
    else addPhones.push(phone);
  }
  return {
    addPhones,
    addShortcodes: row.shortcodes.filter((c) => !existing.shortcodes.includes(c)),
    addMaskedPhones: row.maskedPhones.filter((m) => !existing.maskedPhones.includes(m)),
    phoneConflicts,
  };
}

/** True when a name from the sheet plausibly refers to the same person as a registered name (first names agree). */
export function sameFirstName(a: string, b: string): boolean {
  const first = (n: string) => n.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return first(a) !== "" && first(a) === first(b);
}
