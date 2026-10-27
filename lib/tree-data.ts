// lib/tree-data.ts
//
// SERVER-ONLY. Loading the family tree and working out what the person
// asking is allowed to do with it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { addChildTargetIds, editableNodeIds, nodeFromRow, type TreeNode, type TreeRow } from "./family-tree.ts";
import type { Actor } from "./actors.ts";

/** Every column EXCEPT the photo itself, which is large and fetched separately. */
export const NODE_COLUMNS =
  "id, name, spouse_name, spouse_details, parent_id, spouse_id, member_id, date_of_birth, birthdate, work_education, bio, phone, hidden_fields, has_photo, deleted_at, created_at, updated_at";

/** Every person in the tree who has not been removed. */
export async function loadLiveNodes(db: SupabaseClient): Promise<TreeNode[]> {
  const { data } = await db.from("family_nodes").select(NODE_COLUMNS).is("deleted_at", null).limit(1000).returns<TreeRow[]>();
  return (data ?? []).map(nodeFromRow);
}

/** One person, removed or not. */
export async function loadNode(db: SupabaseClient, id: string): Promise<TreeNode | null> {
  const { data } = await db.from("family_nodes").select(NODE_COLUMNS).eq("id", id).maybeSingle<TreeRow>();
  return data ? nodeFromRow(data) : null;
}

export interface EditContext {
  nodes: TreeNode[];
  /** The viewer's own entry, if they have one. */
  mine: TreeNode | null;
  /** The entries they may edit. */
  editable: Set<string>;
  /** The entries they may add a child under. */
  addChildTargets: Set<string>;
}

/** Loads the tree and works out what this person may change. */
export async function loadEditContext(db: SupabaseClient, actor: Actor): Promise<EditContext> {
  const nodes = await loadLiveNodes(db);
  const mine = actor.memberId ? nodes.find((n) => n.memberId === actor.memberId) ?? null : null;
  return {
    nodes,
    mine,
    editable: editableNodeIds(nodes, mine?.id ?? null, actor.isAdmin),
    addChildTargets: addChildTargetIds(nodes, mine?.id ?? null, actor.isAdmin),
  };
}
