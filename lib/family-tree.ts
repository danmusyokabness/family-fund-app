// lib/family-tree.ts
//
// Pure rules for the family tree (decisions D12, D20 and A3):
//   * every logged-in member may add and edit nodes;
//   * nothing is ever permanently deleted (soft delete, undo from history);
//   * a tree can never contain a loop (nobody can be their own ancestor);
//   * a member with no node of their own must connect to the tree.
//
// No database and no web code here, so every rule can be tested with
// plain data. The API routes (Batch 2) call these functions.

import { normalizePhone } from "./phone.ts";

export interface TreeNode {
  id: string;
  name: string;
  spouseName: string | null;
  parentId: string | null;
  spouseId: string | null;
  memberId: string | null;
  /** "YYYY-MM-DD" or null. The sort key for "eldest first". */
  dateOfBirth: string | null;
  birthdate: string | null; // old free-text field, kept for approximate dates
  workEducation: string | null;
  bio: string | null;
  phone: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface TreeBranch {
  node: TreeNode;
  children: TreeBranch[];
}

// ---------------------------------------------------------------------
// Ordering: eldest first where the birth date is known, then unknown
// dates, then by when the node was created, then by name.
// ---------------------------------------------------------------------
export function compareSiblings(a: TreeNode, b: TreeNode): number {
  if (a.dateOfBirth && b.dateOfBirth && a.dateOfBirth !== b.dateOfBirth) return a.dateOfBirth < b.dateOfBirth ? -1 : 1;
  if (a.dateOfBirth && !b.dateOfBirth) return -1;
  if (!a.dateOfBirth && b.dateOfBirth) return 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/**
 * Builds the tree from a flat list. Deleted nodes are left out. A node
 * whose parent is missing or deleted is shown at the top level, so
 * nobody ever disappears from view because someone else was removed.
 */
export function buildForest(nodes: TreeNode[]): TreeBranch[] {
  const live = nodes.filter((n) => !n.deletedAt);
  const byId = new Map(live.map((n) => [n.id, n]));
  const childrenOf = new Map<string, TreeNode[]>();
  const roots: TreeNode[] = [];

  for (const node of live) {
    if (node.parentId && byId.has(node.parentId) && node.parentId !== node.id) {
      const list = childrenOf.get(node.parentId) ?? [];
      list.push(node);
      childrenOf.set(node.parentId, list);
    } else {
      roots.push(node);
    }
  }

  // The visited set protects against a loop that slipped into old data:
  // each node is shown at most once, so this can never run forever.
  const seen = new Set<string>();
  const build = (node: TreeNode): TreeBranch => {
    seen.add(node.id);
    const kids = (childrenOf.get(node.id) ?? []).filter((k) => !seen.has(k.id)).sort(compareSiblings);
    return { node, children: kids.map(build) };
  };

  const forest = roots.sort(compareSiblings).map(build);

  // Anything still unseen sits in a loop with no root; show each at the top level.
  for (const node of live) {
    if (!seen.has(node.id)) forest.push(build(node));
  }
  return forest;
}

/** Every ancestor id of a node, nearest first. Stops if it meets a loop. */
export function ancestorIds(nodes: TreeNode[], nodeId: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const result: string[] = [];
  const seen = new Set<string>([nodeId]);
  let current = byId.get(nodeId)?.parentId ?? null;
  while (current && !seen.has(current)) {
    result.push(current);
    seen.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return result;
}

/** Every descendant id of a node (children, grandchildren, ...). */
export function descendantIds(nodes: TreeNode[], nodeId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.deletedAt || !n.parentId) continue;
    const list = childrenOf.get(n.parentId) ?? [];
    list.push(n.id);
    childrenOf.set(n.parentId, list);
  }
  const result: string[] = [];
  const seen = new Set<string>([nodeId]);
  const queue = [nodeId];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const child of childrenOf.get(id) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      result.push(child);
      queue.push(child);
    }
  }
  return result;
}

/** Would making `newParentId` the parent of `nodeId` create a loop? */
export function wouldCreateCycle(nodes: TreeNode[], nodeId: string, newParentId: string | null): boolean {
  if (!newParentId) return false;
  if (newParentId === nodeId) return true;
  return ancestorIds(nodes, newParentId).includes(nodeId);
}

// ---------------------------------------------------------------------
// Editing: what a member is allowed to send, checked and cleaned.
// ---------------------------------------------------------------------
export interface NodePatch {
  name?: string;
  spouseName?: string | null;
  parentId?: string | null;
  spouseId?: string | null;
  dateOfBirth?: string | null;
  birthdate?: string | null;
  workEducation?: string | null;
  bio?: string | null;
  phone?: string | null;
}

export type PatchResult = { ok: true; patch: NodePatch } | { ok: false; errors: string[] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME = 120;
const MAX_TEXT = 2000;

function isRealDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * Checks an edit request. Only the fields that were sent are returned,
 * so an edit never wipes something it did not mention. An empty string
 * clears an optional field. `today` ("YYYY-MM-DD", Nairobi) stops birth
 * dates in the future.
 */
export function sanitizeNodePatch(input: Record<string, unknown>, today: string): PatchResult {
  const errors: string[] = [];
  const patch: NodePatch = {};
  const has = (key: string) => Object.prototype.hasOwnProperty.call(input, key);

  const textField = (key: keyof NodePatch, max: number, label: string) => {
    if (!has(key)) return;
    const v = input[key];
    if (v === null || v === "") {
      (patch as Record<string, unknown>)[key] = null;
    } else if (typeof v !== "string") {
      errors.push(`${label} must be text.`);
    } else if ([...v.trim()].length > max) {
      errors.push(`${label} is too long (most ${max} characters).`);
    } else {
      (patch as Record<string, unknown>)[key] = v.trim();
    }
  };

  if (has("name")) {
    const v = input.name;
    if (typeof v !== "string" || v.trim() === "") errors.push("A name is required.");
    else if ([...v.trim()].length > MAX_NAME) errors.push(`The name is too long (most ${MAX_NAME} characters).`);
    else patch.name = v.trim();
  }
  textField("spouseName", MAX_NAME, "Spouse name");
  textField("birthdate", 60, "Birth date note");
  textField("workEducation", MAX_TEXT, "Work / education");
  textField("bio", MAX_TEXT, "Bio");

  if (has("dateOfBirth")) {
    const v = input.dateOfBirth;
    if (v === null || v === "") patch.dateOfBirth = null;
    else if (typeof v !== "string" || !isRealDate(v)) errors.push("The birth date must be a real date, like 1961-03-27.");
    else if (v > today) errors.push("The birth date cannot be in the future.");
    else if (v < "1850-01-01") errors.push("That birth date looks too long ago. Please check it.");
    else patch.dateOfBirth = v;
  }

  if (has("phone")) {
    const v = input.phone;
    if (v === null || v === "") patch.phone = null;
    else if (typeof v !== "string" || !normalizePhone(v)) errors.push("That phone number is not a valid Kenyan mobile number.");
    else patch.phone = normalizePhone(v);
  }

  for (const key of ["parentId", "spouseId"] as const) {
    if (!has(key)) continue;
    const v = input[key];
    if (v === null || v === "") patch[key] = null;
    else if (typeof v !== "string" || !UUID_RE.test(v)) errors.push("That family member could not be found.");
    else patch[key] = v;
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, patch };
}

// ---------------------------------------------------------------------
// History: which fields actually changed, for the change log and undo.
// ---------------------------------------------------------------------
const TRACKED: (keyof TreeNode)[] = [
  "name",
  "spouseName",
  "parentId",
  "spouseId",
  "memberId",
  "dateOfBirth",
  "birthdate",
  "workEducation",
  "bio",
  "phone",
];

export function changedFields(before: Partial<TreeNode>, after: Partial<TreeNode>): (keyof TreeNode)[] {
  return TRACKED.filter((key) => (before[key] ?? null) !== (after[key] ?? null));
}

// ---------------------------------------------------------------------
// First login (D20): help a member with no node connect to the tree.
// ---------------------------------------------------------------------
function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** 0 to 1: how much two names overlap, ignoring case, order and punctuation. */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.max(ta.size, tb.size);
}

/** Unlinked nodes that might already be this member (so they can claim it instead of making a duplicate). Best match first. */
export function rankClaimCandidates(nodes: TreeNode[], memberName: string): TreeNode[] {
  return nodes
    .filter((n) => !n.deletedAt && !n.memberId)
    .map((n) => ({ n, score: nameSimilarity(n.name, memberName) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || compareSiblings(a.n, b.n))
    .map((x) => x.n);
}

/**
 * Nodes this member could attach themselves under as a child, best first:
 * a shared surname (the last word of the name) ranks highest, so the
 * likely parent is suggested first. Everyone live is returned so the
 * member can always choose someone else.
 */
export function rankParentCandidates(nodes: TreeNode[], memberName: string): TreeNode[] {
  const lastWord = (s: string) => tokens(s).slice(-1)[0] ?? "";
  const mine = lastWord(memberName);
  return nodes
    .filter((n) => !n.deletedAt)
    .map((n) => ({ n, score: (mine && lastWord(n.name) === mine ? 2 : 0) + nameSimilarity(n.name, memberName) }))
    .sort((a, b) => b.score - a.score || compareSiblings(a.n, b.n))
    .map((x) => x.n);
}

/** True when this member still has to connect to the tree (D20). */
export function needsToConnect(nodes: TreeNode[], memberId: string): boolean {
  return !nodes.some((n) => !n.deletedAt && n.memberId === memberId);
}
