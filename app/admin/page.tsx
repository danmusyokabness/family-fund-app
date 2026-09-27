// app/admin/page.tsx

import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const isAdmin = await getAdminSession();
  if (!isAdmin) redirect("/admin/login");

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 font-sans">
      <div className="mx-auto max-w-md space-y-4 rounded-xl bg-white p-6 shadow">
        <h1 className="text-xl font-bold text-slate-800">Admin</h1>
        <div className="space-y-2">
          <a href="/admin/setup" className="block rounded-md border border-slate-200 px-4 py-3 hover:bg-slate-50">
            <span className="font-medium text-slate-800">Setup</span>
            <p className="text-sm text-slate-500">Fund name, Till, target, reminder days, message wording.</p>
          </a>
          <a href="/admin/members" className="block rounded-md border border-slate-200 px-4 py-3 hover:bg-slate-50">
            <span className="font-medium text-slate-800">Members</span>
            <p className="text-sm text-slate-500">Add, edit, deactivate, or bulk-import members.</p>
          </a>
        </div>
        <p className="text-sm text-slate-500">Payments are built in Step 5.</p>
        <LogoutButton type="admin" />
      </div>
    </main>
  );
}