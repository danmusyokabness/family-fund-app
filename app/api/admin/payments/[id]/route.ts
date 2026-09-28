// app/api/admin/payments/[id]/route.ts
//
// PATCH does one of these, depending on what's in the body:
//
//   { allocations: [{ memberId, amount }, ...], rememberPayer?: boolean }
//     Replaces who this payment counts for. Confirming a suggestion is
//     just this with one allocation for the full amount. A split is the
//     same shape with more than one. The amounts must add up to exactly
//     the payment's amount. rememberPayer only applies to a
//     single-member allocation (never a split — see the project plan,
//     section 6.2) and, if true, saves a "masked_phone" alias so the
//     same payer auto-matches next time.
//
//   { ignore: true }
//     Marks the payment as not a contribution (e.g. a refund or a
//     mis-sent payment) and clears any allocations it had.
//
//   { amount, paidAt, note }
//     Edits the payment's own details. Only allowed for admin-entered
//     rows (source = "admin") — a real M-PESA statement row's amount
//     and date are the bank's record, not ours to change; its note can
//     still be edited from here too.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

interface PatchBody {
  allocations?: { memberId: string; amount: number }[];
  rememberPayer?: boolean;
  ignore?: boolean;
  amount?: number;
  paidAt?: string;
  note?: string;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: PatchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: payment } = await db
    .from("payments")
    .select("id, amount, source, payer_phone_masked")
    .eq("id", id)
    .maybeSingle();

  if (!payment) {
    return NextResponse.json({ error: "Payment not found." }, { status: 404 });
  }

  // ---- Ignore -----------------------------------------------------------
  if (body.ignore) {
    await db.from("payment_allocations").delete().eq("payment_id", id);
    const { error } = await db
      .from("payments")
      .update({ match_status: "ignored", suggested_member_id: null, suggestion_reason: null })
      .eq("id", id);
    if (error) return NextResponse.json({ error: "Could not update the payment." }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ---- Assign / confirm / split / reassign ------------------------------
  if (body.allocations) {
    if (body.allocations.length === 0) {
      return NextResponse.json({ error: "Give at least one allocation." }, { status: 400 });
    }
    const sum = body.allocations.reduce((s, a) => s + Number(a.amount), 0);
    // A little float tolerance (a cent's worth) rather than requiring
    // exact binary equality, which amounts read back from Postgres can miss by.
    if (Math.abs(sum - Number(payment.amount)) > 0.01) {
      return NextResponse.json(
        { error: `Allocations must add up to the payment amount (KES ${payment.amount}).` },
        { status: 400 }
      );
    }

    await db.from("payment_allocations").delete().eq("payment_id", id);
    const { error: allocError } = await db.from("payment_allocations").insert(
      body.allocations.map((a) => ({ payment_id: id, member_id: a.memberId, amount: a.amount }))
    );
    if (allocError) {
      return NextResponse.json({ error: "Could not save the allocation." }, { status: 500 });
    }

    const { error: statusError } = await db
      .from("payments")
      .update({ match_status: "matched", suggested_member_id: null, suggestion_reason: null })
      .eq("id", id);
    if (statusError) return NextResponse.json({ error: "Could not update the payment." }, { status: 500 });

    // Remember a single-member confirmation, so the same payer auto-matches next time.
    if (body.rememberPayer && body.allocations.length === 1 && payment.payer_phone_masked) {
      await db.from("payer_aliases").upsert(
        {
          member_id: body.allocations[0].memberId,
          alias_type: "masked_phone",
          alias_value: payment.payer_phone_masked,
          source: "confirmed",
        },
        { onConflict: "member_id,alias_type,alias_value" }
      );
    }

    return NextResponse.json({ ok: true });
  }

  // ---- Editing the payment's own details ---------------------------------
  const updates: Record<string, unknown> = {};
  if (body.note !== undefined) updates.note = body.note.trim() || null;

  if (body.amount !== undefined || body.paidAt !== undefined) {
    if (payment.source !== "admin") {
      return NextResponse.json(
        { error: "Only manually entered payments can have their amount or date changed." },
        { status: 400 }
      );
    }
    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (!amount || amount === 0) return NextResponse.json({ error: "Enter a non-zero amount." }, { status: 400 });
      updates.amount = amount;
    }
    if (body.paidAt !== undefined) {
      const d = new Date(body.paidAt);
      if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "Invalid date." }, { status: 400 });
      updates.paid_at = d.toISOString();
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { error } = await db.from("payments").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: "Could not update the payment." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
