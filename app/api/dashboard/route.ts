// app/api/dashboard/route.ts
//
// GET ?fy=2026-08 (optional — any month inside the desired financial
// year; defaults to the current one)
//
// Open to any logged-in identity — a member sees their own balance
// cards plus the full ledger; the superadmin (who has no member record)
// sees the group figures and the ledger, but no personal cards.

import { NextRequest, NextResponse } from "next/server";
import { getMemberSession, getAdminSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/pagination";
import { mergeSettingsWithDefaults } from "@/lib/settings";
import { nairobiCurrentMonthKey, type MonthKey } from "@/lib/dates";
import { buildDashboard, type DashboardAllocation, type DashboardMember, type DashboardPayment } from "@/lib/dashboard";

export async function GET(req: NextRequest) {
  const member = await getMemberSession();
  const isAdmin = await getAdminSession();
  if (!member && !isAdmin) {
    return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const fyParam = searchParams.get("fy");
  const selectedFyMonth: MonthKey | null = fyParam && /^\d{4}-\d{2}$/.test(fyParam) ? fyParam : null;

  const db = supabaseAdmin();

  const [{ data: settingsRows, error: settingsError }, { data: memberRows, error: membersError }] = await Promise.all([
    db.from("settings").select("key, value"),
    db
      .from("members")
      .select("id, full_name, joined_on, family_nodes(date_of_birth)")
      .eq("is_active", true),
  ]);

  if (settingsError || membersError) {
    return NextResponse.json({ error: "Could not load fund data." }, { status: 500 });
  }

  const stored: Record<string, string> = {};
  for (const row of settingsRows ?? []) stored[row.key] = row.value;
  const settings = mergeSettingsWithDefaults(stored);

  const members: DashboardMember[] = (memberRows ?? []).map((m) => {
    const nodes = (m as unknown as { family_nodes: { date_of_birth: string | null }[] }).family_nodes ?? [];
    return {
      id: m.id,
      fullName: m.full_name,
      joinedOn: m.joined_on,
      dateOfBirth: nodes[0]?.date_of_birth ?? null,
    };
  });

  let allocations: DashboardAllocation[];
  let payments: DashboardPayment[];
  let expensesTotal: number;

  try {
    const [allocRows, paymentRows, expenseRows] = await Promise.all([
      fetchAllRows((range) =>
        db.from("payment_allocations").select("member_id, amount, payments(paid_at)").range(range.from, range.to)
      ),
      fetchAllRows((range) =>
        db.from("payments").select("amount, kind, paid_at, match_status").range(range.from, range.to)
      ),
      fetchAllRows((range) => db.from("fund_expenses").select("amount").range(range.from, range.to)),
    ]);

    allocations = (allocRows as unknown as { member_id: string; amount: number; payments: { paid_at: string } | null }[]).map(
      (a) => ({ memberId: a.member_id, amount: a.amount, paidAt: a.payments?.paid_at ?? "" })
    );
    payments = (paymentRows as unknown as { amount: number; kind: string; paid_at: string; match_status: string }[]).map(
      (p) => ({ amount: p.amount, kind: p.kind, paidAt: p.paid_at, matchStatus: p.match_status })
    );
    expensesTotal = (expenseRows as unknown as { amount: number }[]).reduce((sum, e) => sum + Number(e.amount), 0);
  } catch {
    return NextResponse.json({ error: "Could not load payment history." }, { status: 500 });
  }

  const result = buildDashboard({
    members,
    allocations,
    payments,
    expensesTotal,
    targetAmount: Number(settings.target_amount),
    fyStartMonth: Number(settings.fy_start_month),
    asOfMonth: nairobiCurrentMonthKey(),
    selectedFyMonth,
    viewerMemberId: member?.memberId ?? null,
  });

  return NextResponse.json({ ...result, fundName: settings.fund_name, tillNumber: settings.till_number });
}
