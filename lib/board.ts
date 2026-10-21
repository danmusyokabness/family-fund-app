// lib/board.ts
//
// Rules for the family message board (decision A2): a shared board that
// every logged-in member can read and post to, plus PRIVATE messages
// that only the sender and the admin can see. A private "thread" is all
// the private messages that carry the same member_id: the member's own
// messages and the admin's replies (is_from_admin = true).
//
// Pure functions only, so the privacy rules can be tested with plain
// data. The API routes must still filter in the database query itself;
// visibleToMember() is a second, independent safety net.

export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_POSTS_PER_HOUR = 10;

export interface BoardRow {
  id: string;
  memberId: string | null;
  senderName: string;
  content: string;
  isPrivate: boolean;
  isFromAdmin: boolean;
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

/** Rate limit: at most MAX_POSTS_PER_HOUR posts per member in any rolling hour. */
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
 * The only messages a member may ever be sent: public posts, and private
 * messages that belong to their own thread. Deleted messages are never shown.
 */
export function visibleToMember(row: BoardRow, memberId: string): boolean {
  if (row.deletedAt) return false;
  if (!row.isPrivate) return true;
  return row.memberId === memberId;
}

export interface PrivateThread {
  memberId: string;
  memberName: string;
  messages: BoardRow[]; // oldest first
  /** Messages from the member that the admin has not opened yet. */
  unreadCount: number;
  lastMessageAt: string;
}

/** Groups private messages into one thread per member, newest activity first. For the admin inbox. */
export function groupPrivateThreads(rows: BoardRow[], memberNames: Record<string, string>): PrivateThread[] {
  const byMember = new Map<string, BoardRow[]>();
  for (const row of rows) {
    if (!row.isPrivate || row.deletedAt || !row.memberId) continue;
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
