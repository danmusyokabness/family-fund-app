import { test } from "node:test";
import assert from "node:assert/strict";
import { compareMembers, sortMembers, isManuallyOrdered, moveWithinManualGroup, type OrderableMember } from "../lib/member-order.ts";
import { buildDashboard } from "../lib/dashboard.ts";

function m(id: string, fullName: string, dateOfBirth: string | null, sortOrder: number | null): OrderableMember {
  return { id, fullName, dateOfBirth, sortOrder };
}
const ids = (list: OrderableMember[]) => list.map((x) => x.id);

test("known birth dates come first, eldest first", () => {
  const sorted = sortMembers([m("young", "Zed", "1990-01-01", null), m("old", "Amy", "1950-06-01", null), m("mid", "Bob", "1970-03-03", null)]);
  assert.deepEqual(ids(sorted), ["old", "mid", "young"]);
});

test("members with no birth date come after everyone whose age is known", () => {
  const sorted = sortMembers([m("u1", "Anna", null, 1), m("k1", "Zed", "1990-01-01", null)]);
  assert.deepEqual(ids(sorted), ["k1", "u1"]);
});

test("members with unknown ages follow the admin's manual order, not the alphabet", () => {
  const sorted = sortMembers([m("a", "Aaron", null, 3), m("b", "Beth", null, 1), m("c", "Carl", null, 2)]);
  assert.deepEqual(ids(sorted), ["b", "c", "a"]);
});

test("a member the admin never placed goes after the ones they did place, alphabetically among themselves", () => {
  const sorted = sortMembers([m("x", "Xavier", null, null), m("p", "Paul", null, 5), m("n", "Nina", null, null)]);
  assert.deepEqual(ids(sorted), ["p", "n", "x"]);
});

test("before any manual ordering, unknown ages fall back to alphabetical", () => {
  const sorted = sortMembers([m("c", "Carl", null, null), m("a", "Aaron", null, null), m("b", "Beth", null, null)]);
  assert.deepEqual(ids(sorted), ["a", "b", "c"]);
});

test("adding a birth date moves a member out of the manual group and into their age position automatically", () => {
  const before = [m("a", "Aaron", null, 1), m("b", "Beth", "1960-01-01", null), m("c", "Carl", null, 2)];
  assert.deepEqual(ids(sortMembers(before)), ["b", "a", "c"]);
  const after = before.map((x) => (x.id === "c" ? { ...x, dateOfBirth: "1940-05-05" } : x));
  assert.deepEqual(ids(sortMembers(after)), ["c", "b", "a"]);
});

test("two members born the same day are separated by manual order, then name", () => {
  assert.ok(compareMembers(m("a", "Zed", "1960-01-01", 1), m("b", "Amy", "1960-01-01", 2)) < 0);
  assert.ok(compareMembers(m("a", "Zed", "1960-01-01", null), m("b", "Amy", "1960-01-01", null)) > 0);
});

test("isManuallyOrdered is true only when the birth date is unknown", () => {
  assert.equal(isManuallyOrdered(m("a", "A", null, null)), true);
  assert.equal(isManuallyOrdered(m("a", "A", "", null)), true);
  assert.equal(isManuallyOrdered(m("a", "A", "1960-01-01", null)), false);
});

test("moveWithinManualGroup swaps neighbours and returns only the movable members in their new order", () => {
  const list = [m("k", "Known", "1950-01-01", null), m("a", "Aaron", null, 1), m("b", "Beth", null, 2), m("c", "Carl", null, 3)];
  assert.deepEqual(moveWithinManualGroup(list, "c", "up"), ["a", "c", "b"]);
  assert.deepEqual(moveWithinManualGroup(list, "a", "down"), ["b", "a", "c"]);
});

test("moveWithinManualGroup refuses impossible moves: top, bottom, an age-placed member, an unknown id", () => {
  const list = [m("k", "Known", "1950-01-01", null), m("a", "Aaron", null, 1), m("b", "Beth", null, 2)];
  assert.equal(moveWithinManualGroup(list, "a", "up"), null); // already first among the movable
  assert.equal(moveWithinManualGroup(list, "b", "down"), null); // already last
  assert.equal(moveWithinManualGroup(list, "k", "down"), null); // placed by age, cannot be moved
  assert.equal(moveWithinManualGroup(list, "nope", "up"), null);
});

test("the dashboard ledger rows use the same ordering, including the admin's manual order", () => {
  const result = buildDashboard({
    members: [
      { id: "u2", fullName: "Zara", joinedOn: "2026-08-01", dateOfBirth: null, sortOrder: 1 },
      { id: "k1", fullName: "Yusuf", joinedOn: "2026-08-01", dateOfBirth: "1955-02-02" },
      { id: "u1", fullName: "Abel", joinedOn: "2026-08-01", dateOfBirth: null, sortOrder: 2 },
    ],
    allocations: [],
    payments: [],
    expensesTotal: 0,
    targetAmount: 300,
    asOfMonth: "2026-10",
    viewerMemberId: null,
  });
  assert.deepEqual(result.rows.map((r) => r.memberId), ["k1", "u2", "u1"]);
});
