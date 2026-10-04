"use client";
// components/admin/Reminders.tsx

import { useEffect, useState } from "react";

interface RunResult {
  ok: boolean;
  today: string;
  period: string;
  inReminderWindow: boolean;
  reminders: { candidateCount: number; sent: number; skipped: number; failed: number } | null;
  error: string | null;
}
interface LogRow {
  id: string;
  kind: string;
  period: string;
  to_phone: string | null;
  message: string;
  status: string;
  error: string | null;
  created_at: string;
  members: { full_name: string } | null;
}

const STATUS_COLOR: Record<string, string> = {
  sent: "var(--forest)",
  dry_run: "var(--steel)",
  failed: "var(--danger)",
  skipped: "var(--ink-soft)",
};

export default function Reminders() {
  const [log, setLog] = useState<LogRow[]>([]);
  const [loadingLog, setLoadingLog] = useState(true);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadLog() {
    setLoadingLog(true);
    try {
      const res = await fetch("/api/admin/sms-log");
      const data = await res.json();
      if (res.ok) setLog(data.log ?? []);
    } finally {
      setLoadingLog(false);
    }
  }

  useEffect(() => {
    loadLog();
  }, []);

  async function handleRunNow() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/cron/daily");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not run the job.");
      setLastRun(data);
      await loadLog();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not run the job.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-lg font-semibold">Reminders</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Runs automatically once a day. &quot;Run now&quot; triggers the same job manually — safe to click
          any time; while live sending is off, it only logs what it would do.
        </p>
      </div>

      <div className="paper-card space-y-3 p-4">
        <button onClick={handleRunNow} disabled={running} className="btn-primary px-4 py-1.5 text-sm">
          {running ? "Running..." : "Run now"}
        </button>
        {error && <p className="text-sm text-danger">{error}</p>}
        {lastRun && (
          <div className="text-sm">
            <p>
              {lastRun.today} ({lastRun.period}) &middot; reminder window: {lastRun.inReminderWindow ? "yes" : "not today"}
            </p>
            {lastRun.reminders && (
              <p className="mt-1 text-ink-soft">
                {lastRun.reminders.candidateCount} owe money &middot; {lastRun.reminders.sent} sent/dry-run &middot;{" "}
                {lastRun.reminders.skipped} already sent this period &middot; {lastRun.reminders.failed} failed
              </p>
            )}
            {!lastRun.inReminderWindow && <p className="mt-1 text-ink-soft">Not in the reminder window today — nothing to send.</p>}
          </div>
        )}
      </div>

      <div className="paper-card overflow-hidden">
        <h3 className="border-b border-line px-4 py-2 text-sm font-medium text-ink-soft">Recent messages</h3>
        {loadingLog && <p className="p-4 text-sm text-ink-soft">Loading...</p>}
        {!loadingLog && log.length === 0 && <p className="p-4 text-sm text-ink-soft">Nothing sent yet.</p>}
        <div className="max-h-96 overflow-y-auto">
          {log.map((row, i) => (
            <div key={row.id} className={`px-4 py-2 text-xs ${i > 0 ? "border-t border-line" : ""}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">{row.members?.full_name ?? row.to_phone ?? "?"}</span>
                <span style={{ color: STATUS_COLOR[row.status] ?? "var(--ink-soft)" }}>{row.status}</span>
              </div>
              <p className="text-ink-soft">{row.message}</p>
              {row.error && <p className="text-danger">{row.error}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
