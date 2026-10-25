// app/api/admin/tree/undo/route.ts
//
// POST { historyId } -> undo one logged change to the family tree (admin
// only). Only the details that change touched are put back, so later
// edits are never lost. The undo is itself logged.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { planUndo, type HistoryForUndo } from "@/lib/family-tree";
import { loadNode, recordHistory } from "@/lib/tree-data";

interface HistoryRow {
  id: string;
  node_id: string;
  action: string;
  before: HistoryForUndo["before"];
  after: HistoryForUndo["after"];
  undone_at: string | null;
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: { historyId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (typeof body.historyId !== "string") return NextResponse.json({ error: "Choose a change to undo." }, { status: 400 });

  const db = supabaseAdmin();
  const { data: history } = await db
    .from("family_node_history")
    .select("id, node_id, action, before, after, undone_at")
    .eq("id", body.historyId)
    .maybeSingle<HistoryRow>();
  if (!history) return NextResponse.json({ error: "That change could not be found." }, { status: 404 });

  const current = await loadNode(db, history.node_id);
  const now = new Date().toISOString();
  const plan = planUndo({ action: history.action, before: history.before, after: history.after, undoneAt: history.undone_at }, current, now);
  if (!plan.ok) return NextResponse.json({ error: plan.reason }, { status: 409 });

  const { error } = await db.from("family_nodes").update({ ...plan.update, updated_at: now }).eq("id", history.node_id);
  if (error) return NextResponse.json({ error: "Could not undo that change." }, { status: 500 });

  await db.from("family_node_history").update({ undone_at: now }).eq("id", history.id);
  const after = await loadNode(db, history.node_id);
  await recordHistory(db, {
    nodeId: history.node_id,
    actor: { memberId: auth.admin.memberId, name: "Admin (undo)", isAdmin: true },
    action: "restore",
    before: current,
    after,
  });
  return NextResponse.json({ ok: true, summary: plan.summary });
}
