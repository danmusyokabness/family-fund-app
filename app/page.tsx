// app/page.tsx
//
// The member home page — the five things from the project plan: my
// balance, my total this year, the group total this month, the fund
// total, and the full ledger. See components/MemberDashboard.tsx for
// the actual rendering; this file is just the login guard and top bar.

import { redirect } from "next/navigation";
import { getMemberSession, getAdminSession } from "@/lib/auth";
import AppNav from "@/components/AppNav";
import MemberDashboard from "@/components/MemberDashboard";
import ChatWidget from "@/components/ChatWidget";

export const dynamic = "force-dynamic";

export default async function Home() {
  const member = await getMemberSession();
  const isAdmin = await getAdminSession();
  if (!member && !isAdmin) redirect("/login");

  return (
    <main className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <div>
            <p className="font-serif text-lg font-semibold">Family Emergency Fund</p>
            <p className="text-xs text-ink-soft">
              {member ? member.fullName : "Superadmin"}
            </p>
          </div>
          <AppNav isAdmin={isAdmin} isMember={Boolean(member)} current="dashboard" />
        </div>
      </header>
      <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
        <MemberDashboard />
      </div>
      <ChatWidget />
    </main>
  );
}
