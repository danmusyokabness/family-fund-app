// lib/actors.ts
//
// SERVER-ONLY. "Who is doing this?" for the pages every logged-in person
// can use (the family tree and the message board): a member, a member who
// is also an admin, or the main admin login. Returns null when nobody is
// logged in, so a route that calls getActor() and refuses on null has
// checked who is asking.

import { getAdminContext, getMemberSession } from "@/lib/auth";

export interface Actor {
  /** The member's id, or null for the main admin login (which is not a member). */
  memberId: string | null;
  /** The name shown in change logs and on messages. */
  name: string;
  isAdmin: boolean;
}

export async function getActor(): Promise<Actor | null> {
  const member = await getMemberSession();
  const admin = await getAdminContext();
  if (member) return { memberId: member.memberId, name: member.fullName, isAdmin: admin.isAdmin };
  if (admin.isAdmin) return { memberId: null, name: "Admin", isAdmin: true };
  return null;
}
