import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildForest, wouldCreateCycle, ancestorIds, descendantIds, sanitizeNodePatch, changedFields, nameSimilarity,
  rankClaimCandidates, rankParentCandidates, needsToConnect, editableNodeIds, addChildTargetIds, viewForViewer, withRanks,
  nodeFromRow, rowFromPatch, HIDEABLE_FIELDS, needsProfile, birthKey, type TreeNode, type TreeRow,
} from "../lib/family-tree.ts";
import { planOnboarding } from "../lib/onboarding.ts";
import { collectSuggestions } from "../lib/profile.ts";

let counter = 0;
function node(partial: Partial<TreeNode> & { id: string; name: string }): TreeNode {
  counter++;
  return {
    spouseName: null, spouseDetails: null, parentId: null, spouseId: null, memberId: null, dateOfBirth: null, birthdate: null,
    workEducation: null, education: [], work: [], residence: null, bio: null, phone: null, hiddenFields: [], hasPhoto: false, profileCompletedAt: null, deletedAt: null,
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
  assert.deepEqual([...HIDEABLE_FIELDS], ["phone", "dateOfBirth", "birthdate", "workEducation", "education", "work", "residence", "bio", "spouseName", "spouseDetails"]);
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
  birthdate: null, work_education: "Teacher", education: null, work: null, residence: null, bio: "Hello", phone: "254700000001", hidden_fields: ["phone"], has_photo: true, profile_completed_at: null, deleted_at: null,
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

import { generationOf, colourSlot, GENERATION_COLOURS, clampZoom, fitZoom, MIN_ZOOM, MAX_ZOOM } from "../lib/family-tree.ts";

test("generations: the top of the tree is generation 0, their children 1, and cousins share a generation", () => {
  const depth = generationOf(buildForest(family()));
  assert.equal(depth.get("gp"), 0);
  assert.equal(depth.get("dad"), 1);
  assert.equal(depth.get("auntie"), 1);
  assert.equal(depth.get("me"), 2);
  assert.equal(depth.get("cousin"), 2); // a cousin is in the same generation as me
  assert.equal(depth.get("kid"), 3);
  assert.equal(depth.size, 7);
});

test("generations: separate family lines each start at generation 0, and an empty tree has none", () => {
  const depth = generationOf(buildForest([node({ id: "a", name: "A" }), node({ id: "b", name: "B" }), node({ id: "c", name: "C", parentId: "b" })]));
  assert.equal(depth.get("a"), 0);
  assert.equal(depth.get("b"), 0);
  assert.equal(depth.get("c"), 1);
  assert.equal(generationOf([]).size, 0);
});

test("each generation gets its own colour, and very deep trees cycle back to the first colours", () => {
  assert.equal(GENERATION_COLOURS, 8);
  const slots = [0, 1, 2, 3, 4, 5, 6, 7].map(colourSlot);
  assert.equal(new Set(slots).size, 8); // eight different colours
  assert.equal(colourSlot(8), 0);
  assert.equal(colourSlot(9), 1);
  assert.equal(colourSlot(-1), 7); // never out of range
});

test("zoom is kept between the smallest and largest allowed, and nonsense becomes 100%", () => {
  assert.equal(clampZoom(0.01), MIN_ZOOM);
  assert.equal(clampZoom(50), MAX_ZOOM);
  assert.equal(clampZoom(1.25), 1.25);
  assert.equal(clampZoom(NaN), 1);
});

test("fit to screen: a wide tree shrinks to the width, a tall one to the height, a small one stays at 100%", () => {
  const room = { width: 1000, height: 600 };
  assert.equal(fitZoom({ width: 2000, height: 300 }, room), 0.5); // too wide
  assert.equal(fitZoom({ width: 500, height: 1200 }, room), 0.5); // too tall
  assert.equal(fitZoom({ width: 2000, height: 2400 }, room), 0.25); // both: the tighter limit wins
  assert.equal(fitZoom({ width: 400, height: 200 }, room), 1); // already fits: never enlarged
  assert.equal(fitZoom({ width: 100000, height: 100 }, room), MIN_ZOOM); // never smaller than the minimum
  assert.equal(fitZoom({ width: 0, height: 0 }, room), 1); // nothing measured yet
  assert.equal(fitZoom({ width: 500, height: 500 }, { width: 0, height: 0 }), 1);
});

import { sanitizeEducation, sanitizeWork, sanitizeResidence, describeEducation, describeWork, describeResidence } from "../lib/profile.ts";
import { regionsFor, KENYA_COUNTIES, COUNTRIES, DEFAULT_COUNTRY } from "../lib/data/places.ts";

test("regression: fields a form did not send are treated as not sent (this caused 'Spouse name must be text' when joining the tree)", () => {
  const result = sanitizeNodePatch({ dateOfBirth: "1990-05-05", workEducation: undefined, bio: undefined, spouseName: undefined }, "2026-10-21");
  assert.deepEqual(result, { ok: true, patch: { dateOfBirth: "1990-05-05" } });
});

test("profile: education entries are checked (level from the list, an institution, optional months, 'current' clears the end)", () => {
  const ok = sanitizeEducation([{ level: "Bachelor's degree", institution: "  University of Nairobi ", course: "BSc Computer Science", startMonth: "2014-09", endMonth: "2018-12" }], "2026-10");
  assert.deepEqual(ok, { ok: true, value: [{ level: "Bachelor's degree", institution: "University of Nairobi", course: "BSc Computer Science", startMonth: "2014-09", endMonth: "2018-12", current: false }] });
  const now = sanitizeEducation([{ level: "Diploma", institution: "KMTC", startMonth: "2025-09", endMonth: "2027-01", current: true }], "2026-10");
  assert.deepEqual(now.ok && now.value[0].endMonth, null);
  assert.equal(sanitizeEducation([{ level: "Wizard school", institution: "X" }], "2026-10").ok, false);
  assert.equal(sanitizeEducation([{ level: "Diploma", institution: "" }], "2026-10").ok, false);
  assert.equal(sanitizeEducation([{ level: "Diploma", institution: "X", startMonth: "2018-12", endMonth: "2018-01" }], "2026-10").ok, false);
  assert.equal(sanitizeEducation([{ level: "Diploma", institution: "X", startMonth: "2018-13" }], "2026-10").ok, false);
  assert.equal(sanitizeEducation(Array.from({ length: 9 }, () => ({ level: "Diploma", institution: "X" })), "2026-10").ok, false);
});

test("profile: work entries and residence are checked, and read as plain lines", () => {
  assert.equal(sanitizeWork([{ status: "Astronaut" }], "2026-10").ok, false);
  assert.equal(sanitizeWork([{ status: "Not working yet" }], "2026-10").ok, true);
  assert.deepEqual(sanitizeResidence({ country: "Kenya", region: "Nairobi", place: " Kasarani " }), { ok: true, value: { country: "Kenya", region: "Nairobi", place: "Kasarani" } });
  assert.deepEqual(sanitizeResidence({ country: "", region: "", place: "" }), { ok: true, value: null });
  assert.equal(sanitizeResidence({ region: "Nairobi" }).ok, false);
  assert.equal(describeEducation({ level: "Bachelor's degree", institution: "University of Nairobi", course: "BSc Computer Science", startMonth: "2014-09", endMonth: "2018-12", current: false }), "Bachelor's degree, BSc Computer Science at University of Nairobi (Sep 2014 to Dec 2018)");
  assert.equal(describeWork({ status: "Employed", employer: "Kenya Power", title: "Engineer", sector: "Energy and mining", startMonth: "2020-02", endMonth: null, current: true }), "Engineer at Kenya Power (Employed, Energy and mining), Feb 2020 to now");
  assert.equal(describeResidence({ country: "Kenya", region: "Nairobi", place: "Kasarani" }), "Kasarani, Nairobi, Kenya");
});

test("the option lists: Kenya is the default country with its 47 counties; other countries have no preset regions", () => {
  assert.equal(DEFAULT_COUNTRY, "Kenya");
  assert.equal(COUNTRIES[0], "Kenya");
  assert.equal(new Set(COUNTRIES).size, COUNTRIES.length);
  assert.equal(KENYA_COUNTIES.length, 47);
  assert.equal(new Set(KENYA_COUNTIES).size, 47);
  assert.deepEqual(regionsFor("kenya"), KENYA_COUNTIES);
  assert.deepEqual(regionsFor("Canada"), []);
});

// ---------------------------------------------------------------------
// First visit: education, work, residence, and the details form's rules
// ---------------------------------------------------------------------
const EDU = { level: "Bachelor's degree", institution: "University of Nairobi", course: "BSc Computer Science", startMonth: "2014-09", endMonth: "2018-12", current: false };
const JOB = { status: "Employed", employer: "Kenya Power", title: "Engineer", sector: "Energy and mining", startMonth: "2020-02", endMonth: null, current: true };
const HOME = { country: "Kenya", region: "Nairobi", place: "Kasarani" };

test("tree edits accept education, work and residence (checked), and never accept the 'details done' mark from a request", () => {
  const ok = sanitizeNodePatch({ education: [EDU], work: [JOB], residence: HOME }, "2026-11-11");
  assert.deepEqual(ok, { ok: true, patch: { education: [EDU], work: [JOB], residence: HOME } });
  assert.equal(sanitizeNodePatch({ education: [{ level: "Wizard school", institution: "X" }] }, "2026-11-11").ok, false);
  assert.equal(sanitizeNodePatch({ work: "none" }, "2026-11-11").ok, false);
  assert.equal(sanitizeNodePatch({ residence: { region: "Nairobi" } }, "2026-11-11").ok, false);
  assert.deepEqual(sanitizeNodePatch({ residence: null }, "2026-11-11"), { ok: true, patch: { residence: null } });
  assert.deepEqual(sanitizeNodePatch({ profileCompletedAt: "2026-01-01T00:00:00Z", memberId: "x" }, "2026-11-11"), { ok: true, patch: {} });
  assert.deepEqual(sanitizeNodePatch({ education: undefined, work: undefined, residence: undefined }, "2026-11-11"), { ok: true, patch: {} });
  assert.equal(sanitizeNodePatch({ hiddenFields: ["education", "work", "residence"] }, "2026-11-11").ok, true);
});

test("hiding education, work or residence blanks them for the family, and the owner and editors still see them", () => {
  const person = node({ id: "p", name: "Pat", education: [EDU], work: [JOB], residence: HOME, hiddenFields: ["education", "residence"] });
  const family = viewForViewer(person, false);
  assert.deepEqual(family.education, []);
  assert.equal(family.residence, null);
  assert.deepEqual(family.work, [JOB]);
  assert.deepEqual(family.hiddenFields, []);
  const owner = viewForViewer(person, true);
  assert.deepEqual(owner.education, [EDU]);
  assert.deepEqual(owner.residence, HOME);
});

test("an edit that changes education, work or residence counts as a change, and the same entries do not", () => {
  assert.deepEqual(changedFields({ education: [EDU] }, { education: [{ ...EDU, institution: "Moi University" }] }), ["education"]);
  assert.deepEqual(changedFields({ education: [EDU] }, { education: [{ ...EDU }] }), []);
  assert.deepEqual(changedFields({ work: [] }, { work: [JOB] }), ["work"]);
  assert.deepEqual(changedFields({ residence: null }, { residence: HOME }), ["residence"]);
  assert.deepEqual(changedFields({ residence: HOME }, { residence: { ...HOME } }), []);
  assert.deepEqual(changedFields({ profileCompletedAt: null }, { profileCompletedAt: "2026-11-11T08:00:00.000Z" }), ["profileCompletedAt"]);
});

test("rows from before the migration have empty education, work and residence; the new columns map both ways", () => {
  const old = nodeFromRow(ROW);
  assert.deepEqual([old.education, old.work, old.residence, old.profileCompletedAt], [[], [], null, null]);
  const filled = nodeFromRow({ ...ROW, education: [EDU], work: [JOB], residence: HOME, profile_completed_at: "2026-11-11T08:00:00.000Z" });
  assert.deepEqual([filled.education, filled.work, filled.residence, filled.profileCompletedAt], [[EDU], [JOB], HOME, "2026-11-11T08:00:00.000Z"]);
  assert.deepEqual(rowFromPatch({ education: [EDU], residence: null, profileCompletedAt: "x" }), { education: [EDU], residence: null, profile_completed_at: "x" });
  for (const field of ["education", "work", "residence"]) assert.ok((HIDEABLE_FIELDS as readonly string[]).includes(field));
});

test("a member is asked for their details once: when they have no entry, or their entry was never completed", () => {
  assert.equal(needsProfile([], "m1"), true);
  assert.equal(needsProfile([node({ id: "1", name: "X", memberId: "m1" })], "m1"), true); // in the tree, never completed: pre-filled form
  assert.equal(needsProfile([node({ id: "1", name: "X", memberId: "m1", profileCompletedAt: "2026-11-11T08:00:00.000Z" })], "m1"), false);
  assert.equal(needsProfile([node({ id: "1", name: "X", memberId: "m1", deletedAt: "2026-10-01T00:00:00.000Z", profileCompletedAt: "2026-11-11T08:00:00.000Z" })], "m1"), true);
  assert.equal(needsProfile([node({ id: "1", name: "X", memberId: "m2" })], "m1"), true); // someone else's entry does not count
});

test("the details form: date of birth is required (an existing one counts), and a parent already in the tree is kept", () => {
  const dad = node({ id: "dad", name: "Dad" });
  const me = node({ id: "me", name: "Me", memberId: "m1", parentId: "dad", dateOfBirth: "1990-04-04" });
  const nodes = [dad, me];
  assert.deepEqual(planOnboarding({ nodes, mine: me, patch: {}, parent: undefined, today: "2026-11-11" }), { ok: true, parent: { kind: "keep" } });
  // the form clearing the date of birth is not allowed
  const cleared = planOnboarding({ nodes, mine: me, patch: { dateOfBirth: null }, parent: undefined, today: "2026-11-11" });
  assert.equal(cleared.ok, false);
  // no date anywhere: refused
  const bare = node({ id: "me2", name: "Me2", memberId: "m2", parentId: "dad" });
  assert.equal(planOnboarding({ nodes: [dad, bare], mine: bare, patch: {}, parent: undefined, today: "2026-11-11" }).ok, false);
  assert.equal(planOnboarding({ nodes: [dad, bare], mine: bare, patch: { dateOfBirth: "1991-01-01" }, parent: undefined, today: "2026-11-11" }).ok, true);
});

test("the details form: a new member must choose a parent, add one, or (only at the top or in an empty tree) say they are at the top", () => {
  const dad = node({ id: "dad", name: "Dad" });
  const patch = { dateOfBirth: "1990-04-04" };
  const today = "2026-11-11";
  // nothing chosen
  assert.equal(planOnboarding({ nodes: [dad], mine: null, patch, parent: undefined, today }).ok, false);
  assert.equal(planOnboarding({ nodes: [dad], mine: null, patch, parent: { id: "" }, today }).ok, false);
  // an existing person, or one that does not exist
  assert.deepEqual(planOnboarding({ nodes: [dad], mine: null, patch, parent: { id: "dad" }, today }), { ok: true, parent: { kind: "existing", id: "dad" } });
  assert.equal(planOnboarding({ nodes: [dad], mine: null, patch, parent: { id: "ghost" }, today }).ok, false);
  // "my parent is not listed": needs a name and a date of birth or an approximate one
  const added = planOnboarding({ nodes: [dad], mine: null, patch, parent: { newParent: { name: "Mum", dateOfBirth: "1960-01-01" } }, today });
  assert.deepEqual(added, { ok: true, parent: { kind: "new", patch: { name: "Mum", dateOfBirth: "1960-01-01" } } });
  assert.equal(planOnboarding({ nodes: [dad], mine: null, patch, parent: { newParent: { name: "Mum", birthdate: "around 1960" } }, today }).ok, true);
  assert.equal(planOnboarding({ nodes: [dad], mine: null, patch, parent: { newParent: { name: "Mum" } }, today }).ok, false);
  assert.equal(planOnboarding({ nodes: [dad], mine: null, patch, parent: { newParent: { name: "", dateOfBirth: "1960-01-01" } }, today }).ok, false);
  assert.equal(planOnboarding({ nodes: [dad], mine: null, patch, parent: { newParent: { name: "Mum", dateOfBirth: "2999-01-01" } }, today }).ok, false);
  // the top of the tree: only the very first person, or someone already without a parent
  assert.equal(planOnboarding({ nodes: [dad], mine: null, patch, parent: { top: true }, today }).ok, false);
  assert.deepEqual(planOnboarding({ nodes: [], mine: null, patch, parent: { top: true }, today }), { ok: true, parent: { kind: "top" } });
  const root = node({ id: "root", name: "Root", memberId: "m9", dateOfBirth: "1950-01-01" });
  assert.deepEqual(planOnboarding({ nodes: [root], mine: root, patch: {}, parent: { top: true }, today }), { ok: true, parent: { kind: "top" } });
});

test("the details form: someone who already has an entry cannot choose themselves or their own descendant as their parent", () => {
  const root = node({ id: "root", name: "Root", memberId: "m1", dateOfBirth: "1950-01-01" });
  const kid = node({ id: "kid", name: "Kid", parentId: "root" });
  const today = "2026-11-11";
  assert.equal(planOnboarding({ nodes: [root, kid], mine: root, patch: {}, parent: { id: "root" }, today }).ok, false);
  assert.equal(planOnboarding({ nodes: [root, kid], mine: root, patch: {}, parent: { id: "kid" }, today }).ok, false);
});

test("siblings with only an approximate birth are placed by that year, between those with exact dates", () => {
  assert.equal(birthKey({ dateOfBirth: "1961-03-27", birthdate: "around 1950" }), "1961-03-27"); // a real date wins
  assert.equal(birthKey({ dateOfBirth: null, birthdate: "around 1950" }), "1950-07-01");
  assert.equal(birthKey({ dateOfBirth: null, birthdate: "the 1960s" }), "1960-07-01");
  assert.equal(birthKey({ dateOfBirth: null, birthdate: "12345" }), null); // not a year
  assert.equal(birthKey({ dateOfBirth: null, birthdate: "long ago" }), null);
  const a = node({ id: "a", name: "A", dateOfBirth: "1948-01-01" });
  const b = node({ id: "b", name: "B", birthdate: "around 1955" });
  const c = node({ id: "c", name: "C", dateOfBirth: "1962-06-06" });
  const d = node({ id: "d", name: "D" }); // no date at all: after everyone with one
  assert.deepEqual(buildForest([d, c, b, a]).map((x) => x.node.name), ["A", "B", "C", "D"]);
});

test("suggestions: what the family already typed is offered first, most used first, spelled the way people spelled it, with no repeats", () => {
  const edu = (institution: string) => ({ level: "Diploma", institution, course: null, startMonth: null, endMonth: null, current: false });
  const job = (employer: string | null, title: string | null) => ({ status: "Employed", employer, title, sector: null, startMonth: null, endMonth: null, current: true });
  const result = collectSuggestions([
    { education: [edu("Moi University"), edu("Kenyatta University")], work: [job("Kenya Power", "Engineer")] },
    { education: [edu("moi university")], work: [job("kenya power", "Engineer"), job(null, "  ")] },
    { education: [edu("Moi University")] },
    {},
  ]);
  assert.deepEqual(result.institutions, ["Moi University", "Kenyatta University"]);
  assert.deepEqual(result.employers, ["Kenya Power"]);
  assert.deepEqual(result.titles, ["Engineer"]);
  assert.deepEqual(collectSuggestions([]), { institutions: [], employers: [], titles: [] });
});

