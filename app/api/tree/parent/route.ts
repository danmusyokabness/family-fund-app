// app/api/tree/parent/route.ts
//
// POST -> a member whose entry has no parent yet adds one (so the tree can
//         grow upward). The new person is created and the member's entry is
//         pointed at them. Only for the member's OWN entry.

import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/actors";
import { supabaseAdmin } from "@/lib/supabase";
import { nairobiTodayDateString } from "@/lib/dates";
import { rowFromPatch, sanitizeNodePatch } from "@/lib/family-tree";
import { loadEditContext } from "@/lib/tree-data";

export async function POST(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const ctx = await loadEditContext(db, actor);
  const mine = ctx.mine;
  if (!mine) return NextResponse.json({ error: "Connect yourself to the tree first." }, { status: 409 });
  if (ctx.nodes.some((n) => n.id === mine.parentId)) {
    return NextResponse.json({ error: "Your entry already has a parent. Edit that entry instead." }, { status: 409 });
  }

  const { parentId: _ignored, ...rest } = body;
  void _ignored;
  const result = sanitizeNodePatch(rest, nairobiTodayDateString());
  if (!result.ok) return NextResponse.json({ error: result.errors.join(" ") }, { status: 400 });
  if (!result.patch.name) return NextResponse.json({ error: "A name is required." }, { status: 400 });

  const { data, error } = await db
    .from("family_nodes")
    .insert({ ...rowFromPatch(result.patch), parent_id: null, created_by_member_id: actor.memberId })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) return NextResponse.json({ error: "Could not add that person." }, { status: 500 });

  const now = new Date().toISOString();
  const { error: linkError } = await db.from("family_nodes").update({ parent_id: data.id, updated_at: now }).eq("id", mine.id);
  if (linkError) {
    // Do not leave a stray person behind.
    await db.from("family_nodes").update({ deleted_at: now }).eq("id", data.id);
    return NextResponse.json({ error: "Could not connect you to them." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: data.id });
}
