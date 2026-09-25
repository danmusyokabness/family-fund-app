import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { sendSms } from '@/lib/africastalking';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');

    if (type === 'reminder') {
      console.log('Running 7th of the month reminder workflow...');
      await sendSms(['+254700000000'], 'Reminder: Family fund contributions are due.');
      return NextResponse.json({ success: true, message: 'Reminder cron executed.' });
    } 
    
    if (type === 'report') {
      console.log('Running 15th of the month report workflow...');
      await sendSms(['+254700000000'], 'Report: Mid-month family fund summary.');
      return NextResponse.json({ success: true, message: 'Report cron executed.' });
    }

    return NextResponse.json({ success: false, error: 'Invalid or missing cron type parameter.' }, { status: 400 });
  } catch (error) {
    console.error('Cron job error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}