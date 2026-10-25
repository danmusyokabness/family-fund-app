// app/api/tree/history/route.ts
//
// GET -> the most recent changes to the family tree, who made them and
//        when, for everyone who is logged in. Admins also see which ones
//        can still be undone.

import { NextResponse } from "next/server";
import { getActor } from "@/lib/actors";
import { supabaseAdmin } from "@/lib/supabase";
import { changedFields } from "@/lib/family-tree";

interface HistoryRow {
  id: string;
  node_id: string;
  changed_by_name: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
  undone_at: string | null;
  family_nodes: { name: string } | null;
}

export async function GET() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  const { data, error } = await supabaseAdmin()
    .from("family_node_history")
    .select("id, node_id, changed_by_name, action, before, after, created_at, undone_at, family_nodes(name)")
    .order("created_at", { ascending: false })
    .limit(40)
    .returns<HistoryRow[]>();
  if (error) return NextResponse.json({ error: "Could not load the recent changes." }, { status: 500 });

  return NextResponse.json({
    isAdmin: actor.isAdmin,
    changes: (data ?? []).map((h) => ({
      id: h.id,
      at: h.created_at,
      by: h.changed_by_name,
      action: h.action,
      person: h.family_nodes?.name ?? "someone",
      // Which details an edit touched, by name only (never the old or new values, which may be private).
      fields: h.action === "update" ? changedFields((h.before ?? {}) as never, (h.after ?? {}) as never) : [],
      undone: Boolean(h.undone_at),
    })),
  });
}
