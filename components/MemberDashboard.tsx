"use client";
// components/MemberDashboard.tsx

import { useEffect, useState } from "react";
import type { DashboardResult, CellStatus } from "@/lib/dashboard";

type ApiResult = DashboardResult & { fundName: string; tillNumber: string };

const CELL_BG: Record<CellStatus, string> = {
  paid: "var(--forest-soft)",
  prepaid: "var(--steel-soft)",
  partial: "var(--ochre-soft)",
  unpaid: "var(--ochre-soft)",
  before_joining: "transparent",
  future: "transparent",
};
const CELL_TEXT: Record<CellStatus, string> = {
  paid: "var(--forest)",
  prepaid: "var(--steel)",
  partial: "var(--ochre)",
  unpaid: "var(--ochre)",
  before_joining: "var(--line)",
  future: "var(--line)",
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatMonthShort(monthKey: string): string {
  const m = Number(monthKey.split("-")[1]);
  return MONTH_NAMES[m - 1] ?? monthKey;
}
function money(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function MemberDashboard() {
  const [data, setData] = useState<ApiResult | null>(null);
  const [selectedFy, setSelectedFy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const qs = selectedFy ? `?fy=${selectedFy}` : "";
    fetch(`/api/dashboard${qs}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Could not load the dashboard.");
        return body as ApiResult;
      })
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the dashboard."))
      .finally(() => setLoading(false));
  }, [selectedFy]);

  if (loading && !data) return <p className="text-sm text-ink-soft">Loading...</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* ---- Stat row ---- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {data.me && (
          <>
            <div className="paper-card p-4">
              <p className="text-xs text-ink-soft">My balance</p>
              <p className="figures font-serif text-2xl font-semibold" style={{ color: data.me.balance > 0 ? "var(--ochre)" : "var(--forest)" }}>
                KES {money(data.me.balance)}
              </p>
              {data.me.balance > 0 && data.me.unpaidSummary && <p className="mt-0.5 text-xs text-ink-soft">{data.me.unpaidSummary}</p>}
              {data.me.credit > 0 && <p className="mt-0.5 text-xs" style={{ color: "var(--steel)" }}>KES {money(data.me.credit)} credit ahead</p>}
            </div>
            <div className="paper-card p-4">
              <p className="text-xs text-ink-soft">My total, {data.fy.label}</p>
              <p className="figures font-serif text-2xl font-semibold">KES {money(data.me.fyContributed)}</p>
            </div>
          </>
        )}
        <div className="paper-card p-4">
          <p className="text-xs text-ink-soft">Group total this month</p>
          <p className="figures font-serif text-2xl font-semibold">KES {money(data.group.monthCollected)}</p>
        </div>
        <div className="paper-card p-4">
          <p className="text-xs text-ink-soft">Total in account</p>
          <p className="figures font-serif text-2xl font-semibold">KES {money(data.group.fundTotal)}</p>
        </div>
      </div>

      {/* ---- Ledger ---- */}
      <div className="paper-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-serif text-lg font-semibold">Ledger</h2>
          <select
            value={selectedFy ?? data.fy.startMonth}
            onChange={(e) => setSelectedFy(e.target.value)}
            className="px-2 py-1 text-sm"
          >
            {data.fyOptions.map((opt) => (
              <option key={opt.startMonth} value={opt.startMonth}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-soft">
                <th className="sticky left-0 z-10 bg-surface px-4 py-2 font-medium">Member</th>
                {data.months.map((m) => (
                  <th key={m} className="px-2 py-2 text-center font-medium">{formatMonthShort(m)}</th>
                ))}
                <th className="border-l border-line px-3 py-2 text-right font-medium">B/F</th>
                <th className="px-3 py-2 text-right font-medium">{data.fy.label}</th>
                <th className="px-3 py-2 text-right font-medium">All-time</th>
                <th className="px-3 py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr
                  key={row.memberId}
                  className="border-b border-line last:border-0"
                  style={{ background: row.isMe ? "var(--brass-soft)" : i % 2 === 1 ? "var(--paper)" : "transparent" }}
                >
                  <td className={`sticky left-0 z-10 whitespace-nowrap px-4 py-2 ${row.isMe ? "font-semibold" : ""}`} style={{ background: row.isMe ? "var(--brass-soft)" : i % 2 === 1 ? "var(--paper)" : "var(--surface)" }}>
                    {row.fullName}
                  </td>
                  {row.cells.map((cell, ci) => (
                    <td key={ci} className="figures px-2 py-2 text-center" style={{ background: CELL_BG[cell.status], color: CELL_TEXT[cell.status] }}>
                      {cell.paid > 0 ? money(cell.paid) : ""}
                    </td>
                  ))}
                  <td className="figures border-l border-line px-3 py-2 text-right text-ink-soft">{row.broughtForward > 0 ? money(row.broughtForward) : ""}</td>
                  <td className="figures px-3 py-2 text-right">{money(row.fyTotal)}</td>
                  <td className="figures px-3 py-2 text-right">{money(row.allTimeTotal)}</td>
                  <td className="figures px-3 py-2 text-right font-medium" style={{ color: row.balance > 0 ? "var(--ochre)" : "var(--forest)" }}>
                    {money(row.balance)}
                  </td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={data.months.length + 5} className="px-4 py-6 text-center text-ink-soft">No members yet.</td>
                </tr>
              )}
            </tbody>
            {data.rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-line font-medium">
                  <td className="sticky left-0 z-10 bg-surface px-4 py-2">Total</td>
                  {data.columnTotals.map((t, i) => (
                    <td key={i} className="figures px-2 py-2 text-center">{t > 0 ? money(t) : ""}</td>
                  ))}
                  <td colSpan={4} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="flex flex-wrap gap-4 border-t border-line px-4 py-3 text-xs text-ink-soft">
          <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: "var(--forest-soft)" }} /> Paid</span>
          <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: "var(--ochre-soft)" }} /> Unpaid / partial</span>
          <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: "var(--steel-soft)" }} /> Prepaid ahead</span>
        </div>
      </div>
    </div>
  );
}
