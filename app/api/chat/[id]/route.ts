// app/api/chat/[id]/route.ts
//
// DELETE -> remove a message. Not permanent: it is only hidden. Anyone may
// remove their own message; an admin may also remove a public message or one
// in their own inbox (never a private chat between two members).

import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/actors";
import { supabaseAdmin } from "@/lib/supabase";
import { BOARD_COLUMNS, boardRowFromDb, canRemoveMessage, type BoardDbRow } from "@/lib/board";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const { id } = await params;

  const db = supabaseAdmin();
  const { data } = await db.from("message_board").select(BOARD_COLUMNS).eq("id", id).maybeSingle<BoardDbRow>();
  if (!data || data.deleted_at) return NextResponse.json({ error: "That message could not be found." }, { status: 404 });

  if (!canRemoveMessage(boardRowFromDb(data), { memberId: actor.memberId, isAdmin: actor.isAdmin })) {
    return NextResponse.json({ error: "You cannot remove that message." }, { status: 403 });
  }

  const { error } = await db.from("message_board").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ error: "Could not remove that message." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
