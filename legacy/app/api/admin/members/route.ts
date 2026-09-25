import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, memberId, name, primary_phone, alternate_phones, join_date } = body;

    if (action === 'create') {
      if (!name || !primary_phone) {
        return NextResponse.json({ success: false, error: 'Name and primary phone are required.' }, { status: 400 });
      }

      const { data, error } = await supabase
        .from('members')
        .insert([
          {
            full_name: name.trim(),
            primary_phone: primary_phone.trim(),
            alternate_phones: alternate_phones ? alternate_phones.filter(Boolean) : [],
            join_date: join_date || new Date().toISOString().split('T')[0],
            is_admin: false,
          },
        ])
        .select();

      if (error) {
        console.error('Error creating member:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, member: data[0] });
    }

    if (action === 'update') {
      if (!memberId) {
        return NextResponse.json({ success: false, error: 'Member ID is required for update.' }, { status: 400 });
      }

      const { data, error } = await supabase
        .from('members')
        .update({
          full_name: name?.trim(),
          primary_phone: primary_phone?.trim(),
          alternate_phones: alternate_phones ? alternate_phones.filter(Boolean) : [],
          join_date: join_date,
        })
        .eq('id', memberId)
        .select();

      if (error) {
        console.error('Error updating member:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, member: data[0] });
    }

    return NextResponse.json({ success: false, error: 'Invalid action.' }, { status: 400 });
  } catch (err: any) {
    console.error('Admin member API error:', err);
    return NextResponse.json({ success: false, error: err.message || 'Server error' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const { data, error } = await supabase.from('members').select('*').order('full_name', { ascending: true });

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, members: data });
  } catch (err: any) {
    console.error('Error fetching members:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}