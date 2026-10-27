"use client";
// components/FamilyTree.tsx
//
// The family tree, drawn as a real tree: small cards with a photo and a
// name, joined by lines from parent to child, brothers and sisters side by
// side on one line with their own children below them. Click a card to see
// the details.
//
// Who may change what: a member may edit their own entry, their parent's and
// their children's; an admin may edit everyone. Each person (or whoever
// fills in their details) chooses which details the rest of the family can
// see. A member who has no place in the tree yet must first say where they
// are (decision D20).

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
  editableIds: string[];
  addChildIds: string[];
  canAddParent: boolean;
  needsToConnect: boolean;
}

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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** The nodes as the pure tree functions expect them. */
function asTreeNodes(nodes: PublicTreeNode[]): TreeNode[] {
  return nodes.map((n) => ({ ...n, deletedAt: null }));
}

/** Shrinks a chosen picture to a small square JPEG in the browser, so only a few kilobytes are stored. */
async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That picture could not be opened."));
      el.src = url;
    });
    const size = 200;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser cannot prepare pictures.");
    const side = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function Photo({ node, size = 46 }: { node: PublicTreeNode; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size / 3) };
  if (node.hasPhoto) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="fphoto" style={style} src={`/api/tree/${node.id}/photo?v=${encodeURIComponent(node.updatedAt)}`} alt="" />;
  }
  return (
    <span className="fphoto" style={style} aria-hidden>
      {initials(node.name)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Add / edit form
// ---------------------------------------------------------------------------
type Editing =
  | { mode: "add"; parentId: string; label: string }
  | { mode: "addParent" }
  | { mode: "edit"; node: PublicTreeNode };

function PersonForm({ editing, data, onDone, onCancel }: { editing: Editing; data: TreeData; onDone: () => void; onCancel: () => void }) {
  const existing = editing.mode === "edit" ? editing.node : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [spouseName, setSpouseName] = useState(existing?.spouseName ?? "");
  const [spouseDetails, setSpouseDetails] = useState(existing?.spouseDetails ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(existing?.dateOfBirth ?? "");
  const [birthdate, setBirthdate] = useState(existing?.birthdate ?? "");
  const [workEducation, setWorkEducation] = useState(existing?.workEducation ?? "");
  const [bio, setBio] = useState(existing?.bio ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [hidden, setHidden] = useState<Set<string>>(new Set(existing?.hiddenFields ?? []));
  const [parentId, setParentId] = useState(existing?.parentId ?? "");
  const [photo, setPhoto] = useState<string | null>(null); // a newly chosen photo, ready to upload
  const [removePhoto, setRemovePhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parentOptions = useMemo(() => {
    const all = asTreeNodes(data.nodes);
    const blocked = new Set(existing ? [existing.id, ...descendantIds(all, existing.id)] : []);
    return data.nodes.filter((n) => !blocked.has(n.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [data.nodes, existing]);

  function toggleVisible(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setPhoto(await shrinkPhoto(file));
      setRemovePhoto(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That picture could not be used.");
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      name,
      spouseName,
      spouseDetails,
      dateOfBirth,
      birthdate,
      workEducation,
      bio,
      phone,
      hiddenFields: [...hidden],
    };
    try {
      let personId: string;
      if (editing.mode === "edit") {
        if (data.isAdmin) body.parentId = parentId || null;
        const res = await fetch(`/api/tree/${editing.node.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error ?? "Could not save.");
        personId = editing.node.id;
      } else if (editing.mode === "addParent") {
        const res = await fetch("/api/tree/parent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error ?? "Could not save.");
        personId = result.id;
      } else {
        body.parentId = editing.parentId;
        const res = await fetch("/api/tree", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error ?? "Could not save.");
        personId = result.id;
      }

      if (photo) {
        const res = await fetch(`/api/tree/${personId}/photo`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl: photo }) });
        if (!res.ok) {
          const result = await res.json().catch(() => ({}));
          throw new Error(`Saved, but the photo could not be: ${result.error ?? "try a smaller picture."}`);
        }
      } else if (removePhoto && existing?.hasPhoto) {
        await fetch(`/api/tree/${personId}/photo`, { method: "DELETE" });
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-md border border-line px-3 py-2 text-sm";
  const title =
    editing.mode === "edit" ? `Edit ${existing?.name}` : editing.mode === "addParent" ? "Add your parent" : editing.label;
  const shownPhoto = photo ?? (removePhoto ? null : existing?.hasPhoto ? `/api/tree/${existing.id}/photo?v=${encodeURIComponent(existing.updatedAt)}` : null);
  const visibleBox = (key: string) => (
    <label className="mt-1 flex items-center gap-1.5 text-xs text-ink-soft">
      <input type="checkbox" checked={!hidden.has(key)} onChange={() => toggleVisible(key)} />
      Show to the family
    </label>
  );

  return (
    <div className="space-y-3">
      <h3 className="font-serif text-lg font-semibold">{title}</h3>

      <div className="flex items-center gap-3">
        {shownPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="fphoto" style={{ width: 64, height: 64 }} src={shownPhoto} alt="" />
        ) : (
          <span className="fphoto" style={{ width: 64, height: 64, fontSize: 20 }}>
            {initials(name || "?")}
          </span>
        )}
        <div className="space-y-1 text-xs text-ink-soft">
          <label className="link cursor-pointer">
            {shownPhoto ? "Change photo" : "Add a photo"}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => choosePhoto(e.target.files?.[0])} />
          </label>
          {shownPhoto && (
            <button
              type="button"
              className="block underline"
              onClick={() => {
                setPhoto(null);
                setRemovePhoto(true);
              }}
            >
              Remove photo
            </button>
          )}
        </div>
      </div>

      <label className="block text-xs text-ink-soft">
        Full name
        <input value={name} onChange={(e) => setName(e.target.value)} className={input} />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs text-ink-soft">
            Date of birth
            <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className={input} />
          </label>
          {visibleBox("dateOfBirth")}
        </div>
        <label className="block text-xs text-ink-soft">
          Or an approximate date
          <input value={birthdate} onChange={(e) => setBirthdate(e.target.value)} placeholder="for example: around 1950" className={input} />
        </label>
      </div>

      <div>
        <label className="block text-xs text-ink-soft">
          Work or education
          <input value={workEducation} onChange={(e) => setWorkEducation(e.target.value)} className={input} />
        </label>
        {visibleBox("workEducation")}
      </div>

      <div>
        <label className="block text-xs text-ink-soft">
          About
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} className={input} />
        </label>
        {visibleBox("bio")}
      </div>

      <div>
        <label className="block text-xs text-ink-soft">
          Phone
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={input} />
        </label>
        {visibleBox("phone")}
      </div>

      <details className="rounded-md border border-line px-3 py-2 text-xs text-ink-soft">
        <summary className="cursor-pointer">Spouse (optional)</summary>
        <div className="mt-2 space-y-2">
          <label className="block">
            Spouse&apos;s name
            <input value={spouseName} onChange={(e) => setSpouseName(e.target.value)} className={input} />
          </label>
          <label className="block">
            More about the spouse
            <textarea value={spouseDetails} onChange={(e) => setSpouseDetails(e.target.value)} rows={2} className={input} />
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={!hidden.has("spouseName") && !hidden.has("spouseDetails")}
              onChange={() =>
                setHidden((prev) => {
                  const next = new Set(prev);
                  const show = next.has("spouseName") || next.has("spouseDetails");
                  if (show) {
                    next.delete("spouseName");
                    next.delete("spouseDetails");
                  } else {
                    next.add("spouseName");
                    next.add("spouseDetails");
                  }
                  return next;
                })
              }
            />
            Show the spouse to the family
          </label>
        </div>
      </details>

      {data.isAdmin && editing.mode === "edit" && (
        <label className="block text-xs text-ink-soft">
          Child of (admin only: moves this person)
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={input}>
            <option value="">(nobody: top of the tree)</option>
            {parentOptions.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <p className="text-xs text-ink-soft">
        Name and photo are always shown. The other details are shown to the family unless you untick &quot;Show to the family&quot;. A hidden detail can still be seen by the
        person, their parent, their children and the admin.
      </p>

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
          Before you look around, please find your place in the family tree, so everyone is connected. This only takes a moment, and you can change your details afterwards.
        </p>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {claims.length > 0 && (
        <div className="paper-card space-y-2 p-4">
          <h2 className="font-medium">Is one of these you?</h2>
          {claims.map((n) => (
            <div key={n.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                <Photo node={n} size={32} />
                {n.name}
                {born(n) && <span className="text-xs text-ink-soft">{born(n)}</span>}
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
  select,
}: {
  branch: TreeBranch;
  data: TreeData;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  select: (node: PublicTreeNode) => void;
}) {
  const node = branch.node as unknown as PublicTreeNode;
  const isMe = data.me.nodeId === node.id;
  const hasKids = branch.children.length > 0;
  const closed = collapsed.has(node.id);

  return (
    <li>
      <div className="fwrap">
        <button type="button" className={`fcard ${isMe ? "me" : ""}`} onClick={() => select(node)} title={node.name}>
          <Photo node={node} />
          <span className="fcard-name">{node.name}</span>
          {node.spouseName && <span className="fcard-sub">&amp; {node.spouseName}</span>}
        </button>
        {hasKids && (
          <button type="button" className="ftoggle" onClick={() => toggle(node.id)} aria-label={closed ? "Show children" : "Hide children"}>
            {closed ? `+${branch.children.length}` : "−"}
          </button>
        )}
      </div>
      {hasKids && !closed && (
        <ul>
          {branch.children.map((child) => (
            <Branch key={child.node.id} branch={child} data={data} collapsed={collapsed} toggle={toggle} select={select} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function FamilyTree() {
  const [data, setData] = useState<TreeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PublicTreeNode | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tree");
      const tree = await res.json();
      if (!res.ok) throw new Error(tree.error ?? "Could not load the family tree.");
      setData(tree);
      // Keep an open card up to date after a change.
      setSelected((current) => (current ? (tree.nodes as PublicTreeNode[]).find((n) => n.id === current.id) ?? null : null));
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
    } else {
      setSelected(null);
    }
    await load();
  }

  if (!data) return <p className="text-ink-soft">{error ?? "Loading..."}</p>;

  if (data.needsToConnect) {
    return <ConnectToTree data={data} onDone={load} />;
  }

  const editable = new Set(data.editableIds);
  const canAddChild = new Set(data.addChildIds);
  const closeAll = () => {
    setSelected(null);
    setEditing(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Family tree</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Eldest first. Tap a person to see more. You can edit your own entry, your parent&apos;s and your children&apos;s; everyone chooses what the family can see.
        </p>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {forest.length === 0 ? (
        <p className="paper-card p-4 text-sm text-ink-soft">The tree is empty.</p>
      ) : (
        <div className="paper-card overflow-x-auto">
          <div className="ftree">
            <ul>
              {forest.map((branch) => (
                <Branch key={branch.node.id} branch={branch} data={data} collapsed={collapsed} toggle={toggle} select={setSelected} />
              ))}
            </ul>
          </div>
        </div>
      )}

      {data.isAdmin && (
        <p className="text-xs text-ink-soft">As an admin you can edit everyone, move people to a different parent, and add anywhere.</p>
      )}

      {/* ---- Details / edit panel ---- */}
      {(selected || editing) && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={closeAll}>
          <div className="paper-card max-h-[90vh] w-full max-w-md overflow-y-auto rounded-b-none p-5 sm:rounded-b-xl" onClick={(e) => e.stopPropagation()}>
            {editing ? (
              <PersonForm
                key={editing.mode === "edit" ? editing.node.id : editing.mode === "add" ? `add-${editing.parentId}` : "add-parent"}
                editing={editing}
                data={data}
                onCancel={() => setEditing(null)}
                onDone={async () => {
                  setEditing(null);
                  await load();
                }}
              />
            ) : (
              selected && (
                <div className="space-y-3 text-sm">
                  <div className="flex items-center gap-3">
                    <Photo node={selected} size={72} />
                    <div>
                      <p className="font-serif text-xl font-semibold">{selected.name}</p>
                      {data.me.nodeId === selected.id && <p className="text-xs text-brass">This is you</p>}
                      {selected.memberId && data.me.nodeId !== selected.id && <p className="text-xs text-ink-soft">Member of the fund</p>}
                    </div>
                  </div>

                  {born(selected) && <p>{born(selected)}</p>}
                  {selected.workEducation && <p>{selected.workEducation}</p>}
                  {selected.bio && <p className="whitespace-pre-wrap text-ink-soft">{selected.bio}</p>}
                  {selected.phone && (
                    <p>
                      Phone: <a className="link" href={`tel:${selected.phone}`}>{selected.phone}</a>
                    </p>
                  )}
                  {selected.spouseName && (
                    <p className="text-xs text-ink-soft">
                      Spouse: {selected.spouseName}
                      {selected.spouseDetails && <span className="block whitespace-pre-wrap">{selected.spouseDetails}</span>}
                    </p>
                  )}
                  {editable.has(selected.id) && selected.hiddenFields.length > 0 && (
                    <p className="text-xs text-ink-soft">Hidden from the rest of the family: {selected.hiddenFields.join(", ")}.</p>
                  )}

                  <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                    {editable.has(selected.id) && (
                      <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => setEditing({ mode: "edit", node: selected })}>
                        Edit
                      </button>
                    )}
                    {canAddChild.has(selected.id) && (
                      <button
                        type="button"
                        className="btn-secondary px-3 py-1 text-xs"
                        onClick={() =>
                          setEditing({
                            mode: "add",
                            parentId: selected.id,
                            label: data.me.nodeId === selected.id ? "Add your child" : data.isAdmin ? `Add a child of ${selected.name}` : "Add your brother or sister",
                          })
                        }
                      >
                        {data.me.nodeId === selected.id ? "Add your child" : data.isAdmin ? "Add a child" : "Add a brother or sister"}
                      </button>
                    )}
                    {data.me.nodeId === selected.id && data.canAddParent && (
                      <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => setEditing({ mode: "addParent" })}>
                        Add your parent
                      </button>
                    )}
                    {editable.has(selected.id) && !selected.memberId && !data.nodes.some((n) => n.parentId === selected.id) && (
                      <button type="button" className="px-3 py-1 text-xs text-ink-soft underline" onClick={() => remove(selected)}>
                        Remove
                      </button>
                    )}
                    <button type="button" className="ml-auto px-3 py-1 text-xs text-ink-soft underline" onClick={closeAll}>
                      Close
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
