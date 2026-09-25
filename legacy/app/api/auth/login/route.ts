import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const { name, phone } = await request.json();

    if (!name || !phone) {
      return NextResponse.json({ success: false, error: 'Name and phone are required.' }, { status: 400 });
    }

    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();

    // 1. Check Admin credentials from environment variables
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

    if (trimmedName.toLowerCase() === adminUsername.toLowerCase() && trimmedPhone === adminPassword) {
      return NextResponse.json({
        success: true,
        user: {
          name: 'Administrator',
          primary_phone: adminPhoneMask(trimmedPhone),
          is_admin: true,
        },
      });
    }

    // 2. Check regular member credentials in Supabase
    const { data: members, error } = await supabase
      .from('members')
      .select('*')
      .ilike('name', trimmedName)
      .eq('primary_phone', trimmedPhone);

    if (error) {
      console.error('Database login error:', error);
      return NextResponse.json({ success: false, error: 'Database error during login.' }, { status: 500 });
    }

    if (!members || members.length === 0) {
      return NextResponse.json({ success: false, error: 'Invalid name or primary phone number.' }, { status: 401 });
    }

    const member = members[0];

    return NextResponse.json({
      success: true,
      user: {
        id: member.id,
        name: member.full_name,
        primary_phone: member.primary_phone,
        is_admin: member.is_admin || false,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

function adminPhoneMask(phone: string) {
  return phone;
}