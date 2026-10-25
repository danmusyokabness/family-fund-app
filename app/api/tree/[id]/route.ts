// app/api/tree/[id]/route.ts
//
// PATCH  -> edit one person. Any logged-in member may (decision D12).
// DELETE -> remove one person. Never permanent: the person is only hidden
//           and an admin can bring them back (decision A3). A person who
//           is a member's own place in the tree, or who still has
//           children, cannot be removed.
//
// Every change is written to the change log.

import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/actors";
import { supabaseAdmin } from "@/lib/supabase";
import { nairobiTodayDateString } from "@/lib/dates";
import { changedFields, rowFromPatch, sanitizeNodePatch, wouldCreateCycle, nodeFromRow, type TreeRow } from "@/lib/family-tree";
import { loadLiveNodes, recordHistory } from "@/lib/tree-data";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!actor.isAdmin) delete body.phone;

  const result = sanitizeNodePatch(body, nairobiTodayDateString());
  if (!result.ok) return NextResponse.json({ error: result.errors.join(" ") }, { status: 400 });

  const db = supabaseAdmin();
  const nodes = await loadLiveNodes(db);
  const before = nodes.find((n) => n.id === id);
  if (!before) return NextResponse.json({ error: "That person could not be found." }, { status: 404 });

  if (result.patch.parentId !== undefined && result.patch.parentId !== null) {
    if (!nodes.some((n) => n.id === result.patch.parentId)) return NextResponse.json({ error: "That parent could not be found." }, { status: 400 });
    if (wouldCreateCycle(nodes, id, result.patch.parentId)) {
      return NextResponse.json({ error: "That would make someone their own ancestor." }, { status: 400 });
    }
  }
  if (result.patch.spouseId && !nodes.some((n) => n.id === result.patch.spouseId)) {
    return NextResponse.json({ error: "That spouse could not be found." }, { status: 400 });
  }

  const after = { ...before, ...result.patch } as typeof before;
  if (changedFields(before, after).length === 0) return NextResponse.json({ ok: true, unchanged: true });

  const { data, error } = await db
    .from("family_nodes")
    .update({ ...rowFromPatch(result.patch), updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .single<TreeRow>();
  if (error || !data) return NextResponse.json({ error: "Could not save the change." }, { status: 500 });

  await recordHistory(db, { nodeId: id, actor, action: "update", before, after: nodeFromRow(data) });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const { id } = await params;

  const db = supabaseAdmin();
  const nodes = await loadLiveNodes(db);
  const node = nodes.find((n) => n.id === id);
  if (!node) return NextResponse.json({ error: "That person could not be found." }, { status: 404 });

  if (node.memberId) {
    return NextResponse.json({ error: "This is a member's own place in the tree, so it cannot be removed. You can edit it instead." }, { status: 409 });
  }
  if (nodes.some((n) => n.parentId === id)) {
    return NextResponse.json({ error: "This person still has children in the tree. Move or remove them first." }, { status: 409 });
  }

  const { error } = await db.from("family_nodes").update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id).is("deleted_at", null);
  if (error) return NextResponse.json({ error: "Could not remove that person." }, { status: 500 });

  await recordHistory(db, { nodeId: id, actor, action: "delete", before: node, after: null });
  return NextResponse.json({ ok: true });
}
