// lib/tree-data.ts
//
// SERVER-ONLY. Loading the family tree and writing its change log.

import type { SupabaseClient } from "@supabase/supabase-js";
import { nodeFromRow, snapshot, type TreeNode, type TreeRow } from "./family-tree.ts";
import type { Actor } from "./actors.ts";

/** Every person in the tree who has not been removed. */
export async function loadLiveNodes(db: SupabaseClient): Promise<TreeNode[]> {
  const { data } = await db.from("family_nodes").select("*").is("deleted_at", null).limit(1000).returns<TreeRow[]>();
  return (data ?? []).map(nodeFromRow);
}

/** One person, removed or not. */
export async function loadNode(db: SupabaseClient, id: string): Promise<TreeNode | null> {
  const { data } = await db.from("family_nodes").select("*").eq("id", id).maybeSingle<TreeRow>();
  return data ? nodeFromRow(data) : null;
}

/** Writes one line in the change log. Never throws: a logging problem must not undo a real change. */
export async function recordHistory(
  db: SupabaseClient,
  entry: { nodeId: string; actor: Actor; action: "create" | "update" | "delete" | "restore" | "link"; before: TreeNode | null; after: TreeNode | null }
): Promise<void> {
  try {
    await db.from("family_node_history").insert({
      node_id: entry.nodeId,
      changed_by_member_id: entry.actor.memberId,
      changed_by_name: entry.actor.name,
      action: entry.action,
      before: entry.before ? snapshot(entry.before) : null,
      after: entry.after ? snapshot(entry.after) : null,
    });
  } catch {
    /* see above */
  }
}
