import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  const { memberId, dateStr, amount } = await request.json();

  // Check if an entry already exists for this member and month
  const { data: existing } = await supabase
    .from('ledger_entries')
    .select('id')
    .eq('member_id', memberId)
    .eq('month_year', dateStr)
    .single();

  if (existing) {
    const { error } = await supabase
      .from('ledger_entries')
      .update({ amount_paid: amount })
      .eq('id', existing.id);
      
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase
      .from('ledger_entries')
      .insert([{ member_id: memberId, month_year: dateStr, amount_paid: amount }]);
      
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}