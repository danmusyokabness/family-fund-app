import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBoardMessage, checkPostRate, visibleToMember, groupPrivateThreads, MAX_MESSAGE_LENGTH, type BoardRow } from "../lib/board.ts";

function row(partial: Partial<BoardRow>): BoardRow {
  return {
    id: "r", memberId: null, senderName: "Someone", content: "hi", isPrivate: false, isFromAdmin: false,
    createdAt: "2026-10-01T10:00:00.000Z", readAt: null, deletedAt: null, ...partial,
  };
}

test("validateBoardMessage trims, rejects empty and non-text, and enforces the length limit", () => {
  assert.deepEqual(validateBoardMessage("  hello  "), { ok: true, content: "hello" });
  assert.equal(validateBoardMessage("   ").ok, false);
  assert.equal(validateBoardMessage(undefined).ok, false);
  assert.equal(validateBoardMessage(42).ok, false);
  assert.equal(validateBoardMessage("a".repeat(MAX_MESSAGE_LENGTH)).ok, true);
  assert.equal(validateBoardMessage("a".repeat(MAX_MESSAGE_LENGTH + 1)).ok, false);
});

test("validateBoardMessage strips hidden control characters but keeps new lines, and limits blank lines", () => {
  const result = validateBoardMessage("line one\u0000\u0007\r\nline two\n\n\n\n\n\nline three");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.content, "line one\nline two\n\n\nline three");
});

test("checkPostRate allows posting under the limit and says how long to wait once it is reached", () => {
  const now = new Date("2026-10-01T12:00:00.000Z");
  const recent = (minutesAgo: number[]) => minutesAgo.map((m) => new Date(now.getTime() - m * 60000).toISOString());

  assert.deepEqual(checkPostRate(recent([5, 10, 15]), now), { allowed: true });

  const full = checkPostRate(recent([1, 2, 3, 4, 5, 6, 7, 8, 9, 50]), now);
  assert.equal(full.allowed, false);
  if (!full.allowed) assert.equal(full.retryAfterMinutes, 10); // the 50-minute-old post leaves the hour in 10 minutes

  // Posts older than an hour do not count.
  assert.deepEqual(checkPostRate(recent([61, 70, 90, 120, 130, 140, 150, 160, 170, 180]), now), { allowed: true });
});

test("a member can see public posts and their OWN private thread, and nothing else", () => {
  assert.equal(visibleToMember(row({ isPrivate: false, memberId: "other" }), "me"), true);
  assert.equal(visibleToMember(row({ isPrivate: true, memberId: "me" }), "me"), true);
  assert.equal(visibleToMember(row({ isPrivate: true, memberId: "other" }), "me"), false);
  assert.equal(visibleToMember(row({ isPrivate: true, memberId: null }), "me"), false);
});

test("deleted messages are never shown to anyone, public or private", () => {
  const deleted = "2026-10-02T00:00:00.000Z";
  assert.equal(visibleToMember(row({ isPrivate: false, deletedAt: deleted }), "me"), false);
  assert.equal(visibleToMember(row({ isPrivate: true, memberId: "me", deletedAt: deleted }), "me"), false);
});

test("groupPrivateThreads makes one thread per member, newest activity first, with an unread count", () => {
  const rows = [
    row({ id: "1", memberId: "a", isPrivate: true, content: "first", createdAt: "2026-10-01T08:00:00.000Z" }),
    row({ id: "2", memberId: "a", isPrivate: true, content: "admin reply", isFromAdmin: true, createdAt: "2026-10-01T09:00:00.000Z" }),
    row({ id: "3", memberId: "b", isPrivate: true, content: "hello", createdAt: "2026-10-02T08:00:00.000Z" }),
    row({ id: "4", memberId: "a", isPrivate: true, content: "thanks", createdAt: "2026-10-01T10:00:00.000Z", readAt: "2026-10-01T11:00:00.000Z" }),
    row({ id: "5", memberId: "a", isPrivate: false, content: "public, ignored" }),
    row({ id: "6", memberId: "c", isPrivate: true, content: "deleted", deletedAt: "2026-10-03T00:00:00.000Z" }),
  ];
  const threads = groupPrivateThreads(rows, { a: "Anna", b: "Boaz" });
  assert.equal(threads.length, 2);
  assert.equal(threads[0].memberName, "Boaz"); // most recent activity first
  assert.equal(threads[0].unreadCount, 1);
  assert.equal(threads[1].memberName, "Anna");
  assert.deepEqual(threads[1].messages.map((x) => x.id), ["1", "2", "4"]); // oldest first
  assert.equal(threads[1].unreadCount, 1); // "first" is unread; the admin's own reply and the read message do not count
});

import { boardRowFromDb, canRemoveMessage, type BoardDbRow } from "../lib/board.ts";

const DB_ROW: BoardDbRow = {
  id: "m1", member_id: "a", sender_name: "Ann", content: "Hello", is_private: false, is_from_admin: null,
  created_at: "2026-10-01T10:00:00.000Z", read_at: null, deleted_at: null,
};

test("a database row becomes a board message; a missing admin flag means 'not from the admin'", () => {
  const row = boardRowFromDb(DB_ROW);
  assert.equal(row.isFromAdmin, false);
  assert.equal(row.senderName, "Ann");
  assert.equal(boardRowFromDb({ ...DB_ROW, is_from_admin: true }).isFromAdmin, true);
});

test("who may remove a message: an admin any; an author only their own PUBLIC post; nobody a message already removed", () => {
  const publicPost = boardRowFromDb(DB_ROW);
  assert.equal(canRemoveMessage(publicPost, { memberId: "a", isAdmin: false }), true); // own post
  assert.equal(canRemoveMessage(publicPost, { memberId: "b", isAdmin: false }), false); // someone else's
  assert.equal(canRemoveMessage(publicPost, { memberId: null, isAdmin: true }), true); // admin
  const privateMsg = boardRowFromDb({ ...DB_ROW, is_private: true });
  assert.equal(canRemoveMessage(privateMsg, { memberId: "a", isAdmin: false }), false); // private: admin only
  assert.equal(canRemoveMessage(privateMsg, { memberId: null, isAdmin: true }), true);
  const gone = boardRowFromDb({ ...DB_ROW, deleted_at: "2026-10-02T00:00:00.000Z" });
  assert.equal(canRemoveMessage(gone, { memberId: null, isAdmin: true }), false);
  const adminReply = boardRowFromDb({ ...DB_ROW, is_from_admin: true, member_id: "a" });
  assert.equal(canRemoveMessage(adminReply, { memberId: "a", isAdmin: false }), false); // a member cannot delete the admin's words
});
