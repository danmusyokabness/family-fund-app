"use client";
// components/admin/PaymentsManager.tsx

import { useEffect, useState } from "react";

interface MemberOption {
  id: string;
  full_name: string;
}

interface Allocation {
  id: string;
  member_id: string;
  amount: number;
  members: { full_name: string } | null;
}

interface Candidate {
  memberId: string;
  reason: string;
}

interface Payment {
  id: string;
  amount: number;
  kind: string;
  source: string;
  mpesa_receipt: string | null;
  payer_name: string | null;
  payer_phone_masked: string | null;
  payer_ref: string | null;
  paid_at: string;
  match_status: "matched" | "needs_confirmation" | "unmatched" | "ignored";
  suggested_member_id: string | null;
  suggestion_reason: string | null;
  note: string | null;
  payment_allocations: Allocation[];
  candidates?: Candidate[];
}

interface Expense {
  id: string;
  kind: string;
  amount: number;
  occurred_at: string;
  mpesa_receipt: string | null;
  description: string | null;
  note: string | null;
}

const STATUS_TABS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "needs_confirmation", label: "Needs confirmation" },
  { key: "unmatched", label: "Unmatched" },
  { key: "matched", label: "Matched" },
  { key: "ignored", label: "Ignored" },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function PaymentsManager() {
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- Manual entry form ----
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState("manual");
  const [paidAt, setPaidAt] = useState("");
  const [memberId, setMemberId] = useState("");
  const [payerName, setPayerName] = useState("");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // ---- Assign/split row state (payment id -> in-progress rows) ----
  const [assigning, setAssigning] = useState<Record<string, { memberId: string; amount: string }[]>>({});
  const [rememberPayer, setRememberPayer] = useState<Record<string, boolean>>({});
  const [savingAssign, setSavingAssign] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<Record<string, string>>({});

  // ---- Fund expenses ----
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expKind, setExpKind] = useState("charge");
  const [expAmount, setExpAmount] = useState("");
  const [expDate, setExpDate] = useState("");
  const [expDescription, setExpDescription] = useState("");
  const [addingExpense, setAddingExpense] = useState(false);

  async function loadPayments(status: string) {
    setLoading(true);
    setError(null);
    try {
      const qs = status ? `?status=${status}` : "";
      const res = await fetch(`/api/admin/payments${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load payments.");
      setPayments(data.payments ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load payments.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMembers() {
    const res = await fetch("/api/admin/members");
    const data = await res.json();
    if (res.ok) setMembers((data.members ?? []).map((m: { id: string; full_name: string }) => ({ id: m.id, full_name: m.full_name })));
  }

  async function loadExpenses() {
    const res = await fetch("/api/admin/fund-expenses");
    const data = await res.json();
    if (res.ok) setExpenses(data.expenses ?? []);
  }

  useEffect(() => {
    loadMembers();
    loadExpenses();
  }, []);

  useEffect(() => {
    loadPayments(statusFilter);
  }, [statusFilter]);

  function memberName(id: string): string {
    return members.find((m) => m.id === id)?.full_name ?? "Unknown";
  }

  async function handleAddPayment(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch("/api/admin/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(amount),
          kind,
          paidAt: paidAt || undefined,
          memberId: memberId || undefined,
          payerName: !memberId && payerName ? payerName : undefined,
          note,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not record the payment.");
      setAmount("");
      setPaidAt("");
      setMemberId("");
      setPayerName("");
      setNote("");
      await loadPayments(statusFilter);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Could not record the payment.");
    } finally {
      setAdding(false);
    }
  }

  function startAssign(payment: Payment, prefillMemberId?: string) {
    setAssigning((prev) => ({
      ...prev,
      [payment.id]: [{ memberId: prefillMemberId ?? "", amount: String(payment.amount) }],
    }));
    setAssignError((prev) => ({ ...prev, [payment.id]: "" }));
  }

  function updateAssignRow(paymentId: string, index: number, field: "memberId" | "amount", value: string) {
    setAssigning((prev) => {
      const rows = [...(prev[paymentId] ?? [])];
      rows[index] = { ...rows[index], [field]: value };
      return { ...prev, [paymentId]: rows };
    });
  }

  function addSplitRow(paymentId: string) {
    setAssigning((prev) => ({ ...prev, [paymentId]: [...(prev[paymentId] ?? []), { memberId: "", amount: "" }] }));
  }

  async function saveAssign(payment: Payment) {
    const rows = assigning[payment.id] ?? [];
    if (rows.some((r) => !r.memberId || !r.amount)) {
      setAssignError((prev) => ({ ...prev, [payment.id]: "Fill in every row." }));
      return;
    }
    setSavingAssign(payment.id);
    setAssignError((prev) => ({ ...prev, [payment.id]: "" }));
    try {
      const res = await fetch(`/api/admin/payments/${payment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allocations: rows.map((r) => ({ memberId: r.memberId, amount: Number(r.amount) })),
          rememberPayer: !!rememberPayer[payment.id],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save.");
      setAssigning((prev) => {
        const next = { ...prev };
        delete next[payment.id];
        return next;
      });
      await loadPayments(statusFilter);
    } catch (err) {
      setAssignError((prev) => ({ ...prev, [payment.id]: err instanceof Error ? err.message : "Could not save." }));
    } finally {
      setSavingAssign(null);
    }
  }

  async function ignorePayment(payment: Payment) {
    await fetch(`/api/admin/payments/${payment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ignore: true }),
    });
    await loadPayments(statusFilter);
  }

  async function handleAddExpense(e: React.FormEvent) {
    e.preventDefault();
    setAddingExpense(true);
    try {
      await fetch("/api/admin/fund-expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: expKind,
          amount: Number(expAmount),
          occurredAt: expDate || undefined,
          description: expDescription,
        }),
      });
      setExpAmount("");
      setExpDate("");
      setExpDescription("");
      await loadExpenses();
    } finally {
      setAddingExpense(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* ---- Filter tabs ---- */}
      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              statusFilter === tab.key ? "bg-slate-800 text-white" : "bg-white text-slate-600 border border-slate-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ---- Payments list ---- */}
      <section className="rounded-xl bg-white p-6 shadow">
        {loading && <p className="text-sm text-slate-500">Loading...</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!loading && payments.length === 0 && <p className="text-sm text-slate-500">No payments here.</p>}

        <ul className="divide-y divide-slate-100">
          {payments.map((payment) => (
            <li key={payment.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm">
                  <p className="font-medium text-slate-800">
                    KES {payment.amount.toLocaleString()} &middot; {formatDate(payment.paid_at)}
                    <span className="ml-2 text-xs font-normal text-slate-400">{payment.kind}</span>
                  </p>
                  {payment.payer_name && (
                    <p className="text-xs text-slate-500">
                      {payment.payer_name} {payment.payer_phone_masked && `(${payment.payer_phone_masked})`}
                    </p>
                  )}
                  {payment.note && <p className="text-xs text-slate-400">{payment.note}</p>}

                  {payment.match_status === "matched" && payment.payment_allocations.length > 0 && (
                    <p className="mt-1 text-xs text-green-700">
                      &rarr;{" "}
                      {payment.payment_allocations
                        .map((a) => `${a.members?.full_name ?? memberName(a.member_id)} (KES ${a.amount})`)
                        .join(", ")}
                    </p>
                  )}

                  {payment.match_status === "needs_confirmation" && payment.suggested_member_id && (
                    <p className="mt-1 text-xs text-amber-700">
                      Suggested: {memberName(payment.suggested_member_id)} &mdash; {payment.suggestion_reason}
                    </p>
                  )}

                  {payment.match_status === "unmatched" && payment.candidates && payment.candidates.length > 0 && (
                    <p className="mt-1 text-xs text-slate-500">
                      Possible: {payment.candidates.map((c) => memberName(c.memberId)).join(", ")}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
                  {payment.match_status === "needs_confirmation" && payment.suggested_member_id && !assigning[payment.id] && (
                    <button
                      onClick={() => startAssign(payment, payment.suggested_member_id!)}
                      className="rounded bg-slate-800 px-2 py-1 text-white"
                    >
                      Confirm
                    </button>
                  )}
                  {payment.match_status !== "ignored" && !assigning[payment.id] && (
                    <button onClick={() => startAssign(payment)} className="text-slate-600 underline">
                      {payment.match_status === "matched" ? "Reassign / split" : "Assign"}
                    </button>
                  )}
                  {payment.match_status !== "ignored" && (
                    <button onClick={() => ignorePayment(payment)} className="text-slate-400 underline">
                      Ignore
                    </button>
                  )}
                </div>
              </div>

              {assigning[payment.id] && (
                <div className="mt-3 space-y-2 rounded-md bg-slate-50 p-3">
                  {assigning[payment.id].map((row, i) => (
                    <div key={i} className="flex gap-2">
                      <select
                        value={row.memberId}
                        onChange={(e) => updateAssignRow(payment.id, i, "memberId", e.target.value)}
                        className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                      >
                        <option value="">Select member...</option>
                        {members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.full_name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        value={row.amount}
                        onChange={(e) => updateAssignRow(payment.id, i, "amount", e.target.value)}
                        className="w-28 rounded border border-slate-300 px-2 py-1 text-sm"
                        placeholder="Amount"
                      />
                    </div>
                  ))}
                  <button onClick={() => addSplitRow(payment.id)} className="text-xs text-slate-500 underline">
                    + Split with another member
                  </button>
                  {payment.payer_phone_masked && (assigning[payment.id]?.length ?? 0) === 1 && (
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={!!rememberPayer[payment.id]}
                        onChange={(e) => setRememberPayer((prev) => ({ ...prev, [payment.id]: e.target.checked }))}
                      />
                      Remember this payer for next time
                    </label>
                  )}
                  {assignError[payment.id] && <p className="text-xs text-red-600">{assignError[payment.id]}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveAssign(payment)}
                      disabled={savingAssign === payment.id}
                      className="rounded bg-slate-800 px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
                    >
                      {savingAssign === payment.id ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={() =>
                        setAssigning((prev) => {
                          const next = { ...prev };
                          delete next[payment.id];
                          return next;
                        })
                      }
                      className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* ---- Manual entry ---- */}
      <section className="rounded-xl bg-white p-6 shadow">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Record a payment</h2>
        <form onSubmit={handleAddPayment} className="grid gap-2 sm:grid-cols-2">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount (KES)"
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
            required
          />
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
            <option value="manual">Manual payment</option>
            <option value="adjustment">Adjustment (can be negative)</option>
            <option value="opening">Opening balance</option>
          </select>
          <input
            type="date"
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">No member selected (assign later)</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
              </option>
            ))}
          </select>
          {!memberId && (
            <input
              value={payerName}
              onChange={(e) => setPayerName(e.target.value)}
              placeholder="Payer name (optional, helps suggest a match)"
              className="rounded border border-slate-300 px-2 py-1.5 text-sm sm:col-span-2"
            />
          )}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="rounded border border-slate-300 px-2 py-1.5 text-sm sm:col-span-2"
          />
          {addError && <p className="text-xs text-red-600 sm:col-span-2">{addError}</p>}
          <button
            type="submit"
            disabled={adding}
            className="rounded bg-slate-800 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60 sm:col-span-2 sm:w-fit"
          >
            {adding ? "Saving..." : "Record payment"}
          </button>
        </form>
      </section>

      {/* ---- Fund expenses ---- */}
      <section className="rounded-xl bg-white p-6 shadow">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Fund expenses</h2>
        <ul className="mb-3 divide-y divide-slate-100 text-sm">
          {expenses.map((exp) => (
            <li key={exp.id} className="flex justify-between py-2">
              <span>
                {exp.description || exp.kind} <span className="text-xs text-slate-400">({formatDate(exp.occurred_at)})</span>
              </span>
              <span className="text-red-600">-KES {exp.amount.toLocaleString()}</span>
            </li>
          ))}
          {expenses.length === 0 && <li className="py-2 text-sm text-slate-400">None recorded.</li>}
        </ul>
        <form onSubmit={handleAddExpense} className="grid gap-2 sm:grid-cols-2">
          <select value={expKind} onChange={(e) => setExpKind(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
            <option value="charge">M-PESA charge</option>
            <option value="withdrawal">Withdrawal</option>
            <option value="other">Other</option>
          </select>
          <input
            type="number"
            value={expAmount}
            onChange={(e) => setExpAmount(e.target.value)}
            placeholder="Amount (KES)"
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
            required
          />
          <input
            type="date"
            value={expDate}
            onChange={(e) => setExpDate(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
          <input
            value={expDescription}
            onChange={(e) => setExpDescription(e.target.value)}
            placeholder="Description"
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={addingExpense}
            className="rounded bg-slate-800 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60 sm:col-span-2 sm:w-fit"
          >
            {addingExpense ? "Saving..." : "Record expense"}
          </button>
        </form>
      </section>
    </div>
  );
}
