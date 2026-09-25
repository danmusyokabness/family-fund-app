import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const { name, amount } = await request.json();

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    // 1. Find member by full_name
    let { data: member, error: memberError } = await supabase
      .from('members')
      .select('id')
      .ilike('full_name', name.trim())
      .single();

    if (memberError || !member) {
      return NextResponse.json({ success: true, message: 'Member not in contributions ledger.' });
    }

    const numericAmount = Number(amount) || 0;
    if (numericAmount <= 0) {
      return NextResponse.json({ success: true, message: 'No contribution amount to allocate.' });
    }

    let remainingAmount = numericAmount;

    // 2. Fetch all ledger entries for this member ordered by month (earliest first)
    let { data: entries, error: ledgerError } = await supabase
      .from('ledger_entries')
      .select('*')
      .eq('member_id', member.id)
      .order('month_year', { ascending: true });

    if (ledgerError || !entries) {
      return NextResponse.json({ error: ledgerError?.message || 'No ledger entries found' }, { status: 500 });
    }

    // 3. Automatically distribute money starting from the earliest unpaid/partially paid month
    for (let entry of entries) {
      if (remainingAmount <= 0) break;

      const target = Number(entry.target_amount) || 300;
      const currentPaid = Number(entry.amount_paid) || 0;
      const deficit = target - currentPaid;

      if (deficit > 0) {
        const paymentForThisMonth = Math.min(remainingAmount, deficit);
        const newAmountPaid = currentPaid + paymentForThisMonth;

        await supabase
          .from('ledger_entries')
          .update({ amount_paid: newAmountPaid })
          .eq('id', entry.id);

        remainingAmount -= paymentForThisMonth;
      }
    }

    // 4. If there is still money left over, add it to the latest month
    if (remainingAmount > 0 && entries.length > 0) {
      const lastEntry = entries[entries.length - 1];
      const newAmountPaid = Number(lastEntry.amount_paid) + remainingAmount;
      await supabase
        .from('ledger_entries')
        .update({ amount_paid: newAmountPaid })
        .eq('id', lastEntry.id);
    }

    return NextResponse.json({ success: true, message: 'Contribution credited successfully to earliest unpaid months.' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}