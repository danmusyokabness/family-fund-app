"use client";
// components/FullLedger.tsx
//
// The full ledger: every movement of money in the fund, month by month,
// with category filters and a running balance. Reached from the
// "Show full ledger" link under the contributions ledger on the home page.

import { useEffect, useState } from "react";
import { formatMonthYear } from "@/lib/dates";
import { LEDGER_CATEGORY_LABEL, type FullLedger as FullLedgerData, type LedgerCategory, type LedgerEntry } from "@/lib/full-ledger";

type Filter = "all" | "contribution" | "withdrawal" | "charge" | "other" | "adjustments";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "contribution", label: "Contributions" },
  { key: "withdrawal", label: "Withdrawals" },
  { key: "charge", label: "Transaction charges" },
  { key: "other", label: "Other expenses" },
  { key: "adjustments", label: "Opening balance & adjustments" },
];

function matches(filter: Filter, category: LedgerCategory): boolean {
  if (filter === "all") return true;
  if (filter === "adjustments") return category === "opening" || category === "adjustment";
  return filter === category;
}

function amount(n: number): string {
  return Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

const CATEGORY_COLOR: Record<LedgerCategory, string> = {
  contribution: "var(--forest)",
  opening: "var(--steel)",
  adjustment: "var(--steel)",
  withdrawal: "var(--danger)",
  charge: "var(--ochre)",
  other: "var(--ink-soft)",
};

export default function FullLedger() {
  const [ledger, setLedger] = useState<FullLedgerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/ledger/full");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load the ledger.");
        setLedger(data.ledger);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load the ledger.");
      }
    })();
  }, []);

  if (error) return <p className="text-danger">{error}</p>;
  if (!ledger) return <p className="text-ink-soft">Loading...</p>;

  const summary: { label: string; value: number; color: string }[] = [
    { label: "Contributions", value: ledger.byCategory.contribution, color: "var(--forest)" },
    { label: "Withdrawals", value: ledger.byCategory.withdrawal, color: "var(--danger)" },
    { label: "Transaction charges", value: ledger.byCategory.charge, color: "var(--ochre)" },
    { label: "Other expenses", value: ledger.byCategory.other, color: "var(--ink-soft)" },
  ];
  const openingAndAdjustments = ledger.byCategory.opening + ledger.byCategory.adjustment;
  const filtered = filter !== "all";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Full ledger</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Every movement of money in the fund&apos;s account, newest month first: contributions, withdrawals, M-PESA transaction
          charges and other expenses. The balance at the end always matches the &quot;Total in account&quot; on the home page.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="paper-card p-4 sm:col-span-3 lg:col-span-1">
          <p className="text-xs text-ink-soft">Total in account</p>
          <p className="figures font-serif text-2xl font-semibold">KES {amount(ledger.balance)}</p>
        </div>
        {summary.map((s) => (
          <div key={s.label} className="paper-card p-4">
            <p className="text-xs text-ink-soft">{s.label}</p>
            <p className="figures text-lg font-semibold" style={{ color: s.color }}>
              KES {amount(s.value)}
            </p>
          </div>
        ))}
      </div>
      {openingAndAdjustments !== 0 && (
        <p className="text-xs text-ink-soft">
          Also included: opening balance and adjustments, net KES {openingAndAdjustments < 0 ? "-" : ""}
          {amount(openingAndAdjustments)}.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)} className={filter === f.key ? "btn-primary px-3 py-1 text-xs" : "btn-secondary px-3 py-1 text-xs"}>
            {f.label}
          </button>
        ))}
      </div>

      {ledger.months.length === 0 && <p className="paper-card p-4 text-sm text-ink-soft">No money has moved yet.</p>}

      {ledger.months.map((month) => {
        const rows: LedgerEntry[] = month.entries.filter((e) => matches(filter, e.category));
        if (rows.length === 0) return null;
        const shownTotal = rows.reduce((sum, e) => sum + e.money, 0);
        return (
          <section key={month.month} className="paper-card overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
              <h2 className="font-serif text-lg font-semibold">{formatMonthYear(month.month)}</h2>
              {filtered ? (
                <p className="text-xs text-ink-soft">
                  {rows.length} item(s) &middot; <span className="figures font-medium">KES {shownTotal < 0 ? "-" : ""}{amount(shownTotal)}</span>
                </p>
              ) : (
                <p className="text-xs text-ink-soft">
                  In <span className="figures font-medium" style={{ color: "var(--forest)" }}>KES {amount(month.moneyIn)}</span> &middot; Out{" "}
                  <span className="figures font-medium" style={{ color: "var(--danger)" }}>KES {amount(month.moneyOut)}</span> &middot; Balance at month end{" "}
                  <span className="figures font-medium">KES {amount(month.closingBalance)}</span>
                </p>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {rows.map((e, i) => (
                    <tr key={e.id} className={i > 0 ? "border-t border-line" : ""}>
                      <td className="whitespace-nowrap px-4 py-2 align-top text-xs text-ink-soft">
                        {shortDate(e.date)}
                        <span className="block">{e.time}</span>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <span className="block">{e.label}</span>
                        <span className="block text-xs" style={{ color: CATEGORY_COLOR[e.category] }}>
                          {LEDGER_CATEGORY_LABEL[e.category]}
                          {e.detail && <span className="text-ink-soft"> &middot; {e.detail}</span>}
                          {e.awaitingMember && <span className="text-ink-soft"> &middot; counted in the total, not yet in a member&apos;s ledger</span>}
                        </span>
                      </td>
                      <td className="figures whitespace-nowrap px-2 py-2 text-right align-top font-medium" style={{ color: e.money < 0 ? "var(--danger)" : "var(--forest)" }}>
                        {e.money < 0 ? "-" : "+"}
                        {amount(e.money)}
                      </td>
                      {!filtered && <td className="figures whitespace-nowrap px-4 py-2 text-right align-top text-xs text-ink-soft">{amount(e.balanceAfter)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {!filtered && ledger.months.length > 0 && <p className="text-xs text-ink-soft">The right-hand column is the fund&apos;s balance after each entry.</p>}
    </div>
  );
}
