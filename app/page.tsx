// app/page.tsx
//
// The member home page — the five things from the project plan: my
// balance, my total this year, the group total this month, the fund
// total, and the full ledger. See components/MemberDashboard.tsx for
// the actual rendering; this file is just the login guard.

import { redirect } from "next/navigation";
import { getMemberSession, getAdminSession } from "@/lib/auth";
import LogoutButton from "@/components/LogoutButton";
import MemberDashboard from "@/components/MemberDashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const member = await getMemberSession();
  const isAdmin = await getAdminSession();
  if (!member && !isAdmin) redirect("/login");

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 font-sans">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Family Emergency Fund</h1>
            <p className="text-sm text-slate-500">
              {member ? `Logged in as ${member.fullName}` : "Logged in as superadmin"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isAdmin && (
              <a href="/admin" className="text-sm text-slate-600 underline">
                Admin
              </a>
            )}
            <LogoutButton type={member ? "member" : "admin"} />
          </div>
        </div>
        <MemberDashboard />
      </div>
    </main>
  );
}
