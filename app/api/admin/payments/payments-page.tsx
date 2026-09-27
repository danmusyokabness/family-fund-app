// app/admin/payments/page.tsx

import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import PaymentsManager from "@/components/admin/PaymentsManager";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const isAdmin = await getAdminSession();
  if (!isAdmin) redirect("/admin/login");

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 font-sans">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <a href="/admin" className="text-sm text-slate-500 underline">&larr; Admin home</a>
          <h1 className="mt-2 text-2xl font-bold text-slate-800">Payments</h1>
        </div>
        <PaymentsManager />
      </div>
    </main>
  );
}
