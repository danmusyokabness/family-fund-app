// app/api/admin/reset-test-data/route.ts
//
// Clears members, payments, and everything derived from them, so Setup
// and the member import can be run through again while testing — without
// wiping the fund's settings (Till, target, message wording) or the
// family tree, which aren't "test data" in the same sense.
//
// Requires the exact confirmation phrase in the request body, so this
// can never be triggered by an accidental click or a repeated request.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

const CONFIRMATION_PHRASE = "DELETE ALL TEST DATA";

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: { confirm?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (body.confirm !== CONFIRMATION_PHRASE) {
    return NextResponse.json(
      { error: `Type exactly "${CONFIRMATION_PHRASE}" to confirm.` },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();

  // members cascades to member_phones, payer_aliases, and (once they
  // exist from Step 5 onward) payment_allocations.
  // payments cascades to payment_allocations.
  // Deleted in an order that respects those foreign keys.
  const tables = [
    "sms_log",
    "job_runs",
    "login_attempts",
    "message_board",
    "payments",
    "fund_expenses",
    "imports",
    "members",
  ];

  for (const table of tables) {
    // Supabase requires a filter on delete; this matches every row
    // (every id differs from the all-zero UUID) without needing to know
    // each table's actual contents first.
    const { error } = await db.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) {
      return NextResponse.json({ error: `Could not clear "${table}": ${error.message}` }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, cleared: tables });
}