// app/api/admin/members/import/route.ts
//
// POST { csv, defaultJoinedOn, commit? }
//   commit is falsy (or missing) -> PREVIEW ONLY. Parses the CSV and
//     returns every row with its warnings/errors. Nothing is written.
//   commit: true -> for every row that has no errors: creates the member
//     (+ phones + till/business numbers + statement numbers), OR, if the
//     primary phone already belongs to a member with the same first name,
//     ADDS the row's new numbers to that member. Every NEW member
//     gets the same defaultJoinedOn (the sheet has no per-member
//     joining-date column) — for exceptions, edit that one member
//     afterwards on the Members page.
//
// Nothing is ever removed or overwritten: re-importing an updated sheet
// only adds numbers that are missing. A primary phone registered to a
// member with a DIFFERENT first name is skipped and reported (it is
// probably a typing mistake), and a number that belongs to another
// member is never moved.

import { NextRequest, NextResponse } from "next/server";
import { canonicalMaskedPhone } from "@/lib/phone";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { parseMemberImportCsv, planMemberMerge, sameFirstName, type ParsedMemberRow } from "@/lib/members-import";

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

  // Everything needed to recognise members who already exist.
  const { data: phoneRows } = await db.from("member_phones").select("member_id, phone_number");
  const { data: memberRows } = await db.from("members").select("id, full_name");
  const { data: aliasRows } = await db.from("payer_aliases").select("member_id, alias_type, alias_value");

  const pushTo = (map: Map<string, string[]>, key: string, value: string) => {
    const list = map.get(key) ?? [];
    list.push(value);
    map.set(key, list);
  };
  const phoneOwners = new Map<string, string>(); // phone -> member id
  const phonesOf = new Map<string, string[]>();
  for (const r of phoneRows ?? []) {
    phoneOwners.set(r.phone_number, r.member_id);
    pushTo(phonesOf, r.member_id, r.phone_number);
  }
  const nameOf = new Map<string, string>((memberRows ?? []).map((m) => [m.id, m.full_name as string]));
  const shortcodesOf = new Map<string, string[]>();
  const maskedOf = new Map<string, string[]>();
  for (const a of aliasRows ?? []) {
    if (a.alias_type === "shortcode") pushTo(shortcodesOf, a.member_id, a.alias_value);
    else if (a.alias_type === "masked_phone") pushTo(maskedOf, a.member_id, canonicalMaskedPhone(a.alias_value) ?? a.alias_value);
  }

  const results: Array<{
    rowNumber: number;
    fullName: string;
    status: "created" | "updated" | "skipped";
    reason?: string;
  }> = [];

  for (const row of parsed.rows as ParsedMemberRow[]) {
    const skip = (reason: string) => results.push({ rowNumber: row.rowNumber, fullName: row.fullName, status: "skipped", reason });

    if (row.errors.length > 0) {
      skip("Invalid row.");
      continue;
    }
    if (!row.primaryPhone) {
      skip("No primary phone.");
      continue;
    }

    // ---- A member who already exists: add what is new, remove nothing ----
    const ownerId = phoneOwners.get(row.primaryPhone);
    if (ownerId) {
      const ownerName = nameOf.get(ownerId) ?? "another member";
      if (!sameFirstName(ownerName, row.fullName)) {
        skip(`That phone number is registered to ${ownerName}, not ${row.fullName}. Check the number.`);
        continue;
      }

      const plan = planMemberMerge(
        row,
        ownerId,
        {
          phones: phonesOf.get(ownerId) ?? [],
          shortcodes: shortcodesOf.get(ownerId) ?? [],
          maskedPhones: maskedOf.get(ownerId) ?? [],
        },
        phoneOwners
      );

      const added: string[] = [];
      if (plan.addPhones.length > 0) {
        const { error } = await db
          .from("member_phones")
          .insert(plan.addPhones.map((phone) => ({ member_id: ownerId, phone_number: phone, is_primary: false })));
        if (error) {
          skip("Could not save the new phone number(s).");
          continue;
        }
        plan.addPhones.forEach((phone) => {
          phoneOwners.set(phone, ownerId);
          pushTo(phonesOf, ownerId, phone);
        });
        added.push(`${plan.addPhones.length} alternate number(s)`);
      }

      const newAliases = [
        ...plan.addShortcodes.map((value) => ({ member_id: ownerId, alias_type: "shortcode", alias_value: value, source: "import" })),
        ...plan.addMaskedPhones.map((value) => ({ member_id: ownerId, alias_type: "masked_phone", alias_value: value, source: "import" })),
      ];
      if (newAliases.length > 0) {
        const { error } = await db.from("payer_aliases").insert(newAliases);
        if (error) {
          skip("Could not save the new payer number(s).");
          continue;
        }
        plan.addShortcodes.forEach((v) => pushTo(shortcodesOf, ownerId, v));
        plan.addMaskedPhones.forEach((v) => pushTo(maskedOf, ownerId, v));
        if (plan.addShortcodes.length > 0) added.push(`${plan.addShortcodes.length} till/business number(s)`);
        if (plan.addMaskedPhones.length > 0) added.push(`${plan.addMaskedPhones.length} statement number(s)`);
      }

      const conflictNote =
        plan.phoneConflicts.length > 0 ? ` Not added because they belong to another member: ${plan.phoneConflicts.join(", ")}.` : "";
      if (added.length === 0) {
        skip(`Already up to date.${conflictNote}`);
      } else {
        results.push({
          rowNumber: row.rowNumber,
          fullName: row.fullName,
          status: "updated",
          reason: `Added ${added.join(", ")} to ${ownerName}.${conflictNote}`,
        });
      }
      continue;
    }

    // ---- A new member ----
    // An alternate that already belongs to someone else is left out rather than
    // letting the whole insert fail (which used to leave a member with no phone).
    const alternates = row.alternatePhones.filter((phone) => !phoneOwners.has(phone));
    const leftOut = row.alternatePhones.filter((phone) => phoneOwners.has(phone));

    const { data: member, error: memberError } = await db
      .from("members")
      .insert({ full_name: row.fullName, joined_on: joinedOn })
      .select("id")
      .single();

    if (memberError || !member) {
      skip("Could not create member.");
      continue;
    }

    const { error: phonesError } = await db.from("member_phones").insert([
      { member_id: member.id, phone_number: row.primaryPhone, is_primary: true },
      ...alternates.map((phone) => ({ member_id: member.id, phone_number: phone, is_primary: false })),
    ]);
    if (phonesError) {
      await db.from("members").delete().eq("id", member.id); // never leave a member with no phone
      skip("Could not save the phone numbers.");
      continue;
    }
    phoneOwners.set(row.primaryPhone, member.id);
    alternates.forEach((p) => phoneOwners.set(p, member.id));

    const aliasRowsToAdd = [
      ...row.shortcodes.map((value) => ({ member_id: member.id, alias_type: "shortcode", alias_value: value, source: "import" })),
      ...row.maskedPhones.map((value) => ({ member_id: member.id, alias_type: "masked_phone", alias_value: value, source: "import" })),
    ];
    if (aliasRowsToAdd.length > 0) await db.from("payer_aliases").insert(aliasRowsToAdd);

    results.push({
      rowNumber: row.rowNumber,
      fullName: row.fullName,
      status: "created",
      reason: leftOut.length > 0 ? `Not added because they belong to another member: ${leftOut.join(", ")}.` : undefined,
    });
  }

  const createdCount = results.filter((r) => r.status === "created").length;
  const updatedCount = results.filter((r) => r.status === "updated").length;
  return NextResponse.json({
    ok: true,
    createdCount,
    updatedCount,
    skippedCount: results.length - createdCount - updatedCount,
    results,
  });
}
