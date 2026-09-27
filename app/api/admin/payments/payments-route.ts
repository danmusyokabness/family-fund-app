// app/api/admin/payments/route.ts
//
// GET  ?status=matched|needs_confirmation|unmatched|ignored (optional)
//      &limit=50&offset=0
//   Lists payments, newest first, each with its allocations (member
//   name + amount). For "unmatched" rows, also attaches freshly
//   computed candidates (re-running matchPayment live) so the admin
//   isn't starting from nothing — these aren't stored in the database,
//   just computed on the way out.
//
// POST creates one manual payment (kind: manual/adjustment/opening —
//   never "mpesa", that only ever comes from a statement/Daraja import).
//   Three ways to identify who it's for, tried in this order:
//     1. memberId given directly -> matched immediately.
//     2. payerPhoneMasked / payerName / payerRef given -> run the same
//        matchPayment() engine the future statement importer will use.
//     3. Neither -> saved as unmatched, assign it later.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { matchPayment, type PaymentForMatching } from "@/lib/payment-matching";
import { loadMembersForMatching } from "@/lib/load-members-for-matching";

const VALID_STATUSES = ["matched", "needs_confirmation", "unmatched", "ignored"];
const VALID_KINDS = ["manual", "adjustment", "opening"];

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const limit = Math.min(Number(searchParams.get("limit") ?? "50") || 50, 200);
  const offset = Number(searchParams.get("offset") ?? "0") || 0;

  const db = supabaseAdmin();
  let query = db
    .from("payments")
    .select(
      "id, amount, kind, source, mpesa_receipt, payer_name, payer_phone_masked, payer_ref, paid_at, " +
        "match_status, suggested_member_id, suggestion_reason, note, created_at, " +
        "payment_allocations(id, member_id, amount, members(full_name))"
    )
    .order("paid_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status && VALID_STATUSES.includes(status)) {
    query = query.eq("match_status", status);
  }

  const { data: payments, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Could not load payments." }, { status: 500 });
  }

  // Only bother recomputing candidates for the "unmatched" rows actually
  // being returned on this page — cheap at this scale, pointless otherwise.
  const unmatchedRows = (payments ?? []).filter((p) => p.match_status === "unmatched");
  let candidatesByPaymentId: Record<string, { memberId: string; reason: string }[]> = {};
  if (unmatchedRows.length > 0) {
    const members = await loadMembersForMatching();
    candidatesByPaymentId = Object.fromEntries(
      unmatchedRows.map((p) => {
        const outcome = matchPayment(
          { payerPhoneMasked: p.payer_phone_masked, payerName: p.payer_name, payerRef: p.payer_ref },
          members
        );
        return [p.id, outcome.status === "unmatched" ? outcome.candidates : []];
      })
    );
  }

  const withCandidates = (payments ?? []).map((p) => ({
    ...p,
    candidates: candidatesByPaymentId[p.id] ?? undefined,
  }));

  return NextResponse.json({ payments: withCandidates });
}

interface CreatePaymentBody {
  amount?: number;
  kind?: string;
  paidAt?: string;
  memberId?: string;
  payerPhoneMasked?: string;
  payerName?: string;
  payerRef?: string;
  note?: string;
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: CreatePaymentBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!amount || amount === 0) {
    return NextResponse.json({ error: "Enter a non-zero amount." }, { status: 400 });
  }

  const kind = body.kind ?? "manual";
  if (!VALID_KINDS.includes(kind)) {
    return NextResponse.json({ error: `kind must be one of: ${VALID_KINDS.join(", ")}` }, { status: 400 });
  }
  if (kind !== "adjustment" && amount < 0) {
    return NextResponse.json({ error: "Only an adjustment can be a negative amount." }, { status: 400 });
  }

  const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();
  if (Number.isNaN(paidAt.getTime())) {
    return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  }

  const db = supabaseAdmin();

  let matchStatus: "matched" | "needs_confirmation" | "unmatched" = "unmatched";
  let matchedMemberId: string | null = null;
  let suggestedMemberId: string | null = null;
  let suggestionReason: string | null = null;

  if (body.memberId) {
    const { data: member } = await db.from("members").select("id").eq("id", body.memberId).maybeSingle();
    if (!member) return NextResponse.json({ error: "That member was not found." }, { status: 400 });
    matchStatus = "matched";
    matchedMemberId = body.memberId;
  } else if (body.payerPhoneMasked || body.payerName || body.payerRef) {
    const members = await loadMembersForMatching();
    const outcome = matchPayment(
      {
        payerPhoneMasked: body.payerPhoneMasked ?? null,
        payerName: body.payerName ?? null,
        payerRef: body.payerRef ?? null,
      } satisfies PaymentForMatching,
      members
    );
    if (outcome.status === "matched") {
      matchStatus = "matched";
      matchedMemberId = outcome.memberId;
    } else if (outcome.status === "needs_confirmation") {
      matchStatus = "needs_confirmation";
      suggestedMemberId = outcome.suggestedMemberId;
      suggestionReason = outcome.reason;
    }
  }

  const { data: payment, error: paymentError } = await db
    .from("payments")
    .insert({
      amount,
      kind,
      source: "admin",
      payer_name: body.payerName ?? null,
      payer_phone_masked: body.payerPhoneMasked ?? null,
      payer_ref: body.payerRef ?? null,
      paid_at: paidAt.toISOString(),
      match_status: matchStatus,
      suggested_member_id: suggestedMemberId,
      suggestion_reason: suggestionReason,
      note: body.note?.trim() || null,
    })
    .select("id")
    .single();

  if (paymentError || !payment) {
    return NextResponse.json({ error: "Could not record the payment." }, { status: 500 });
  }

  if (matchStatus === "matched" && matchedMemberId) {
    const { error: allocError } = await db
      .from("payment_allocations")
      .insert({ payment_id: payment.id, member_id: matchedMemberId, amount });
    if (allocError) {
      return NextResponse.json({ error: "Payment saved, but could not allocate it." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, paymentId: payment.id, matchStatus });
}
