// app/api/board/[id]/route.ts
//
// DELETE -> remove a message from the board. Not permanent: the message is
// hidden. An admin may remove any message; an author may remove their own
// public post; private messages are removed by an admin only.

import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/actors";
import { supabaseAdmin } from "@/lib/supabase";
import { boardRowFromDb, canRemoveMessage, type BoardDbRow } from "@/lib/board";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const { id } = await params;

  const db = supabaseAdmin();
  const { data } = await db
    .from("message_board")
    .select("id, member_id, sender_name, content, is_private, is_from_admin, created_at, read_at, deleted_at")
    .eq("id", id)
    .maybeSingle<BoardDbRow>();
  if (!data || data.deleted_at) return NextResponse.json({ error: "That message could not be found." }, { status: 404 });

  if (!canRemoveMessage(boardRowFromDb(data), { memberId: actor.memberId, isAdmin: actor.isAdmin })) {
    return NextResponse.json({ error: "You cannot remove that message." }, { status: 403 });
  }

  const { error } = await db.from("message_board").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ error: "Could not remove that message." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
