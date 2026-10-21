// lib/member-order.ts
//
// ONE place that decides the order members are listed in (the ledger on
// the dashboard, and the member list the admin sees), so the two can
// never disagree.
//
// The rule (decision D19, extended):
//   1. Members whose date of birth is known come first, eldest first.
//      (The date comes from the family-tree node linked to the member.)
//   2. Everyone whose date of birth is NOT known comes after them, in the
//      order the admin chose with the up/down buttons (members.sort_order,
//      smaller number = higher up). A member the admin has never placed
//      (sort_order empty) goes after the ones they did place.
//   3. If two members are still tied, alphabetical by name decides.
//
// So the admin's manual order only matters for members with no known
// birth date. As soon as a birth date is filled in on the family tree,
// that member slots into the right age position automatically.
//
// Pure: no database, no dates "today", easy to test.

export interface OrderableMember {
  id: string;
  fullName: string;
  /** "YYYY-MM-DD" or null when not known. */
  dateOfBirth: string | null;
  /** The admin's manual position (1, 2, 3...) or null when never placed. */
  sortOrder: number | null;
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function compareSortOrder(a: number | null, b: number | null): number {
  if (a !== null && b !== null) return a === b ? 0 : a < b ? -1 : 1;
  if (a !== null) return -1; // placed beats never-placed
  if (b !== null) return 1;
  return 0;
}

export function compareMembers(a: OrderableMember, b: OrderableMember): number {
  const aKnown = a.dateOfBirth !== null && a.dateOfBirth !== "";
  const bKnown = b.dateOfBirth !== null && b.dateOfBirth !== "";

  if (aKnown && bKnown) {
    if (a.dateOfBirth !== b.dateOfBirth) return (a.dateOfBirth as string) < (b.dateOfBirth as string) ? -1 : 1;
    const bySort = compareSortOrder(a.sortOrder, b.sortOrder);
    return bySort !== 0 ? bySort : compareNames(a.fullName, b.fullName);
  }
  if (aKnown) return -1;
  if (bKnown) return 1;

  const bySort = compareSortOrder(a.sortOrder, b.sortOrder);
  return bySort !== 0 ? bySort : compareNames(a.fullName, b.fullName);
}

export function sortMembers<T extends OrderableMember>(members: T[]): T[] {
  return [...members].sort(compareMembers);
}

/** True when the admin's manual order is what decides this member's position. */
export function isManuallyOrdered(member: OrderableMember): boolean {
  return member.dateOfBirth === null || member.dateOfBirth === "";
}

/**
 * Moves one member up or down among the members that can be moved
 * (those with no known birth date) and returns the new full list of ids
 * in display order. Members with a known birth date never move — they
 * are placed by age. Returns null if the move is impossible (already at
 * the top/bottom of the movable group, or the member can't be moved).
 *
 * The returned list contains ONLY the movable members' ids, in their new
 * order; the caller saves positions 1..n for them.
 */
export function moveWithinManualGroup<T extends OrderableMember>(
  members: T[],
  memberId: string,
  direction: "up" | "down"
): string[] | null {
  const movable = sortMembers(members).filter(isManuallyOrdered);
  const index = movable.findIndex((m) => m.id === memberId);
  if (index === -1) return null;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= movable.length) return null;

  const ids = movable.map((m) => m.id);
  [ids[index], ids[target]] = [ids[target], ids[index]];
  return ids;
}
