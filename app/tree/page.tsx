// app/tree/page.tsx
//
// The family tree. Anyone logged in can see it and add or edit people.

import { redirect } from "next/navigation";
import { getMemberSession, getAdminSession } from "@/lib/auth";
import AppNav from "@/components/AppNav";
import FamilyTree from "@/components/FamilyTree";

export const dynamic = "force-dynamic";

export default async function TreePage() {
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
          <AppNav isAdmin={isAdmin} isMember={Boolean(member)} current="tree" />
        </div>
      </header>
      <div className="mx-auto max-w-screen-lg px-4 py-6 sm:px-6">
        <FamilyTree />
      </div>
    </main>
  );
}
