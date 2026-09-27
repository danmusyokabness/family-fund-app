"use client";
// components/LogoutButton.tsx
//
// A small shared client component so the logout fetch/redirect logic
// isn't duplicated between the member home page and the admin page.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LogoutButton({
  type,
  label = "Log out",
}: {
  type: "member" | "admin";
  label?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
    } finally {
      router.push(type === "admin" ? "/admin/login" : "/login");
      router.refresh();
    }
  }

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      className="text-sm text-slate-500 underline hover:text-slate-700 disabled:opacity-60"
    >
      {loading ? "Logging out..." : label}
    </button>
  );
}