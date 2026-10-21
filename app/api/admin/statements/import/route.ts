// app/api/admin/statements/import/route.ts
//
// POST { csv } or { pdfBase64, password? }, plus filename and commit.
//
//   commit falsy/missing -> PREVIEW ONLY. Parses, runs the integrity
//     check, flags which rows are already recorded (duplicates), and
//     returns everything for review. Nothing is written.
//
//   commit: true -> actually records every new row. REFUSED if the
//     integrity check failed — a statement that doesn't reconcile is
//     never imported, full stop. Each payment is matched the same way
//     app/api/admin/payments/route.ts matches a manual one (remembered
//     payer / registered phone -> counted immediately; name only ->
//     needs confirmation; nothing -> unmatched). Charges go to
//     fund_expenses. A receipt already on file is skipped, never
//     double-counted — the database's own unique constraint on
//     mpesa_receipt is a second line of defence behind this check.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { parseStatementRows, type ParsedStatementRow } from "@/lib/statement-parser";
import { csvToStatementRows } from "@/lib/statement-csv";
import { extractStatementRowsFromPdf } from "@/lib/pdf-statement";
import { matchPayment } from "@/lib/payment-matching";
import { loadMembersForMatching } from "@/lib/load-members-for-matching";
import { nairobiWallTimeToUtcIso } from "@/lib/dates";

interface ImportBody {
  csv?: string;
  pdfBase64?: string;
  password?: string;
  filename?: string;
  commit?: boolean;
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: ImportBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  let rawRows;
  let source: "csv" | "pdf";
  let debugLines: string[] | undefined;

  if (body.csv) {
    rawRows = csvToStatementRows(body.csv);
    source = "csv";
  } else if (body.pdfBase64) {
    let buffer: Buffer;
    try {
      buffer = Buffer.from(body.pdfBase64, "base64");
    } catch {
      return NextResponse.json({ error: "Could not read the uploaded file." }, { status: 400 });
    }
    try {
      const extracted = await extractStatementRowsFromPdf(buffer, body.password || undefined);
      rawRows = extracted.rawRows;
      debugLines = extracted.lines;
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? `Could not read the PDF: ${err.message}` : "Could not read the PDF." },
        { status: 400 }
      );
    }
    source = "pdf";
  } else {
    return NextResponse.json({ error: "Provide a CSV or a PDF." }, { status: 400 });
  }

  const parsed = parseStatementRows(rawRows);
  const db = supabaseAdmin();

  const paymentReceipts = parsed.rows.filter((r) => r.kind === "payment").map((r) => r.receiptNo);
  const chargeReceipts = parsed.rows.filter((r) => r.kind !== "payment").map((r) => r.receiptNo);

  const [{ data: existingPayments }, { data: existingExpenses }] = await Promise.all([
    paymentReceipts.length
      ? db.from("payments").select("mpesa_receipt").in("mpesa_receipt", paymentReceipts)
      : Promise.resolve({ data: [] as { mpesa_receipt: string }[] }),
    chargeReceipts.length
      ? db.from("fund_expenses").select("mpesa_receipt, kind").in("mpesa_receipt", chargeReceipts)
      : Promise.resolve({ data: [] as { mpesa_receipt: string; kind: string }[] }),
  ]);
  const existingPaymentReceipts = new Set((existingPayments ?? []).map((p) => p.mpesa_receipt));
  const existingExpenseKeys = new Set((existingExpenses ?? []).map((e) => `${e.mpesa_receipt}|${e.kind}`));

  function isDuplicate(row: ParsedStatementRow): boolean {
    if (row.kind === "payment") return existingPaymentReceipts.has(row.receiptNo);
    const kind = row.kind === "charge" ? "charge" : "other";
    return existingExpenseKeys.has(`${row.receiptNo}|${kind}`);
  }

  const rowsWithDup = parsed.rows.map((r) => ({ ...r, isDuplicate: isDuplicate(r) }));
  const newCount = rowsWithDup.filter((r) => !r.isDuplicate).length;
  const duplicateCount = rowsWithDup.length - newCount;

  // Members are loaded once: the preview uses them to show who each payment
  // WOULD be matched to, and the import below uses them to really match.
  const members = await loadMembersForMatching();
  const memberNameById = new Map(members.map((m) => [m.id, m.fullName]));

  if (!body.commit) {
    const previewRows = rowsWithDup.map((row) => {
      if (row.kind !== "payment") return row;
      const outcome = matchPayment(
        { payerPhoneMasked: row.payerPhoneMasked, payerName: row.payerName, payerRef: row.payerRef },
        members
      );
      const match =
        outcome.status === "matched"
          ? { status: "matched" as const, memberName: memberNameById.get(outcome.memberId) ?? null, reason: outcome.reason }
          : outcome.status === "needs_confirmation"
            ? { status: "needs_confirmation" as const, memberName: memberNameById.get(outcome.suggestedMemberId) ?? null, reason: outcome.reason }
            : { status: "unmatched" as const, memberName: null, reason: "no member matches this payer" };
      return { ...row, match };
    });
    return NextResponse.json({
      source,
      integrityOk: parsed.integrityOk,
      reportedClosingBalance: parsed.reportedClosingBalance,
      calculatedClosingBalance: parsed.calculatedClosingBalance,
      totalPaidIn: parsed.totalPaidIn,
      totalWithdrawn: parsed.totalWithdrawn,
      skippedCount: parsed.skippedCount,
      brokenReceipts: parsed.brokenReceipts,
      newCount,
      duplicateCount,
      rows: previewRows,
      lines: debugLines,
    });
  }

  if (!parsed.integrityOk) {
    return NextResponse.json(
      { error: "Cannot import: the statement's running balance did not reconcile. Check the preview for details." },
      { status: 400 }
    );
  }

  let created = 0;

  for (const row of rowsWithDup) {
    if (row.isDuplicate) continue;

    let occurredAtUtc: string;
    try {
      occurredAtUtc = nairobiWallTimeToUtcIso(row.completionTime);
    } catch {
      continue; // an unparseable timestamp is skipped rather than guessed at
    }

    if (row.kind === "payment") {
      const outcome = matchPayment(
        { payerPhoneMasked: row.payerPhoneMasked, payerName: row.payerName, payerRef: row.payerRef },
        members
      );

      let matchStatus: "matched" | "needs_confirmation" | "unmatched" = "unmatched";
      let suggestedMemberId: string | null = null;
      let suggestionReason: string | null = null;
      let matchedMemberId: string | null = null;

      if (outcome.status === "matched") {
        matchStatus = "matched";
        matchedMemberId = outcome.memberId;
      } else if (outcome.status === "needs_confirmation") {
        matchStatus = "needs_confirmation";
        suggestedMemberId = outcome.suggestedMemberId;
        suggestionReason = outcome.reason;
      }

      const { data: payment, error } = await db
        .from("payments")
        .insert({
          amount: row.amount,
          kind: "mpesa",
          source,
          mpesa_receipt: row.receiptNo,
          payer_name: row.payerName,
          payer_phone_masked: row.payerPhoneMasked,
          payer_ref: row.payerRef,
          paid_at: occurredAtUtc,
          match_status: matchStatus,
          suggested_member_id: suggestedMemberId,
          suggestion_reason: suggestionReason,
          raw: row,
        })
        .select("id")
        .single();

      if (error || !payment) continue; // most likely a duplicate receipt the pre-check missed — the database's own unique constraint protects it either way

      if (matchStatus === "matched" && matchedMemberId) {
        await db.from("payment_allocations").insert({ payment_id: payment.id, member_id: matchedMemberId, amount: row.amount });
      }
      created++;
    } else {
      const kind = row.kind === "charge" ? "charge" : "other";
      const { error } = await db.from("fund_expenses").insert({
        kind,
        amount: row.amount,
        occurred_at: occurredAtUtc,
        mpesa_receipt: row.receiptNo,
        description: row.details,
      });
      if (!error) created++;
    }
  }

  await db.from("imports").insert({
    source,
    filename: body.filename ?? null,
    rows_total: parsed.rows.length,
    rows_new: created,
    rows_duplicate: duplicateCount,
    rows_skipped: parsed.skippedCount,
    total_paid_in: parsed.totalPaidIn,
    total_charges: parsed.totalWithdrawn,
    closing_balance_reported: parsed.reportedClosingBalance,
    closing_balance_calculated: parsed.calculatedClosingBalance,
    integrity_ok: parsed.integrityOk,
    status: "confirmed",
  });

  return NextResponse.json({ ok: true, created, skippedDuplicates: duplicateCount });
}
