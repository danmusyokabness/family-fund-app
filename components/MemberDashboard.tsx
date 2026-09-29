"use client";
// components/MemberDashboard.tsx

import { useEffect, useState } from "react";
import type { DashboardResult, CellStatus } from "@/lib/dashboard";

type ApiResult = DashboardResult & { fundName: string; tillNumber: string };

const CELL_STYLES: Record<CellStatus, string> = {
  paid: "bg-green-100 text-green-800",
  prepaid: "bg-blue-100 text-blue-800",
  partial: "bg-amber-100 text-amber-800",
  unpaid: "bg-amber-200 text-amber-900",
  before_joining: "bg-slate-50 text-slate-300",
  future: "bg-slate-50 text-slate-300",
};

function formatMonthShort(monthKey: string): string {
  const [, m] = monthKey.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return names[Number(m) - 1] ?? monthKey;
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

  if (loading && !data) return <p className="text-sm text-slate-500">Loading...</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      {/* ---- Cards ---- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {data.me && (
          <>
            <div className="rounded-xl bg-white p-4 shadow">
              <p className="text-xs text-slate-500">My balance</p>
              <p className={`text-xl font-bold ${data.me.balance > 0 ? "text-amber-700" : "text-green-700"}`}>
                KES {money(data.me.balance)}
              </p>
              {data.me.balance > 0 && data.me.unpaidSummary && (
                <p className="mt-0.5 text-xs text-slate-400">{data.me.unpaidSummary}</p>
              )}
              {data.me.credit > 0 && <p className="mt-0.5 text-xs text-blue-600">KES {money(data.me.credit)} credit ahead</p>}
            </div>
            <div className="rounded-xl bg-white p-4 shadow">
              <p className="text-xs text-slate-500">My total this {data.fy.label}</p>
              <p className="text-xl font-bold text-slate-800">KES {money(data.me.fyContributed)}</p>
            </div>
          </>
        )}
        <div className="rounded-xl bg-white p-4 shadow">
          <p className="text-xs text-slate-500">Group total this month</p>
          <p className="text-xl font-bold text-slate-800">KES {money(data.group.monthCollected)}</p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow">
          <p className="text-xs text-slate-500">Total in account</p>
          <p className="text-xl font-bold text-slate-800">KES {money(data.group.fundTotal)}</p>
        </div>
      </div>

      {/* ---- Ledger ---- */}
      <div className="rounded-xl bg-white p-4 shadow">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">Ledger</h2>
          <select
            value={selectedFy ?? data.fy.startMonth}
            onChange={(e) => setSelectedFy(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            {data.fyOptions.map((opt) => (
              <option key={opt.startMonth} value={opt.startMonth}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="sticky left-0 bg-white px-2 py-1">Member</th>
                {data.months.map((m) => (
                  <th key={m} className="px-1 py-1 text-center">{formatMonthShort(m)}</th>
                ))}
                <th className="px-2 py-1 text-right">B/F</th>
                <th className="px-2 py-1 text-right">{data.fy.label} total</th>
                <th className="px-2 py-1 text-right">All-time</th>
                <th className="px-2 py-1 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.memberId} className={row.isMe ? "bg-slate-50 font-medium" : ""}>
                  <td className="sticky left-0 whitespace-nowrap bg-inherit px-2 py-1">{row.fullName}</td>
                  {row.cells.map((cell, i) => (
                    <td key={i} className={`px-1 py-1 text-center ${CELL_STYLES[cell.status]}`}>
                      {cell.paid > 0 ? money(cell.paid) : ""}
                    </td>
                  ))}
                  <td className="px-2 py-1 text-right">{row.broughtForward > 0 ? money(row.broughtForward) : ""}</td>
                  <td className="px-2 py-1 text-right">{money(row.fyTotal)}</td>
                  <td className="px-2 py-1 text-right">{money(row.allTimeTotal)}</td>
                  <td className={`px-2 py-1 text-right ${row.balance > 0 ? "text-amber-700" : "text-green-700"}`}>
                    {money(row.balance)}
                  </td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={data.months.length + 5} className="px-2 py-4 text-center text-slate-400">
                    No members yet.
                  </td>
                </tr>
              )}
            </tbody>
            {data.rows.length > 0 && (
              <tfoot>
                <tr className="border-t border-slate-200 font-medium text-slate-700">
                  <td className="sticky left-0 bg-white px-2 py-1">Total</td>
                  {data.columnTotals.map((t, i) => (
                    <td key={i} className="px-1 py-1 text-center">{t > 0 ? money(t) : ""}</td>
                  ))}
                  <td colSpan={4} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
          <span><span className="inline-block h-2.5 w-2.5 rounded-sm bg-green-100 align-middle" /> Paid</span>
          <span><span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-200 align-middle" /> Unpaid / partial</span>
          <span><span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-100 align-middle" /> Prepaid ahead</span>
        </div>
      </div>
    </div>
  );
}
