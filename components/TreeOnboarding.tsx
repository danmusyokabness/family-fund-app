"use client";
// components/TreeOnboarding.tsx
//
// The first time a member opens the family tree they are asked to fill in
// their details (rules: lib/onboarding.ts).
//
//   * A member who is not in the tree yet first says who they are: take over an
//     entry someone already made for them ("That's me"), or say they are not
//     listed.
//   * Then the details form. If they already have an entry it is PRE-FILLED
//     and they complete it. Required: date of birth and a parent. Everything
//     else is optional, and each detail has a "Show to the family" tick.
//
// Saving marks the details as done, so they are asked only once.

import { useMemo, useState } from "react";
import { descendantIds, rankClaimCandidates, rankParentCandidates, type PublicTreeNode } from "@/lib/family-tree";
import { asTreeNodes, born, initials, Photo, shrinkPhoto, type TreeData } from "./tree-common";
import { dropBlankEducation, dropBlankWork, EducationEditor, ResidenceEditor, ShowToFamily, WorkEditor } from "./ProfileFields";
import { collectSuggestions, type EducationEntry, type Residence, type WorkEntry } from "@/lib/profile";

const input = "w-full rounded-md border border-line px-3 py-2 text-sm";
const NOT_LISTED = "__new__";
const TOP = "__top__";

export default function TreeOnboarding({ data, onDone }: { data: TreeData; onDone: () => void }) {
  const mine = data.me.nodeId ? data.nodes.find((n) => n.id === data.me.nodeId) ?? null : null;
  // Step 1 is only for a member with no entry. Choosing "I am not listed" moves on to the form.
  const [notListed, setNotListed] = useState(false);

  if (!mine && !notListed) return <WhoAreYou data={data} onDone={onDone} onNotListed={() => setNotListed(true)} />;
  return <DetailsForm data={data} mine={mine} onDone={onDone} />;
}

// ---------------------------------------------------------------------------
// Step 1: who are you?
// ---------------------------------------------------------------------------
function WhoAreYou({ data, onDone, onNotListed }: { data: TreeData; onDone: () => void; onNotListed: () => void }) {
  const all = useMemo(() => asTreeNodes(data.nodes), [data.nodes]);
  const claims = useMemo(() => rankClaimCandidates(all, data.me.name).slice(0, 5), [all, data.me.name]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim(nodeId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tree/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ claimNodeId: nodeId }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Could not connect you.");
      onDone(); // the tree reloads and the form appears, pre-filled with that entry
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect you.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Welcome to the family tree</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Before you look around, please find yourself in the tree and tell the family a little about you. It takes a few minutes, and you choose what everyone else can see.
        </p>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {claims.length > 0 ? (
        <div className="paper-card space-y-2 p-4">
          <h2 className="font-medium">Is one of these you?</h2>
          {claims.map((n) => (
            <div key={n.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                <Photo node={n} size={32} />
                {n.name}
                {born(n) && <span className="text-xs text-ink-soft">{born(n)}</span>}
              </span>
              <button type="button" disabled={busy} onClick={() => claim(n.id)} className="btn-secondary px-3 py-1 text-xs">
                That&apos;s me
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-soft">{data.nodes.length === 0 ? "The tree is empty, so you will be the first person in it." : "Nobody in the tree matches your name yet."}</p>
      )}
      <button type="button" disabled={busy} onClick={onNotListed} className="btn-primary px-4 py-1.5 text-sm">
        {claims.length > 0 ? "None of these is me: add me" : "Add me to the tree"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: the details form (pre-filled when the member already has an entry)
// ---------------------------------------------------------------------------
function DetailsForm({ data, mine, onDone }: { data: TreeData; mine: PublicTreeNode | null; onDone: () => void }) {
  const firstName = data.me.name.trim().split(/\s+/)[0] ?? "";
  const all = useMemo(() => asTreeNodes(data.nodes), [data.nodes]);
  const suggestions = useMemo(() => collectSuggestions(data.nodes), [data.nodes]);
  const livingParent = mine?.parentId ? data.nodes.find((n) => n.id === mine.parentId) ?? null : null;
  const treeIsEmpty = data.nodes.length === 0;
  // Nobody may be preselected as the parent: the most likely ones are listed first and the person must choose.
  // Never offered: yourself or anyone below you (that would make someone their own ancestor).
  const parents = useMemo(() => {
    const blocked = new Set(mine ? [mine.id, ...descendantIds(all, mine.id)] : []);
    return rankParentCandidates(all, data.me.name).filter((n) => !blocked.has(n.id));
  }, [all, data.me.name, mine]);
  const canBeTop = Boolean(mine) || treeIsEmpty;

  const [dateOfBirth, setDateOfBirth] = useState(mine?.dateOfBirth ?? "");
  const [phone, setPhone] = useState(mine?.phone ?? "");
  const [education, setEducation] = useState<EducationEntry[]>(mine?.education ?? []);
  const [work, setWork] = useState<WorkEntry[]>(mine?.work ?? []);
  const [residence, setResidence] = useState<Residence | null>(mine?.residence ?? null);
  const [spouseName, setSpouseName] = useState(mine?.spouseName ?? "");
  const [spouseDetails, setSpouseDetails] = useState(mine?.spouseDetails ?? "");
  const [bio, setBio] = useState(mine?.bio ?? "");
  const [hidden, setHidden] = useState<Set<string>>(new Set(mine?.hiddenFields ?? []));
  const [photo, setPhoto] = useState<string | null>(null);
  const [parentChoice, setParentChoice] = useState(canBeTop && treeIsEmpty ? TOP : "");
  const [newParentName, setNewParentName] = useState("");
  const [newParentDob, setNewParentDob] = useState("");
  const [newParentApprox, setNewParentApprox] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsParent = !livingParent;
  const parentOk = !needsParent || (parentChoice !== "" && (parentChoice !== NOT_LISTED || (newParentName.trim() !== "" && (newParentDob !== "" || newParentApprox.trim() !== ""))));
  const canSave = dateOfBirth !== "" && parentOk && !busy;

  function toggle(field: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setPhoto(await shrinkPhoto(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That picture could not be used.");
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const details: Record<string, unknown> = {
      dateOfBirth,
      phone,
      education: dropBlankEducation(education),
      work: dropBlankWork(work),
      residence,
      spouseName,
      spouseDetails,
      bio,
      hiddenFields: [...hidden],
    };
    let parent: Record<string, unknown> | undefined;
    if (needsParent) {
      if (parentChoice === TOP) parent = { top: true };
      else if (parentChoice === NOT_LISTED) parent = { newParent: { name: newParentName, dateOfBirth: newParentDob || null, birthdate: newParentApprox || null } };
      else parent = { id: parentChoice };
    }
    try {
      const res = await fetch("/api/tree/onboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ details, parent }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Could not save your details.");
      if (photo) {
        const up = await fetch(`/api/tree/${result.id}/photo`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl: photo }) });
        if (!up.ok) {
          // The details are saved; only the picture failed. Carry on: the photo can be added later from the card.
          setError(null);
        }
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your details.");
      setBusy(false);
    }
  }

  const shownPhoto = photo ?? (mine?.hasPhoto ? `/api/tree/${mine.id}/photo?v=${encodeURIComponent(mine.updatedAt)}` : null);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Welcome{firstName ? `, ${firstName}` : ""}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {mine
            ? "Your place in the family tree is ready. Please check your details and complete them. They are filled in with what the family already has."
            : "Please tell the family a little about you, so you can be added to the tree."}{" "}
          Only your <strong>date of birth</strong> and your <strong>parent</strong> are required. For everything else, you choose what the rest of the family can see.
        </p>
      </div>

      <div className="paper-card space-y-4 p-4">
        <div className="flex items-center gap-3">
          {shownPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="fphoto" style={{ width: 64, height: 64 }} src={shownPhoto} alt="" />
          ) : (
            <span className="fphoto" style={{ width: 64, height: 64, fontSize: 20 }}>
              {initials(data.me.name)}
            </span>
          )}
          <div className="text-xs text-ink-soft">
            <p className="text-sm font-medium text-ink">{data.me.name}</p>
            <label className="link cursor-pointer">
              {shownPhoto ? "Change photo" : "Add a photo (optional)"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => choosePhoto(e.target.files?.[0])} />
            </label>
          </div>
        </div>

        <div>
          <label className="block text-xs text-ink-soft">
            Date of birth (required)
            <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className={input} />
          </label>
          <ShowToFamily field="dateOfBirth" hidden={hidden} onToggle={toggle} />
        </div>

        {needsParent ? (
          <div className="space-y-2">
            <label className="block text-xs text-ink-soft">
              Whose child are you? (required; the most likely parents are listed first)
              <select value={parentChoice} onChange={(e) => setParentChoice(e.target.value)} className={input}>
                <option value="">Choose your parent...</option>
                {parents.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
                <option value={NOT_LISTED}>My parent is not listed: add them</option>
                {canBeTop && <option value={TOP}>I am at the top of the tree (my parents are not in this tree)</option>}
              </select>
            </label>
            {parentChoice === NOT_LISTED && (
              <div className="space-y-2 rounded-md border border-line p-3">
                <label className="block text-xs text-ink-soft">
                  Your parent&apos;s full name
                  <input value={newParentName} onChange={(e) => setNewParentName(e.target.value)} className={input} />
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block text-xs text-ink-soft">
                    Their date of birth
                    <input type="date" value={newParentDob} onChange={(e) => setNewParentDob(e.target.value)} className={input} />
                  </label>
                  <label className="block text-xs text-ink-soft">
                    Or approximately
                    <input value={newParentApprox} onChange={(e) => setNewParentApprox(e.target.value)} placeholder="for example: around 1950" className={input} />
                  </label>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm">
            <span className="text-xs text-ink-soft">Your parent: </span>
            {livingParent?.name}
          </p>
        )}

        <div>
          <label className="block text-xs text-ink-soft">
            Phone (optional)
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={input} />
          </label>
          <ShowToFamily field="phone" hidden={hidden} onToggle={toggle} />
        </div>
      </div>

      <div className="paper-card space-y-2 p-4">
        <h2 className="font-medium">Where you studied (optional)</h2>
        <EducationEditor value={education} onChange={setEducation} institutions={suggestions.institutions} />
        <ShowToFamily field="education" hidden={hidden} onToggle={toggle} />
      </div>

      <div className="paper-card space-y-2 p-4">
        <h2 className="font-medium">Your work (optional)</h2>
        <WorkEditor value={work} onChange={setWork} employers={suggestions.employers} titles={suggestions.titles} />
        <ShowToFamily field="work" hidden={hidden} onToggle={toggle} />
      </div>

      <div className="paper-card space-y-2 p-4">
        <h2 className="font-medium">Where you live (optional)</h2>
        <ResidenceEditor value={residence} onChange={setResidence} />
        <ShowToFamily field="residence" hidden={hidden} onToggle={toggle} />
      </div>

      <details className="paper-card p-4 text-sm" open={Boolean(spouseName || spouseDetails || bio)}>
        <summary className="cursor-pointer font-medium">Spouse and a few words about you (optional)</summary>
        <div className="mt-3 space-y-3">
          <label className="block text-xs text-ink-soft">
            Spouse&apos;s name
            <input value={spouseName} onChange={(e) => setSpouseName(e.target.value)} className={input} />
          </label>
          <label className="block text-xs text-ink-soft">
            More about your spouse
            <textarea value={spouseDetails} onChange={(e) => setSpouseDetails(e.target.value)} rows={2} className={input} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-ink-soft">
            <input
              type="checkbox"
              checked={!hidden.has("spouseName") && !hidden.has("spouseDetails")}
              onChange={() =>
                setHidden((prev) => {
                  const next = new Set(prev);
                  const hide = !next.has("spouseName") && !next.has("spouseDetails");
                  if (hide) {
                    next.add("spouseName");
                    next.add("spouseDetails");
                  } else {
                    next.delete("spouseName");
                    next.delete("spouseDetails");
                  }
                  return next;
                })
              }
            />
            Show your spouse to the family
          </label>
          <label className="block text-xs text-ink-soft">
            About you
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} className={input} />
          </label>
          <ShowToFamily field="bio" hidden={hidden} onToggle={toggle} />
        </div>
      </details>

      <p className="text-xs text-ink-soft">
        Your name and photo are always shown. A hidden detail can still be seen by you, your parent, your children and the admin. You can change anything later by opening your card in the tree.
      </p>

      {error && <p className="text-sm text-danger">{error}</p>}
      <button type="button" onClick={submit} disabled={!canSave} className="btn-primary px-5 py-2 text-sm">
        {busy ? "Saving..." : mine ? "Save and open the family tree" : "Add me and open the family tree"}
      </button>
      {!canSave && !busy && (
        <p className="text-xs text-ink-soft">
          {dateOfBirth === "" ? "Enter your date of birth. " : ""}
          {needsParent && !parentOk ? "Choose your parent (or add them). " : ""}
        </p>
      )}
    </div>
  );
}
