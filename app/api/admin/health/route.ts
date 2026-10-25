// app/api/admin/health/route.ts
//
// GET -> everything the Health tab shows: green/amber/red checks, the
// schedule, recent runs of the daily job, and the last texts sent.
// Admin only. Secrets are never returned: only whether they are set.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { serverEnv } from "@/lib/env";
import { nairobiTodayDateString } from "@/lib/dates";
import { adminAlertPhones, loadDataFreshness, loadSettings } from "@/lib/messaging";
import { buildHealthChecks, nextScheduledDate, overallStatus } from "@/lib/health";
import { balanceAsOf, buildFullLedger } from "@/lib/full-ledger";
import { loadFullLedgerInputs } from "@/lib/ledger-data";

interface MemberRow {
  full_name: string;
  member_phones: { id: string }[] | null;
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const db = supabaseAdmin();
    const env = serverEnv();
    const settings = await loadSettings(db);
    const today = nairobiTodayDateString();

    const freshness = await loadDataFreshness(db, today, settings);

    const { data: runs } = await db
      .from("job_runs")
      .select("started_at, finished_at, ok, details")
      .eq("job", "daily")
      .order("started_at", { ascending: false })
      .limit(8);

    const { data: backups } = await db
      .from("job_runs")
      .select("started_at")
      .eq("job", "export")
      .order("started_at", { ascending: false })
      .limit(1);

    const [needs, unmatched] = await Promise.all([
      db.from("payments").select("id", { count: "exact", head: true }).eq("match_status", "needs_confirmation"),
      db.from("payments").select("id", { count: "exact", head: true }).eq("match_status", "unmatched"),
    ]);

    const { data: memberRows } = await db
      .from("members")
      .select("full_name, member_phones(id)")
      .eq("is_active", true)
      .returns<MemberRow[]>();
    const membersWithoutPhone = (memberRows ?? []).filter((m) => (m.member_phones ?? []).length === 0).map((m) => m.full_name);

    const { data: sentRows } = await db
      .from("sms_log")
      .select("kind, period, created_at")
      .eq("status", "sent")
      .order("created_at", { ascending: false })
      .limit(40);
    const lastTexts: Record<"reminder" | "report", { period: string; at: string } | null> = { reminder: null, report: null };
    for (const row of sentRows ?? []) {
      if ((row.kind === "reminder" || row.kind === "report") && !lastTexts[row.kind as "reminder" | "report"]) {
        lastTexts[row.kind as "reminder" | "report"] = { period: row.period, at: row.created_at };
      }
    }

    // Does the fund's own total agree with the bank's closing balance on the last imported statement?
    let statementCheck: { closingBalance: number; asOfDate: string; ledgerBalance: number } | null = null;
    const { data: lastImports } = await db
      .from("imports")
      .select("id, closing_balance_reported, period_end")
      .eq("status", "confirmed")
      .order("created_at", { ascending: false })
      .limit(1);
    const lastImport = lastImports && lastImports.length > 0 ? lastImports[0] : null;
    if (lastImport && lastImport.closing_balance_reported !== null && lastImport.closing_balance_reported !== undefined) {
      let asOfDate: string | null = lastImport.period_end ?? null;
      if (!asOfDate) {
        // Older imports did not record their last day: use the latest transaction that import brought in.
        const { data: p } = await db.from("payments").select("paid_at").eq("import_id", lastImport.id).order("paid_at", { ascending: false }).limit(1);
        const { data: e } = await db.from("fund_expenses").select("occurred_at").eq("import_id", lastImport.id).order("occurred_at", { ascending: false }).limit(1);
        const latest = [p?.[0]?.paid_at, e?.[0]?.occurred_at].filter(Boolean).sort().pop();
        if (latest) asOfDate = new Date(new Date(latest as string).getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
      }
      if (asOfDate) {
        const ledger = buildFullLedger(await loadFullLedgerInputs(db));
        statementCheck = {
          closingBalance: Number(lastImport.closing_balance_reported),
          asOfDate,
          ledgerBalance: balanceAsOf(ledger, asOfDate),
        };
      }
    }

    const unreadMessages = await db
      .from("message_board")
      .select("id", { count: "exact", head: true })
      .eq("is_private", true)
      .eq("is_from_admin", false)
      .is("read_at", null)
      .is("deleted_at", null);

    const lastRun = runs && runs.length > 0 ? runs[0] : null;
    const checks = buildHealthChecks({
      now: new Date().toISOString(),
      lastDailyRun: lastRun ? { startedAt: lastRun.started_at, ok: lastRun.ok, details: lastRun.details } : null,
      smsLive: env.smsLive,
      atConfigured: Boolean(env.atApiKey && env.atUsername),
      freshness,
      needsConfirmation: needs.count ?? 0,
      unmatched: unmatched.count ?? 0,
      membersWithoutPhone,
      lastBackupAt: backups && backups.length > 0 ? backups[0].started_at : null,
      alertPhoneCount: (await adminAlertPhones(db, settings)).length,
      statementCheck,
      unreadMessages: unreadMessages.count ?? 0,
    });

    const reminderDay = Number(settings.reminder_day) || 7;
    const reportDay = Number(settings.report_day) || 15;

    return NextResponse.json({
      overall: overallStatus(checks),
      checks,
      schedule: {
        today,
        reminderDay,
        reportDay,
        nextReminder: nextScheduledDate(today, reminderDay),
        nextReport: nextScheduledDate(today, reportDay),
        maxImportAgeDays: freshness.maxAgeDays,
      },
      lastTexts,
      runs: (runs ?? []).map((r) => ({ startedAt: r.started_at, ok: r.ok, details: r.details })),
      canBackup: auth.admin.isSuperAdmin,
    });
  } catch {
    return NextResponse.json({ error: "Could not load the health checks." }, { status: 500 });
  }
}
