"use client";
// components/FamilyTree.tsx
//
// The family tree. Everyone who is logged in can look, add people and edit
// them; every change is logged, and an admin can undo any of them. A member
// who has no place in the tree yet must first say where they are (decision
// D20), so nobody is ever left floating.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildForest,
  descendantIds,
  rankClaimCandidates,
  rankParentCandidates,
  type PublicTreeNode,
  type TreeBranch,
  type TreeNode,
} from "@/lib/family-tree";

interface TreeData {
  nodes: PublicTreeNode[];
  me: { memberId: string | null; name: string; nodeId: string | null };
  isAdmin: boolean;
  needsToConnect: boolean;
}
interface Change {
  id: string;
  at: string;
  by: string;
  action: string;
  person: string;
  fields: string[];
  undone: boolean;
}

const FIELD_LABEL: Record<string, string> = {
  name: "name",
  spouseName: "spouse",
  parentId: "parent",
  spouseId: "spouse link",
  memberId: "member link",
  dateOfBirth: "date of birth",
  birthdate: "birth date note",
  workEducation: "work or education",
  bio: "bio",
  phone: "phone",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function born(node: PublicTreeNode): string | null {
  if (node.dateOfBirth) {
    const [y, m, d] = node.dateOfBirth.split("-").map(Number);
    const now = new Date();
    let age = now.getFullYear() - y;
    if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
    return `Born ${d} ${MONTHS[m - 1]} ${y} (${age})`;
  }
  return node.birthdate ? `Born ${node.birthdate}` : null;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** The nodes as the pure tree functions expect them. */
function asTreeNodes(nodes: PublicTreeNode[]): TreeNode[] {
  return nodes.map((n) => ({ ...n, deletedAt: null }));
}

function describe(change: Change): string {
  switch (change.action) {
    case "create":
      return `added ${change.person}`;
    case "update":
      return `changed ${change.person}${change.fields.length > 0 ? " (" + change.fields.map((f) => FIELD_LABEL[f] ?? f).join(", ") + ")" : ""}`;
    case "delete":
      return `removed ${change.person}`;
    case "restore":
      return `undid a change to ${change.person}`;
    case "link":
      return `linked ${change.person} to a member account`;
    default:
      return `changed ${change.person}`;
  }
}

// ---------------------------------------------------------------------------
// The form for adding or editing one person
// ---------------------------------------------------------------------------
type Editing = { mode: "add"; parentId: string | null } | { mode: "edit"; node: PublicTreeNode };

function PersonForm({
  editing,
  data,
  onDone,
  onCancel,
}: {
  editing: Editing;
  data: TreeData;
  onDone: () => void;
  onCancel: () => void;
}) {
  const existing = editing.mode === "edit" ? editing.node : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [spouseName, setSpouseName] = useState(existing?.spouseName ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(existing?.dateOfBirth ?? "");
  const [birthdate, setBirthdate] = useState(existing?.birthdate ?? "");
  const [workEducation, setWorkEducation] = useState(existing?.workEducation ?? "");
  const [bio, setBio] = useState(existing?.bio ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [parentId, setParentId] = useState(editing.mode === "add" ? editing.parentId ?? "" : existing?.parentId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A person cannot be moved under themselves or their own descendants.
  const parentOptions = useMemo(() => {
    const all = asTreeNodes(data.nodes);
    const blocked = new Set(existing ? [existing.id, ...descendantIds(all, existing.id)] : []);
    return data.nodes.filter((n) => !blocked.has(n.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [data.nodes, existing]);

  async function submit() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      name,
      spouseName,
      dateOfBirth,
      birthdate,
      workEducation,
      bio,
      parentId: parentId || null,
    };
    if (data.isAdmin) body.phone = phone;
    try {
      const res = await fetch(existing ? `/api/tree/${existing.id}` : "/api/tree", {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Could not save.");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-md border border-line px-3 py-2 text-sm";
  return (
    <div className="paper-card space-y-3 border-brass p-4">
      <h3 className="font-medium">{existing ? `Edit ${existing.name}` : "Add a person"}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-ink-soft sm:col-span-2">
          Full name
          <input value={name} onChange={(e) => setName(e.target.value)} className={input} />
        </label>
        <label className="text-xs text-ink-soft sm:col-span-2">
          Child of
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={input}>
            <option value="">(nobody: top of the tree)</option>
            {parentOptions.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
                {n.spouseName ? ` & ${n.spouseName}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-soft">
          Date of birth
          <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className={input} />
        </label>
        <label className="text-xs text-ink-soft">
          Birth date, if only approximate
          <input value={birthdate} onChange={(e) => setBirthdate(e.target.value)} placeholder="for example: around 1950" className={input} />
        </label>
        <label className="text-xs text-ink-soft sm:col-span-2">
          Spouse (name)
          <input value={spouseName} onChange={(e) => setSpouseName(e.target.value)} className={input} />
        </label>
        <label className="text-xs text-ink-soft sm:col-span-2">
          Work or education
          <input value={workEducation} onChange={(e) => setWorkEducation(e.target.value)} className={input} />
        </label>
        <label className="text-xs text-ink-soft sm:col-span-2">
          About
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} className={input} />
        </label>
        {data.isAdmin && (
          <label className="text-xs text-ink-soft sm:col-span-2">
            Phone (only admins can see this)
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={input} />
          </label>
        )}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-3">
        <button type="button" onClick={submit} disabled={busy || !name.trim()} className="btn-primary px-4 py-1.5 text-sm">
          {busy ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary px-4 py-1.5 text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// First visit: say where you are in the family (decision D20)
// ---------------------------------------------------------------------------
function ConnectToTree({ data, onDone }: { data: TreeData; onDone: () => void }) {
  const all = useMemo(() => asTreeNodes(data.nodes), [data.nodes]);
  const claims = useMemo(() => rankClaimCandidates(all, data.me.name).slice(0, 5), [all, data.me.name]);
  const parents = useMemo(() => rankParentCandidates(all, data.me.name), [all, data.me.name]);
  const [parentId, setParentId] = useState(parents[0]?.id ?? "");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tree/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Could not connect you.");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect you.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Where are you in the family?</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Before you look around, please find your place in the family tree, so everyone is connected. This only takes a moment, and you can change your
          details afterwards.
        </p>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {claims.length > 0 && (
        <div className="paper-card space-y-2 p-4">
          <h2 className="font-medium">Is one of these you?</h2>
          {claims.map((n) => (
            <div key={n.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                {n.name}
                {born(n) && <span className="ml-2 text-xs text-ink-soft">{born(n)}</span>}
              </span>
              <button type="button" disabled={busy} onClick={() => connect({ claimNodeId: n.id })} className="btn-secondary px-3 py-1 text-xs">
                That&apos;s me
              </button>
            </div>
          ))}
        </div>
      )}

      {data.nodes.length === 0 ? (
        <div className="paper-card space-y-2 p-4">
          <h2 className="font-medium">The tree is empty</h2>
          <p className="text-sm text-ink-soft">You can start it. Others will be added around you.</p>
          <button type="button" disabled={busy} onClick={() => connect({ asRoot: true })} className="btn-primary px-4 py-1.5 text-sm">
            Start the tree with me
          </button>
        </div>
      ) : (
        <div className="paper-card space-y-3 p-4">
          <h2 className="font-medium">{claims.length > 0 ? "Otherwise, add yourself" : "Add yourself"}</h2>
          <label className="block text-xs text-ink-soft">
            Whose child are you? (the most likely parents are listed first)
            <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm">
              {parents.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                  {n.spouseName ? ` & ${n.spouseName}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-ink-soft">
            Your date of birth (optional, it helps put the family in order)
            <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm" />
          </label>
          <button type="button" disabled={busy || !parentId} onClick={() => connect({ parentId, dateOfBirth })} className="btn-primary px-4 py-1.5 text-sm">
            Add me to the tree
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------
function Branch({
  branch,
  data,
  collapsed,
  toggle,
  onAdd,
  onEdit,
  onRemove,
}: {
  branch: TreeBranch;
  data: TreeData;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  onAdd: (parentId: string) => void;
  onEdit: (node: PublicTreeNode) => void;
  onRemove: (node: PublicTreeNode) => void;
}) {
  const node = branch.node as unknown as PublicTreeNode;
  const isMe = data.me.nodeId === node.id;
  const hasKids = branch.children.length > 0;
  const closed = collapsed.has(node.id);

  return (
    <li>
      <div className={`paper-card p-3 text-sm ${isMe ? "border-brass" : ""}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-medium">
            {node.name}
            {isMe && <span className="ml-2 rounded-full border border-brass px-2 py-0.5 text-xs font-normal text-brass">you</span>}
            {node.memberId && !isMe && <span className="ml-2 text-xs font-normal text-ink-soft">member</span>}
          </p>
          {hasKids && (
            <button type="button" onClick={() => toggle(node.id)} className="text-xs text-ink-soft underline">
              {closed ? `Show ${branch.children.length} child(ren)` : "Hide children"}
            </button>
          )}
        </div>
        {node.spouseName && <p className="text-xs text-ink-soft">Married to {node.spouseName}</p>}
        {born(node) && <p className="text-xs text-ink-soft">{born(node)}</p>}
        {node.workEducation && <p className="mt-1 text-xs">{node.workEducation}</p>}
        {node.bio && <p className="mt-1 whitespace-pre-wrap text-xs text-ink-soft">{node.bio}</p>}
        {data.isAdmin && node.phone && <p className="mt-1 text-xs text-ink-soft">Phone: {node.phone}</p>}
        <div className="mt-2 flex gap-4 text-xs">
          <button type="button" onClick={() => onAdd(node.id)} className="link">
            Add a child
          </button>
          <button type="button" onClick={() => onEdit(node)} className="link">
            Edit
          </button>
          {!node.memberId && !hasKids && (
            <button type="button" onClick={() => onRemove(node)} className="text-ink-soft underline">
              Remove
            </button>
          )}
        </div>
      </div>
      {hasKids && !closed && (
        <ul className="ml-3 mt-2 space-y-2 border-l border-line pl-4">
          {branch.children.map((child) => (
            <Branch key={child.node.id} branch={child} data={data} collapsed={collapsed} toggle={toggle} onAdd={onAdd} onEdit={onEdit} onRemove={onRemove} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function FamilyTree() {
  const [data, setData] = useState<TreeData | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [changesAdmin, setChangesAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [treeRes, historyRes] = await Promise.all([fetch("/api/tree"), fetch("/api/tree/history")]);
      const tree = await treeRes.json();
      if (!treeRes.ok) throw new Error(tree.error ?? "Could not load the family tree.");
      setData(tree);
      if (historyRes.ok) {
        const history = await historyRes.json();
        setChanges(history.changes);
        setChangesAdmin(history.isAdmin);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the family tree.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const forest = useMemo(() => (data ? buildForest(asTreeNodes(data.nodes)) : []), [data]);

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function remove(node: PublicTreeNode) {
    if (!window.confirm(`Remove ${node.name} from the tree? (An admin can bring them back.)`)) return;
    setError(null);
    const res = await fetch(`/api/tree/${node.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not remove that person.");
    }
    await load();
  }

  async function undo(change: Change) {
    if (!window.confirm(`Undo this change: ${describe(change)}?`)) return;
    setError(null);
    setNotice(null);
    const res = await fetch("/api/admin/tree/undo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ historyId: change.id }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setError(body.error ?? "Could not undo that change.");
    else setNotice(body.summary ?? "Undone.");
    await load();
  }

  if (!data) return <p className="text-ink-soft">{error ?? "Loading..."}</p>;

  if (data.needsToConnect) {
    return <ConnectToTree data={data} onDone={load} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Family tree</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Eldest first. Anyone can add people and fix details; every change is recorded and an admin can undo it. Nobody is ever deleted for good.
          </p>
        </div>
        <button type="button" onClick={() => setEditing({ mode: "add", parentId: null })} className="btn-primary px-4 py-1.5 text-sm">
          Add a person
        </button>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {notice && <p className="text-sm text-forest">{notice}</p>}

      {editing && (
        <PersonForm
          key={editing.mode === "edit" ? editing.node.id : `add-${editing.parentId ?? "root"}`}
          editing={editing}
          data={data}
          onCancel={() => setEditing(null)}
          onDone={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}

      {forest.length === 0 ? (
        <p className="paper-card p-4 text-sm text-ink-soft">The tree is empty. Add the first person.</p>
      ) : (
        <ul className="space-y-3">
          {forest.map((branch) => (
            <Branch
              key={branch.node.id}
              branch={branch}
              data={data}
              collapsed={collapsed}
              toggle={toggle}
              onAdd={(parentId) => setEditing({ mode: "add", parentId })}
              onEdit={(node) => setEditing({ mode: "edit", node })}
              onRemove={remove}
            />
          ))}
        </ul>
      )}

      <section className="paper-card overflow-hidden">
        <h2 className="border-b border-line px-4 py-2 text-sm font-medium text-ink-soft">Recent changes</h2>
        {changes.length === 0 && <p className="p-4 text-sm text-ink-soft">Nothing has changed yet.</p>}
        <div className="max-h-80 overflow-y-auto">
          {changes.map((c, i) => (
            <div key={c.id} className={`flex items-center justify-between gap-3 px-4 py-2 text-xs ${i > 0 ? "border-t border-line" : ""} ${c.undone ? "opacity-50" : ""}`}>
              <span>
                <span className="text-ink-soft">{when(c.at)}</span> &middot; {c.by} {describe(c)}
                {c.undone && <span className="ml-2 text-ink-soft">(undone)</span>}
              </span>
              {changesAdmin && !c.undone && c.action !== "restore" && (
                <button type="button" onClick={() => undo(c)} className="link shrink-0">
                  Undo
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
