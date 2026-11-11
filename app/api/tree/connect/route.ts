// app/api/tree/connect/route.ts
//
// POST { claimNodeId } -> a member who has no place in the tree yet takes over
//         an entry that already exists and has no member attached (decision
//         D20). Adding yourself as a NEW entry is done on the details form
//         instead (/api/tree/onboard), which also asks for the details that are
//         required. A member has exactly one place.
//
// Only members can do this (the main admin login is not a member).

import { NextRequest, NextResponse } from "next/server";
import { getMemberSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { needsToConnect } from "@/lib/family-tree";
import { loadLiveNodes } from "@/lib/tree-data";

export async function POST(req: NextRequest) {
  const member = await getMemberSession();
  if (!member) return NextResponse.json({ error: "Only members can connect themselves to the tree." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const nodes = await loadLiveNodes(db);
  if (!needsToConnect(nodes, member.memberId)) {
    return NextResponse.json({ error: "You already have a place in the tree." }, { status: 409 });
  }
  // ---- Take over an existing entry ------------------------------------------
  if (typeof body.claimNodeId === "string") {
    const target = nodes.find((n) => n.id === body.claimNodeId);
    if (!target) return NextResponse.json({ error: "That entry could not be found." }, { status: 404 });
    if (target.memberId) return NextResponse.json({ error: "That entry already belongs to another member." }, { status: 409 });

    const { data, error } = await db
      .from("family_nodes")
      .update({ member_id: member.memberId, updated_at: new Date().toISOString() })
      .eq("id", target.id)
      .is("member_id", null)
      .is("deleted_at", null)
      .select("id")
      .single<{ id: string }>();
    if (error || !data) return NextResponse.json({ error: "Could not connect you to that entry." }, { status: 409 });
    return NextResponse.json({ ok: true, id: target.id });
  }

  // Adding yourself as a new entry is done on the details form (/api/tree/onboard), which also asks for the details that are required.
  return NextResponse.json({ error: "Choose which entry is you, or fill in your details to be added." }, { status: 400 });
}
