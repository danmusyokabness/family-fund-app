// app/api/admin/export/route.ts
//
// GET ?type=backup   -> EVERYTHING, as one JSON file (the real backup:
//                       the free database plan keeps no downloadable ones)
// GET ?type=ledger   -> the full ledger as a spreadsheet (CSV)
// GET ?type=members  -> the member list as a spreadsheet (CSV)
//
// Superadmin only: these files contain phone numbers and other personal
// details. A full backup is recorded in job_runs so the Health tab can
// say when the last one was taken.

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/pagination";
import { nairobiTodayDateString } from "@/lib/dates";
import { buildFullLedger, LEDGER_CATEGORY_LABEL } from "@/lib/full-ledger";
import { loadFullLedgerInputs } from "@/lib/ledger-data";
import { toCsv } from "@/lib/export";

// Every table worth keeping. login_attempts is left out on purpose (it is only throttling noise).
const BACKUP_TABLES = [
  "settings",
  "members",
  "member_phones",
  "payer_aliases",
  "payments",
  "payment_allocations",
  "fund_expenses",
  "imports",
  "sms_log",
  "job_runs",
  "family_nodes",
  "family_node_history",
  "message_board",
];

function download(body: string, filename: string, contentType: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": `${contentType}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

interface MemberRow {
  full_name: string;
  joined_on: string;
  is_active: boolean;
  is_admin: boolean;
  member_phones: { phone_number: string; is_primary: boolean }[] | null;
}

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const type = req.nextUrl.searchParams.get("type");
  const db = supabaseAdmin();
  const today = nairobiTodayDateString();

  try {
    if (type === "ledger") {
      const ledger = buildFullLedger(await loadFullLedgerInputs(db));
      const rows = [...ledger.months].reverse().flatMap((m) =>
        [...m.entries].reverse().map((e) => [
          e.date,
          e.time,
          e.month,
          LEDGER_CATEGORY_LABEL[e.category],
          e.label,
          e.detail ?? "",
          e.money > 0 ? e.money : "",
          e.money < 0 ? -e.money : "",
          e.balanceAfter,
        ])
      );
      const csv = toCsv(["Date", "Time", "Month", "Category", "Description", "Details", "In (KES)", "Out (KES)", "Balance after (KES)"], rows);
      return download("\uFEFF" + csv, `family-fund-ledger-${today}.csv`, "text/csv");
    }

    if (type === "members") {
      const { data } = await db
        .from("members")
        .select("full_name, joined_on, is_active, is_admin, member_phones(phone_number, is_primary)")
        .order("full_name", { ascending: true })
        .returns<MemberRow[]>();
      const rows = (data ?? []).map((m) => {
        const phones = m.member_phones ?? [];
        return [
          m.full_name,
          phones.find((p) => p.is_primary)?.phone_number ?? "",
          phones.filter((p) => !p.is_primary).map((p) => p.phone_number).join(" "),
          m.joined_on,
          m.is_active,
          m.is_admin,
        ];
      });
      const csv = toCsv(["Name", "Primary phone", "Other phones", "Joined", "Active", "Admin"], rows);
      return download("\uFEFF" + csv, `family-fund-members-${today}.csv`, "text/csv");
    }

    if (type === "backup") {
      const tables: Record<string, unknown[]> = {};
      const problems: string[] = [];
      for (const table of BACKUP_TABLES) {
        try {
          tables[table] = await fetchAllRows((range) => db.from(table).select("*").range(range.from, range.to));
        } catch {
          // A table that does not exist yet (for example before a migration was run) must not spoil the backup.
          problems.push(`${table}: could not be read`);
        }
      }

      const counts = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length]));
      await db.from("job_runs").insert({
        job: "export",
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        ok: problems.length === 0,
        details: { counts, problems },
      });

      const body = JSON.stringify({ exportedAt: new Date().toISOString(), problems, tables }, null, 2);
      return download(body, `family-fund-backup-${today}.json`, "application/json");
    }

    return NextResponse.json({ error: "type must be backup, ledger or members." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "The export failed. Try again." }, { status: 500 });
  }
}
