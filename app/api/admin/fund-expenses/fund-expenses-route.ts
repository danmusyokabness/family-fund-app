// app/api/admin/fund-expenses/route.ts
//
// GET  -> the most recent expenses (charges, withdrawals, other outflows).
// POST -> record one. No payer-matching needed here — an expense always
//         belongs to the fund as a whole, never a member.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

const VALID_KINDS = ["charge", "withdrawal", "other"];

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "50") || 50, 200);

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("fund_expenses")
    .select("id, kind, amount, occurred_at, mpesa_receipt, description, note, created_at")
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: "Could not load expenses." }, { status: 500 });
  return NextResponse.json({ expenses: data ?? [] });
}

interface CreateExpenseBody {
  kind?: string;
  amount?: number;
  occurredAt?: string;
  mpesaReceipt?: string;
  description?: string;
  note?: string;
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: CreateExpenseBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const kind = body.kind ?? "other";
  if (!VALID_KINDS.includes(kind)) {
    return NextResponse.json({ error: `kind must be one of: ${VALID_KINDS.join(", ")}` }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!amount || amount <= 0) {
    return NextResponse.json({ error: "Enter a positive amount." }, { status: 400 });
  }

  const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) {
    return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { error } = await db.from("fund_expenses").insert({
    kind,
    amount,
    occurred_at: occurredAt.toISOString(),
    mpesa_receipt: body.mpesaReceipt?.trim() || null,
    description: body.description?.trim() || null,
    note: body.note?.trim() || null,
  });

  if (error) return NextResponse.json({ error: "Could not record the expense." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
