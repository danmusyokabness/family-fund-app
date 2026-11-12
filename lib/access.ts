// lib/access.ts
//
// SERVER-ONLY. Who may see the money screens.
//
// A "family-only" member (members.contributes = false) belongs to the family:
// they can log in, use the family tree and the chat, but they do not pay the
// monthly contribution, so they have no ledger, no balance and no reminders,
// and they are not counted in the group figures. Admins always see everything.

import type { SupabaseClient } from "@supabase/supabase-js";

/** True unless the member has been marked family-only. A missing row or value counts as contributing, so nobody is locked out by mistake. */
export async function memberContributes(db: SupabaseClient, memberId: string): Promise<boolean> {
  const { data } = await db.from("members").select("contributes").eq("id", memberId).maybeSingle<{ contributes: boolean | null }>();
  return data?.contributes !== false;
}
