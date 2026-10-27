// app/api/tree/route.ts
//
// GET  -> the whole family tree (everyone who has not been removed), who
//         is looking, which entries they may edit, and whether they still
//         have to connect themselves to it (decision D20). Details a
//         person has chosen to hide are left out unless the viewer may
//         edit that entry.
// POST -> add a person. A member may add a child under themselves or a
//         brother or sister under their parent; an admin may add anywhere.

import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/actors";
import { supabaseAdmin } from "@/lib/supabase";
import { nairobiTodayDateString } from "@/lib/dates";
import { needsToConnect, rowFromPatch, sanitizeNodePatch, viewForViewer, withRanks } from "@/lib/family-tree";
import { loadEditContext } from "@/lib/tree-data";

export async function GET() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  try {
    const ctx = await loadEditContext(supabaseAdmin(), actor);
    // Ranks come from the REAL birth dates, so everyone sees the same eldest-first order even when a date is hidden.
    const ranked = withRanks(ctx.nodes);
    return NextResponse.json({
      nodes: ranked.map((n) => viewForViewer(n, ctx.editable.has(n.id))),
      me: { memberId: actor.memberId, name: actor.name, nodeId: ctx.mine?.id ?? null },
      isAdmin: actor.isAdmin,
      editableIds: [...ctx.editable],
      addChildIds: [...ctx.addChildTargets],
      // A member whose entry has no parent yet may add one.
      canAddParent: Boolean(ctx.mine && !ctx.nodes.some((n) => n.id === ctx.mine?.parentId)),
      // A member must be placed in the tree; the main admin login is not a member.
      needsToConnect: actor.memberId ? needsToConnect(ctx.nodes, actor.memberId) : false,
    });
  } catch {
    return NextResponse.json({ error: "Could not load the family tree." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const result = sanitizeNodePatch(body, nairobiTodayDateString());
  if (!result.ok) return NextResponse.json({ error: result.errors.join(" ") }, { status: 400 });
  if (!result.patch.name) return NextResponse.json({ error: "A name is required." }, { status: 400 });

  const db = supabaseAdmin();
  const ctx = await loadEditContext(db, actor);
  const parentId = result.patch.parentId ?? null;

  if (parentId && !ctx.nodes.some((n) => n.id === parentId)) {
    return NextResponse.json({ error: "That parent could not be found." }, { status: 400 });
  }
  if (!actor.isAdmin) {
    if (!parentId || !ctx.addChildTargets.has(parentId)) {
      return NextResponse.json(
        { error: "You can add a child under yourself, or a brother or sister under your parent. Ask an admin for anything else." },
        { status: 403 }
      );
    }
  }
  if (result.patch.spouseId && !ctx.nodes.some((n) => n.id === result.patch.spouseId)) {
    return NextResponse.json({ error: "That spouse could not be found." }, { status: 400 });
  }

  const { data, error } = await db
    .from("family_nodes")
    .insert({ ...rowFromPatch(result.patch), created_by_member_id: actor.memberId })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) return NextResponse.json({ error: "Could not add that person." }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}
