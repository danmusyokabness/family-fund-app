// app/api/board/route.ts
//
// The family message board (decision A2): a shared board every logged-in
// member can read and post to, plus PRIVATE messages between one member
// and the admin.
//
// GET  -> the public posts, and (for a member) their own private
//         conversation with the admin. Another member's private messages
//         are never in the reply: the database query asks only for this
//         member's thread, and every row is checked again with
//         visibleToMember().
// POST { content, private? } -> post to the board, or send the admin a
//         private message. Limited to 10 posts an hour per member.

import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/actors";
import { supabaseAdmin } from "@/lib/supabase";
import { boardRowFromDb, checkPostRate, validateBoardMessage, visibleToMember, type BoardDbRow } from "@/lib/board";
import { notifyAdminsOfPrivateMessage } from "@/lib/messaging";

const COLUMNS = "id, member_id, sender_name, content, is_private, is_from_admin, created_at, read_at, deleted_at";

export async function GET() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  const db = supabaseAdmin();
  const { data: publicRows, error } = await db
    .from("message_board")
    .select(COLUMNS)
    .eq("is_private", false)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<BoardDbRow[]>();
  if (error) return NextResponse.json({ error: "Could not load the board." }, { status: 500 });

  const viewer = actor.memberId ?? "";
  const posts = (publicRows ?? [])
    .map(boardRowFromDb)
    .filter((row) => visibleToMember(row, viewer))
    .map((row) => ({
      id: row.id,
      senderName: row.senderName,
      content: row.content,
      createdAt: row.createdAt,
      mine: actor.memberId !== null && row.memberId === actor.memberId,
      canDelete: actor.isAdmin || (actor.memberId !== null && row.memberId === actor.memberId),
    }));

  let thread: { id: string; fromAdmin: boolean; senderName: string; content: string; createdAt: string }[] = [];
  if (actor.memberId) {
    const { data: mine } = await db
      .from("message_board")
      .select(COLUMNS)
      .eq("is_private", true)
      .eq("member_id", actor.memberId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(200)
      .returns<BoardDbRow[]>();
    thread = (mine ?? [])
      .map(boardRowFromDb)
      .filter((row) => visibleToMember(row, viewer))
      .map((row) => ({ id: row.id, fromAdmin: row.isFromAdmin, senderName: row.senderName, content: row.content, createdAt: row.createdAt }));

    // Opening the page counts as reading the admin's replies.
    await db.from("message_board").update({ read_at: new Date().toISOString() }).eq("is_private", true).eq("member_id", actor.memberId).eq("is_from_admin", true).is("read_at", null);
  }

  return NextResponse.json({ posts, thread, isAdmin: actor.isAdmin, name: actor.name, isMember: actor.memberId !== null });
}

export async function POST(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  let body: { content?: unknown; private?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const checked = validateBoardMessage(body.content);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  const wantsPrivate = body.private === true;
  if (wantsPrivate && !actor.memberId) {
    // The main admin login is not a member; it answers from the admin inbox instead.
    return NextResponse.json({ error: "Reply to members from the Messages tab in the admin area." }, { status: 400 });
  }

  const db = supabaseAdmin();

  // At most 10 posts an hour per member, public and private together.
  if (actor.memberId) {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recent } = await db
      .from("message_board")
      .select("created_at")
      .eq("member_id", actor.memberId)
      .eq("is_from_admin", false)
      .gte("created_at", hourAgo)
      .limit(50);
    const rate = checkPostRate((recent ?? []).map((r) => r.created_at as string), new Date());
    if (!rate.allowed) {
      return NextResponse.json({ error: `That is a lot of messages. Please try again in about ${rate.retryAfterMinutes} minute(s).` }, { status: 429 });
    }
  }

  const { error } = await db.from("message_board").insert({
    member_id: actor.memberId,
    sender_name: actor.name,
    content: checked.content,
    is_private: wantsPrivate,
    is_from_admin: false,
  });
  if (error) return NextResponse.json({ error: "Could not send that message." }, { status: 500 });

  // A private message is no use if nobody notices it: text the admin.
  if (wantsPrivate) await notifyAdminsOfPrivateMessage(db, actor.name);
  return NextResponse.json({ ok: true });
}
