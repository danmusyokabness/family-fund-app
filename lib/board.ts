// lib/board.ts
//
// Rules for the family CHAT (decision A2, simplified 23 Oct 2026).
//
// One chat, three kinds of conversation, chosen with a "To:" selector:
//   * Everyone      a public message everyone logged in can read
//   * a member      a private chat between two members; nobody else
//                   (not even the admin) can see it
//   * the Admin     a private message to the admin; only the member and the
//                   admin see it, and the admin's replies come back here
//
// How a message is stored (message_board):
//   public           is_private = false
//   to the admin     is_private = true, to_admin = true,  member_id = the sender
//   to a member      is_private = true, recipient_member_id = the other member,
//                    member_id = the sender
//   admin's reply    is_private = true, is_from_admin = true, member_id = the member
//
// Pure functions only, so the privacy rules can be tested with plain data.
// The API routes still filter in the database query itself; these checks
// are a second, independent safety net.

export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_POSTS_PER_HOUR = 10;

export interface BoardRow {
  id: string;
  /** The sender; for the admin's reply, the member it is addressed to. */
  memberId: string | null;
  senderName: string;
  content: string;
  isPrivate: boolean;
  isFromAdmin: boolean;
  toAdmin: boolean;
  recipientMemberId: string | null;
  createdAt: string; // ISO timestamp
  readAt: string | null;
  deletedAt: string | null;
}

export type ValidationResult = { ok: true; content: string } | { ok: false; error: string };

/** Trims, strips control characters (keeping new lines), and enforces length. Plain text only. */
export function validateBoardMessage(input: unknown): ValidationResult {
  if (typeof input !== "string") return { ok: false, error: "Write a message first." };
  // eslint-disable-next-line no-control-regex
  const cleaned = input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\r\n/g, "\n").trim();
  if (cleaned.length === 0) return { ok: false, error: "Write a message first." };
  if ([...cleaned].length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: `Please keep messages under ${MAX_MESSAGE_LENGTH} characters.` };
  }
  return { ok: true, content: cleaned.replace(/\n{4,}/g, "\n\n\n") };
}

/** Rate limit: at most MAX_POSTS_PER_HOUR messages per member in any rolling hour. */
export function checkPostRate(
  recentPostTimes: string[],
  now: Date,
  maxPerHour: number = MAX_POSTS_PER_HOUR
): { allowed: true } | { allowed: false; retryAfterMinutes: number } {
  const hourAgo = now.getTime() - 60 * 60 * 1000;
  const inWindow = recentPostTimes.map((t) => new Date(t).getTime()).filter((t) => Number.isFinite(t) && t > hourAgo).sort((a, b) => a - b);
  if (inWindow.length < maxPerHour) return { allowed: true };
  const oldestCounting = inWindow[inWindow.length - maxPerHour];
  const retryAfterMs = oldestCounting + 60 * 60 * 1000 - now.getTime();
  return { allowed: false, retryAfterMinutes: Math.max(1, Math.ceil(retryAfterMs / 60000)) };
}

/**
 * The only messages a member may ever be sent: public ones, ones they
 * wrote, ones written to them, and the admin's replies to them. Deleted
 * messages are never shown.
 */
export function visibleToMember(row: BoardRow, memberId: string): boolean {
  if (row.deletedAt) return false;
  if (!row.isPrivate) return true;
  if (!memberId) return false;
  return row.memberId === memberId || row.recipientMemberId === memberId;
}

/** What the admin may read in the inbox: private messages to the admin, and the admin's own replies. Never a chat between two members. */
export function visibleToAdminInbox(row: BoardRow): boolean {
  if (row.deletedAt || !row.isPrivate) return false;
  return row.toAdmin || row.isFromAdmin;
}

/**
 * Who may remove a message: an admin may remove a public message or one in
 * their own inbox (never a chat between two members); an author may remove
 * their own message.
 */
export function canRemoveMessage(row: BoardRow, who: { memberId: string | null; isAdmin: boolean }): boolean {
  if (row.deletedAt) return false;
  if (who.isAdmin && (!row.isPrivate || visibleToAdminInbox(row))) return true;
  return who.memberId !== null && row.memberId === who.memberId && !row.isFromAdmin;
}

// ---------------------------------------------------------------------
// Conversations, as one member sees them
// ---------------------------------------------------------------------
export type ConversationKey = string; // "public" | "admin" | "member:<id>"

/** Which conversation a message belongs to for this member, or null if it is not theirs to see. */
export function conversationKey(row: BoardRow, me: string): ConversationKey | null {
  if (!visibleToMember(row, me)) return null;
  if (!row.isPrivate) return "public";
  if ((row.isFromAdmin || row.toAdmin) && row.memberId === me) return "admin";
  if (row.recipientMemberId && row.memberId === me) return `member:${row.recipientMemberId}`;
  if (row.recipientMemberId === me && row.memberId) return `member:${row.memberId}`;
  return null;
}

export interface Conversation {
  key: ConversationKey;
  title: string;
  /** Oldest first. */
  messages: BoardRow[];
  /** Messages TO this member that they have not opened yet (never counted for the public chat). */
  unread: number;
  lastAt: string;
}

/** Groups what a member may see into conversations, "Everyone" first then the most recently active. */
export function groupConversations(rows: BoardRow[], me: string, names: Record<string, string>): Conversation[] {
  const byKey = new Map<ConversationKey, BoardRow[]>();
  for (const row of rows) {
    const key = conversationKey(row, me);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }

  const conversations: Conversation[] = [];
  for (const [key, list] of byKey) {
    const messages = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const title = key === "public" ? "Everyone" : key === "admin" ? "Admin" : names[key.slice("member:".length)] ?? "A member";
    // Unread = messages TO this member (another member's, or the admin's reply) that they have not opened.
    const unread = key === "public" ? 0 : messages.filter((m) => !m.readAt && (m.isFromAdmin || m.memberId !== me)).length;
    conversations.push({ key, title, messages, unread, lastAt: messages[messages.length - 1].createdAt });
  }
  return conversations.sort((a, b) => (a.key === "public" ? -1 : b.key === "public" ? 1 : b.lastAt.localeCompare(a.lastAt)));
}

// ---------------------------------------------------------------------
// The admin's inbox: one conversation per member who wrote to the admin
// ---------------------------------------------------------------------
export interface PrivateThread {
  memberId: string;
  memberName: string;
  messages: BoardRow[]; // oldest first
  /** Messages from the member that the admin has not opened yet. */
  unreadCount: number;
  lastMessageAt: string;
}

export function groupPrivateThreads(rows: BoardRow[], memberNames: Record<string, string>): PrivateThread[] {
  const byMember = new Map<string, BoardRow[]>();
  for (const row of rows) {
    if (!visibleToAdminInbox(row) || !row.memberId) continue;
    const list = byMember.get(row.memberId) ?? [];
    list.push(row);
    byMember.set(row.memberId, list);
  }

  const threads: PrivateThread[] = [];
  for (const [memberId, list] of byMember) {
    const messages = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    threads.push({
      memberId,
      memberName: memberNames[memberId] ?? "Unknown member",
      messages,
      unreadCount: messages.filter((m) => !m.isFromAdmin && !m.readAt).length,
      lastMessageAt: messages[messages.length - 1].createdAt,
    });
  }
  return threads.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
}

/** A message_board database row. */
export interface BoardDbRow {
  id: string;
  member_id: string | null;
  sender_name: string;
  content: string;
  is_private: boolean;
  is_from_admin: boolean | null;
  to_admin: boolean | null;
  recipient_member_id: string | null;
  created_at: string;
  read_at: string | null;
  deleted_at: string | null;
}

export const BOARD_COLUMNS = "id, member_id, sender_name, content, is_private, is_from_admin, to_admin, recipient_member_id, created_at, read_at, deleted_at";

export function boardRowFromDb(r: BoardDbRow): BoardRow {
  return {
    id: r.id,
    memberId: r.member_id,
    senderName: r.sender_name,
    content: r.content,
    isPrivate: r.is_private,
    isFromAdmin: r.is_from_admin === true,
    toAdmin: r.to_admin === true,
    recipientMemberId: r.recipient_member_id,
    createdAt: r.created_at,
    readAt: r.read_at,
    deletedAt: r.deleted_at,
  };
}
