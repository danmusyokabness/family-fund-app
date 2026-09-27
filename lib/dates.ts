// lib/dates.ts
//
// All date/month arithmetic for the fund, in one place, with no database
// access — so it can be tested on its own and reused by the ledger engine,
// the reminder scheduler, and the dashboard.
//
// Kenya (Africa/Nairobi) is UTC+3 all year round — it has never observed
// daylight saving — so "the current date in Nairobi" is computed with a
// fixed 3-hour offset rather than relying on a timezone database. This
// keeps it correct even on a runtime with a minimal or missing ICU/tz
// database (a real risk on some serverless platforms).
//
// A "month" is represented everywhere as a MonthKey string "YYYY-MM"
// (e.g. "2026-08"). Using a plain, sortable string instead of a Date
// object avoids an entire category of timezone bugs when all we ever
// mean is "the due month", never a specific instant.

export type MonthKey = string; // "YYYY-MM"

const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;

/** The current instant, shifted so its UTC getters read as Nairobi wall-clock time. */
export function nairobiNow(): Date {
  return new Date(Date.now() + NAIROBI_OFFSET_MS);
}

/** The current month in Nairobi, as a MonthKey. */
export function nairobiCurrentMonthKey(): MonthKey {
  const d = nairobiNow();
  return formatMonthKey(d.getUTCFullYear(), d.getUTCMonth() + 1);
}

/** The current calendar day in Nairobi, as "YYYY-MM-DD". */
export function nairobiTodayDateString(): string {
  const d = nairobiNow();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatMonthKey(year: number, month: number): MonthKey {
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month number: ${month}`);
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Parses a MonthKey like "2026-08" into its numeric parts. Throws on anything malformed. */
export function parseMonthKey(key: MonthKey): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) throw new Error(`Invalid MonthKey: "${key}"`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error(`Invalid MonthKey: "${key}"`);
  return { year, month };
}

/**
 * Extracts the month a "YYYY-MM-DD" date string falls in, as a MonthKey.
 * Works by splitting the string, not by constructing a JS Date, so there
 * is no timezone shifting risk at all (this is how `joined_on` and
 * `paid_at::date` values from the database should be turned into months).
 */
export function monthKeyFromDateString(dateString: string): MonthKey {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateString);
  if (!match) throw new Error(`Invalid date string: "${dateString}"`);
  return `${match[1]}-${match[2]}`;
}

export function addMonths(key: MonthKey, delta: number): MonthKey {
  const { year, month } = parseMonthKey(key);
  const zeroBasedTotal = (month - 1) + delta;
  const newYear = year + Math.floor(zeroBasedTotal / 12);
  const newMonth = ((zeroBasedTotal % 12) + 12) % 12 + 1;
  return formatMonthKey(newYear, newMonth);
}

/** -1 if a < b, 0 if equal, 1 if a > b. MonthKeys sort correctly as plain strings too, this is just explicit. */
export function compareMonthKeys(a: MonthKey, b: MonthKey): -1 | 0 | 1 {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Every month from start to end, inclusive. Empty array if start is after end. */
export function monthsBetweenInclusive(start: MonthKey, end: MonthKey): MonthKey[] {
  if (compareMonthKeys(start, end) > 0) return [];
  const months: MonthKey[] = [];
  let cursor = start;
  // A guard against an accidental infinite loop from bad input, not a real limit:
  // 100 years of months is far more than this fund will ever need.
  const maxIterations = 12 * 100;
  for (let i = 0; i < maxIterations; i++) {
    months.push(cursor);
    if (cursor === end) break;
    cursor = addMonths(cursor, 1);
  }
  return months;
}

const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

export function formatMonthShort(key: MonthKey): string {
  const { month } = parseMonthKey(key);
  return MONTH_NAMES_SHORT[month - 1];
}

export function formatMonthYear(key: MonthKey): string {
  const { year } = parseMonthKey(key);
  return `${formatMonthShort(key)} ${year}`;
}

// -----------------------------------------------------------------------
// Financial year helpers.
//
// The fund's FY runs August to July. The start month (8) is a parameter
// with a default, not a buried constant, so it can be wired to a Setup
// value later without touching this function's logic.
// -----------------------------------------------------------------------

export const DEFAULT_FY_START_MONTH = 8; // August

export interface FYRange {
  /** e.g. "FY 2026/2027" */
  label: string;
  startMonth: MonthKey;
  endMonth: MonthKey;
}

/** The financial year that a given month falls inside. */
export function fyRangeForMonth(key: MonthKey, fyStartMonth: number = DEFAULT_FY_START_MONTH): FYRange {
  const { year, month } = parseMonthKey(key);
  const fyStartYear = month >= fyStartMonth ? year : year - 1;
  const startMonth = formatMonthKey(fyStartYear, fyStartMonth);
  const endMonth = addMonths(startMonth, 11);
  const { year: endYear } = parseMonthKey(endMonth);
  return {
    label: `FY ${fyStartYear}/${endYear}`,
    startMonth,
    endMonth,
  };
}
