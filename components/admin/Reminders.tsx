"use client";
// components/admin/Reminders.tsx
//
// The "Reminders" tab: the monthly arrears reminder and the monthly fund
// report. For each one it lists who should get what, with the exact wording,
// and a WhatsApp button that opens WhatsApp with that member's message ready
// to send. The app sends nothing by itself (no text-message provider).

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
  messages: PlannedMessage[];
  counts: Record<PlanStatus, number>;
  dataFreshness: { lastUpdatedAt: string | null; ageDays: number | null; maxAgeDays: number; stale: boolean };
}

const STATUS_LABEL: Record<PlanStatus, string> = {
  ready: "ready to send",
  already_sent: "already sent this month",
  no_phone: "no phone number",
  no_balance_due: "owes nothing",
  pending_confirmation: "payment awaiting confirmation: not reminded",
};

const KIND_INFO: Record<Kind, { title: string; what: string }> = {
  reminder: {
    title: "Arrears reminder",
    what: "For members who owe money. Members with a payment still waiting for your confirmation are skipped, because their balance may be wrong.",
  },
  report: {
    title: "Fund report",
    what: "For every member with a phone: money collected this month, the total in the account, and their own balance. Other members are never named.",
  },
};

export default function Reminders() {
  const [kind, setKind] = useState<Kind>("reminder");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const loadPlan = useCallback(async (k: Kind) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/messages?kind=${k}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not prepare the messages.");
      setPlan(data.plan as Plan);
    } catch (err) {
      setPlan(null);
      setError(err instanceof Error ? err.message : "Could not prepare the messages.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlan(kind);
  }, [kind, loadPlan]);

  async function copy(memberId: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(memberId);
      setTimeout(() => setCopied((c) => (c === memberId ? null : c)), 2000);
    } catch {
      /* copying is a convenience; ignore */
    }
  }

  const listed = plan?.messages.filter((m) => m.status !== "no_balance_due") ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-lg font-semibold">Reminders and reports</h2>
        <p className="mt-1 text-sm text-ink-soft">
          The app does not send messages by itself. Here is who should get the monthly reminder (around the 7th) and report (around the 15th), with the
          wording ready. Press <strong>WhatsApp</strong> on a member to open WhatsApp with their message filled in, then press send.
        </p>
      </div>

      <div className="flex gap-2">
        {(["reminder", "report"] as Kind[]).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={kind === k ? "btn-primary px-4 py-1.5 text-sm" : "btn-secondary px-4 py-1.5 text-sm"}>
            {k === "reminder" ? "Reminder" : "Fund report"}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {loading && <p className="text-sm text-ink-soft">Preparing the messages...</p>}

      {plan && !loading && (
        <>
          <div
            className="rounded-md border px-3 py-2 text-sm"
            style={plan.dataFreshness.stale ? { borderColor: "var(--ochre)", background: "var(--paper)", color: "var(--ochre)" } : { borderColor: "var(--line)", color: "var(--ink-soft)" }}
          >
            {plan.dataFreshness.ageDays === null ? (
              <>No statement has been imported yet.</>
            ) : (
              <>
                Payment data was last updated {plan.dataFreshness.ageDays === 0 ? "today" : `${plan.dataFreshness.ageDays} day(s) ago`} (the latest statement import).
              </>
            )}
            {plan.dataFreshness.stale && (
              <>
                {" "}
                <strong>Import the latest statement first</strong>, or anyone who has paid since then would be reminded wrongly.
              </>
            )}
          </div>

          <div className="paper-card space-y-2 p-4 text-sm">
            <p className="font-medium">{KIND_INFO[kind].title}</p>
            <p className="text-ink-soft">{KIND_INFO[kind].what}</p>
            <p className="text-ink-soft">
              Usual day: <strong>{plan.scheduledDay}</strong> of each month. Today is {plan.today}; this is for <strong>{plan.period}</strong>.
            </p>
            <div>
              <p className="text-xs text-ink-soft">Wording (change it in the Setup tab):</p>
              <p className="mt-1 rounded-md border border-line bg-paper px-3 py-2 text-xs">{plan.template}</p>
            </div>
          </div>

          <div className="paper-card overflow-hidden">
            <div className="border-b border-line px-4 py-2 text-sm text-ink-soft">
              {plan.counts.ready} ready &middot; {plan.counts.already_sent} already sent &middot; {plan.counts.pending_confirmation} awaiting confirmation &middot;{" "}
              {plan.counts.no_phone} no phone
              {kind === "reminder" && <> &middot; {plan.counts.no_balance_due} owe nothing</>}
            </div>

            {listed.length === 0 && <p className="p-4 text-sm text-ink-soft">Nobody needs this message right now.</p>}
            <div className="max-h-[32rem] overflow-y-auto">
              {listed.map((m, i) => (
                <div key={m.memberId} className={`px-4 py-2 text-sm ${i > 0 ? "border-t border-line" : ""} ${m.status === "ready" ? "" : "opacity-60"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {m.fullName} {m.phone && <span className="text-xs font-normal text-ink-soft">{m.phone}</span>}
                    </span>
                    <span className="flex items-center gap-3 text-xs">
                      {m.status === "ready" && m.phone && (
                        <>
                          <a
                            href={`https://wa.me/${m.phone}?text=${encodeURIComponent(m.message)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="btn-secondary px-3 py-1"
                            title="Opens WhatsApp with this message ready to send"
                          >
                            WhatsApp
                          </a>
                          <button type="button" className="underline" onClick={() => copy(m.memberId, m.message)}>
                            {copied === m.memberId ? "Copied" : "Copy text"}
                          </button>
                        </>
                      )}
                      <span style={{ color: m.status === "ready" ? "var(--forest)" : "var(--ink-soft)" }}>{STATUS_LABEL[m.status]}</span>
                    </span>
                  </div>
                  {m.message && <p className="mt-0.5 text-xs text-ink-soft">{m.message}</p>}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
