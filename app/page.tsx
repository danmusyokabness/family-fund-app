// app/page.tsx
//
// Placeholder for Step 1 only. The old page.tsx (with its bugs) has been
// moved to legacy/app/page.tsx for reference. The real member dashboard
// (balance, this-year total, this-month group total, fund total, ledger)
// is built in Step 6, on top of the login system from Step 3.

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4 font-sans">
      <div className="max-w-md text-center space-y-3">
        <h1 className="text-2xl font-bold text-slate-800">Family Emergency Fund Tracker</h1>
        <p className="text-slate-600">
          Step 1 foundation is in place. Login (Step 3), Setup (Step 4) and the member
          dashboard (Step 6) are built in the steps that follow.
        </p>
        <p className="text-sm text-slate-400">
          Check <code>/api/health</code> to confirm the database connection works.
        </p>
      </div>
    </main>
  );
}
