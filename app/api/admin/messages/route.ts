// app/api/admin/messages/route.ts
//
// GET  ?kind=reminder|report
//        -> a PREVIEW: who would be texted what, who is skipped and why.
//           Sends nothing.
// POST { kind, memberIds? }
//        -> actually sends (or, while SMS_LIVE is off, records a dry run)
//           the messages that are "ready", for everyone or just the
//           members listed. The text is always rebuilt on the server.
//
// Admin only.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { planMessages, sendMessages, type MessageKind } from "@/lib/messaging";

function parseKind(value: unknown): MessageKind | null {
  return value === "reminder" || value === "report" ? value : null;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const kind = parseKind(req.nextUrl.searchParams.get("kind"));
  if (!kind) return NextResponse.json({ error: "kind must be reminder or report." }, { status: 400 });

  try {
    const plan = await planMessages(supabaseAdmin(), kind);
    return NextResponse.json({ plan });
  } catch {
    return NextResponse.json({ error: "Could not prepare the messages." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: { kind?: unknown; memberIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const kind = parseKind(body.kind);
  if (!kind) return NextResponse.json({ error: "kind must be reminder or report." }, { status: 400 });

  let memberIds: string[] | undefined;
  if (body.memberIds !== undefined) {
    if (!Array.isArray(body.memberIds) || !body.memberIds.every((id) => typeof id === "string")) {
      return NextResponse.json({ error: "memberIds must be a list of ids." }, { status: 400 });
    }
    memberIds = body.memberIds as string[];
  }

  try {
    const summary = await sendMessages(supabaseAdmin(), kind, { memberIds });
    return NextResponse.json({ summary });
  } catch {
    return NextResponse.json({ error: "Sending failed. Check the message log before trying again." }, { status: 500 });
  }
}
