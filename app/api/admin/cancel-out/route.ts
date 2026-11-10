// app/api/admin/cancel-out/route.ts
//
// Cancel out a withdrawal and the deposit that put the money back, without
// changing the Total in account (see lib/cancel-out.ts). Superadmin only,
// because it deletes money records.
//
// GET  -> the withdrawals / other expenses and the deposits that could be
//         chosen (deposits credited to a member's monthly dues are left out).
// POST { expenseIds, paymentIds } -> removes them, but ONLY if the two sides
//         add up to exactly the same amount. What was removed is written in
//         full to job_runs (job "cancel_out") so it can always be seen again.

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { checkCancelOut } from "@/lib/cancel-out";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ExpenseRow {
  id: string;
  kind: string;
  amount: number;
  occurred_at: string;
  description: string | null;
  mpesa_receipt?: string | null;
  import_id?: string | null;
}
interface PaymentRow {
  id: string;
  kind: string;
  amount: number;
  purpose: string | null;
  match_status: string;
  paid_at: string;
  payer_name: string | null;
  note: string | null;
  mpesa_receipt?: string | null;
  import_id?: string | null;
  payment_allocations: { id: string; members: { full_name: string } | null }[] | null;
}

function creditedToMonthlyDues(p: { purpose: string | null; payment_allocations: unknown[] | null }): boolean {
  return (p.purpose ?? "monthly") === "monthly" && (p.payment_allocations ?? []).length > 0;
}

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const db = supabaseAdmin();
  const { data: expenses, error: expenseError } = await db
    .from("fund_expenses")
    .select("id, kind, amount, occurred_at, description")
    .in("kind", ["withdrawal", "other"])
    .order("occurred_at", { ascending: false })
    .limit(100)
    .returns<ExpenseRow[]>();
  const { data: payments, error: paymentError } = await db
    .from("payments")
    .select("id, kind, amount, purpose, match_status, paid_at, payer_name, note, payment_allocations(id, members(full_name))")
    .gt("amount", 0)
    .in("kind", ["mpesa", "manual"])
    .order("paid_at", { ascending: false })
    .limit(200)
    .returns<PaymentRow[]>();
  if (expenseError || paymentError) return NextResponse.json({ error: "Could not load the entries." }, { status: 500 });

  return NextResponse.json({
    expenses: (expenses ?? []).map((e) => ({ id: e.id, kind: e.kind, amount: Number(e.amount), date: e.occurred_at, label: e.description ?? (e.kind === "withdrawal" ? "Withdrawal" : "Other expense") })),
    deposits: (payments ?? [])
      .filter((p) => !creditedToMonthlyDues(p))
      .map((p) => ({
        id: p.id,
        kind: p.kind,
        amount: Number(p.amount),
        date: p.paid_at,
        purpose: p.purpose ?? "monthly",
        label:
          [...new Set((p.payment_allocations ?? []).map((a) => a.members?.full_name ?? "").filter(Boolean))].join(", ") ||
          p.payer_name ||
          p.note ||
          "Deposit",
      })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  let body: { expenseIds?: unknown; paymentIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const ids = (value: unknown): string[] | null =>
    Array.isArray(value) && value.length <= 20 && value.every((v) => typeof v === "string" && UUID.test(v)) ? (value as string[]) : null;
  const expenseIds = ids(body.expenseIds);
  const paymentIds = ids(body.paymentIds);
  if (!expenseIds || !paymentIds) return NextResponse.json({ error: "Choose the withdrawals and deposits again." }, { status: 400 });

  const db = supabaseAdmin();
  const { data: expenseRows } = await db.from("fund_expenses").select("*").in("id", expenseIds);
  const { data: paymentRows } = await db.from("payments").select("*, payment_allocations(*)").in("id", paymentIds);
  if ((expenseRows ?? []).length !== expenseIds.length || (paymentRows ?? []).length !== paymentIds.length) {
    return NextResponse.json({ error: "One of those entries no longer exists. Refresh and try again." }, { status: 404 });
  }

  const check = checkCancelOut(
    (expenseRows ?? []).map((e) => ({ id: e.id, kind: e.kind, amount: Number(e.amount) })),
    (paymentRows ?? []).map((p) => ({
      id: p.id,
      kind: p.kind,
      amount: Number(p.amount),
      creditedToMonthlyDues: creditedToMonthlyDues({ purpose: p.purpose, payment_allocations: p.payment_allocations }),
    }))
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 409 });

  // Take the deposits out first, then the withdrawals; if the second step fails, put the deposits back so the total never moves.
  const allocations = (paymentRows ?? []).flatMap((p) => (p.payment_allocations ?? []) as Record<string, unknown>[]);
  const payments = (paymentRows ?? []).map((p) => {
    const { payment_allocations: _a, ...row } = p;
    void _a;
    return row as Record<string, unknown>;
  });

  const a = await db.from("payment_allocations").delete().in("payment_id", paymentIds);
  if (a.error) return NextResponse.json({ error: "Could not remove the deposits. Nothing was changed." }, { status: 500 });
  const b = await db.from("payments").delete().in("id", paymentIds);
  if (b.error) {
    if (allocations.length > 0) await db.from("payment_allocations").insert(allocations);
    return NextResponse.json({ error: "Could not remove the deposits. Nothing was changed." }, { status: 500 });
  }
  const c = await db.from("fund_expenses").delete().in("id", expenseIds);
  if (c.error) {
    await db.from("payments").insert(payments);
    if (allocations.length > 0) await db.from("payment_allocations").insert(allocations);
    return NextResponse.json({ error: "Could not remove the withdrawals, so the deposits were put back. Nothing was changed." }, { status: 500 });
  }

  const now = new Date().toISOString();
  await db.from("job_runs").insert({
    job: "cancel_out",
    started_at: now,
    finished_at: now,
    ok: true,
    details: { totalKes: check.totalCents / 100, expenses: expenseRows, payments, allocations },
  });

  const fromStatement = [...(expenseRows ?? []), ...(paymentRows ?? [])].some((r) => (r as { import_id?: string | null }).import_id);
  return NextResponse.json({ ok: true, removedExpenses: expenseIds.length, removedPayments: paymentIds.length, totalKes: check.totalCents / 100, fromStatement });
}
