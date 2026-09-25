import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const selectedFY = searchParams.get('fy') || '2026/2027';

  const { data: members, error: memError } = await supabase.from('members').select('*').order('full_name');
  const { data: entries, error: entError } = await supabase.from('ledger_entries').select('*');

  if (memError || entError) {
    return NextResponse.json({ error: 'Failed to fetch ledger data' }, { status: 500 });
  }

  const fyMonths = ['08', '09', '10', '11', '12', '01', '02', '03', '04', '05', '06', '07'];
  const monthLabels = ['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'];

  let groupTotalAllTime = 0;
  let groupTotalThisMonth = 0;
  const currentMonthStr = new Date().toISOString().substring(0, 7);

  const monthTotalsMap: Record<string, number> = {};
  monthLabels.forEach(m => monthTotalsMap[m] = 0);

  const processedMembers = members.map((member) => {
    let memberAllTime = 0;
    let memberCarriedOver = 0;
    const monthsMap: Record<string, number> = {};

    entries.filter(e => e.member_id === member.id).forEach((entry) => {
      const amount = Number(entry.amount_paid) || 0;
      memberAllTime += amount;
      groupTotalAllTime += amount;

      const dateStr = entry.month_year; // Format: 'YYYY-MM-DD'
      if (dateStr.substring(0, 7) === currentMonthStr) {
        groupTotalThisMonth += amount;
      }

      const [yearStr, monthNum] = dateStr.split('-');
      const year = parseInt(yearStr);
      const startYear = parseInt(monthNum) >= 8 ? year : year - 1;
      const entryFY = `${startYear}/${startYear + 1}`;

      if (entryFY === selectedFY) {
        const idx = fyMonths.indexOf(monthNum);
        if (idx !== -1) {
          const label = monthLabels[idx];
          monthsMap[label] = (monthsMap[label] || 0) + amount;
          monthTotalsMap[label] += amount;
        }
      } else if (startYear < parseInt(selectedFY.split('/')[0])) {
        memberCarriedOver += amount;
      }
    });

    const fyTotal = Object.values(monthsMap).reduce((a, b) => a + b, 0);

    return {
      id: member.id,
      name: member.full_name,
      slug: member.slug,
      months: monthsMap,
      fyTotal,
      carriedOver: memberCarriedOver,
      totalContributed: memberAllTime
    };
  });

  return NextResponse.json({
    members: processedMembers,
    monthTotals: monthTotalsMap,
    groupTotalAllTime,
    groupTotalThisMonth,
    financialYear: selectedFY
  });
}