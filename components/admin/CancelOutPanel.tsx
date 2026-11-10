"use client";
// components/admin/CancelOutPanel.tsx
//
// "Cancel out": remove a withdrawal and the deposit(s) that put the money
// back, in one step, without changing the Total in account. Only enabled
// when the two sides are exactly equal. Main admin login only.

import { useCallback, useState } from "react";
import { checkCancelOut } from "@/lib/cancel-out";

interface Entry {
  id: string;
  kind: string;
  amount: number;
  date: string;
  label: string;
  purpose?: string;
}

function money(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
}
function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", year: "numeric" });
}

export default function CancelOutPanel({ onDone }: { onDone: () => void }) {
  const [expenses, setExpenses] = useState<Entry[] | null>(null);
  const [deposits, setDeposits] = useState<Entry[]>([]);
  const [chosenExpenses, setChosenExpenses] = useState<Set<string>>(new Set());
  const [chosenDeposits, setChosenDeposits] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/cancel-out");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load the entries.");
      setExpenses(data.expenses);
      setDeposits(data.deposits);
      setChosenExpenses(new Set());
      setChosenDeposits(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the entries.");
    }
  }, []);

  function toggle(set: Set<string>, setter: (s: Set<string>) => void, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  const picked = {
    expenses: (expenses ?? []).filter((e) => chosenExpenses.has(e.id)),
    deposits: deposits.filter((d) => chosenDeposits.has(d.id)),
  };
  const out = picked.expenses.reduce((n, e) => n + e.amount, 0);
  const back = picked.deposits.reduce((n, d) => n + d.amount, 0);
  const check = checkCancelOut(
    picked.expenses.map((e) => ({ id: e.id, kind: e.kind, amount: e.amount })),
    picked.deposits.map((d) => ({ id: d.id, kind: d.kind, amount: d.amount, creditedToMonthlyDues: false }))
  );

  async function submit() {
    if (!check.ok) return;
    if (!window.confirm(`Remove ${picked.expenses.length} withdrawal(s) and ${picked.deposits.length} deposit(s), each side KES ${money(out)}? The Total in account will not change.`)) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/cancel-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expenseIds: [...chosenExpenses], paymentIds: [...chosenDeposits] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not cancel them out.");
      setMessage(
        `Removed ${data.removedExpenses} withdrawal(s) and ${data.removedPayments} deposit(s), KES ${money(data.totalKes)} each side. The Total in account did not change.` +
          (data.fromStatement ? " Some of these came from an imported statement: if you import that statement again, they will come back, so leave it or import both statements together." : "")
      );
      await load();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel them out.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details
      className="paper-card p-4 text-sm"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && expenses === null) load();
      }}
    >
      <summary className="cursor-pointer font-medium">Cancel out a withdrawal and the deposit that put it back</summary>
      <p className="mt-2 text-xs text-ink-soft">
        If money was taken out and later put back, remove both entries here. The two sides must add up to exactly the same amount, so the Total in account stays the
        same. A record of what was removed is kept. M-PESA transaction charges and deposits that pay off a member&apos;s monthly dues are not offered.
      </p>

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {message && <p className="mt-2 text-sm text-forest">{message}</p>}
      {expenses === null && !error && <p className="mt-2 text-xs text-ink-soft">Loading...</p>}

      {expenses !== null && (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-1 text-xs font-medium text-ink-soft">1. The withdrawal(s)</h3>
            <div className="max-h-56 overflow-y-auto rounded-md border border-line">
              {expenses.length === 0 && <p className="p-3 text-xs text-ink-soft">No withdrawals recorded.</p>}
              {expenses.map((e) => (
                <label key={e.id} className="flex cursor-pointer items-start gap-2 border-b border-line px-3 py-2 text-xs last:border-b-0">
                  <input type="checkbox" className="mt-0.5" checked={chosenExpenses.has(e.id)} onChange={() => toggle(chosenExpenses, setChosenExpenses, e.id)} />
                  <span className="flex-1">
                    {e.label}
                    <span className="block text-ink-soft">{day(e.date)}</span>
                  </span>
                  <span className="figures" style={{ color: "var(--danger)" }}>-{money(e.amount)}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-medium text-ink-soft">2. The deposit(s) that put it back</h3>
            <div className="max-h-56 overflow-y-auto rounded-md border border-line">
              {deposits.length === 0 && <p className="p-3 text-xs text-ink-soft">No deposits to choose from.</p>}
              {deposits.map((d) => (
                <label key={d.id} className="flex cursor-pointer items-start gap-2 border-b border-line px-3 py-2 text-xs last:border-b-0">
                  <input type="checkbox" className="mt-0.5" checked={chosenDeposits.has(d.id)} onChange={() => toggle(chosenDeposits, setChosenDeposits, d.id)} />
                  <span className="flex-1">
                    {d.label}
                    <span className="block text-ink-soft">{day(d.date)}</span>
                  </span>
                  <span className="figures" style={{ color: "var(--forest)" }}>+{money(d.amount)}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {expenses !== null && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={submit} disabled={busy || !check.ok} className="btn-primary px-4 py-1.5 text-sm">
            {busy ? "Removing..." : "Remove them both"}
          </button>
          <span className="text-xs text-ink-soft">
            Withdrawals KES {money(out)} &middot; Deposits KES {money(back)}
            {picked.expenses.length > 0 && picked.deposits.length > 0 && !check.ok && <span className="block" style={{ color: "var(--ochre)" }}>{check.error}</span>}
          </span>
        </div>
      )}
    </details>
  );
}
