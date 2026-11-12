"use client";
// components/ProfileFields.tsx
//
// The three small forms for what a person tells the family about themselves:
// where they studied, where they work and where they live. Used on the
// first-visit details form and when editing a person. Every list is only a
// suggestion: anything can be typed, so nobody is ever stuck.

import { COUNTRIES, DEFAULT_COUNTRY, regionsFor } from "@/lib/data/places";
import { EDUCATION_LEVELS, INSTITUTIONS, JOB_TITLES, SECTORS, WORK_STATUSES } from "@/lib/data/careers";
import { MAX_ENTRIES, type EducationEntry, type Residence, type WorkEntry } from "@/lib/profile";

const input = "w-full rounded-md border border-line px-3 py-2 text-sm";

/** What the family has already typed comes first, then the built-in list, with no repeats (ignoring capitals). */
function merged(family: string[] | undefined, builtIn: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [...(family ?? []), ...builtIn]) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function emptyEducation(): EducationEntry {
  return { level: EDUCATION_LEVELS[0], institution: "", course: null, startMonth: null, endMonth: null, current: false };
}
export function emptyWork(): WorkEntry {
  return { status: WORK_STATUSES[0], employer: null, title: null, sector: null, startMonth: null, endMonth: null, current: true };
}

/** "Show to the family" tick for one hideable detail. */
export function ShowToFamily({ field, hidden, onToggle }: { field: string; hidden: Set<string>; onToggle: (field: string) => void }) {
  return (
    <label className="mt-1 flex items-center gap-1.5 text-xs text-ink-soft">
      <input type="checkbox" checked={!hidden.has(field)} onChange={() => onToggle(field)} />
      Show to the family
    </label>
  );
}

function Months({
  start,
  end,
  current,
  currentLabel,
  onChange,
}: {
  start: string | null;
  end: string | null;
  current: boolean;
  currentLabel: string;
  onChange: (next: { startMonth: string | null; endMonth: string | null; current: boolean }) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="block text-xs text-ink-soft">
        From (month)
        <input type="month" value={start ?? ""} onChange={(e) => onChange({ startMonth: e.target.value || null, endMonth: end, current })} className={input} />
      </label>
      <label className="block text-xs text-ink-soft">
        To (month)
        <input
          type="month"
          value={current ? "" : end ?? ""}
          disabled={current}
          onChange={(e) => onChange({ startMonth: start, endMonth: e.target.value || null, current })}
          className={input}
        />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-ink-soft sm:col-span-2">
        <input type="checkbox" checked={current} onChange={(e) => onChange({ startMonth: start, endMonth: e.target.checked ? null : end, current: e.target.checked })} />
        {currentLabel}
      </label>
    </div>
  );
}

export function EducationEditor({ value, onChange, institutions }: { value: EducationEntry[]; onChange: (next: EducationEntry[]) => void; institutions?: string[] }) {
  const update = (i: number, patch: Partial<EducationEntry>) => onChange(value.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  return (
    <div className="space-y-2">
      <datalist id="institution-suggestions">
        {merged(institutions, INSTITUTIONS).map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {value.map((e, i) => (
        <div key={i} className="space-y-2 rounded-md border border-line p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-xs text-ink-soft">
              Level
              <select value={e.level} onChange={(ev) => update(i, { level: ev.target.value })} className={input}>
                {EDUCATION_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-ink-soft">
              School or institution
              <input value={e.institution} list="institution-suggestions" onChange={(ev) => update(i, { institution: ev.target.value })} className={input} />
            </label>
          </div>
          <label className="block text-xs text-ink-soft">
            Course (optional)
            <input value={e.course ?? ""} onChange={(ev) => update(i, { course: ev.target.value || null })} placeholder="for example: BSc Computer Science" className={input} />
          </label>
          <Months
            start={e.startMonth}
            end={e.endMonth}
            current={e.current}
            currentLabel="Still studying here"
            onChange={(m) => update(i, m)}
          />
          <button type="button" className="text-xs text-ink-soft underline" onClick={() => onChange(value.filter((_, idx) => idx !== i))}>
            Remove this one
          </button>
        </div>
      ))}
      {value.length < MAX_ENTRIES && (
        <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => onChange([...value, emptyEducation()])}>
          + Add education
        </button>
      )}
    </div>
  );
}

export function WorkEditor({ value, onChange, employers, titles }: { value: WorkEntry[]; onChange: (next: WorkEntry[]) => void; employers?: string[]; titles?: string[] }) {
  const update = (i: number, patch: Partial<WorkEntry>) => onChange(value.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  return (
    <div className="space-y-2">
      <datalist id="employer-suggestions">
        {merged(employers, []).map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <datalist id="job-title-suggestions">
        {merged(titles, JOB_TITLES).map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {value.map((w, i) => (
        <div key={i} className="space-y-2 rounded-md border border-line p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-xs text-ink-soft">
              Status
              <select value={w.status} onChange={(ev) => update(i, { status: ev.target.value })} className={input}>
                {WORK_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-ink-soft">
              Sector (optional)
              <select value={w.sector ?? ""} onChange={(ev) => update(i, { sector: ev.target.value || null })} className={input}>
                <option value="">(not stated)</option>
                {SECTORS.map((sector) => (
                  <option key={sector} value={sector}>
                    {sector}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-ink-soft">
              Job title (optional)
              <input value={w.title ?? ""} list="job-title-suggestions" onChange={(ev) => update(i, { title: ev.target.value || null })} className={input} />
            </label>
            <label className="block text-xs text-ink-soft">
              Employer or business (optional)
              <input value={w.employer ?? ""} list="employer-suggestions" onChange={(ev) => update(i, { employer: ev.target.value || null })} className={input} />
            </label>
          </div>
          <Months start={w.startMonth} end={w.endMonth} current={w.current} currentLabel="Still doing this" onChange={(m) => update(i, m)} />
          <button type="button" className="text-xs text-ink-soft underline" onClick={() => onChange(value.filter((_, idx) => idx !== i))}>
            Remove this one
          </button>
        </div>
      ))}
      {value.length < MAX_ENTRIES && (
        <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => onChange([...value, emptyWork()])}>
          + Add work
        </button>
      )}
    </div>
  );
}

export function ResidenceEditor({ value, onChange }: { value: Residence | null; onChange: (next: Residence | null) => void }) {
  const current: Residence = value ?? { country: DEFAULT_COUNTRY, region: null, place: null };
  const counties = regionsFor(current.country);
  const set = (patch: Partial<Residence>) => onChange({ ...current, ...patch });
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <label className="block text-xs text-ink-soft">
        Country
        <select value={current.country} onChange={(e) => set({ country: e.target.value, region: null })} className={input}>
          {COUNTRIES.map((country) => (
            <option key={country} value={country}>
              {country}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-ink-soft">
        {counties.length > 0 ? "County" : "Region or state"}
        {counties.length > 0 ? (
          <select value={current.region ?? ""} onChange={(e) => set({ region: e.target.value || null })} className={input}>
            <option value="">(choose)</option>
            {counties.map((county) => (
              <option key={county} value={county}>
                {county}
              </option>
            ))}
          </select>
        ) : (
          <input value={current.region ?? ""} onChange={(e) => set({ region: e.target.value || null })} className={input} />
        )}
      </label>
      <label className="block text-xs text-ink-soft">
        Town or area
        <input value={current.place ?? ""} onChange={(e) => set({ place: e.target.value || null })} className={input} />
      </label>
      {value && (
        <button type="button" className="text-left text-xs text-ink-soft underline sm:col-span-3" onClick={() => onChange(null)}>
          Clear where I live
        </button>
      )}
    </div>
  );
}

/** An "Add education" row the person never filled in is left out, rather than blocking the save. */
export function dropBlankEducation(list: EducationEntry[]): EducationEntry[] {
  return list.filter((e) => e.institution.trim() !== "" || (e.course ?? "").trim() !== "" || e.startMonth || e.endMonth);
}
/** Same for work: a row with only the default status chosen is left out. */
export function dropBlankWork(list: WorkEntry[]): WorkEntry[] {
  return list.filter((w) => (w.employer ?? "").trim() !== "" || (w.title ?? "").trim() !== "" || w.sector || w.startMonth || w.endMonth);
}
