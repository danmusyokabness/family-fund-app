// lib/profile.ts
//
// What a person tells the family about themselves: where they studied,
// where they work and where they live. Each is a small structured form
// (a choice, a name, two dates) rather than free text, so everyone's
// entries look the same and can be shown the same way.
//
// This file checks and tidies what is sent, and turns entries into
// readable lines. Pure: no database, no web code. NOT yet used by the app
// (see the README, "The next work").

import { EDUCATION_LEVELS, WORK_STATUSES } from "./data/careers.ts";

export interface EducationEntry {
  level: string;
  institution: string;
  /** The course, for example "BSc Computer Science". Optional. */
  course: string | null;
  /** "YYYY-MM" or null. */
  startMonth: string | null;
  endMonth: string | null;
  /** Still studying there. */
  current: boolean;
}

export interface WorkEntry {
  status: string;
  employer: string | null;
  title: string | null;
  sector: string | null;
  startMonth: string | null;
  endMonth: string | null;
  /** Still doing this. */
  current: boolean;
}

export interface Residence {
  country: string;
  /** A county for Kenya, otherwise whatever the person typed. */
  region: string | null;
  /** Town or area. */
  place: string | null;
}

export const MAX_ENTRIES = 8;
const MAX_TEXT = 120;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

function text(value: unknown, label: string, required: boolean): Checked<string | null> {
  if (value === undefined || value === null || value === "") {
    return required ? { ok: false, error: `${label} is required.` } : { ok: true, value: null };
  }
  if (typeof value !== "string") return { ok: false, error: `${label} must be text.` };
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed === "") return required ? { ok: false, error: `${label} is required.` } : { ok: true, value: null };
  if ([...trimmed].length > MAX_TEXT) return { ok: false, error: `${label} is too long (most ${MAX_TEXT} characters).` };
  return { ok: true, value: trimmed };
}

function addYears(monthKey: string, years: number): string {
  return `${Number(monthKey.slice(0, 4)) + years}${monthKey.slice(4)}`;
}

function month(value: unknown, label: string, currentMonth: string): Checked<string | null> {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string" || !MONTH_RE.test(value)) return { ok: false, error: `${label} must be a month, like 2018-07.` };
  if (Number(value.slice(0, 4)) < 1900) return { ok: false, error: `${label} looks too long ago. Please check it.` };
  if (value > addYears(currentMonth, 10)) return { ok: false, error: `${label} is too far in the future.` };
  return { ok: true, value };
}

function dates(entry: Record<string, unknown>, currentMonth: string, prefix: string): Checked<{ startMonth: string | null; endMonth: string | null; current: boolean }> {
  const start = month(entry.startMonth, `${prefix} start`, currentMonth);
  if (!start.ok) return start;
  const end = month(entry.endMonth, `${prefix} end`, currentMonth);
  if (!end.ok) return end;
  const current = entry.current === true;
  if (!current && start.value && end.value && end.value < start.value) {
    return { ok: false, error: `${prefix}: the end cannot be before the start.` };
  }
  return { ok: true, value: { startMonth: start.value, endMonth: current ? null : end.value, current } };
}

/** `currentMonth` is "YYYY-MM" (Nairobi) and limits how far ahead a date may be. */
export function sanitizeEducation(input: unknown, currentMonth: string): Checked<EducationEntry[]> {
  if (!Array.isArray(input)) return { ok: false, error: "The education list is not valid." };
  if (input.length > MAX_ENTRIES) return { ok: false, error: `You can add up to ${MAX_ENTRIES} education entries.` };
  const out: EducationEntry[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) return { ok: false, error: "An education entry is not valid." };
    const e = raw as Record<string, unknown>;
    const level = text(e.level, "Education level", true);
    if (!level.ok) return level;
    if (!EDUCATION_LEVELS.includes(level.value as string)) return { ok: false, error: `"${level.value}" is not an education level in the list.` };
    const institution = text(e.institution, "School or institution", true);
    if (!institution.ok) return institution;
    const course = text(e.course, "Course", false);
    if (!course.ok) return course;
    const when = dates(e, currentMonth, "Education");
    if (!when.ok) return when;
    out.push({ level: level.value as string, institution: institution.value as string, course: course.value, ...when.value });
  }
  return { ok: true, value: out };
}

export function sanitizeWork(input: unknown, currentMonth: string): Checked<WorkEntry[]> {
  if (!Array.isArray(input)) return { ok: false, error: "The work list is not valid." };
  if (input.length > MAX_ENTRIES) return { ok: false, error: `You can add up to ${MAX_ENTRIES} work entries.` };
  const out: WorkEntry[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) return { ok: false, error: "A work entry is not valid." };
    const e = raw as Record<string, unknown>;
    const status = text(e.status, "Work status", true);
    if (!status.ok) return status;
    if (!WORK_STATUSES.includes(status.value as string)) return { ok: false, error: `"${status.value}" is not a work status in the list.` };
    const employer = text(e.employer, "Employer", false);
    if (!employer.ok) return employer;
    const title = text(e.title, "Job title", false);
    if (!title.ok) return title;
    const sector = text(e.sector, "Sector", false);
    if (!sector.ok) return sector;
    const when = dates(e, currentMonth, "Work");
    if (!when.ok) return when;
    out.push({ status: status.value as string, employer: employer.value, title: title.value, sector: sector.value, ...when.value });
  }
  return { ok: true, value: out };
}

/** Null (or an empty object) clears the residence. */
export function sanitizeResidence(input: unknown): Checked<Residence | null> {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== "object") return { ok: false, error: "The residence is not valid." };
  const r = input as Record<string, unknown>;
  if (!r.country && !r.region && !r.place) return { ok: true, value: null };
  const country = text(r.country, "Country", true);
  if (!country.ok) return country;
  const region = text(r.region, "Region or county", false);
  if (!region.ok) return region;
  const place = text(r.place, "Town or area", false);
  if (!place.ok) return place;
  return { ok: true, value: { country: country.value as string, region: region.value, place: place.value } };
}

// ---------------------------------------------------------------------
// Readable lines
// ---------------------------------------------------------------------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthLabel(m: string | null): string {
  const match = m ? MONTH_RE.exec(m) : null;
  return match ? `${MONTHS[Number(match[2]) - 1]} ${match[1]}` : "";
}

function period(start: string | null, end: string | null, current: boolean, nowWord: string): string {
  const s = monthLabel(start);
  const e = current ? nowWord : monthLabel(end);
  if (s && e) return `${s} to ${e}`;
  if (s) return `from ${s}`;
  if (e) return current ? e : `until ${e}`;
  return "";
}

export function describeEducation(e: EducationEntry): string {
  const when = period(e.startMonth, e.endMonth, e.current, "now");
  const what = e.course ? `${e.level}, ${e.course}` : e.level;
  return `${what} at ${e.institution}${when ? ` (${when})` : ""}`;
}

export function describeWork(w: WorkEntry): string {
  const when = period(w.startMonth, w.endMonth, w.current, "now");
  const role = [w.title, w.employer ? `at ${w.employer}` : null].filter(Boolean).join(" ");
  const lead = role || w.status;
  const extra = [role ? w.status : null, w.sector].filter(Boolean).join(", ");
  return `${lead}${extra ? ` (${extra})` : ""}${when ? `, ${when}` : ""}`;
}

export function describeResidence(r: Residence | null): string {
  if (!r) return "";
  return [r.place, r.region, r.country].filter(Boolean).join(", ");
}

/**
 * Names the family has already typed, offered as suggestions to the next person (most used first,
 * spelled the way most people spelled them). Only what the viewer can already see is passed in.
 */
export function collectSuggestions(people: { education?: EducationEntry[]; work?: WorkEntry[] }[]): { institutions: string[]; employers: string[]; titles: string[] } {
  const tally = (counts: Map<string, { text: string; n: number }>, raw: string | null | undefined) => {
    const text = (raw ?? "").trim().replace(/\s+/g, " ");
    if (!text) return;
    const key = text.toLowerCase();
    const entry = counts.get(key);
    if (entry) entry.n += 1;
    else counts.set(key, { text, n: 1 });
  };
  const institutions = new Map<string, { text: string; n: number }>();
  const employers = new Map<string, { text: string; n: number }>();
  const titles = new Map<string, { text: string; n: number }>();
  for (const p of people) {
    for (const e of p.education ?? []) tally(institutions, e.institution);
    for (const w of p.work ?? []) {
      tally(employers, w.employer);
      tally(titles, w.title);
    }
  }
  const rank = (m: Map<string, { text: string; n: number }>) =>
    [...m.values()].sort((a, b) => b.n - a.n || a.text.localeCompare(b.text, undefined, { sensitivity: "base" })).map((v) => v.text);
  return { institutions: rank(institutions), employers: rank(employers), titles: rank(titles) };
}
