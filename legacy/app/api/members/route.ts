import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  const { fullName, phone } = await request.json();
  const slug = fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

  const { data: member, error: memError } = await supabase
    .from('members')
    .insert([{ full_name: fullName, slug }])
    .select()
    .single();

  if (memError) return NextResponse.json({ error: memError.message }, { status: 500 });

  if (phone) {
    await supabase.from('member_phones').insert([{ member_id: member.id, phone_number: phone }]);
  }

  return NextResponse.json({ success: true, member });
}