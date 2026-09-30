// app/admin/page.tsx

import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import LogoutButton from "@/components/LogoutButton";
import AdminShell from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const isAdmin = await getAdminSession();
  if (!isAdmin) redirect("/admin/login");

  return (
    <main className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-4 py-3 sm:px-6">
          <div>
            <p className="font-serif text-lg font-semibold">Family Emergency Fund</p>
            <p className="text-xs text-ink-soft">Admin</p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <a href="/" className="link">Dashboard</a>
            <LogoutButton type="admin" />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
        <AdminShell />
      </div>
    </main>
  );
}
