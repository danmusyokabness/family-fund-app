import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('family_nodes')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data || []);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { name, spouse_name, parent_id } = await request.json();

    if (!name || !parent_id) {
      return NextResponse.json({ error: 'Name and parent_id are required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('family_nodes')
      .insert([
        {
          name: name.trim(),
          spouse_name: spouse_name ? spouse_name.trim() : null,
          parent_id: parent_id,
        },
      ])
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}