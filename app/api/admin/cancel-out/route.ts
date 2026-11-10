// app/api/admin/cancel-out/route.ts
//
// Cancel out a withdrawal, the deposit that put the money back and the
// M-PESA fee charged on that deposit, without changing the Total in account
// (see lib/cancel-out.ts). Superadmin only, because it deletes money records.
//
// GET  -> the withdrawals / other expenses and the deposits that could be
//         chosen (deposits credited to a member's monthly dues are left out),
//         each deposit with the fee charged on it.
// POST { expenseIds, paymentIds } -> erases them, but ONLY if the money adds
//         up: deposits minus their fees must equal the withdrawals, apart from
//         a few cents of rounding, which is kept as one plain "Rounding" line.
//
// Nothing is written to any log or history: the entries are gone. The one
// thing remembered is the M-PESA receipt NUMBERS (table import_skip_receipts,
// never shown or exported), so that importing an old statement again does not
// bring the erased entries back.

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { checkCancelOut, toCents } from "@/lib/cancel-out";

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

/** The fee(s) charged on each deposit: charge rows that carry the same M-PESA receipt. Keyed by receipt, in cents. */
async function feesByReceipt(db: ReturnType<typeof supabaseAdmin>, receipts: string[]): Promise<{ rows: Record<string, unknown>[]; cents: Map<string, number> } | null> {
  if (receipts.length === 0) return { rows: [], cents: new Map() };
  const { data, error } = await db.from("fund_expenses").select("*").eq("kind", "charge").in("mpesa_receipt", receipts);
  if (error) return null;
  const cents = new Map<string, number>();
  for (const r of data ?? []) cents.set(String(r.mpesa_receipt), (cents.get(String(r.mpesa_receipt)) ?? 0) + toCents(Number(r.amount)));
  return { rows: (data ?? []) as Record<string, unknown>[], cents };
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
    .select("id, kind, amount, purpose, match_status, paid_at, payer_name, note, mpesa_receipt, payment_allocations(id, members(full_name))")
    .gt("amount", 0)
    .in("kind", ["mpesa", "manual"])
    .order("paid_at", { ascending: false })
    .limit(200)
    .returns<PaymentRow[]>();
  if (expenseError || paymentError) return NextResponse.json({ error: "Could not load the entries." }, { status: 500 });

  const candidates = (payments ?? []).filter((p) => !creditedToMonthlyDues(p));
  const fees = await feesByReceipt(
    db,
    candidates.map((p) => p.mpesa_receipt).filter((r): r is string => !!r)
  );
  if (!fees) return NextResponse.json({ error: "Could not load the entries." }, { status: 500 });

  return NextResponse.json({
    expenses: (expenses ?? []).map((e) => ({ id: e.id, kind: e.kind, amount: Number(e.amount), date: e.occurred_at, label: e.description ?? (e.kind === "withdrawal" ? "Withdrawal" : "Other expense") })),
    deposits: candidates.map((p) => ({
      id: p.id,
      kind: p.kind,
      amount: Number(p.amount),
      fee: (p.mpesa_receipt ? (fees.cents.get(p.mpesa_receipt) ?? 0) : 0) / 100,
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

  // The fee(s) charged on the chosen deposits go with them.
  const depositReceipts = (paymentRows ?? []).map((p) => p.mpesa_receipt as string | null).filter((r): r is string => !!r);
  const fees = await feesByReceipt(db, depositReceipts);
  if (!fees) return NextResponse.json({ error: "Could not check the fees. Nothing was changed." }, { status: 500 });
  const feeIds = fees.rows.map((r) => String(r.id));
  if (feeIds.some((id) => expenseIds.includes(id))) return NextResponse.json({ error: "A fee cannot be chosen on its own." }, { status: 409 });

  // Another deposit that is marked as putting one of these withdrawals back would be left pointing at nothing.
  const { data: pointing } = await db.from("payments").select("id").in("related_expense_id", expenseIds);
  if ((pointing ?? []).some((p) => !paymentIds.includes(p.id))) {
    return NextResponse.json({ error: "Another deposit is marked as putting one of these withdrawals back. Choose that deposit too, then try again." }, { status: 409 });
  }

  const check = checkCancelOut(
    (expenseRows ?? []).map((e) => ({ id: e.id, kind: e.kind, amount: Number(e.amount) })),
    (paymentRows ?? []).map((p) => ({
      id: p.id,
      kind: p.kind,
      amount: Number(p.amount),
      fee: (p.mpesa_receipt ? (fees.cents.get(p.mpesa_receipt as string) ?? 0) : 0) / 100,
      creditedToMonthlyDues: creditedToMonthlyDues({ purpose: p.purpose, payment_allocations: p.payment_allocations }),
    }))
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 409 });

  const allocations = (paymentRows ?? []).flatMap((p) => (p.payment_allocations ?? []) as Record<string, unknown>[]);
  const payments = (paymentRows ?? []).map((p) => {
    const { payment_allocations: _a, ...row } = p;
    void _a;
    return row as Record<string, unknown>;
  });

  // 1. Remember the receipt numbers (numbers only) so an old statement cannot bring these back.
  const receipts = [
    ...new Set(
      [...(expenseRows ?? []).map((e) => e.mpesa_receipt as string | null), ...depositReceipts, ...fees.rows.map((r) => r.mpesa_receipt as string | null)].filter((r): r is string => !!r)
    ),
  ];
  let addedReceipts: string[] = [];
  if (receipts.length > 0) {
    const { data: known, error: knownError } = await db.from("import_skip_receipts").select("mpesa_receipt").in("mpesa_receipt", receipts);
    if (knownError) return NextResponse.json({ error: "The database is not ready for this yet. Run db/008 in the Supabase SQL Editor first. Nothing was changed." }, { status: 500 });
    const have = new Set((known ?? []).map((k) => k.mpesa_receipt as string));
    addedReceipts = receipts.filter((r) => !have.has(r));
    if (addedReceipts.length > 0) {
      const { error } = await db.from("import_skip_receipts").insert(addedReceipts.map((mpesa_receipt) => ({ mpesa_receipt })));
      if (error) return NextResponse.json({ error: "Could not prepare the removal. Nothing was changed." }, { status: 500 });
    }
  }

  let roundingId: string | null = null;
  const undoPreparation = async () => {
    if (roundingId) await db.from("payments").delete().eq("id", roundingId);
    if (addedReceipts.length > 0) await db.from("import_skip_receipts").delete().in("mpesa_receipt", addedReceipts);
  };

  // 2. The few cents the deposits bring in beyond the withdrawals stay in the fund as one plain line.
  if (check.leftoverCents > 0) {
    const dates = (paymentRows ?? []).map((p) => String(p.paid_at)).sort();
    const latest = dates[dates.length - 1];
    const { data: rounding, error } = await db
      .from("payments")
      .insert({
        amount: check.leftoverCents / 100,
        kind: "manual",
        purpose: "other",
        source: "admin",
        paid_at: latest,
        match_status: "ignored",
        note: "Rounding",
      })
      .select("id")
      .single();
    if (error || !rounding) {
      await undoPreparation();
      return NextResponse.json({ error: "Could not prepare the removal. Nothing was changed." }, { status: 500 });
    }
    roundingId = rounding.id as string;
  }

  // 3. Take the deposits out first, then the withdrawals and fees; if a step fails, put everything back so the total never moves.
  const a = await db.from("payment_allocations").delete().in("payment_id", paymentIds);
  if (a.error) {
    await undoPreparation();
    return NextResponse.json({ error: "Could not remove the deposits. Nothing was changed." }, { status: 500 });
  }
  const b = await db.from("payments").delete().in("id", paymentIds);
  if (b.error) {
    if (allocations.length > 0) await db.from("payment_allocations").insert(allocations);
    await undoPreparation();
    return NextResponse.json({ error: "Could not remove the deposits. Nothing was changed." }, { status: 500 });
  }
  const c = await db.from("fund_expenses").delete().in("id", [...expenseIds, ...feeIds]);
  if (c.error) {
    await db.from("payments").insert(payments);
    if (allocations.length > 0) await db.from("payment_allocations").insert(allocations);
    await undoPreparation();
    return NextResponse.json({ error: "Could not remove the withdrawals, so the deposits were put back. Nothing was changed." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    removedExpenses: expenseIds.length,
    removedPayments: paymentIds.length,
    removedFees: feeIds.length,
    totalKes: check.totalCents / 100,
    feeKes: check.feeCents / 100,
    roundingKes: check.leftoverCents / 100,
  });
}
