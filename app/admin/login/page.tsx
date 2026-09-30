"use client";
// app/admin/login/page.tsx
//
// Separate from member login on purpose — the admin account is a
// username + password from environment variables, not a member record.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      router.push("/admin");
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
          <h1 className="font-serif text-2xl font-semibold">Admin login</h1>
          <p className="mt-1 text-sm text-ink-soft">For the fund administrator only.</p>
        </div>

        <div>
          <label htmlFor="username" className="mb-1 block text-sm font-medium text-ink">Username</label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-3 py-2"
            autoComplete="username"
            required
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-ink">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2"
            autoComplete="current-password"
            required
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <button type="submit" disabled={loading} className="btn-primary w-full py-2">
          {loading ? "Logging in..." : "Log in"}
        </button>

        <p className="text-center text-xs text-ink-soft">
          Family member? <a href="/login" className="link">Member login</a>
        </p>
      </form>
    </main>
  );
}
