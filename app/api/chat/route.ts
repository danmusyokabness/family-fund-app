// app/api/chat/route.ts
//
// The family chat: one small chat for everyone, private chats between two
// members, and private messages to the admin (see lib/board.ts).
//
// GET   -> the conversations this person may see, and the list of people
//          they can start a chat with. A private chat between two members
//          is never in anyone else's reply (the admin's included): the
//          database query asks only for rows that involve this person, and
//          every row is checked again.
// POST  { to, content } -> send. `to` is "public", "admin", "member:<id>",
//          or (admin only) "inbox:<id>" to reply to a member's message.
//          At most 10 a hour per member.
// PATCH { key } -> mark a conversation as read.

import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/actors";
import { supabaseAdmin } from "@/lib/supabase";
import {
  BOARD_COLUMNS,
  boardRowFromDb,
  canRemoveMessage,
  checkPostRate,
  groupConversations,
  groupPrivateThreads,
  validateBoardMessage,
  visibleToMember,
  type BoardDbRow,
  type BoardRow,
} from "@/lib/board";
import { notifyAdminsOfPrivateMessage } from "@/lib/messaging";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface OutMessage {
  id: string;
  fromMe: boolean;
  senderName: string;
  content: string;
  createdAt: string;
  canDelete: boolean;
}

export async function GET() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  const db = supabaseAdmin();
  const me = actor.memberId;

  const { data: memberRows } = await db.from("members").select("id, full_name").eq("is_active", true).order("full_name", { ascending: true });
  const names: Record<string, string> = {};
  for (const m of memberRows ?? []) names[m.id] = m.full_name;
  const people = (memberRows ?? []).filter((m) => m.id !== me).map((m) => ({ id: m.id, name: m.full_name }));

  // Public messages.
  const { data: publicRows, error } = await db
    .from("message_board")
    .select(BOARD_COLUMNS)
    .eq("is_private", false)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(80)
    .returns<BoardDbRow[]>();
  if (error) return NextResponse.json({ error: "Could not load the chat." }, { status: 500 });

  // Private messages that involve this member (written by them, or to them).
  let privateRows: BoardDbRow[] = [];
  if (me) {
    const { data } = await db
      .from("message_board")
      .select(BOARD_COLUMNS)
      .eq("is_private", true)
      .or(`member_id.eq.${me},recipient_member_id.eq.${me}`)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(300)
      .returns<BoardDbRow[]>();
    privateRows = data ?? [];
  }

  const rows: BoardRow[] = [...(publicRows ?? []), ...privateRows].map(boardRowFromDb).filter((r) => visibleToMember(r, me ?? ""));
  const conversations = groupConversations(rows, me ?? "", names).map((c) => ({
    key: c.key,
    title: c.title,
    unread: c.unread,
    lastAt: c.lastAt,
    messages: c.messages.map(
      (m): OutMessage => ({
        id: m.id,
        fromMe: me !== null && m.memberId === me && !m.isFromAdmin,
        senderName: m.senderName,
        content: m.content,
        createdAt: m.createdAt,
        canDelete: canRemoveMessage(m, { memberId: me, isAdmin: actor.isAdmin }),
      })
    ),
  }));

  // The admin's inbox: one conversation per member who wrote to the admin.
  if (actor.isAdmin) {
    const { data: inbox } = await db
      .from("message_board")
      .select(BOARD_COLUMNS)
      .eq("is_private", true)
      .or("to_admin.eq.true,is_from_admin.eq.true")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(500)
      .returns<BoardDbRow[]>();
    for (const t of groupPrivateThreads((inbox ?? []).map(boardRowFromDb), names)) {
      conversations.push({
        key: `inbox:${t.memberId}`,
        title: `${t.memberName} (to admin)`,
        unread: t.unreadCount,
        lastAt: t.lastMessageAt,
        messages: t.messages.map((m) => ({
          id: m.id,
          fromMe: m.isFromAdmin,
          senderName: m.isFromAdmin ? "Admin" : m.senderName,
          content: m.content,
          createdAt: m.createdAt,
          canDelete: canRemoveMessage(m, { memberId: me, isAdmin: true }),
        })),
      });
    }
  }

  return NextResponse.json({
    conversations,
    people: actor.isAdmin && !me ? [] : people,
    unreadTotal: conversations.reduce((n, c) => n + c.unread, 0),
    isAdmin: actor.isAdmin,
    isMember: me !== null,
    name: actor.name,
  });
}

export async function POST(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  let body: { to?: unknown; content?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const checked = validateBoardMessage(body.content);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  const to = typeof body.to === "string" ? body.to : "";
  const db = supabaseAdmin();
  const me = actor.memberId;

  // At most 10 messages an hour per member.
  if (me) {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recent } = await db.from("message_board").select("created_at").eq("member_id", me).eq("is_from_admin", false).gte("created_at", hourAgo).limit(50);
    const rate = checkPostRate((recent ?? []).map((r) => r.created_at as string), new Date());
    if (!rate.allowed) {
      return NextResponse.json({ error: `That is a lot of messages. Please try again in about ${rate.retryAfterMinutes} minute(s).` }, { status: 429 });
    }
  }

  let insert: Record<string, unknown>;
  let notifyAdmin = false;

  if (to === "public") {
    insert = { member_id: me, sender_name: actor.name, content: checked.content, is_private: false, is_from_admin: false };
  } else if (to === "admin") {
    if (!me) return NextResponse.json({ error: "Reply to members from the conversation list." }, { status: 400 });
    insert = { member_id: me, sender_name: actor.name, content: checked.content, is_private: true, to_admin: true, is_from_admin: false };
    notifyAdmin = true;
  } else if (to.startsWith("member:")) {
    const other = to.slice("member:".length);
    if (!me) return NextResponse.json({ error: "Only members can start a private chat." }, { status: 400 });
    if (!UUID.test(other) || other === me) return NextResponse.json({ error: "Choose who to write to." }, { status: 400 });
    const { data: target } = await db.from("members").select("id").eq("id", other).eq("is_active", true).maybeSingle();
    if (!target) return NextResponse.json({ error: "That member could not be found." }, { status: 404 });
    insert = { member_id: me, sender_name: actor.name, content: checked.content, is_private: true, recipient_member_id: other, is_from_admin: false };
  } else if (to.startsWith("inbox:")) {
    const memberId = to.slice("inbox:".length);
    if (!actor.isAdmin) return NextResponse.json({ error: "Only an admin can reply there." }, { status: 403 });
    if (!UUID.test(memberId)) return NextResponse.json({ error: "Choose who to reply to." }, { status: 400 });
    const { data: target } = await db.from("members").select("id").eq("id", memberId).maybeSingle();
    if (!target) return NextResponse.json({ error: "That member could not be found." }, { status: 404 });
    insert = { member_id: memberId, sender_name: "Admin", content: checked.content, is_private: true, is_from_admin: true };
    // Replying means the admin has read what the member sent.
    await db.from("message_board").update({ read_at: new Date().toISOString() }).eq("is_private", true).eq("to_admin", true).eq("member_id", memberId).is("read_at", null);
  } else {
    return NextResponse.json({ error: "Choose who to write to." }, { status: 400 });
  }

  const { error } = await db.from("message_board").insert(insert);
  if (error) return NextResponse.json({ error: "Could not send that message." }, { status: 500 });

  if (notifyAdmin) await notifyAdminsOfPrivateMessage(db, actor.name);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  let body: { key?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const key = typeof body.key === "string" ? body.key : "";
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const me = actor.memberId;

  if (key === "admin" && me) {
    await db.from("message_board").update({ read_at: now }).eq("is_private", true).eq("is_from_admin", true).eq("member_id", me).is("read_at", null);
  } else if (key.startsWith("member:") && me) {
    const other = key.slice("member:".length);
    if (UUID.test(other)) {
      await db.from("message_board").update({ read_at: now }).eq("is_private", true).eq("recipient_member_id", me).eq("member_id", other).is("read_at", null);
    }
  } else if (key.startsWith("inbox:") && actor.isAdmin) {
    const other = key.slice("inbox:".length);
    if (UUID.test(other)) {
      await db.from("message_board").update({ read_at: now }).eq("is_private", true).eq("to_admin", true).eq("member_id", other).is("read_at", null);
    }
  }
  return NextResponse.json({ ok: true });
}
