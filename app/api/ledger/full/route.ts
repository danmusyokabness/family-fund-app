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
import { buildFullLedger } from "@/lib/full-ledger";
import { loadFullLedgerInputs } from "@/lib/ledger-data";

export async function GET() {
  const member = await getMemberSession();
  const isAdmin = await getAdminSession();
  if (!member && !isAdmin) {
    return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  }

  try {
    const inputs = await loadFullLedgerInputs(supabaseAdmin());
    return NextResponse.json({ ledger: buildFullLedger(inputs) });
  } catch {
    return NextResponse.json({ error: "Could not load the ledger." }, { status: 500 });
  }
}
