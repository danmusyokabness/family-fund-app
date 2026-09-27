// lib/csv.ts
//
// A small, dependency-free CSV parser. Handles the real-world messiness
// that matters here: quoted fields (so a name or address containing a
// comma doesn't split into two columns), escaped quotes ("" inside a
// quoted field), and both \n and \r\n line endings (Google Sheets and
// Excel exports differ). Not a full RFC 4180 implementation, but enough
// for the exports this project actually deals with.
//
// Used by the member bulk-import (Step 4) and will be reused by the
// M-PESA statement CSV import (Step 7) — the same parsing rules apply
// to both, so this is written once rather than twice.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // Normalise line endings up front so the main loop only has to think
  // about \n, not \r\n vs \n vs a stray \r.
  const input = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++; // skip the escaped quote's second character
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  // The final field/row won't have a trailing newline to trigger the push above.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully blank trailing rows (a common artefact of spreadsheet exports).
  while (rows.length > 0 && rows[rows.length - 1].every((cell) => cell.trim() === "")) {
    rows.pop();
  }

  return rows;
}

/**
 * Parses CSV text where the first row is a header, and returns each
 * subsequent row as an object keyed by that header — trimmed, and with
 * a lowercase lookup so callers can match column names loosely (e.g.
 * "Primary Phone Number" vs "primary phone number").
 */
export interface CsvTable {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsvWithHeader(text: string): CsvTable {
  const rawRows = parseCsv(text);
  if (rawRows.length === 0) return { headers: [], rows: [] };

  const headers = rawRows[0].map((h) => h.trim());
  const rows = rawRows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (r[i] ?? "").trim();
    });
    return obj;
  });

  return { headers, rows };
}

/** Finds a column by loose name matching (case-insensitive substring match on every candidate, in order). */
export function findColumn(headers: string[], candidates: string[]): string | null {
  const lowerHeaders = headers.map((h) => h.toLowerCase());
  for (const candidate of candidates) {
    const idx = lowerHeaders.findIndex((h) => h.includes(candidate.toLowerCase()));
    if (idx !== -1) return headers[idx];
  }
  return null;
}