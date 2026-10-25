import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildForest, wouldCreateCycle, ancestorIds, descendantIds, sanitizeNodePatch, changedFields, nameSimilarity,
  rankClaimCandidates, rankParentCandidates, needsToConnect, type TreeNode,
} from "../lib/family-tree.ts";

let counter = 0;
function node(partial: Partial<TreeNode> & { id: string; name: string }): TreeNode {
  counter++;
  return {
    spouseName: null, parentId: null, spouseId: null, memberId: null, dateOfBirth: null, birthdate: null,
    workEducation: null, bio: null, phone: null, deletedAt: null, createdAt: `2026-01-01T00:00:${String(counter).padStart(2, "0")}.000Z`,
    ...partial,
  };
}
const names = (branches: { node: TreeNode }[]) => branches.map((b) => b.node.name);

test("buildForest nests children under parents and orders siblings eldest first, unknown ages last", () => {
  const nodes = [
    node({ id: "root", name: "Grandpa" }),
    node({ id: "c1", name: "Young", parentId: "root", dateOfBirth: "1990-01-01" }),
    node({ id: "c2", name: "Eldest", parentId: "root", dateOfBirth: "1960-01-01" }),
    node({ id: "c3", name: "Unknown", parentId: "root" }),
  ];
  const forest = buildForest(nodes);
  assert.equal(forest.length, 1);
  assert.deepEqual(names(forest[0].children), ["Eldest", "Young", "Unknown"]);
});

test("deleted nodes disappear, and their children are shown at the top level instead of vanishing", () => {
  const nodes = [
    node({ id: "p", name: "Parent", deletedAt: "2026-10-01T00:00:00.000Z" }),
    node({ id: "k", name: "Kid", parentId: "p" }),
  ];
  const forest = buildForest(nodes);
  assert.deepEqual(names(forest), ["Kid"]);
});

test("buildForest survives a loop that slipped into old data: every node still appears once and it ends", () => {
  const nodes = [node({ id: "a", name: "A", parentId: "b" }), node({ id: "b", name: "B", parentId: "a" })];
  const forest = buildForest(nodes);
  const all: string[] = [];
  const walk = (list: { node: TreeNode; children: unknown[] }[]) => list.forEach((b) => { all.push(b.node.name); walk(b.children as never); });
  walk(forest);
  assert.deepEqual(all.sort(), ["A", "B"]);
});

test("ancestors and descendants are found across several generations", () => {
  const nodes = [
    node({ id: "g", name: "G" }), node({ id: "p", name: "P", parentId: "g" }),
    node({ id: "c", name: "C", parentId: "p" }), node({ id: "d", name: "D", parentId: "p" }),
  ];
  assert.deepEqual(ancestorIds(nodes, "c"), ["p", "g"]);
  assert.deepEqual(descendantIds(nodes, "g").sort(), ["c", "d", "p"]);
  assert.deepEqual(descendantIds(nodes, "c"), []);
});

test("wouldCreateCycle stops anyone becoming their own ancestor", () => {
  const nodes = [node({ id: "g", name: "G" }), node({ id: "p", name: "P", parentId: "g" }), node({ id: "c", name: "C", parentId: "p" })];
  assert.equal(wouldCreateCycle(nodes, "g", "c"), true); // grandparent under grandchild
  assert.equal(wouldCreateCycle(nodes, "p", "p"), true); // own parent
  assert.equal(wouldCreateCycle(nodes, "c", "g"), false); // moving up is fine
  assert.equal(wouldCreateCycle(nodes, "c", null), false);
});

test("sanitizeNodePatch returns only what was sent, trimmed, so an edit never wipes other fields", () => {
  const result = sanitizeNodePatch({ name: "  Jane Doe  ", bio: "Teacher" }, "2026-10-21");
  assert.deepEqual(result, { ok: true, patch: { name: "Jane Doe", bio: "Teacher" } });
});

test("sanitizeNodePatch: an empty string clears an optional field, but a name can never be blank", () => {
  assert.deepEqual(sanitizeNodePatch({ bio: "" }, "2026-10-21"), { ok: true, patch: { bio: null } });
  const blank = sanitizeNodePatch({ name: "   " }, "2026-10-21");
  assert.equal(blank.ok, false);
});

test("sanitizeNodePatch checks birth dates: real, not in the future, not absurdly old", () => {
  assert.equal(sanitizeNodePatch({ dateOfBirth: "1961-03-27" }, "2026-10-21").ok, true);
  assert.equal(sanitizeNodePatch({ dateOfBirth: "1961-02-30" }, "2026-10-21").ok, false);
  assert.equal(sanitizeNodePatch({ dateOfBirth: "27/03/1961" }, "2026-10-21").ok, false);
  assert.equal(sanitizeNodePatch({ dateOfBirth: "2027-01-01" }, "2026-10-21").ok, false);
  assert.equal(sanitizeNodePatch({ dateOfBirth: "1700-01-01" }, "2026-10-21").ok, false);
  assert.deepEqual(sanitizeNodePatch({ dateOfBirth: "" }, "2026-10-21"), { ok: true, patch: { dateOfBirth: null } });
});

test("sanitizeNodePatch normalises phones, rejects bad ids and over-long text", () => {
  assert.deepEqual(sanitizeNodePatch({ phone: "0712 345 678" }, "2026-10-21"), { ok: true, patch: { phone: "254712345678" } });
  assert.equal(sanitizeNodePatch({ phone: "12345" }, "2026-10-21").ok, false);
  assert.equal(sanitizeNodePatch({ parentId: "not-a-uuid" }, "2026-10-21").ok, false);
  assert.equal(sanitizeNodePatch({ parentId: "123e4567-e89b-12d3-a456-426614174000" }, "2026-10-21").ok, true);
  assert.equal(sanitizeNodePatch({ bio: "x".repeat(2001) }, "2026-10-21").ok, false);
});

test("changedFields lists only what actually changed, treating empty and missing as the same", () => {
  const before = { name: "A", bio: null, phone: "254700000001" };
  const after = { name: "A", bio: "Hello", phone: "254700000001" };
  assert.deepEqual(changedFields(before, after), ["bio"]);
  assert.deepEqual(changedFields({ bio: null }, { bio: undefined }), []);
});

test("nameSimilarity ignores case, order and punctuation", () => {
  assert.equal(nameSimilarity("Jane Doe", "doe, jane"), 1);
  assert.equal(nameSimilarity("Jane Doe", "Jane Smith"), 0.5);
  assert.equal(nameSimilarity("Jane", "Peter"), 0);
  assert.equal(nameSimilarity("", "Peter"), 0);
});

test("first login: a member is offered unlinked nodes that look like them, best match first, never already-linked ones", () => {
  const nodes = [
    node({ id: "1", name: "Mary Kataka" }),
    node({ id: "2", name: "Mary Wafula" }),
    node({ id: "3", name: "Mary Kataka", memberId: "someone-else" }),
    node({ id: "4", name: "Peter Odhiambo" }),
  ];
  const candidates = rankClaimCandidates(nodes, "Mary Kataka");
  assert.deepEqual(candidates.map((n) => n.id), ["1", "2"]);
});

test("first login: the likely parent (same surname) is suggested first, and everyone else is still choosable", () => {
  const nodes = [
    node({ id: "1", name: "Peter Odhiambo" }),
    node({ id: "2", name: "Samuel Kataka" }),
    node({ id: "3", name: "Grace Wafula" }),
  ];
  const ranked = rankParentCandidates(nodes, "Mary Kataka");
  assert.equal(ranked[0].id, "2");
  assert.equal(ranked.length, 3);
});

test("needsToConnect is true until a live node is linked to the member; deleted nodes do not count", () => {
  assert.equal(needsToConnect([], "m1"), true);
  assert.equal(needsToConnect([node({ id: "1", name: "X", memberId: "m1" })], "m1"), false);
  assert.equal(needsToConnect([node({ id: "1", name: "X", memberId: "m1", deletedAt: "2026-10-01T00:00:00.000Z" })], "m1"), true);
});

import { nodeFromRow, rowFromPatch, snapshot, toPublicNode, planUndo, type TreeRow } from "../lib/family-tree.ts";

const ROW: TreeRow = {
  id: "n1", name: "Jane Doe", spouse_name: "John Doe", parent_id: "p1", spouse_id: null, member_id: "m1", date_of_birth: "1961-03-27",
  birthdate: null, work_education: "Teacher", bio: "Hello", phone: "254700000001", deleted_at: null, created_at: "2026-01-01T00:00:00.000Z",
};

test("a database row becomes a node, and an edit becomes database columns", () => {
  const node = nodeFromRow(ROW);
  assert.equal(node.spouseName, "John Doe");
  assert.equal(node.dateOfBirth, "1961-03-27");
  assert.equal(node.memberId, "m1");
  assert.deepEqual(rowFromPatch({ spouseName: "Jo", workEducation: null, nonsense: "x" } as never), { spouse_name: "Jo", work_education: null });
});

test("phone numbers are shown to the admin only", () => {
  const node = nodeFromRow(ROW);
  assert.equal(toPublicNode(node, true).phone, "254700000001");
  assert.equal(toPublicNode(node, false).phone, null);
  assert.ok(!("deletedAt" in toPublicNode(node, false)));
});

test("undo of an edit puts back only the fields that edit changed, never later changes to other fields", () => {
  const before = { ...snapshot(nodeFromRow(ROW)) };
  const after = { ...before, bio: "Changed bio", workEducation: "Principal" };
  const current = { ...nodeFromRow(ROW), bio: "Changed bio", workEducation: "Principal", spouseName: "Edited later by someone else" };
  const plan = planUndo({ action: "update", before, after, undoneAt: null }, current, "2026-10-23T00:00:00.000Z");
  assert.equal(plan.ok, true);
  if (plan.ok) {
    assert.deepEqual(plan.update, { bio: "Hello", work_education: "Teacher" });
    assert.ok(!("spouse_name" in plan.update)); // the later edit survives
  }
});

test("undo of a removal brings the person back; undo of an addition removes them again", () => {
  const removed = { ...nodeFromRow(ROW), memberId: null, deletedAt: "2026-10-01T00:00:00.000Z" };
  const back = planUndo({ action: "delete", before: snapshot(removed), after: null, undoneAt: null }, removed, "now");
  assert.deepEqual(back.ok && back.update, { deleted_at: null });

  const live = { ...nodeFromRow(ROW), memberId: null };
  const gone = planUndo({ action: "create", before: null, after: snapshot(live), undoneAt: null }, live, "2026-10-23T00:00:00.000Z");
  assert.deepEqual(gone.ok && gone.update, { deleted_at: "2026-10-23T00:00:00.000Z" });
});

test("undo refuses what would leave a member floating or what was already done", () => {
  const memberNode = nodeFromRow(ROW); // linked to a member
  assert.equal(planUndo({ action: "create", before: null, after: snapshot(memberNode), undoneAt: null }, memberNode, "now").ok, false);
  assert.equal(planUndo({ action: "update", before: {}, after: {}, undoneAt: "2026-10-01T00:00:00.000Z" }, memberNode, "now").ok, false);
  assert.equal(planUndo({ action: "update", before: { bio: "a" }, after: { bio: "a" }, undoneAt: null }, memberNode, "now").ok, false); // nothing changed
  assert.equal(planUndo({ action: "delete", before: null, after: null, undoneAt: null }, memberNode, "now").ok, false); // not removed
  assert.equal(planUndo({ action: "update", before: { bio: "a" }, after: { bio: "b" }, undoneAt: null }, null, "now").ok, false); // gone
  assert.equal(planUndo({ action: "restore", before: null, after: null, undoneAt: null }, memberNode, "now").ok, false);
});

test("undo of a claim unlinks the node, but only while it is still linked to that same member", () => {
  const node = nodeFromRow(ROW);
  const plan = planUndo({ action: "link", before: { memberId: null }, after: { memberId: "m1" }, undoneAt: null }, node, "now");
  assert.deepEqual(plan.ok && plan.update, { member_id: null });
  assert.equal(planUndo({ action: "link", before: { memberId: null }, after: { memberId: "someone-else" }, undoneAt: null }, node, "now").ok, false);
});
