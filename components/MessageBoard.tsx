"use client";
// components/MessageBoard.tsx
//
// The family board (everyone can read and post) and, for members, a
// private conversation with the admin that nobody else can see.

import { useCallback, useEffect, useState } from "react";

interface Post {
  id: string;
  senderName: string;
  content: string;
  createdAt: string;
  mine: boolean;
  canDelete: boolean;
}
interface ThreadMessage {
  id: string;
  fromAdmin: boolean;
  senderName: string;
  content: string;
  createdAt: string;
}
interface BoardData {
  posts: Post[];
  thread: ThreadMessage[];
  isAdmin: boolean;
  isMember: boolean;
  name: string;
}

const MAX = 1000;

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function MessageBoard() {
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publicText, setPublicText] = useState("");
  const [privateText, setPrivateText] = useState("");
  const [busy, setBusy] = useState<"public" | "private" | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/board");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not load the board.");
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the board.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function send(kind: "public" | "private") {
    const content = kind === "public" ? publicText : privateText;
    if (!content.trim()) return;
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch("/api/board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, private: kind === "private" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not send that message.");
      if (kind === "public") setPublicText("");
      else setPrivateText("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that message.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this message from the board?")) return;
    const res = await fetch(`/api/board/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not remove that message.");
    }
    await load();
  }

  if (!data) return <p className="text-ink-soft">{error ?? "Loading..."}</p>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Family board</h1>
        <p className="mt-1 text-sm text-ink-soft">
          A place for the whole family to share news and notes. Everyone who is logged in can read and post here. Please keep it kind, and keep money
          questions that are private for the admin below.
        </p>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <section className="space-y-3">
        <div className="paper-card space-y-2 p-4">
          <textarea
            value={publicText}
            onChange={(e) => setPublicText(e.target.value)}
            maxLength={MAX}
            rows={3}
            placeholder="Write something for the family..."
            className="w-full rounded-md border border-line px-3 py-2 text-sm"
          />
          <div className="flex items-center justify-between text-xs text-ink-soft">
            <span>
              {publicText.length}/{MAX}
            </span>
            <button type="button" onClick={() => send("public")} disabled={busy !== null || !publicText.trim()} className="btn-primary px-4 py-1.5 text-sm">
              {busy === "public" ? "Posting..." : "Post to the board"}
            </button>
          </div>
        </div>

        {data.posts.length === 0 && <p className="paper-card p-4 text-sm text-ink-soft">Nothing posted yet. Be the first.</p>}
        {data.posts.map((post) => (
          <article key={post.id} className="paper-card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium">
                {post.senderName}
                {post.mine && <span className="ml-2 text-xs font-normal text-ink-soft">(you)</span>}
              </p>
              <p className="text-xs text-ink-soft">{when(post.createdAt)}</p>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm">{post.content}</p>
            {post.canDelete && (
              <button type="button" onClick={() => remove(post.id)} className="mt-2 text-xs text-ink-soft underline">
                Remove
              </button>
            )}
          </article>
        ))}
      </section>

      {data.isMember ? (
        <section className="space-y-3">
          <div>
            <h2 className="font-serif text-xl font-semibold">Message the admin</h2>
            <p className="mt-1 text-sm text-ink-soft">Private: only you and the admin can see this conversation.</p>
          </div>
          <div className="space-y-2">
            {data.thread.length === 0 && <p className="paper-card p-4 text-sm text-ink-soft">No messages yet.</p>}
            {data.thread.map((m) => (
              <div key={m.id} className={`max-w-[85%] rounded-md border border-line px-3 py-2 text-sm ${m.fromAdmin ? "bg-paper" : "ml-auto bg-surface"}`}>
                <p className="text-xs text-ink-soft">
                  {m.fromAdmin ? "Admin" : "You"} &middot; {when(m.createdAt)}
                </p>
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
            ))}
          </div>
          <div className="paper-card space-y-2 p-4">
            <textarea
              value={privateText}
              onChange={(e) => setPrivateText(e.target.value)}
              maxLength={MAX}
              rows={3}
              placeholder="Write privately to the admin..."
              className="w-full rounded-md border border-line px-3 py-2 text-sm"
            />
            <div className="flex items-center justify-between text-xs text-ink-soft">
              <span>
                {privateText.length}/{MAX}
              </span>
              <button type="button" onClick={() => send("private")} disabled={busy !== null || !privateText.trim()} className="btn-primary px-4 py-1.5 text-sm">
                {busy === "private" ? "Sending..." : "Send to the admin"}
              </button>
            </div>
          </div>
        </section>
      ) : (
        data.isAdmin && (
          <p className="text-sm text-ink-soft">
            Private messages from members arrive in the <a href="/admin" className="link">Admin area</a>, under the Messages tab.
          </p>
        )
      )}
    </div>
  );
}
