// app/api/admin/members/import/route.ts
//
// POST { csv, defaultJoinedOn, commit? }
//   commit is falsy (or missing) -> PREVIEW ONLY. Parses the CSV and
//     returns every row with its warnings/errors. Nothing is written.
//   commit: true -> actually creates a member (+ phones + shortcode
//     aliases) for every row that has no errors. Every imported member
//     gets the same defaultJoinedOn (the sheet has no per-member
//     joining-date column) — for exceptions, edit that one member
//     afterwards on the Members page.
//
// A primary phone that's already registered to an existing member is
// skipped as a likely duplicate import, not silently overwritten.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { parseMemberImportCsv, type ParsedMemberRow } from "@/lib/members-import";

function toFirstOfMonth(input: string): string | null {
  const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(input.trim());
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${match[1]}-${match[2]}-01`;
}

interface ImportBody {
  csv?: string;
  defaultJoinedOn?: string;
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

  const csv = body.csv ?? "";
  if (!csv.trim()) {
    return NextResponse.json({ error: "Paste or upload the CSV first." }, { status: 400 });
  }

  const parsed = parseMemberImportCsv(csv);

  if (!body.commit) {
    // Preview only — nothing touches the database.
    return NextResponse.json(parsed);
  }

  const joinedOn = toFirstOfMonth(body.defaultJoinedOn ?? "");
  if (!joinedOn) {
    return NextResponse.json({ error: "A joining month (YYYY-MM) is required to import." }, { status: 400 });
  }

  const db = supabaseAdmin();

  const { data: existingPhoneRows } = await db.from("member_phones").select("phone_number");
  const existingPhones = new Set((existingPhoneRows ?? []).map((r) => r.phone_number));

  const results: Array<{ rowNumber: number; fullName: string; status: "created" | "skipped"; reason?: string }> = [];

  for (const row of parsed.rows as ParsedMemberRow[]) {
    if (row.errors.length > 0) {
      results.push({ rowNumber: row.rowNumber, fullName: row.fullName, status: "skipped", reason: "Invalid row." });
      continue;
    }
    if (!row.primaryPhone) {
      results.push({ rowNumber: row.rowNumber, fullName: row.fullName, status: "skipped", reason: "No primary phone." });
      continue;
    }
    if (existingPhones.has(row.primaryPhone)) {
      results.push({
        rowNumber: row.rowNumber,
        fullName: row.fullName,
        status: "skipped",
        reason: "That phone number is already registered to a member.",
      });
      continue;
    }

    const { data: member, error: memberError } = await db
      .from("members")
      .insert({ full_name: row.fullName, joined_on: joinedOn })
      .select("id")
      .single();

    if (memberError || !member) {
      results.push({ rowNumber: row.rowNumber, fullName: row.fullName, status: "skipped", reason: "Could not create member." });
      continue;
    }

    const phoneRows = [
      { member_id: member.id, phone_number: row.primaryPhone, is_primary: true },
      ...row.alternatePhones.map((phone) => ({ member_id: member.id, phone_number: phone, is_primary: false })),
    ];
    await db.from("member_phones").insert(phoneRows);
    existingPhones.add(row.primaryPhone);
    row.alternatePhones.forEach((p) => existingPhones.add(p));

    if (row.shortcodes.length > 0) {
      await db.from("payer_aliases").insert(
        row.shortcodes.map((value) => ({
          member_id: member.id,
          alias_type: "shortcode",
          alias_value: value,
          source: "import",
        }))
      );
    }

    results.push({ rowNumber: row.rowNumber, fullName: row.fullName, status: "created" });
  }

  const createdCount = results.filter((r) => r.status === "created").length;
  return NextResponse.json({ ok: true, createdCount, skippedCount: results.length - createdCount, results });
}