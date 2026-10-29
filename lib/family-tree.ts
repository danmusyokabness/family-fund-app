// lib/family-tree.ts
//
// Pure rules for the family tree (decisions D12, D19, D20, A3):
//   * a member may edit their OWN entry, their PARENT's entry and their
//     CHILDREN's entries; an admin may edit everyone;
//   * each person (or whoever fills in their details) decides which
//     optional details the rest of the family can see;
//   * nothing is ever permanently deleted (soft delete);
//   * a tree can never contain a loop (nobody is their own ancestor);
//   * a member with no entry of their own must connect to the tree.
//
// No database and no web code here, so every rule can be tested with
// plain data. The API routes call these functions.

import { normalizePhone } from "./phone.ts";

/** Details a person can choose to hide from the rest of the family. Name and photo are always shown. */
export const HIDEABLE_FIELDS = ["phone", "dateOfBirth", "birthdate", "workEducation", "bio", "spouseName", "spouseDetails"] as const;
export type HideableField = (typeof HIDEABLE_FIELDS)[number];

export interface TreeNode {
  id: string;
  name: string;
  spouseName: string | null;
  /** Optional extra information about the spouse (kept low-key on purpose). */
  spouseDetails: string | null;
  parentId: string | null;
  spouseId: string | null;
  memberId: string | null;
  /** "YYYY-MM-DD" or null. The sort key for "eldest first". */
  dateOfBirth: string | null;
  birthdate: string | null; // free text, for approximate dates
  workEducation: string | null;
  bio: string | null;
  phone: string | null;
  /** The details this person has chosen NOT to show to the rest of the family. */
  hiddenFields: string[];
  hasPhoto: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Position among all the family in eldest-first order, worked out on the
   * server from the REAL birth dates. It lets everyone see the same order
   * without the birth dates themselves being shown.
   */
  rank?: number;
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
  if (a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank;
  if (a.dateOfBirth && b.dateOfBirth && a.dateOfBirth !== b.dateOfBirth) return a.dateOfBirth < b.dateOfBirth ? -1 : 1;
  if (a.dateOfBirth && !b.dateOfBirth) return -1;
  if (!a.dateOfBirth && b.dateOfBirth) return 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/** Gives every node its place in eldest-first order, from the real data. */
export function withRanks<T extends TreeNode>(nodes: T[]): T[] {
  const sorted = [...nodes].sort((a, b) => compareSiblings({ ...a, rank: undefined }, { ...b, rank: undefined }));
  const rankOf = new Map(sorted.map((n, i) => [n.id, i]));
  return nodes.map((n) => ({ ...n, rank: rankOf.get(n.id) }));
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
// Who may change what
// ---------------------------------------------------------------------

/**
 * The entries this viewer may edit: their own, their parent's and their
 * children's. An admin may edit every entry. A viewer with no entry of
 * their own (not yet connected) may edit nothing.
 */
export function editableNodeIds(nodes: TreeNode[], myNodeId: string | null, isAdmin: boolean): Set<string> {
  const live = nodes.filter((n) => !n.deletedAt);
  if (isAdmin) return new Set(live.map((n) => n.id));
  const mine = myNodeId ? live.find((n) => n.id === myNodeId) : undefined;
  if (!mine) return new Set();
  const ids = new Set<string>([mine.id]);
  if (mine.parentId && live.some((n) => n.id === mine.parentId)) ids.add(mine.parentId);
  for (const n of live) if (n.parentId === mine.id) ids.add(n.id);
  return ids;
}

/**
 * The entries this viewer may add a CHILD under: themselves (their own
 * child) and their parent (a brother or sister). An admin may add under
 * anyone.
 */
export function addChildTargetIds(nodes: TreeNode[], myNodeId: string | null, isAdmin: boolean): Set<string> {
  const live = nodes.filter((n) => !n.deletedAt);
  if (isAdmin) return new Set(live.map((n) => n.id));
  const mine = myNodeId ? live.find((n) => n.id === myNodeId) : undefined;
  if (!mine) return new Set();
  const ids = new Set<string>([mine.id]);
  if (mine.parentId && live.some((n) => n.id === mine.parentId)) ids.add(mine.parentId);
  return ids;
}

/** A node as shown to a viewer. */
export type PublicTreeNode = Omit<TreeNode, "deletedAt">;

/**
 * What a viewer is shown. The details a person chose to hide are removed
 * unless the viewer is allowed to edit that entry (the person, their
 * parent, their children, or an admin), who need to see them to edit them.
 * The list of hidden details is only sent to those same people.
 */
export function viewForViewer(node: TreeNode, canSeeHidden: boolean): PublicTreeNode {
  const { deletedAt: _deletedAt, ...rest } = node;
  void _deletedAt;
  if (canSeeHidden) return { ...rest };
  const view: PublicTreeNode = { ...rest, hiddenFields: [] };
  for (const field of node.hiddenFields) {
    if ((HIDEABLE_FIELDS as readonly string[]).includes(field)) (view as unknown as Record<string, unknown>)[field] = null;
  }
  return view;
}

// ---------------------------------------------------------------------
// Editing: what a member is allowed to send, checked and cleaned.
// ---------------------------------------------------------------------
export interface NodePatch {
  name?: string;
  spouseName?: string | null;
  spouseDetails?: string | null;
  parentId?: string | null;
  spouseId?: string | null;
  dateOfBirth?: string | null;
  birthdate?: string | null;
  workEducation?: string | null;
  bio?: string | null;
  phone?: string | null;
  hiddenFields?: string[];
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
  textField("spouseDetails", MAX_TEXT, "Spouse details");
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

  if (has("hiddenFields")) {
    const v = input.hiddenFields;
    if (!Array.isArray(v) || !v.every((f) => typeof f === "string")) {
      errors.push("The list of hidden details is not valid.");
    } else {
      const unknown = v.filter((f) => !(HIDEABLE_FIELDS as readonly string[]).includes(f));
      if (unknown.length > 0) errors.push(`"${unknown[0]}" is not something that can be hidden.`);
      else patch.hiddenFields = [...new Set(v as string[])];
    }
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
// Which fields actually changed (so an edit that changes nothing is skipped).
// ---------------------------------------------------------------------
const TRACKED: (keyof TreeNode)[] = [
  "name",
  "spouseName",
  "spouseDetails",
  "parentId",
  "spouseId",
  "memberId",
  "dateOfBirth",
  "birthdate",
  "workEducation",
  "bio",
  "phone",
  "hiddenFields",
];

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = [...((a as string[] | null | undefined) ?? [])].sort().join("|");
    const y = [...((b as string[] | null | undefined) ?? [])].sort().join("|");
    return x === y;
  }
  return (a ?? null) === (b ?? null);
}

export function changedFields(before: Partial<TreeNode>, after: Partial<TreeNode>): (keyof TreeNode)[] {
  return TRACKED.filter((key) => !same(before[key], after[key]));
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

// ---------------------------------------------------------------------
// Database rows <-> nodes
// ---------------------------------------------------------------------
export interface TreeRow {
  id: string;
  name: string;
  spouse_name: string | null;
  spouse_details: string | null;
  parent_id: string | null;
  spouse_id: string | null;
  member_id: string | null;
  date_of_birth: string | null;
  birthdate: string | null;
  work_education: string | null;
  bio: string | null;
  phone: string | null;
  hidden_fields: string[] | null;
  has_photo: boolean | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export function nodeFromRow(r: TreeRow): TreeNode {
  return {
    id: r.id,
    name: r.name,
    spouseName: r.spouse_name,
    spouseDetails: r.spouse_details,
    parentId: r.parent_id,
    spouseId: r.spouse_id,
    memberId: r.member_id,
    dateOfBirth: r.date_of_birth,
    birthdate: r.birthdate,
    workEducation: r.work_education,
    bio: r.bio,
    phone: r.phone,
    hiddenFields: r.hidden_fields ?? [],
    hasPhoto: r.has_photo === true,
    deletedAt: r.deleted_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? r.created_at,
  };
}

const COLUMN_OF: Record<string, string> = {
  name: "name",
  spouseName: "spouse_name",
  spouseDetails: "spouse_details",
  parentId: "parent_id",
  spouseId: "spouse_id",
  memberId: "member_id",
  dateOfBirth: "date_of_birth",
  birthdate: "birthdate",
  workEducation: "work_education",
  bio: "bio",
  phone: "phone",
  hiddenFields: "hidden_fields",
};

/** An edit (camelCase) as database columns (snake_case). Unknown keys are dropped. */
export function rowFromPatch(patch: Partial<Record<keyof TreeNode, unknown>>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const column = COLUMN_OF[key];
    if (column) row[column] = value === undefined ? null : value;
  }
  return row;
}

// ---------------------------------------------------------------------
// How the tree is drawn: colours by generation, and fitting it to the screen.
// ---------------------------------------------------------------------

/** How many different generation colours there are; deeper generations start again from the first. */
export const GENERATION_COLOURS = 8;

/** Which generation each person is in: 0 for the top of the tree, 1 for their children, and so on. */
export function generationOf(forest: TreeBranch[]): Map<string, number> {
  const depths = new Map<string, number>();
  const walk = (branch: TreeBranch, depth: number) => {
    depths.set(branch.node.id, depth);
    for (const child of branch.children) walk(child, depth + 1);
  };
  for (const root of forest) walk(root, 0);
  return depths;
}

/** The colour slot (0 to GENERATION_COLOURS - 1) for a generation. */
export function colourSlot(generation: number): number {
  return ((generation % GENERATION_COLOURS) + GENERATION_COLOURS) % GENERATION_COLOURS;
}

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 2;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * The zoom at which the whole tree fits in the space available, never
 * enlarging past full size. A tree that already fits is shown at 100%.
 */
export function fitZoom(natural: { width: number; height: number }, available: { width: number; height: number }): number {
  if (natural.width <= 0 || natural.height <= 0 || available.width <= 0 || available.height <= 0) return 1;
  return clampZoom(Math.min(1, available.width / natural.width, available.height / natural.height));
}
