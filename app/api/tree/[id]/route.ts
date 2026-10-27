// app/api/tree/[id]/route.ts
//
// PATCH  -> edit one person. A member may edit their own entry, their
//           parent's and their children's; an admin may edit anyone.
//           Only an admin can move someone to a different parent.
// DELETE -> remove one person (same rule for who may). Never permanent: the
//           person is only hidden (decision A3). A member's own entry, or a
//           person who still has children, cannot be removed.

import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/actors";
import { supabaseAdmin } from "@/lib/supabase";
import { nairobiTodayDateString } from "@/lib/dates";
import { changedFields, rowFromPatch, sanitizeNodePatch, wouldCreateCycle } from "@/lib/family-tree";
import { loadEditContext } from "@/lib/tree-data";

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

  const result = sanitizeNodePatch(body, nairobiTodayDateString());
  if (!result.ok) return NextResponse.json({ error: result.errors.join(" ") }, { status: 400 });

  const db = supabaseAdmin();
  const ctx = await loadEditContext(db, actor);
  const before = ctx.nodes.find((n) => n.id === id);
  if (!before) return NextResponse.json({ error: "That person could not be found." }, { status: 404 });
  if (!ctx.editable.has(id)) {
    return NextResponse.json({ error: "You can edit your own entry, your parent's and your children's. Ask an admin to change anyone else." }, { status: 403 });
  }

  if (result.patch.parentId !== undefined && result.patch.parentId !== before.parentId) {
    if (!actor.isAdmin) return NextResponse.json({ error: "Only an admin can move someone to a different parent." }, { status: 403 });
    if (result.patch.parentId !== null) {
      if (!ctx.nodes.some((n) => n.id === result.patch.parentId)) return NextResponse.json({ error: "That parent could not be found." }, { status: 400 });
      if (wouldCreateCycle(ctx.nodes, id, result.patch.parentId)) {
        return NextResponse.json({ error: "That would make someone their own ancestor." }, { status: 400 });
      }
    }
  }
  if (result.patch.spouseId && !ctx.nodes.some((n) => n.id === result.patch.spouseId)) {
    return NextResponse.json({ error: "That spouse could not be found." }, { status: 400 });
  }

  const after = { ...before, ...result.patch } as typeof before;
  if (changedFields(before, after).length === 0) return NextResponse.json({ ok: true, unchanged: true });

  const { error } = await db
    .from("family_nodes")
    .update({ ...rowFromPatch(result.patch), updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) return NextResponse.json({ error: "Could not save the change." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const { id } = await params;

  const db = supabaseAdmin();
  const ctx = await loadEditContext(db, actor);
  const node = ctx.nodes.find((n) => n.id === id);
  if (!node) return NextResponse.json({ error: "That person could not be found." }, { status: 404 });
  if (!ctx.editable.has(id)) return NextResponse.json({ error: "You cannot remove that person." }, { status: 403 });

  if (node.memberId) {
    return NextResponse.json({ error: "This is a member's own place in the tree, so it cannot be removed. You can edit it instead." }, { status: 409 });
  }
  if (ctx.nodes.some((n) => n.parentId === id)) {
    return NextResponse.json({ error: "This person still has children in the tree. Move or remove them first." }, { status: 409 });
  }

  const now = new Date().toISOString();
  const { error } = await db.from("family_nodes").update({ deleted_at: now, updated_at: now }).eq("id", id).is("deleted_at", null);
  if (error) return NextResponse.json({ error: "Could not remove that person." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
