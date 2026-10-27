// app/api/tree/[id]/photo/route.ts
//
// GET    -> the person's small profile photo (any logged-in person).
// PUT    -> set it: { dataUrl } with a JPEG/PNG/WebP under 100 KB. Only the
//           people who may edit that entry (or an admin).
// DELETE -> remove it (same rule).

import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/actors";
import { supabaseAdmin } from "@/lib/supabase";
import { parsePhotoDataUrl, photoToBuffer } from "@/lib/tree-photo";
import { loadEditContext } from "@/lib/tree-data";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const { id } = await params;

  const { data } = await supabaseAdmin()
    .from("family_nodes")
    .select("photo, has_photo")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle<{ photo: string | null; has_photo: boolean | null }>();
  const picture = data?.photo ? photoToBuffer(data.photo) : null;
  if (!picture) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(picture.data), {
    status: 200,
    headers: {
      "Content-Type": picture.mime,
      // The page asks for a new address whenever the picture changes, so it can be kept.
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const { id } = await params;

  let body: { dataUrl?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const checked = parsePhotoDataUrl(body.dataUrl);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  const db = supabaseAdmin();
  const ctx = await loadEditContext(db, actor);
  if (!ctx.nodes.some((n) => n.id === id)) return NextResponse.json({ error: "That person could not be found." }, { status: 404 });
  if (!ctx.editable.has(id)) return NextResponse.json({ error: "You cannot change that person's photo." }, { status: 403 });

  const { error } = await db
    .from("family_nodes")
    .update({ photo: `data:${checked.mime};base64,${checked.base64}`, has_photo: true, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: "Could not save the photo." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const { id } = await params;

  const db = supabaseAdmin();
  const ctx = await loadEditContext(db, actor);
  if (!ctx.nodes.some((n) => n.id === id)) return NextResponse.json({ error: "That person could not be found." }, { status: 404 });
  if (!ctx.editable.has(id)) return NextResponse.json({ error: "You cannot change that person's photo." }, { status: 403 });

  const { error } = await db.from("family_nodes").update({ photo: null, has_photo: false, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ error: "Could not remove the photo." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
