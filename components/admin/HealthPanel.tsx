"use client";
// components/admin/HealthPanel.tsx
//
// The "Health" tab: is the app looking after itself? Green / amber /
// red checks in plain words, the schedule of the automatic texts, the
// recent runs of the daily job, and the backup and export downloads.

import { useEffect, useState } from "react";

type CheckStatus = "ok" | "warn" | "bad";
interface Check {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
}
interface Health {
  overall: CheckStatus;
  checks: Check[];
  schedule: { today: string; reminderDay: number; reportDay: number; nextReminder: string; nextReport: string; maxImportAgeDays: number };
  lastTexts: { reminder: { period: string; at: string } | null; report: { period: string; at: string } | null };
  runs: { startedAt: string; ok: boolean | null; details: unknown }[];
  canBackup: boolean;
}

const COLOR: Record<CheckStatus, string> = { ok: "var(--forest)", warn: "var(--ochre)", bad: "var(--danger)" };
const WORD: Record<CheckStatus, string> = { ok: "All good", warn: "Needs attention", bad: "Problem" };

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function day(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "long", year: "numeric" });
}
function runSummary(details: unknown): string {
  const d = details as {
    inReminderWindow?: boolean;
    inReportWindow?: boolean;
    reminders?: { sent?: number; held?: string } | null;
    report?: { sent?: number; held?: string } | null;
    error?: string | null;
  } | null;
  if (!d) return "";
  if (d.error) return d.error;
  const parts: string[] = [];
  if (d.reminders) parts.push(d.reminders.held ? "reminder held back" : `reminder: ${d.reminders.sent ?? 0} sent`);
  if (d.report) parts.push(d.report.held ? "report held back" : `report: ${d.report.sent ?? 0} sent`);
  return parts.length > 0 ? parts.join(", ") : "kept the database awake";
}

export default function HealthPanel() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/admin/health");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load the health checks.");
      setHealth(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the health checks.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!health) return <p className="text-sm text-ink-soft">Checking...</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg font-semibold">Health</h2>
          <p className="mt-1 text-sm text-ink-soft">Is the app looking after itself? Anything amber or red is worth a look.</p>
        </div>
        <button type="button" onClick={load} className="btn-secondary px-3 py-1 text-sm">
          Check again
        </button>
      </div>

      <div className="rounded-md border px-3 py-2 text-sm font-medium" style={{ borderColor: COLOR[health.overall], color: COLOR[health.overall] }}>
        {WORD[health.overall]}
      </div>

      <div className="paper-card overflow-hidden">
        {health.checks.map((c, i) => (
          <div key={c.key} className={`flex gap-3 px-4 py-3 text-sm ${i > 0 ? "border-t border-line" : ""}`}>
            <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLOR[c.status] }} aria-label={c.status} />
            <div>
              <p className="font-medium">{c.label}</p>
              <p className="text-ink-soft">{c.detail}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="paper-card space-y-1 p-4 text-sm">
        <h3 className="font-medium">Automatic texts</h3>
        <p className="text-ink-soft">
          Next reminder: <strong>{day(health.schedule.nextReminder)}</strong> (day {health.schedule.reminderDay} of each month).
        </p>
        <p className="text-ink-soft">
          Next fund report: <strong>{day(health.schedule.nextReport)}</strong> (day {health.schedule.reportDay} of each month).
        </p>
        <p className="text-ink-soft">
          Last reminder sent: {health.lastTexts.reminder ? `${when(health.lastTexts.reminder.at)} (for ${health.lastTexts.reminder.period})` : "never"}. Last report sent:{" "}
          {health.lastTexts.report ? `${when(health.lastTexts.report.at)} (for ${health.lastTexts.report.period})` : "never"}.
        </p>
        <p className="text-xs text-ink-soft">
          Import a statement a few days before each date so the texts use up-to-date payments (they wait if the data is more than{" "}
          {health.schedule.maxImportAgeDays} day(s) old).
        </p>
      </div>

      <div className="paper-card p-4 text-sm">
        <h3 className="font-medium">Backup and downloads</h3>
        {health.canBackup ? (
          <>
            <p className="mt-1 text-ink-soft">
              The free database plan keeps no backups you can download, so keep your own: take a full backup about once a month and
              store it somewhere safe (it contains phone numbers).
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <a href="/api/admin/export?type=backup" className="btn-primary px-4 py-1.5 text-sm" onClick={() => setTimeout(load, 2500)}>
                Download full backup
              </a>
              <a href="/api/admin/export?type=ledger" className="btn-secondary px-4 py-1.5 text-sm">
                Full ledger (spreadsheet)
              </a>
              <a href="/api/admin/export?type=members" className="btn-secondary px-4 py-1.5 text-sm">
                Member list (spreadsheet)
              </a>
            </div>
          </>
        ) : (
          <p className="mt-1 text-ink-soft">Backups and downloads contain personal details, so only the main admin login can make them.</p>
        )}
      </div>

      <div className="paper-card overflow-hidden">
        <h3 className="border-b border-line px-4 py-2 text-sm font-medium text-ink-soft">Recent runs of the daily job</h3>
        {health.runs.length === 0 && <p className="p-4 text-sm text-ink-soft">It has not run yet.</p>}
        {health.runs.map((r, i) => (
          <div key={i} className={`flex items-center justify-between gap-3 px-4 py-2 text-xs ${i > 0 ? "border-t border-line" : ""}`}>
            <span>{when(r.startedAt)}</span>
            <span className="text-ink-soft">{runSummary(r.details)}</span>
            <span style={{ color: r.ok === false ? "var(--danger)" : "var(--forest)" }}>{r.ok === false ? "failed" : "ok"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
