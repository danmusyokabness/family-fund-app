"use client";
// components/admin/Reminders.tsx
//
// The "Reminders" tab: the 7th-of-the-month arrears reminder and the
// 15th-of-the-month fund report. For each one it shows who would be
// texted what BEFORE anything is sent, lets the admin untick people,
// and asks for confirmation. The same messages go out automatically on
// the scheduled day; this screen is for sending one by hand (for example
// when the day has already passed) and for checking the wording.

import { useCallback, useEffect, useState } from "react";

type Kind = "reminder" | "report";
type PlanStatus = "ready" | "already_sent" | "no_phone" | "no_balance_due" | "pending_confirmation";

interface PlannedMessage {
  memberId: string;
  fullName: string;
  phone: string | null;
  message: string;
  segments: number;
  balance: number;
  status: PlanStatus;
}
interface Plan {
  kind: Kind;
  period: string;
  today: string;
  scheduledDay: number;
  template: string;
  live: boolean;
  liveNote: string;
  messages: PlannedMessage[];
  counts: Record<PlanStatus, number>;
  totalSegments: number;
  dataFreshness: { lastUpdatedAt: string | null; ageDays: number | null; maxAgeDays: number; stale: boolean };
}
interface SendSummary {
  kind: Kind;
  period: string;
  attempted: number;
  sent: number;
  dryRun: boolean;
  failed: number;
  failures: { fullName: string; error: string }[];
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

const STATUS_LABEL: Record<PlanStatus, string> = {
  ready: "ready",
  already_sent: "already sent this month",
  no_phone: "no phone number",
  no_balance_due: "owes nothing",
  pending_confirmation: "payment awaiting confirmation: not texted",
};

const KIND_INFO: Record<Kind, { title: string; what: string }> = {
  reminder: {
    title: "Arrears reminder",
    what: "Sent to members who owe money. Members with a payment still waiting for your confirmation are skipped, because their balance may be wrong.",
  },
  report: {
    title: "Fund report",
    what: "Sent to every member with a phone: money collected this month, the total in the account, and their own balance. Other members are never named.",
  },
};

export default function Reminders() {
  const [kind, setKind] = useState<Kind>("reminder");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [summary, setSummary] = useState<SendSummary | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);

  const loadLog = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/sms-log");
      const data = await res.json();
      if (res.ok) setLog(data.log ?? []);
    } catch {
      /* the log is a convenience; ignore */
    }
  }, []);

  const loadPlan = useCallback(async (k: Kind) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/messages?kind=${k}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not prepare the messages.");
      const loaded: Plan = data.plan;
      setPlan(loaded);
      setSelected(new Set(loaded.messages.filter((m) => m.status === "ready").map((m) => m.memberId)));
    } catch (err) {
      setPlan(null);
      setError(err instanceof Error ? err.message : "Could not prepare the messages.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlan(kind);
    loadLog();
  }, [kind, loadPlan, loadLog]);

  function switchKind(k: Kind) {
    setSummary(null);
    setKind(k);
  }

  function toggle(memberId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  async function handleSend() {
    if (!plan || selected.size === 0) return;
    const chosen = plan.messages.filter((m) => m.status === "ready" && selected.has(m.memberId));
    const segments = chosen.reduce((n, m) => n + m.segments, 0);
    const warning = plan.live
      ? `Send ${chosen.length} real text message(s) now (about ${segments} SMS in total)? Real messages cannot be taken back.`
      : `Live sending is OFF. Record a DRY RUN for ${chosen.length} message(s)? Nothing will actually be sent.`;
    if (!window.confirm(warning)) return;

    setSending(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch("/api/admin/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, memberIds: chosen.map((m) => m.memberId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sending failed.");
      setSummary(data.summary);
      await Promise.all([loadPlan(kind), loadLog()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sending failed.");
    } finally {
      setSending(false);
    }
  }

  const listed = plan?.messages.filter((m) => m.status !== "no_balance_due") ?? [];
  const readyCount = plan?.messages.filter((m) => m.status === "ready" && selected.has(m.memberId)).length ?? 0;
  const chosenSegments =
    plan?.messages.filter((m) => m.status === "ready" && selected.has(m.memberId)).reduce((n, m) => n + m.segments, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-lg font-semibold">Reminders and reports</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Both go out by themselves: the reminder on the 7th and the report on the 15th of each month (a missed day is
          caught up over the next two days, and nobody is ever texted twice in a month). Use this screen to check the
          messages, or to send one by hand when the day has already passed.
        </p>
      </div>

      <div className="flex gap-2">
        {(["reminder", "report"] as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => switchKind(k)}
            className={kind === k ? "btn-primary px-4 py-1.5 text-sm" : "btn-secondary px-4 py-1.5 text-sm"}
          >
            {k === "reminder" ? "7th reminder" : "15th report"}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {loading && <p className="text-sm text-ink-soft">Preparing the messages...</p>}

      {plan && !loading && (
        <>
          <div
            className="rounded-md border px-3 py-2 text-sm"
            style={
              plan.live
                ? { borderColor: "var(--forest)", background: "var(--forest-soft)", color: "var(--forest)" }
                : { borderColor: "var(--ochre)", background: "var(--paper)", color: "var(--ochre)" }
            }
          >
            {plan.liveNote}
          </div>

          <div
            className="rounded-md border px-3 py-2 text-sm"
            style={
              plan.dataFreshness.stale
                ? { borderColor: "var(--ochre)", background: "var(--paper)", color: "var(--ochre)" }
                : { borderColor: "var(--line)", color: "var(--ink-soft)" }
            }
          >
            {plan.dataFreshness.ageDays === null ? (
              <>No statement has been imported yet.</>
            ) : (
              <>
                Payment data was last updated{" "}
                {plan.dataFreshness.ageDays === 0 ? "today" : `${plan.dataFreshness.ageDays} day(s) ago`} (the latest statement import).
              </>
            )}
            {plan.dataFreshness.stale && (
              <>
                {" "}
                <strong>The automatic text will wait</strong> until you import a newer statement (limit: {plan.dataFreshness.maxAgeDays} day(s), changeable in
                Setup). You can still send by hand below, but anyone who has paid since then would be reminded wrongly.
              </>
            )}
          </div>

          <div className="paper-card space-y-2 p-4 text-sm">
            <p className="font-medium">{KIND_INFO[kind].title}</p>
            <p className="text-ink-soft">{KIND_INFO[kind].what}</p>
            <p className="text-ink-soft">
              Automatic day: <strong>{plan.scheduledDay}</strong> of each month (about 08:00 Nairobi time). Today is {plan.today}; this
              sends for <strong>{plan.period}</strong>. If the statement was imported a while ago, import the latest one first, or people
              who have already paid may be texted.
            </p>
            <div>
              <p className="text-xs text-ink-soft">Wording (change it in the Setup tab):</p>
              <p className="mt-1 rounded-md border border-line bg-paper px-3 py-2 text-xs">{plan.template}</p>
            </div>
          </div>

          <div className="paper-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2 text-sm">
              <span className="text-ink-soft">
                {plan.counts.ready} ready &middot; {plan.counts.already_sent} already sent &middot;{" "}
                {plan.counts.pending_confirmation} awaiting confirmation &middot; {plan.counts.no_phone} no phone
                {kind === "reminder" && <> &middot; {plan.counts.no_balance_due} owe nothing</>}
              </span>
              {plan.counts.ready > 0 && (
                <span className="flex gap-3 text-xs">
                  <button type="button" className="underline" onClick={() => setSelected(new Set(plan.messages.filter((m) => m.status === "ready").map((m) => m.memberId)))}>
                    Select all
                  </button>
                  <button type="button" className="underline" onClick={() => setSelected(new Set())}>
                    Select none
                  </button>
                </span>
              )}
            </div>

            {listed.length === 0 && <p className="p-4 text-sm text-ink-soft">Nobody needs this message right now.</p>}
            <div className="max-h-[28rem] overflow-y-auto">
              {listed.map((m, i) => (
                <label key={m.memberId} className={`flex gap-3 px-4 py-2 text-sm ${i > 0 ? "border-t border-line" : ""} ${m.status === "ready" ? "cursor-pointer" : "opacity-60"}`}>
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={m.status !== "ready"}
                    checked={m.status === "ready" && selected.has(m.memberId)}
                    onChange={() => toggle(m.memberId)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {m.fullName} {m.phone && <span className="text-xs font-normal text-ink-soft">{m.phone}</span>}
                      </span>
                      <span className="text-xs" style={{ color: m.status === "ready" ? "var(--forest)" : "var(--ink-soft)" }}>
                        {STATUS_LABEL[m.status]}
                      </span>
                    </span>
                    {m.message && (
                      <span className="mt-0.5 block text-xs text-ink-soft">
                        {m.message} <span className="whitespace-nowrap">({m.segments} SMS)</span>
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
              <button type="button" onClick={handleSend} disabled={sending || readyCount === 0} className="btn-primary px-4 py-1.5 text-sm">
                {sending ? "Sending..." : plan.live ? `Send ${readyCount} text(s) now` : `Record dry run for ${readyCount}`}
              </button>
              <span className="text-xs text-ink-soft">
                {readyCount} selected &middot; about {chosenSegments} SMS
              </span>
            </div>
          </div>

          {summary && (
            <div
              className="rounded-md border px-3 py-2 text-sm"
              style={summary.failed > 0 ? { borderColor: "var(--danger)", color: "var(--danger)" } : { borderColor: "var(--forest)", background: "var(--forest-soft)", color: "var(--forest)" }}
            >
              {summary.dryRun ? "Dry run recorded for" : "Sent to"} {summary.sent} of {summary.attempted} member(s)
              {summary.failed > 0 && <>, {summary.failed} failed</>}.
              {summary.failures.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {summary.failures.map((f, i) => (
                    <li key={i}>
                      {f.fullName}: {f.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      <div className="paper-card overflow-hidden">
        <h3 className="border-b border-line px-4 py-2 text-sm font-medium text-ink-soft">Recent messages</h3>
        {log.length === 0 && <p className="p-4 text-sm text-ink-soft">Nothing sent yet.</p>}
        <div className="max-h-96 overflow-y-auto">
          {log.map((row, i) => (
            <div key={row.id} className={`px-4 py-2 text-xs ${i > 0 ? "border-t border-line" : ""}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {row.members?.full_name ?? row.to_phone ?? "?"} <span className="font-normal text-ink-soft">&middot; {row.kind} &middot; {row.period}</span>
                </span>
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
