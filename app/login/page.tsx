"use client";
// app/login/page.tsx
//
// The one shared link every member uses. They log in with their name and
// their registered phone number — no password to remember, no separate
// link per person. See the project README, section 8, for why.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/member-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="paper-card w-full max-w-sm space-y-4 p-7">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Family Emergency Fund</h1>
          <p className="mt-1 text-sm text-ink-soft">Log in with your name and phone number.</p>
        </div>

        <div>
          <label htmlFor="fullName" className="mb-1 block text-sm font-medium text-ink">Full name</label>
          <input
            id="fullName"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full px-3 py-2"
            placeholder="e.g. Esther Nakhanu"
            autoComplete="name"
            required
          />
        </div>

        <div>
          <label htmlFor="phone" className="mb-1 block text-sm font-medium text-ink">Phone number</label>
          <input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full px-3 py-2"
            placeholder="07XXXXXXXX"
            autoComplete="tel"
            required
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <button type="submit" disabled={loading} className="btn-primary w-full py-2">
          {loading ? "Logging in..." : "Log in"}
        </button>

        <p className="text-center text-xs text-ink-soft">
          Are you the admin? <a href="/admin/login" className="link">Admin login</a>
        </p>
      </form>
    </main>
  );
}
