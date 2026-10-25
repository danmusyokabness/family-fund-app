// app/board/page.tsx
//
// The family message board and private messages to the admin.

import { redirect } from "next/navigation";
import { getMemberSession, getAdminSession } from "@/lib/auth";
import AppNav from "@/components/AppNav";
import MessageBoard from "@/components/MessageBoard";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
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
          <AppNav isAdmin={isAdmin} isMember={Boolean(member)} current="board" />
        </div>
      </header>
      <div className="mx-auto max-w-screen-md px-4 py-6 sm:px-6">
        <MessageBoard />
      </div>
    </main>
  );
}
