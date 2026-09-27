// app/page.tsx
//
// Now gated behind member login (Step 3). Still a placeholder otherwise —
// the real dashboard (balance, this-year total, this-month group total,
// fund total, the full ledger) is built in Step 6 on top of this guard.

import { redirect } from "next/navigation";
import { getMemberSession, getAdminSession } from "@/lib/auth";
import LogoutButton from "@/components/LogoutButton";

// This page's content depends entirely on who is logged in, so it must
// always be rendered fresh per visitor — never statically pre-built at
// deploy time (which would happen before any env vars/cookies are real,
// and could risk one visitor's cached page being shown to another).
export const dynamic = "force-dynamic";

export default async function Home() {
  const member = await getMemberSession();
  if (!member) redirect("/login");

  const isAdmin = await getAdminSession();

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4 font-sans">
      <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-6 text-center shadow">
        <h1 className="text-xl font-bold text-slate-800">Family Emergency Fund Tracker</h1>
        <p className="text-slate-600">
          Logged in as <span className="font-medium">{member.fullName}</span>.
        </p>
        <p className="text-sm text-slate-500">
          Balance, this year&apos;s total, this month&apos;s group total, the fund total and the full ledger
          are built in Step 6.
        </p>
        {isAdmin && (
          <p className="text-sm">
            <a href="/admin" className="text-slate-600 underline">Go to admin</a>
          </p>
        )}
        <LogoutButton type="member" />
      </div>
    </main>
  );
}