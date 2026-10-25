// app/ledger/page.tsx
//
// The full ledger page: every movement of money in the fund, by month
// and category. Same login guard as the home page.

import { redirect } from "next/navigation";
import { getMemberSession, getAdminSession } from "@/lib/auth";
import AppNav from "@/components/AppNav";
import FullLedger from "@/components/FullLedger";

export const dynamic = "force-dynamic";

export default async function LedgerPage() {
  const member = await getMemberSession();
  const isAdmin = await getAdminSession();
  if (!member && !isAdmin) redirect("/login");

  return (
    <main className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <div>
            <p className="font-serif text-lg font-semibold">Family Emergency Fund</p>
            <p className="text-xs text-ink-soft">{member ? member.fullName : "Superadmin"}</p>
          </div>
          <AppNav isAdmin={isAdmin} isMember={Boolean(member)} current="ledger" />
        </div>
      </header>
      <div className="mx-auto max-w-screen-lg px-4 py-6 sm:px-6">
        <FullLedger />
      </div>
    </main>
  );
}
