// lib/tree-photo.ts
//
// Profile photos on the family tree are small pictures, shrunk in the
// browser to about 200 pixels, and kept as text in the database (no file
// storage to set up). This checks what the server is sent before it is
// stored. Pure: no database, no web code.

export const MAX_PHOTO_BYTES = 100 * 1024; // 100 KB after decoding: far more than a 200px picture needs
const ALLOWED = ["image/jpeg", "image/png", "image/webp"] as const;

export type PhotoCheck = { ok: true; mime: string; base64: string; bytes: number } | { ok: false; error: string };

export function parsePhotoDataUrl(input: unknown): PhotoCheck {
  if (typeof input !== "string") return { ok: false, error: "Choose a picture first." };
  const match = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input);
  if (!match) return { ok: false, error: "That does not look like a picture." };
  const [, mime, base64] = match;
  if (!(ALLOWED as readonly string[]).includes(mime)) return { ok: false, error: "Use a JPEG, PNG or WebP picture." };
  if (base64.length % 4 !== 0) return { ok: false, error: "That picture is damaged. Please choose it again." };
  const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  if (bytes > MAX_PHOTO_BYTES) return { ok: false, error: "That picture is too big. A smaller one will do." };
  if (bytes < 100) return { ok: false, error: "That picture is too small to be real." };
  return { ok: true, mime, base64, bytes };
}

/** Rebuilds the data URL from what is stored, for sending the picture back. */
export function photoToBuffer(stored: string): { mime: string; data: Buffer } | null {
  const match = /^data:(image\/[a-z]+);base64,([\s\S]+)$/.exec(stored);
  if (!match) return null;
  return { mime: match[1], data: Buffer.from(match[2], "base64") };
}
