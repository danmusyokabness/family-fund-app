// app/api/admin/messages/route.ts
//
// GET  ?kind=reminder|report
//        -> a PREVIEW: who should get what, who is skipped and why.
//           Sends nothing: the app has no text-message provider. The admin
//           sends each message by hand (WhatsApp link) from the Reminders tab.
//
// Admin only.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { planMessages, type MessageKind } from "@/lib/messaging";

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
