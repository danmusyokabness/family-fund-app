import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const { transactions } = await request.json(); 
    // Format: [{ phone: '254712345678', amount: 300, dateStr: '2026-09-01' }]

    if (!Array.isArray(transactions)) {
      return NextResponse.json({ error: 'Invalid input format' }, { status: 400 });
    }

    const results = [];

    for (const tx of transactions) {
      // 1. Look up member ID using phone number
      const { data: phoneRecord } = await supabase
        .from('member_phones')
        .select('member_id')
        .eq('phone_number', tx.phone)
        .maybeSingle();

      if (!phoneRecord) {
        results.push({ phone: tx.phone, status: 'Member phone not found' });
        continue;
      }

      const memberId = phoneRecord.member_id;

      // 2. Check for existing ledger entry for this member and month
      const { data: existing } = await supabase
        .from('ledger_entries')
        .select('id, amount_paid')
        .eq('member_id', memberId)
        .eq('month_year', tx.dateStr)
        .maybeSingle();

      if (existing) {
        const newTotal = Number(existing.amount_paid) + Number(tx.amount);
        await supabase
          .from('ledger_entries')
          .update({ amount_paid: newTotal })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('ledger_entries')
          .insert([{ member_id: memberId, month_year: tx.dateStr, amount_paid: tx.amount }]);
      }

      results.push({ phone: tx.phone, status: 'Success' });
    }

    return NextResponse.json({ success: true, results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}