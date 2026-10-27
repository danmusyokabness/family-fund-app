import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateBoardMessage, checkPostRate, visibleToMember, visibleToAdminInbox, canRemoveMessage, conversationKey, groupConversations,
  groupPrivateThreads, boardRowFromDb, MAX_MESSAGE_LENGTH, type BoardRow, type BoardDbRow,
} from "../lib/board.ts";

function row(partial: Partial<BoardRow>): BoardRow {
  return {
    id: "r", memberId: null, senderName: "Someone", content: "hi", isPrivate: false, isFromAdmin: false, toAdmin: false,
    recipientMemberId: null, createdAt: "2026-10-01T10:00:00.000Z", readAt: null, deletedAt: null, ...partial,
  };
}
const names = { a: "Anna", b: "Boaz", c: "Cara" };

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
  if (!full.allowed) assert.equal(full.retryAfterMinutes, 10);
  assert.deepEqual(checkPostRate(recent([61, 70, 90, 120, 130, 140, 150, 160, 170, 180]), now), { allowed: true });
});

test("public messages are for everyone; private ones only for the two people in them", () => {
  assert.equal(visibleToMember(row({ memberId: "a" }), "z"), true);
  // Anna writes privately to Boaz
  const dm = row({ memberId: "a", isPrivate: true, recipientMemberId: "b" });
  assert.equal(visibleToMember(dm, "a"), true);
  assert.equal(visibleToMember(dm, "b"), true);
  assert.equal(visibleToMember(dm, "c"), false); // a third member can never see it
  // Anna writes to the admin; the admin replies
  const toAdmin = row({ memberId: "a", isPrivate: true, toAdmin: true });
  const reply = row({ memberId: "a", isPrivate: true, isFromAdmin: true });
  assert.equal(visibleToMember(toAdmin, "a"), true);
  assert.equal(visibleToMember(reply, "a"), true);
  assert.equal(visibleToMember(toAdmin, "b"), false);
  assert.equal(visibleToMember(reply, "b"), false);
});

test("deleted messages are never shown to anyone", () => {
  const gone = "2026-10-02T00:00:00.000Z";
  assert.equal(visibleToMember(row({ deletedAt: gone }), "a"), false);
  assert.equal(visibleToMember(row({ memberId: "a", isPrivate: true, toAdmin: true, deletedAt: gone }), "a"), false);
  assert.equal(visibleToAdminInbox(row({ memberId: "a", isPrivate: true, toAdmin: true, deletedAt: gone })), false);
});

test("the admin's inbox holds messages to the admin and the admin's replies, and NEVER a chat between two members", () => {
  assert.equal(visibleToAdminInbox(row({ memberId: "a", isPrivate: true, toAdmin: true })), true);
  assert.equal(visibleToAdminInbox(row({ memberId: "a", isPrivate: true, isFromAdmin: true })), true);
  assert.equal(visibleToAdminInbox(row({ memberId: "a", isPrivate: true, recipientMemberId: "b" })), false);
  assert.equal(visibleToAdminInbox(row({ memberId: "a" })), false); // public messages are not "inbox"
});

test("conversationKey puts each message in the right conversation for the member looking", () => {
  assert.equal(conversationKey(row({ memberId: "a" }), "b"), "public");
  const dm = row({ memberId: "a", isPrivate: true, recipientMemberId: "b" });
  assert.equal(conversationKey(dm, "a"), "member:b"); // Anna's view: the chat with Boaz
  assert.equal(conversationKey(dm, "b"), "member:a"); // Boaz's view: the chat with Anna
  assert.equal(conversationKey(dm, "c"), null);
  assert.equal(conversationKey(row({ memberId: "a", isPrivate: true, toAdmin: true }), "a"), "admin");
  assert.equal(conversationKey(row({ memberId: "a", isPrivate: true, isFromAdmin: true }), "a"), "admin");
});

test("groupConversations: Everyone first, then the most recent chats, with unread counted only for messages TO me", () => {
  const rows = [
    row({ id: "1", memberId: "b", content: "public hello", createdAt: "2026-10-01T08:00:00.000Z" }),
    row({ id: "2", memberId: "b", isPrivate: true, recipientMemberId: "a", content: "hi Anna", createdAt: "2026-10-01T09:00:00.000Z" }), // to me, unread
    row({ id: "3", memberId: "a", isPrivate: true, recipientMemberId: "b", content: "hi Boaz", createdAt: "2026-10-01T09:30:00.000Z" }), // from me
    row({ id: "4", memberId: "a", isPrivate: true, toAdmin: true, content: "question", createdAt: "2026-10-02T09:00:00.000Z" }), // from me
    row({ id: "5", memberId: "a", isPrivate: true, isFromAdmin: true, content: "answer", createdAt: "2026-10-02T10:00:00.000Z" }), // admin reply to me, unread
    row({ id: "6", memberId: "c", isPrivate: true, recipientMemberId: "b", content: "not mine", createdAt: "2026-10-03T09:00:00.000Z" }), // someone else's chat
  ];
  const conversations = groupConversations(rows, "a", names);
  assert.deepEqual(conversations.map((c) => c.key), ["public", "admin", "member:b"]);
  assert.equal(conversations[0].title, "Everyone");
  assert.equal(conversations[1].title, "Admin");
  assert.equal(conversations[2].title, "Boaz");
  assert.equal(conversations[0].unread, 0);
  assert.equal(conversations[1].unread, 1); // the admin's answer
  assert.equal(conversations[2].unread, 1); // Boaz's message to me
  assert.deepEqual(conversations[2].messages.map((m) => m.id), ["2", "3"]); // oldest first
  assert.ok(!conversations.some((c) => c.messages.some((m) => m.id === "6")));
});

test("groupPrivateThreads (the admin inbox) makes one thread per member, newest activity first, with an unread count", () => {
  const rows = [
    row({ id: "1", memberId: "a", isPrivate: true, toAdmin: true, createdAt: "2026-10-01T08:00:00.000Z" }),
    row({ id: "2", memberId: "a", isPrivate: true, isFromAdmin: true, createdAt: "2026-10-01T09:00:00.000Z" }),
    row({ id: "3", memberId: "b", isPrivate: true, toAdmin: true, createdAt: "2026-10-02T08:00:00.000Z" }),
    row({ id: "4", memberId: "a", isPrivate: true, toAdmin: true, createdAt: "2026-10-01T10:00:00.000Z", readAt: "2026-10-01T11:00:00.000Z" }),
    row({ id: "5", memberId: "a", content: "public, ignored" }),
    row({ id: "6", memberId: "c", isPrivate: true, toAdmin: true, deletedAt: "2026-10-03T00:00:00.000Z" }),
    row({ id: "7", memberId: "a", isPrivate: true, recipientMemberId: "b" }), // a chat between two members: never in the inbox
  ];
  const threads = groupPrivateThreads(rows, names);
  assert.equal(threads.length, 2);
  assert.equal(threads[0].memberName, "Boaz");
  assert.equal(threads[0].unreadCount, 1);
  assert.deepEqual(threads[1].messages.map((m) => m.id), ["1", "2", "4"]);
  assert.equal(threads[1].unreadCount, 1);
});

const DB_ROW: BoardDbRow = {
  id: "m1", member_id: "a", sender_name: "Ann", content: "Hello", is_private: false, is_from_admin: null, to_admin: null,
  recipient_member_id: null, created_at: "2026-10-01T10:00:00.000Z", read_at: null, deleted_at: null,
};

test("a database row becomes a message; missing flags mean 'no'", () => {
  const r = boardRowFromDb(DB_ROW);
  assert.equal(r.isFromAdmin, false);
  assert.equal(r.toAdmin, false);
  assert.equal(r.recipientMemberId, null);
  assert.equal(boardRowFromDb({ ...DB_ROW, to_admin: true, recipient_member_id: "b" }).toAdmin, true);
});

test("who may remove a message: authors their own; an admin public messages and their own inbox, never a chat between two members", () => {
  const publicPost = boardRowFromDb(DB_ROW);
  assert.equal(canRemoveMessage(publicPost, { memberId: "a", isAdmin: false }), true);
  assert.equal(canRemoveMessage(publicPost, { memberId: "b", isAdmin: false }), false);
  assert.equal(canRemoveMessage(publicPost, { memberId: null, isAdmin: true }), true);
  const dm = boardRowFromDb({ ...DB_ROW, is_private: true, recipient_member_id: "b" });
  assert.equal(canRemoveMessage(dm, { memberId: "a", isAdmin: false }), true); // my own message
  assert.equal(canRemoveMessage(dm, { memberId: "b", isAdmin: false }), false); // the recipient cannot delete the sender's message
  assert.equal(canRemoveMessage(dm, { memberId: null, isAdmin: true }), false); // an admin cannot touch a chat between two members
  const toAdmin = boardRowFromDb({ ...DB_ROW, is_private: true, to_admin: true });
  assert.equal(canRemoveMessage(toAdmin, { memberId: null, isAdmin: true }), true);
  const adminReply = boardRowFromDb({ ...DB_ROW, is_private: true, is_from_admin: true });
  assert.equal(canRemoveMessage(adminReply, { memberId: "a", isAdmin: false }), false); // a member cannot delete the admin's words
  assert.equal(canRemoveMessage(boardRowFromDb({ ...DB_ROW, deleted_at: "2026-10-02T00:00:00.000Z" }), { memberId: null, isAdmin: true }), false);
});
