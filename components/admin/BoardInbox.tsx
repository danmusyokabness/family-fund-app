"use client";
// components/admin/BoardInbox.tsx
//
// The "Messages" tab: private messages from members, one conversation per
// member, newest activity first, with unread counts and a reply box.

import { useCallback, useEffect, useState } from "react";

interface Message {
  id: string;
  fromAdmin: boolean;
  senderName: string;
  content: string;
  createdAt: string;
}
interface Thread {
  memberId: string;
  memberName: string;
  unreadCount: number;
  lastMessageAt: string;
  messages: Message[];
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function BoardInbox() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/board");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load the messages.");
      setThreads(data.threads);
      setUnreadTotal(data.unreadTotal);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the messages.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function openThread(thread: Thread) {
    const next = open === thread.memberId ? null : thread.memberId;
    setOpen(next);
    setReply("");
    if (next && thread.unreadCount > 0) {
      await fetch("/api/admin/board", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId: thread.memberId }) });
      await load();
    }
  }

  async function sendReply(memberId: string) {
    if (!reply.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, content: reply }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not send the reply.");
      setReply("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the reply.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-serif text-lg font-semibold">
          Messages {unreadTotal > 0 && <span className="ml-1 rounded-full bg-ochre-soft px-2 py-0.5 text-xs font-normal text-ochre">{unreadTotal} unread</span>}
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          Private messages members send you from the Board page. Only you and that member can see a conversation. (The public board is moderated on the
          Board page itself: admins see a Remove link on every post.)
        </p>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {loaded && threads.length === 0 && <p className="paper-card p-4 text-sm text-ink-soft">No private messages yet.</p>}

      <div className="space-y-2">
        {threads.map((t) => (
          <div key={t.memberId} className="paper-card overflow-hidden">
            <button type="button" onClick={() => openThread(t)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm">
              <span className="font-medium">{t.memberName}</span>
              <span className="flex items-center gap-3 text-xs text-ink-soft">
                {t.unreadCount > 0 && <span className="rounded-full bg-ochre-soft px-2 py-0.5 text-ochre">{t.unreadCount} new</span>}
                {when(t.lastMessageAt)}
              </span>
            </button>
            {open === t.memberId && (
              <div className="space-y-2 border-t border-line px-4 py-3">
                {t.messages.map((m) => (
                  <div key={m.id} className={`max-w-[85%] rounded-md border border-line px-3 py-2 text-sm ${m.fromAdmin ? "ml-auto bg-surface" : "bg-paper"}`}>
                    <p className="text-xs text-ink-soft">
                      {m.fromAdmin ? "You (admin)" : t.memberName} &middot; {when(m.createdAt)}
                    </p>
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  </div>
                ))}
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  maxLength={1000}
                  rows={2}
                  placeholder={`Reply to ${t.memberName}...`}
                  className="w-full rounded-md border border-line px-3 py-2 text-sm"
                />
                <button type="button" onClick={() => sendReply(t.memberId)} disabled={busy || !reply.trim()} className="btn-primary px-4 py-1.5 text-sm">
                  {busy ? "Sending..." : "Send reply"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
