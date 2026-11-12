// app/api/ledger/full/route.ts
//
// GET -> the full ledger: contributions AND withdrawals, M-PESA
// transaction charges, other expenses, opening balances and adjustments,
// month by month with a running balance (see lib/full-ledger.ts).
//
// Open to any logged-in member who contributes, or the admin. It contains no phone
// numbers and no M-PESA receipt numbers.

import { NextResponse } from "next/server";
import { getMemberSession, getAdminContext } from "@/lib/auth";
import { memberContributes } from "@/lib/access";
import { supabaseAdmin } from "@/lib/supabase";
import { buildFullLedger } from "@/lib/full-ledger";
import { loadFullLedgerInputs } from "@/lib/ledger-data";

export async function GET() {
  const member = await getMemberSession();
  const isAdmin = (await getAdminContext()).isAdmin;
  if (!member && !isAdmin) {
    return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  }

  const db = supabaseAdmin();
  if (member && !isAdmin && !(await memberContributes(db, member.memberId))) {
    return NextResponse.json({ error: "This part of the site is for members who contribute to the fund." }, { status: 403 });
  }

  try {
    const inputs = await loadFullLedgerInputs(db);
    return NextResponse.json({ ledger: buildFullLedger(inputs) });
  } catch {
    return NextResponse.json({ error: "Could not load the ledger." }, { status: 500 });
  }
}
