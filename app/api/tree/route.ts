// app/api/tree/route.ts
//
// GET  -> the whole family tree (everyone who has not been removed), who
//         is looking, and whether they still have to connect themselves
//         to it (decision D20). Phone numbers are included for admins only.
// POST -> add a person. Any logged-in member may (decision D12). The
//         change is logged so an admin can undo it.

import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/actors";
import { supabaseAdmin } from "@/lib/supabase";
import { nairobiTodayDateString } from "@/lib/dates";
import { needsToConnect, rowFromPatch, sanitizeNodePatch, toPublicNode, nodeFromRow, type TreeRow } from "@/lib/family-tree";
import { loadLiveNodes, recordHistory } from "@/lib/tree-data";

export async function GET() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  try {
    const nodes = await loadLiveNodes(supabaseAdmin());
    const mine = actor.memberId ? nodes.find((n) => n.memberId === actor.memberId) ?? null : null;
    return NextResponse.json({
      nodes: nodes.map((n) => toPublicNode(n, actor.isAdmin)),
      me: { memberId: actor.memberId, name: actor.name, nodeId: mine?.id ?? null },
      isAdmin: actor.isAdmin,
      // A member must be placed in the tree; the main admin login is not a member.
      needsToConnect: actor.memberId ? needsToConnect(nodes, actor.memberId) : false,
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

  // Phone numbers on the tree are an admin detail.
  if (!actor.isAdmin) delete body.phone;

  const result = sanitizeNodePatch(body, nairobiTodayDateString());
  if (!result.ok) return NextResponse.json({ error: result.errors.join(" ") }, { status: 400 });
  if (!result.patch.name) return NextResponse.json({ error: "A name is required." }, { status: 400 });

  const db = supabaseAdmin();
  const nodes = await loadLiveNodes(db);

  if (result.patch.parentId && !nodes.some((n) => n.id === result.patch.parentId)) {
    return NextResponse.json({ error: "That parent could not be found." }, { status: 400 });
  }
  if (result.patch.spouseId && !nodes.some((n) => n.id === result.patch.spouseId)) {
    return NextResponse.json({ error: "That spouse could not be found." }, { status: 400 });
  }

  const { data, error } = await db
    .from("family_nodes")
    .insert({ ...rowFromPatch(result.patch), created_by_member_id: actor.memberId })
    .select("*")
    .single<TreeRow>();
  if (error || !data) return NextResponse.json({ error: "Could not add that person." }, { status: 500 });

  const created = nodeFromRow(data);
  await recordHistory(db, { nodeId: created.id, actor, action: "create", before: null, after: created });
  return NextResponse.json({ ok: true, id: created.id });
}
