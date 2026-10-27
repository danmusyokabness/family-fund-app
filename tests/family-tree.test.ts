import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildForest, wouldCreateCycle, ancestorIds, descendantIds, sanitizeNodePatch, changedFields, nameSimilarity,
  rankClaimCandidates, rankParentCandidates, needsToConnect, editableNodeIds, addChildTargetIds, viewForViewer, withRanks,
  nodeFromRow, rowFromPatch, HIDEABLE_FIELDS, type TreeNode, type TreeRow,
} from "../lib/family-tree.ts";

let counter = 0;
function node(partial: Partial<TreeNode> & { id: string; name: string }): TreeNode {
  counter++;
  return {
    spouseName: null, spouseDetails: null, parentId: null, spouseId: null, memberId: null, dateOfBirth: null, birthdate: null,
    workEducation: null, bio: null, phone: null, hiddenFields: [], hasPhoto: false, deletedAt: null,
    createdAt: `2026-01-01T00:00:${String(counter).padStart(2, "0")}.000Z`, updatedAt: `2026-01-01T00:00:${String(counter).padStart(2, "0")}.000Z`,
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


// ---------------------------------------------------------------------
// Who may edit what, and which details a person can hide
// ---------------------------------------------------------------------
// grandpa -> dad (member Dan) -> me (member Mia) -> kid; dad -> auntie; auntie -> cousin
function family() {
  return [
    node({ id: "gp", name: "Grandpa" }),
    node({ id: "dad", name: "Dad", parentId: "gp" }),
    node({ id: "auntie", name: "Auntie", parentId: "gp" }),
    node({ id: "me", name: "Mia", parentId: "dad", memberId: "m-mia" }),
    node({ id: "sis", name: "Sis", parentId: "dad" }),
    node({ id: "kid", name: "Kid", parentId: "me" }),
    node({ id: "cousin", name: "Cousin", parentId: "auntie" }),
  ];
}

test("a member may edit their own entry, their parent's and their children's, and nobody else's", () => {
  const ids = [...editableNodeIds(family(), "me", false)].sort();
  assert.deepEqual(ids, ["dad", "kid", "me"]);
  // not siblings, grandparents, aunts, cousins
  for (const other of ["sis", "gp", "auntie", "cousin"]) assert.ok(!ids.includes(other));
});

test("an admin may edit everyone; a member with no entry yet may edit nothing; removed people are not editable", () => {
  assert.equal(editableNodeIds(family(), null, true).size, 7);
  assert.equal(editableNodeIds(family(), null, false).size, 0);
  assert.equal(editableNodeIds(family(), "not-a-node", false).size, 0);
  const withGone = family().map((n) => (n.id === "kid" ? { ...n, deletedAt: "2026-10-01T00:00:00.000Z" } : n));
  assert.ok(!editableNodeIds(withGone, "me", false).has("kid"));
});

test("a member may add a child under themselves (their own child) or under their parent (a brother or sister), nowhere else", () => {
  assert.deepEqual([...addChildTargetIds(family(), "me", false)].sort(), ["dad", "me"]);
  assert.equal(addChildTargetIds(family(), "gp", false).size, 1); // a root has no parent to add siblings under: only themselves
  assert.equal(addChildTargetIds(family(), null, true).size, 7);
});

test("hidden details are removed for people who may not edit the entry, and kept for those who may", () => {
  const person = node({ id: "p", name: "Pat", phone: "254700000001", bio: "Likes fishing", dateOfBirth: "1960-05-05", hiddenFields: ["phone", "dateOfBirth"] });
  const stranger = viewForViewer(person, false);
  assert.equal(stranger.phone, null);
  assert.equal(stranger.dateOfBirth, null);
  assert.equal(stranger.bio, "Likes fishing"); // not hidden
  assert.deepEqual(stranger.hiddenFields, []); // the list of what is hidden is not revealed
  assert.ok(!("deletedAt" in stranger));
  const owner = viewForViewer(person, true);
  assert.equal(owner.phone, "254700000001");
  assert.equal(owner.dateOfBirth, "1960-05-05");
  assert.deepEqual(owner.hiddenFields, ["phone", "dateOfBirth"]);
});

test("nothing is hidden unless the person chose to, so a phone number is visible by default", () => {
  const person = node({ id: "p", name: "Pat", phone: "254700000001" });
  assert.equal(viewForViewer(person, false).phone, "254700000001");
});

test("only real, hideable details can be hidden; the name and photo can never be hidden", () => {
  assert.deepEqual([...HIDEABLE_FIELDS], ["phone", "dateOfBirth", "birthdate", "workEducation", "bio", "spouseName", "spouseDetails"]);
  assert.deepEqual(sanitizeNodePatch({ hiddenFields: ["phone", "bio", "phone"] }, "2026-10-21"), { ok: true, patch: { hiddenFields: ["phone", "bio"] } });
  assert.equal(sanitizeNodePatch({ hiddenFields: ["name"] }, "2026-10-21").ok, false);
  assert.equal(sanitizeNodePatch({ hiddenFields: "phone" }, "2026-10-21").ok, false);
  assert.deepEqual(sanitizeNodePatch({ hiddenFields: [] }, "2026-10-21"), { ok: true, patch: { hiddenFields: [] } });
});

test("spouse details are optional text, and an edit that only reorders the hidden list changes nothing", () => {
  assert.deepEqual(sanitizeNodePatch({ spouseDetails: "  Teacher in Kisumu " }, "2026-10-21"), { ok: true, patch: { spouseDetails: "Teacher in Kisumu" } });
  assert.deepEqual(changedFields({ hiddenFields: ["phone", "bio"] }, { hiddenFields: ["bio", "phone"] }), []);
  assert.deepEqual(changedFields({ hiddenFields: [] }, { hiddenFields: ["phone"] }), ["hiddenFields"]);
});

test("everyone sees the same eldest-first order, even when a birth date is hidden from them", () => {
  const nodes = withRanks([
    node({ id: "young", name: "Young", dateOfBirth: "1990-01-01" }),
    node({ id: "old", name: "Old", dateOfBirth: "1950-01-01" }),
    node({ id: "mid", name: "Mid", dateOfBirth: "1970-01-01" }),
  ]);
  // A stranger sees them with the birth dates hidden, but the order still follows the real dates.
  const hidden = nodes.map((n) => ({ ...n, dateOfBirth: null }));
  assert.deepEqual(buildForest(hidden).map((b) => b.node.name), ["Old", "Mid", "Young"]);
});

const ROW: TreeRow = {
  id: "n1", name: "Jane Doe", spouse_name: "John Doe", spouse_details: "Teacher", parent_id: "p1", spouse_id: null, member_id: "m1", date_of_birth: "1961-03-27",
  birthdate: null, work_education: "Teacher", bio: "Hello", phone: "254700000001", hidden_fields: ["phone"], has_photo: true, deleted_at: null,
  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-02-01T00:00:00.000Z",
};

test("a database row becomes a node, and an edit becomes database columns", () => {
  const n = nodeFromRow(ROW);
  assert.equal(n.spouseName, "John Doe");
  assert.equal(n.spouseDetails, "Teacher");
  assert.deepEqual(n.hiddenFields, ["phone"]);
  assert.equal(n.hasPhoto, true);
  assert.equal(n.updatedAt, "2026-02-01T00:00:00.000Z");
  assert.deepEqual(rowFromPatch({ spouseName: "Jo", hiddenFields: ["bio"], workEducation: null, nonsense: "x" } as never), { spouse_name: "Jo", hidden_fields: ["bio"], work_education: null });
  // Rows from before the migration have no hidden list or photo flag.
  const old = nodeFromRow({ ...ROW, hidden_fields: null, has_photo: null, updated_at: null });
  assert.deepEqual(old.hiddenFields, []);
  assert.equal(old.hasPhoto, false);
  assert.equal(old.updatedAt, old.createdAt);
});

import { parsePhotoDataUrl, photoToBuffer, MAX_PHOTO_BYTES } from "../lib/tree-photo.ts";

const dataUrl = (mime: string, bytes: number) => `data:${mime};base64,${Buffer.alloc(bytes, 7).toString("base64")}`;

test("profile photos: a small JPEG, PNG or WebP is accepted", () => {
  for (const mime of ["image/jpeg", "image/png", "image/webp"]) {
    const result = parsePhotoDataUrl(dataUrl(mime, 5000));
    assert.equal(result.ok, true, mime);
    if (result.ok) assert.equal(result.bytes, 5000);
  }
});

test("profile photos: anything else is refused (other types, scripts, damaged text, too big, too small, not text)", () => {
  assert.equal(parsePhotoDataUrl(dataUrl("image/svg", 5000)).ok, false); // SVG can carry scripts
  assert.equal(parsePhotoDataUrl(dataUrl("image/gif", 5000)).ok, false);
  assert.equal(parsePhotoDataUrl("data:text/html;base64,PHNjcmlwdD4=").ok, false);
  assert.equal(parsePhotoDataUrl("not a data url").ok, false);
  assert.equal(parsePhotoDataUrl("data:image/jpeg;base64,@@@@").ok, false);
  assert.equal(parsePhotoDataUrl(dataUrl("image/jpeg", MAX_PHOTO_BYTES + 3)).ok, false);
  assert.equal(parsePhotoDataUrl(dataUrl("image/jpeg", 10)).ok, false);
  assert.equal(parsePhotoDataUrl(undefined).ok, false);
  assert.equal(parsePhotoDataUrl(42).ok, false);
});

test("a stored photo comes back as the same bytes with its type", () => {
  const stored = dataUrl("image/jpeg", 300);
  const back = photoToBuffer(stored);
  assert.equal(back?.mime, "image/jpeg");
  assert.equal(back?.data.length, 300);
  assert.equal(photoToBuffer("rubbish"), null);
});
