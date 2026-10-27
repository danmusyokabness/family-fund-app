// app/api/tree/connect/route.ts
//
// POST -> a member who has no place in the tree yet connects themselves to
//         it (decision D20). They either
//           { claimNodeId }                          take over an entry that
//                                                    already exists and has
//                                                    no member attached, or
//           { parentId, dateOfBirth?, ... }          add themselves as a child
//                                                    of someone already there,
//           { asRoot: true }                         start the tree (only
//                                                    allowed while it is empty).
//         A member is never left floating, and has exactly one place.
//
// Only members can do this (the main admin login is not a member).

import { NextRequest, NextResponse } from "next/server";
import { getMemberSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { nairobiTodayDateString } from "@/lib/dates";
import { needsToConnect, rowFromPatch, sanitizeNodePatch } from "@/lib/family-tree";
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

  // ---- Add themselves as a new entry -------------------------------------------
  const startingTheTree = body.asRoot === true;
  const parentId = typeof body.parentId === "string" ? body.parentId : null;
  if (startingTheTree) {
    if (nodes.length > 0) return NextResponse.json({ error: "The tree already has people in it: choose who you are, or whose child you are." }, { status: 409 });
  } else {
    if (!parentId || !nodes.some((n) => n.id === parentId)) {
      return NextResponse.json({ error: "Choose the person you are the child of." }, { status: 400 });
    }
  }

  const result = sanitizeNodePatch({ dateOfBirth: body.dateOfBirth, workEducation: body.workEducation, bio: body.bio, spouseName: body.spouseName }, nairobiTodayDateString());
  if (!result.ok) return NextResponse.json({ error: result.errors.join(" ") }, { status: 400 });

  const { data, error } = await db
    .from("family_nodes")
    .insert({
      ...rowFromPatch(result.patch),
      name: member.fullName,
      parent_id: startingTheTree ? null : parentId,
      member_id: member.memberId,
      created_by_member_id: member.memberId,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) return NextResponse.json({ error: "Could not add you to the tree." }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}
