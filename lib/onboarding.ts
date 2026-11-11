// lib/onboarding.ts
//
// The first time a member opens the family tree they are asked to fill in
// their details. Pure rules for what that form must contain, so they can be
// tested without a database. The API route (app/api/tree/onboard) calls this.
//
//   * Required: the date of birth (an exact date, so the family can be put in
//     eldest-first order) and a parent. Everything else is optional, and the
//     person chooses what the family can see.
//   * The parent is chosen from the tree, or added ("my parent is not listed"),
//     or, only for someone already at the top of the tree (or the first person in
//     an empty tree), left as "top of the tree".
//   * A person who already has a parent in the tree keeps it; only an admin may
//     move someone to a different parent (that rule is unchanged).

import { sanitizeNodePatch, wouldCreateCycle, type NodePatch, type TreeNode } from "./family-tree.ts";

export type ParentPlan =
  | { kind: "keep" }
  | { kind: "existing"; id: string }
  | { kind: "new"; patch: NodePatch & { name: string } }
  | { kind: "top" };

export type OnboardingPlan = { ok: true; parent: ParentPlan } | { ok: false; error: string };

export interface OnboardingInput {
  nodes: TreeNode[];
  /** The member's own entry, if they already have one. */
  mine: TreeNode | null;
  /** The details sent, already checked by sanitizeNodePatch. */
  patch: NodePatch;
  /** What the form sent for the parent: { id } | { newParent: {...} } | { top: true } | nothing. */
  parent: unknown;
  /** "YYYY-MM-DD" in Nairobi. */
  today: string;
}

export function planOnboarding(input: OnboardingInput): OnboardingPlan {
  const { nodes, mine, patch, today } = input;
  const live = nodes.filter((n) => !n.deletedAt);

  // 1. The date of birth is required: the one already on the entry counts if the form did not change it.
  const dob = patch.dateOfBirth !== undefined ? patch.dateOfBirth : mine?.dateOfBirth ?? null;
  if (!dob) return { ok: false, error: "Your date of birth is required. You can hide it from the family with the \"Show to the family\" tick." };

  // 2. A parent already in the tree is kept.
  if (mine && mine.parentId && live.some((n) => n.id === mine.parentId)) return { ok: true, parent: { kind: "keep" } };

  const raw = input.parent && typeof input.parent === "object" ? (input.parent as Record<string, unknown>) : {};

  // 3. An existing person from the list.
  if (typeof raw.id === "string" && raw.id !== "") {
    const chosen = live.find((n) => n.id === raw.id);
    if (!chosen) return { ok: false, error: "That parent could not be found. Choose again." };
    if (mine && (chosen.id === mine.id || wouldCreateCycle(nodes, mine.id, chosen.id))) {
      return { ok: false, error: "That would make someone their own ancestor. Choose a different parent." };
    }
    return { ok: true, parent: { kind: "existing", id: chosen.id } };
  }

  // 4. A parent who is not in the tree yet: added now.
  if (raw.newParent && typeof raw.newParent === "object") {
    const np = raw.newParent as Record<string, unknown>;
    const checked = sanitizeNodePatch({ name: np.name, dateOfBirth: np.dateOfBirth, birthdate: np.birthdate }, today);
    if (!checked.ok) return { ok: false, error: checked.errors.join(" ") };
    if (!checked.patch.name) return { ok: false, error: "Enter your parent's name." };
    if (!checked.patch.dateOfBirth && !checked.patch.birthdate) {
      return { ok: false, error: "Enter your parent's date of birth, or an approximate one such as \"around 1950\"." };
    }
    return { ok: true, parent: { kind: "new", patch: { ...checked.patch, name: checked.patch.name } } };
  }

  // 5. The top of the tree: only for someone already there, or the very first person.
  if (raw.top === true) {
    if (mine || live.length === 0) return { ok: true, parent: { kind: "top" } };
    return { ok: false, error: "Choose your parent from the list, or add them." };
  }

  return { ok: false, error: "Choose your parent from the list, or add them." };
}
