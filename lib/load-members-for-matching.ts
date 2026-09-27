// lib/load-members-for-matching.ts
//
// SERVER-ONLY. The one place that turns the real members/member_phones/
// payer_aliases tables into the plain shape lib/payment-matching.ts's
// pure matchPayment() function expects. Used by the manual payment
// route now, and will be reused as-is by the Step 7 statement importer.

import { supabaseAdmin } from "./supabase";
import type { MemberForMatching } from "./payment-matching";

interface MemberRow {
  id: string;
  full_name: string;
  member_phones: { phone_number: string }[] | null;
  payer_aliases: { alias_type: string; alias_value: string }[] | null;
}

export async function loadMembersForMatching(): Promise<MemberForMatching[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("members")
    .select("id, full_name, member_phones(phone_number), payer_aliases(alias_type, alias_value)")
    .eq("is_active", true)
    .returns<MemberRow[]>();

  if (error) throw new Error(`loadMembersForMatching: ${error.message}`);

  return (data ?? []).map((m) => ({
    id: m.id,
    fullName: m.full_name,
    phones: (m.member_phones ?? []).map((p) => p.phone_number),
    aliases: (m.payer_aliases ?? []).map((a) => ({
      aliasType: a.alias_type as "masked_phone" | "shortcode" | "payer_name",
      aliasValue: a.alias_value,
    })),
  }));
}
