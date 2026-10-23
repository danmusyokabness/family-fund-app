// app/api/ledger/full/route.ts
//
// GET -> the full ledger: contributions AND withdrawals, M-PESA
// transaction charges, other expenses, opening balances and adjustments,
// month by month with a running balance (see lib/full-ledger.ts).
//
// Open to any logged-in member or the admin. It contains no phone
// numbers and no M-PESA receipt numbers.

import { NextResponse } from "next/server";
import { getMemberSession, getAdminSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/pagination";
import { buildFullLedger, type FullLedgerExpense, type FullLedgerPayment } from "@/lib/full-ledger";

interface PaymentRow {
  id: string;
  amount: number;
  kind: string;
  paid_at: string;
  match_status: string;
  note: string | null;
  payment_allocations: { members: { full_name: string } | null }[] | null;
}
interface ExpenseRow {
  id: string;
  kind: string;
  amount: number;
  occurred_at: string;
  description: string | null;
}

export async function GET() {
  const member = await getMemberSession();
  const isAdmin = await getAdminSession();
  if (!member && !isAdmin) {
    return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  }

  const db = supabaseAdmin();
  try {
    const paymentRows = (await fetchAllRows((range) =>
      db
        .from("payments")
        .select("id, amount, kind, paid_at, match_status, note, payment_allocations(members(full_name))")
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

    const payments: FullLedgerPayment[] = paymentRows.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      kind: p.kind,
      paidAt: p.paid_at,
      matchStatus: p.match_status,
      memberNames: [...new Set((p.payment_allocations ?? []).map((a) => a.members?.full_name ?? "").filter(Boolean))],
      note: p.note,
    }));
    const expenses: FullLedgerExpense[] = expenseRows.map((e) => ({
      id: e.id,
      kind: e.kind,
      amount: Number(e.amount),
      occurredAt: e.occurred_at,
      description: e.description,
    }));

    return NextResponse.json({ ledger: buildFullLedger({ payments, expenses }) });
  } catch {
    return NextResponse.json({ error: "Could not load the ledger." }, { status: 500 });
  }
}
