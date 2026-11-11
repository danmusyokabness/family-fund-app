// app/api/tree/onboard/route.ts
//
// POST -> a member fills in their details the first time they open the family
//         tree. Works for both cases:
//           * they already have an entry (they claimed one, or someone added
//             them): the entry is completed and marked as done;
//           * they have none: one is created for them, under the parent they
//             chose (or the parent they add).
//         The rules (date of birth and parent are required; everything else is
//         optional; they choose what the family can see) live in
//         lib/onboarding.ts. The name always comes from the member's own record.
//
// Body: { details: { dateOfBirth, phone, education, work, residence, spouseName,
//                    spouseDetails, bio, hiddenFields, ... },
//         parent?: { id } | { newParent: { name, dateOfBirth | birthdate } } | { top: true } }
//
// Only members can do this (the main admin login is not a member).

import { NextRequest, NextResponse } from "next/server";
import { getMemberSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { nairobiTodayDateString } from "@/lib/dates";
import { rowFromPatch, sanitizeNodePatch } from "@/lib/family-tree";
import { planOnboarding } from "@/lib/onboarding";
import { loadLiveNodes } from "@/lib/tree-data";

export async function POST(req: NextRequest) {
  const member = await getMemberSession();
  if (!member) return NextResponse.json({ error: "Only members fill in their details here." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const details = body.details && typeof body.details === "object" ? { ...(body.details as Record<string, unknown>) } : {};
  // These are never taken from the browser: the name is the member's own, the links and the "done" mark are set here.
  for (const key of ["name", "memberId", "parentId", "spouseId", "profileCompletedAt"]) delete details[key];

  const today = nairobiTodayDateString();
  const checked = sanitizeNodePatch(details, today);
  if (!checked.ok) return NextResponse.json({ error: checked.errors.join(" ") }, { status: 400 });

  const db = supabaseAdmin();
  const nodes = await loadLiveNodes(db);
  const mine = nodes.find((n) => n.memberId === member.memberId) ?? null;

  const plan = planOnboarding({ nodes, mine, patch: checked.patch, parent: body.parent, today });
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 });

  const now = new Date().toISOString();

  // A parent who is not in the tree yet is added first (and removed again if the rest fails).
  let parentId: string | null | undefined; // undefined = leave the parent as it is
  let createdParentId: string | null = null;
  if (plan.parent.kind === "existing") parentId = plan.parent.id;
  else if (plan.parent.kind === "top") parentId = null;
  else if (plan.parent.kind === "new") {
    const { data, error } = await db
      .from("family_nodes")
      .insert({ ...rowFromPatch(plan.parent.patch), parent_id: null, created_by_member_id: member.memberId })
      .select("id")
      .single<{ id: string }>();
    if (error || !data) return NextResponse.json({ error: "Could not add your parent. Nothing was saved." }, { status: 500 });
    createdParentId = data.id;
    parentId = data.id;
  }
  const undoParent = async () => {
    if (createdParentId) await db.from("family_nodes").update({ deleted_at: now }).eq("id", createdParentId);
  };

  if (mine) {
    const { error } = await db
      .from("family_nodes")
      .update({
        ...rowFromPatch(checked.patch),
        ...(parentId !== undefined ? { parent_id: parentId } : {}),
        profile_completed_at: mine.profileCompletedAt ?? now,
        updated_at: now,
      })
      .eq("id", mine.id)
      .is("deleted_at", null);
    if (error) {
      await undoParent();
      return NextResponse.json({ error: "Could not save your details." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, id: mine.id });
  }

  const { data, error } = await db
    .from("family_nodes")
    .insert({
      ...rowFromPatch(checked.patch),
      name: member.fullName,
      parent_id: parentId ?? null,
      member_id: member.memberId,
      created_by_member_id: member.memberId,
      profile_completed_at: now,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    await undoParent();
    return NextResponse.json({ error: "Could not add you to the tree." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: data.id });
}
