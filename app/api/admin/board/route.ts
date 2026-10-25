// app/api/admin/board/route.ts
//
// The admin's inbox for PRIVATE messages from members (admin only).
//
// GET   -> every private conversation, one per member, newest activity
//          first, with how many messages are unread.
// POST  { memberId, content } -> reply to that member privately.
// PATCH { memberId }          -> mark that member's messages as read.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { boardRowFromDb, groupPrivateThreads, validateBoardMessage, type BoardDbRow } from "@/lib/board";

const COLUMNS = "id, member_id, sender_name, content, is_private, is_from_admin, created_at, read_at, deleted_at";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("message_board")
    .select(COLUMNS)
    .eq("is_private", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1000)
    .returns<BoardDbRow[]>();
  if (error) return NextResponse.json({ error: "Could not load the messages." }, { status: 500 });

  const { data: members } = await db.from("members").select("id, full_name");
  const names: Record<string, string> = {};
  for (const m of members ?? []) names[m.id] = m.full_name;

  const threads = groupPrivateThreads((data ?? []).map(boardRowFromDb), names);
  return NextResponse.json({
    unreadTotal: threads.reduce((n, t) => n + t.unreadCount, 0),
    threads: threads.map((t) => ({
      memberId: t.memberId,
      memberName: t.memberName,
      unreadCount: t.unreadCount,
      lastMessageAt: t.lastMessageAt,
      messages: t.messages.map((m) => ({ id: m.id, fromAdmin: m.isFromAdmin, senderName: m.senderName, content: m.content, createdAt: m.createdAt })),
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: { memberId?: unknown; content?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (typeof body.memberId !== "string") return NextResponse.json({ error: "Choose who to reply to." }, { status: 400 });
  const checked = validateBoardMessage(body.content);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  const db = supabaseAdmin();
  const { data: member } = await db.from("members").select("id").eq("id", body.memberId).maybeSingle();
  if (!member) return NextResponse.json({ error: "That member could not be found." }, { status: 404 });

  const now = new Date().toISOString();
  const { error } = await db.from("message_board").insert({
    member_id: body.memberId,
    sender_name: "Admin",
    content: checked.content,
    is_private: true,
    is_from_admin: true,
  });
  if (error) return NextResponse.json({ error: "Could not send the reply." }, { status: 500 });

  // Replying means the admin has read what the member sent.
  await db.from("message_board").update({ read_at: now }).eq("is_private", true).eq("member_id", body.memberId).eq("is_from_admin", false).is("read_at", null);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: { memberId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (typeof body.memberId !== "string") return NextResponse.json({ error: "Choose a conversation." }, { status: 400 });

  await supabaseAdmin()
    .from("message_board")
    .update({ read_at: new Date().toISOString() })
    .eq("is_private", true)
    .eq("member_id", body.memberId)
    .eq("is_from_admin", false)
    .is("read_at", null);
  return NextResponse.json({ ok: true });
}
