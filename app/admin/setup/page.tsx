// app/admin/setup/page.tsx
//
// Guard lives here (server-side, redirect-based); the actual interactive
// form is a client component so it can fetch/submit without a full page reload.

import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import SetupForm from "@/components/admin/SetupForm";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const isAdmin = await getAdminSession();
  if (!isAdmin) redirect("/admin/login");

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 font-sans">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <a href="/admin" className="text-sm text-slate-500 underline">&larr; Admin home</a>
          <h1 className="mt-2 text-2xl font-bold text-slate-800">Setup</h1>
          <p className="mt-1 text-sm text-slate-600">
            Nothing here is hard-coded — this is the one place these values live.
          </p>
        </div>
        <SetupForm />
      </div>
    </main>
  );
}