'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

function DashboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedMemberSlug = searchParams.get('member');

  const [selectedFY, setSelectedFY] = useState('2026/2027');
  const [ledgerData, setLedgerData] = useState<any[]>([]);
  const [monthTotals, setMonthTotals] = useState<Record<string, number>>({});
  const [groupStats, setGroupStats] = useState({ totalAllTime: 0, totalThisMonth: 0 });
  const [currentUser, setCurrentUser] = useState<any>(null);

  const [messages, setMessages] = useState<any[]>([]);
  const [content, setContent] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);

  const monthsList = ['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'];

  useEffect(() => {
    fetchLedger();
    fetchMessages();
  }, [selectedFY, selectedMemberSlug]);

  async function fetchLedger() {
    const res = await fetch(`/api/ledger?fy=${encodeURIComponent(selectedFY)}`);
    const data = await res.json();
    setLedgerData(data.members || []);
    setMonthTotals(data.monthTotals || {});
    setGroupStats({
      totalAllTime: data.groupTotalAllTime || 0,
      totalThisMonth: data.groupTotalThisMonth || 0,
    });

    if (selectedMemberSlug && data.members) {
      const member = data.members.find((m: any) => m.slug === selectedMemberSlug);
      if (member) setCurrentUser(member);
    }
  }

  async function fetchMessages() {
    const res = await fetch('/api/messages');
    const data = await res.json();
    setMessages(data || []);
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;

    const senderName = currentUser ? currentUser.name : 'Anonymous';

    await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senderName, content, isPrivate }),
    });

    setContent('');
    fetchMessages();
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 font-sans w-full">
      <div className="w-full space-y-8">
        
        {/* Header Bar */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Family Emergency Fund Tracker</h1>
            <p className="text-sm text-slate-500">M-PESA Till Number: <span className="font-semibold text-slate-800">1611383</span></p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Link
              href="/admin"
              className="px-3 py-1.5 text-xs rounded font-semibold bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm transition-all"
            >
              Admin Portal
            </Link>
            <button
              onClick={() => router.push('/family-tree')}
              className="px-3 py-1.5 text-xs rounded font-semibold bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm transition-all"
            >
              Family Tree View
            </button>
            <select 
              value={selectedFY} 
              onChange={(e) => setSelectedFY(e.target.value)}
              className="bg-white border border-slate-300 rounded px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm"
            >
              <option value="2026/2027">Financial Year 2026/2027</option>
              <option value="2027/2028">Financial Year 2027/2028</option>
            </select>
          </div>
        </div>

        {/* 1. Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Group Total (All-Time)</span>
            <p className="text-2xl font-extrabold text-emerald-600">KES {groupStats.totalAllTime.toLocaleString()}</p>
          </div>
          <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Group Total (Current Month)</span>
            <p className="text-2xl font-extrabold text-blue-600">KES {groupStats.totalThisMonth.toLocaleString()}</p>
          </div>
          <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Your Personal Total (All-Time)</span>
            <p className="text-2xl font-extrabold text-indigo-600">
              {currentUser ? `KES ${currentUser.totalContributed.toLocaleString()}` : 'Use Personal Link'}
            </p>
          </div>
        </div>

        {/* 2. Master Ledger Table */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-x-auto w-full">
          <div className="p-4 border-b bg-slate-50 flex justify-between items-center">
            <h2 className="font-semibold text-slate-700">Master Ledger - {selectedFY}</h2>
            <span className="text-xs text-slate-500">Contributions update automatically & transparently.</span>
          </div>
          <table className="w-full text-sm text-left text-slate-600">
            <thead className="text-xs text-slate-700 uppercase bg-slate-100 border-b">
              <tr>
                <th className="px-4 py-3">Member Name</th>
                <th className="px-3 py-3 bg-slate-200/50">Carried Over</th>
                {monthsList.map(m => <th key={m} className="px-3 py-3">{m}</th>)}
                <th className="px-3 py-3 font-bold text-slate-800">FY Total</th>
                <th className="px-3 py-3 font-bold text-emerald-700">All-Time Total</th>
              </tr>
            </thead>
            <tbody>
              {ledgerData.map((m) => {
                const isSelected = m.slug === selectedMemberSlug;
                return (
                  <tr key={m.id} className={`border-b ${isSelected ? 'bg-indigo-50/80 font-semibold' : 'hover:bg-slate-50'}`}>
                    <td className="px-4 py-3 font-medium text-slate-900">{m.name}</td>
                    <td className="px-3 py-3 bg-slate-100/50 text-slate-500 font-medium">KES {m.carriedOver}</td>
                    {monthsList.map((month) => (
                      <td key={month} className="px-3 py-3">
                        <span className={(m.months[month] || 0) < 300 ? 'text-amber-600 font-semibold' : 'text-slate-700'}>
                          {m.months[month] || 0}
                        </span>
                      </td>
                    ))}
                    <td className="px-3 py-3 font-bold text-slate-800">KES {m.fyTotal}</td>
                    <td className="px-3 py-3 font-bold text-emerald-700">KES {m.totalContributed}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-slate-100 font-bold border-t border-slate-300">
              <tr>
                <td className="px-4 py-3 text-slate-800">MONTHLY TOTALS</td>
                <td className="px-3 py-3 text-slate-500">-</td>
                {monthsList.map((month) => (
                  <td key={month} className="px-3 py-3 text-slate-800">
                    KES {monthTotals[month] || 0}
                  </td>
                ))}
                <td className="px-3 py-3 text-slate-800">-</td>
                <td className="px-3 py-3 text-emerald-700">-</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* 3. Community Message Board */}
        <div className="bg-white rounded-lg border border-slate-200 p-6 shadow-sm space-y-4 w-full">
          <h2 className="font-semibold text-slate-800 border-b pb-2">Community Message Board</h2>
          <form onSubmit={handleSendMessage} className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">
                Posting as: <strong className="text-slate-800">{currentUser ? currentUser.name : 'Anonymous'}</strong>
              </span>
              <div className="flex items-center space-x-2">
                <input 
                  type="checkbox" 
                  id="privateToggle" 
                  checked={isPrivate} 
                  onChange={(e) => setIsPrivate(e.target.checked)} 
                  className="rounded border-slate-300 text-indigo-600"
                />
                <label htmlFor="privateToggle" className="text-xs text-slate-600">Send to Admin Only (Private)</label>
              </div>
            </div>
            <textarea 
              placeholder="Write a message..." 
              value={content} 
              onChange={(e) => setContent(e.target.value)}
              className="w-full p-2 border border-slate-300 rounded text-sm h-20"
              required
            />
            <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700">
              Post Comment
            </button>
          </form>

          <div className="space-y-3 pt-4 border-t">
            {messages.map((msg) => {
              return (
                <div key={msg.id} className={`p-3 rounded border text-sm ${msg.is_private ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex justify-between items-center text-xs text-slate-500 mb-1">
                    <span className="font-semibold text-slate-700">{msg.sender_name}</span>
                    <span>{new Date(msg.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="text-slate-700">{msg.content}</p>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading Family Fund Tracker...</div>}>
      <DashboardContent />
    </Suspense>
  );
}