// lib/ledger-data.ts
//
// SERVER-ONLY. Loads everything the full ledger is built from (every
// payment with the members it was counted for, and every expense), used
// by the ledger page's API and by the CSV export so both always agree.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "./pagination.ts";
import type { FullLedgerExpense, FullLedgerPayment } from "./full-ledger.ts";

interface PaymentRow {
  id: string;
  amount: number;
  kind: string;
  paid_at: string;
  match_status: string;
  note: string | null;
  purpose: string | null;
  related_expense_id: string | null;
  payment_allocations: { members: { full_name: string } | null }[] | null;
}
interface ExpenseRow {
  id: string;
  kind: string;
  amount: number;
  occurred_at: string;
  description: string | null;
}

export async function loadFullLedgerInputs(db: SupabaseClient): Promise<{ payments: FullLedgerPayment[]; expenses: FullLedgerExpense[] }> {
  const paymentRows = (await fetchAllRows((range) =>
    db
      .from("payments")
      .select("id, amount, kind, paid_at, match_status, note, purpose, related_expense_id, payment_allocations(members(full_name))")
      .order("paid_at", { ascending: true })
      .range(range.from, range.to)
  )) as unknown as PaymentRow[];

  const expenseRows = (await fetchAllRows((range) =>
    db
      .from("fund_expenses")
      .select("id, kind, amount, occurred_at, description")
      .order("occurred_at", { ascending: true })
      .range(range.from, range.to)
  )) as unknown as ExpenseRow[];

  return {
    payments: paymentRows.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      kind: p.kind,
      paidAt: p.paid_at,
      matchStatus: p.match_status,
      memberNames: [...new Set((p.payment_allocations ?? []).map((a) => a.members?.full_name ?? "").filter(Boolean))],
      note: p.note,
      purpose: p.purpose ?? "monthly",
      relatedExpenseId: p.related_expense_id,
    })),
    expenses: expenseRows.map((e) => ({
      id: e.id,
      kind: e.kind,
      amount: Number(e.amount),
      occurredAt: e.occurred_at,
      description: e.description,
    })),
  };
}
