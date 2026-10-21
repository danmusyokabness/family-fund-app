// app/api/admin/members/reorder/route.ts
//
// POST { orderedIds: string[] }
//
// Saves the admin's manual order for members whose birth date is not
// known yet. The list is the ids of those members in the order they
// should appear; they are saved as positions 1, 2, 3...
//
// Any admin (superadmin or member-admin) may do this. Only members in
// the list are touched; everyone else keeps their current position.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: { orderedIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const ids = body.orderedIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500) {
    return NextResponse.json({ error: "Send the list of member ids in the order you want." }, { status: 400 });
  }
  if (!ids.every((id) => typeof id === "string" && UUID_RE.test(id))) {
    return NextResponse.json({ error: "One of the member ids is not valid." }, { status: 400 });
  }
  if (new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: "The same member appears twice in the list." }, { status: 400 });
  }

  const db = supabaseAdmin();

  // Make sure every id is a real member before changing anything.
  const { data: existing, error: lookupError } = await db.from("members").select("id").in("id", ids as string[]);
  if (lookupError) {
    return NextResponse.json({ error: "Could not check the members." }, { status: 500 });
  }
  if ((existing ?? []).length !== ids.length) {
    return NextResponse.json({ error: "One of those members no longer exists. Refresh and try again." }, { status: 404 });
  }

  // One small update per member (at most a few dozen), saved as 1..n.
  for (let i = 0; i < ids.length; i++) {
    const { error } = await db
      .from("members")
      .update({ sort_order: i + 1 })
      .eq("id", ids[i] as string);
    if (error) {
      return NextResponse.json({ error: "Could not save the new order. Please try again." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
