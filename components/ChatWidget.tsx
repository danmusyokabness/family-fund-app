"use client";
// components/ChatWidget.tsx
//
// The family chat: a round button at the bottom right of the page that
// opens a small chat panel. One chat, with a "To:" choice: everyone, a
// particular member (private: nobody else sees it, not even the admin), or
// the admin. Admins see the members' messages to them as extra conversations
// and can reply.
//
// Light on purpose: nothing is fetched until the page loads once, and while
// the panel is closed nothing is polled. While it is open it refreshes every
// 30 seconds.

import { useCallback, useEffect, useRef, useState } from "react";

interface Message {
  id: string;
  fromMe: boolean;
  senderName: string;
  content: string;
  createdAt: string;
  canDelete: boolean;
}
interface Conversation {
  key: string;
  title: string;
  unread: number;
  lastAt: string;
  messages: Message[];
}
interface ChatData {
  conversations: Conversation[];
  people: { id: string; name: string }[];
  unreadTotal: number;
  isAdmin: boolean;
  isMember: boolean;
  name: string;
}

const MAX = 1000;

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ChatData | null>(null);
  const [key, setKey] = useState("public");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/chat");
      if (!res.ok) return;
      setData(await res.json());
    } catch {
      /* the chat is a convenience; if it cannot load, nothing else is affected */
    }
  }, []);

  // One load when the page opens (for the unread badge), then only while the panel is open.
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!open) return;
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [open, load]);

  const current = data?.conversations.find((c) => c.key === key) ?? null;

  // Opening a conversation counts as reading it.
  useEffect(() => {
    if (!open || !current || current.unread === 0) return;
    (async () => {
      await fetch("/api/chat", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
      await load();
    })();
  }, [open, key, current, load]);

  // Keep the newest message in view.
  useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, key, current?.messages.length]);

  if (!data) return null;

  // Everything the person can write to: the conversations that exist, plus Admin and each other member to start a new one.
  const existing = new Set(data.conversations.map((c) => c.key));
  const optionList: { key: string; label: string }[] = data.conversations.map((c) => ({ key: c.key, label: c.unread > 0 ? `${c.title} (${c.unread} new)` : c.title }));
  if (data.isMember && !existing.has("public")) optionList.unshift({ key: "public", label: "Everyone" });
  if (data.isMember && !existing.has("admin")) optionList.push({ key: "admin", label: "Admin" });
  for (const person of data.people) if (!existing.has(`member:${person.id}`)) optionList.push({ key: `member:${person.id}`, label: `${person.name} (new private chat)` });
  if (!data.isMember && !existing.has("public")) optionList.unshift({ key: "public", label: "Everyone" });

  const title = optionList.find((o) => o.key === key)?.label.replace(/ \(.*\)$/, "") ?? "Everyone";
  const target = key.startsWith("inbox:") ? `Reply to ${title}` : key === "public" ? "Everyone" : key === "admin" ? "the Admin (private)" : `${title} (private)`;

  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: key, content: text }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not send that message.");
      setText("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that message.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this message?")) return;
    const res = await fetch(`/api/chat/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not remove that message.");
    }
    await load();
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open the family chat"
          className="fixed bottom-4 right-4 z-30 flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface shadow-md"
          style={{ color: "var(--brass)" }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
          </svg>
          {data.unreadTotal > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs text-white" style={{ background: "var(--ochre)" }}>
              {data.unreadTotal}
            </span>
          )}
        </button>
      )}

      {open && (
        <div className="paper-card fixed bottom-4 right-4 z-30 flex h-[28rem] max-h-[75vh] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden shadow-lg">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <select
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setError(null);
              }}
              className="min-w-0 flex-1 rounded-md px-2 py-1 text-sm"
              aria-label="Who the chat is with"
            >
              {optionList.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close the chat" className="px-2 text-lg leading-none text-ink-soft">
              ×
            </button>
          </div>

          <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
            {(!current || current.messages.length === 0) && (
              <p className="pt-6 text-center text-xs text-ink-soft">
                {key === "public" ? "Nothing here yet. Say hello to the family." : "No messages yet. Write the first one below."}
              </p>
            )}
            {current?.messages.map((m) => (
              <div key={m.id} className={`max-w-[88%] rounded-lg border border-line px-3 py-1.5 text-sm ${m.fromMe ? "ml-auto bg-surface" : "bg-paper"}`}>
                <p className="flex items-center justify-between gap-3 text-xs text-ink-soft">
                  <span>{m.fromMe ? "You" : m.senderName}</span>
                  <span>{when(m.createdAt)}</span>
                </p>
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
                {m.canDelete && (
                  <button type="button" onClick={() => remove(m.id)} className="text-xs text-ink-soft underline">
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-line px-3 py-2">
            <p className="mb-1 text-xs text-ink-soft">To: {target}</p>
            {error && <p className="mb-1 text-xs text-danger">{error}</p>}
            <div className="flex items-end gap-2">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                maxLength={MAX}
                rows={2}
                placeholder="Write a message..."
                className="min-w-0 flex-1 rounded-md border border-line px-2 py-1.5 text-sm"
              />
              <button type="button" onClick={send} disabled={busy || !text.trim()} className="btn-primary px-3 py-1.5 text-sm">
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
