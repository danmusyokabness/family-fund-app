"use client";
// components/admin/MembersManager.tsx

import { useEffect, useRef, useState } from "react";
import { compareMembers, isManuallyOrdered, moveWithinManualGroup, type OrderableMember } from "@/lib/member-order";

interface MemberPhone {
  id: string;
  phone_number: string;
  is_primary: boolean;
}
interface MemberAlias {
  id: string;
  alias_type: string;
  alias_value: string;
}
interface Member {
  id: string;
  full_name: string;
  joined_on: string;
  is_active: boolean;
  is_admin: boolean;
  notes: string | null;
  member_phones: MemberPhone[];
  payer_aliases: MemberAlias[];
  sort_order: number | null;
  family_nodes: { date_of_birth: string | null; deleted_at: string | null }[] | null;
}

/** The birth date from the member's linked (not deleted) family-tree node, if any. */
function knownBirthDate(member: Member): string | null {
  const node = (member.family_nodes ?? []).find((n) => n.date_of_birth && !n.deleted_at);
  return node?.date_of_birth ?? null;
}
function toOrderable(member: Member): OrderableMember {
  return { id: member.id, fullName: member.full_name, dateOfBirth: knownBirthDate(member), sortOrder: member.sort_order };
}

interface ParsedRow {
  rowNumber: number;
  fullName: string;
  primaryPhone: string | null;
  alternatePhones: string[];
  shortcodes: string[];
  maskedPhones?: string[];
  warnings: string[];
  errors: string[];
}
interface PreviewResult {
  rows: ParsedRow[];
  importableCount: number;
  skippedCount: number;
}
interface CommitResult {
  createdCount: number;
  updatedCount?: number;
  skippedCount: number;
  results: { rowNumber: number; fullName: string; status: "created" | "updated" | "skipped"; reason?: string }[];
}

function splitList(input: string): string[] {
  return input.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
}
function monthKeyFromDateString(dateStr: string): string {
  return dateStr.slice(0, 7);
}

const inputCls = "rounded-md px-2.5 py-1.5 text-sm";
const fieldLabel = "mb-1 block text-xs font-medium text-ink-soft";

export default function MembersManager() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [togglingAdminId, setTogglingAdminId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);

  // ---- Add member (collapsed by default) ----
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newJoinedOn, setNewJoinedOn] = useState("");
  const [newPrimaryPhone, setNewPrimaryPhone] = useState("");
  const [newAlternatePhones, setNewAlternatePhones] = useState("");
  const [newShortcodes, setNewShortcodes] = useState("");
  const [newMaskedPhones, setNewMaskedPhones] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // ---- Edit member ----
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editJoinedOn, setEditJoinedOn] = useState("");
  const [editPrimaryPhone, setEditPrimaryPhone] = useState("");
  const [editAlternatePhones, setEditAlternatePhones] = useState("");
  const [editShortcodes, setEditShortcodes] = useState("");
  const [editMaskedPhones, setEditMaskedPhones] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // ---- CSV import (collapsed by default) ----
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [showPasteInstead, setShowPasteInstead] = useState(false);
  const [defaultJoinedOn, setDefaultJoinedOn] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Reset test data ----
  const [confirmText, setConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState(false);

  async function loadMembers() {
    setLoadingMembers(true);
    setMembersError(null);
    try {
      const res = await fetch("/api/admin/members");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load members.");
      setMembers(data.members ?? []);
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : "Could not load members.");
    } finally {
      setLoadingMembers(false);
    }
  }

  async function toggleMemberAdmin(member: Member) {
    setTogglingAdminId(member.id);
    try {
      await fetch(`/api/admin/members/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAdmin: !member.is_admin }),
      });
      await loadMembers();
    } finally {
      setTogglingAdminId(null);
    }
  }

  async function moveMember(member: Member, direction: "up" | "down") {
    const newOrder = moveWithinManualGroup(members.map(toOrderable), member.id, direction);
    if (!newOrder) return;
    setMovingId(member.id);
    setOrderError(null);
    try {
      const res = await fetch("/api/admin/members/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: newOrder }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save the new order.");
      await loadMembers();
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : "Could not save the new order.");
    } finally {
      setMovingId(null);
    }
  }

  useEffect(() => {
    loadMembers();
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => setIsSuperAdmin(Boolean(data.isSuperAdmin)))
      .catch(() => setIsSuperAdmin(false));
  }, []);

  async function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: newName,
          joinedOn: newJoinedOn,
          primaryPhone: newPrimaryPhone,
          alternatePhones: splitList(newAlternatePhones),
          shortcodes: splitList(newShortcodes),
          maskedPhones: splitList(newMaskedPhones),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not add member.");
      setNewName("");
      setNewJoinedOn("");
      setNewPrimaryPhone("");
      setNewAlternatePhones("");
      setNewShortcodes("");
      setNewMaskedPhones("");
      setShowAddForm(false);
      await loadMembers();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Could not add member.");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(member: Member) {
    setEditingId(member.id);
    setEditName(member.full_name);
    setEditJoinedOn(monthKeyFromDateString(member.joined_on));
    const primary = member.member_phones.find((p) => p.is_primary);
    const alternates = member.member_phones.filter((p) => !p.is_primary);
    setEditPrimaryPhone(primary?.phone_number ?? "");
    setEditAlternatePhones(alternates.map((p) => p.phone_number).join(", "));
    setEditShortcodes(member.payer_aliases.filter((a) => a.alias_type === "shortcode").map((a) => a.alias_value).join(", "));
    setEditMaskedPhones(member.payer_aliases.filter((a) => a.alias_type === "masked_phone").map((a) => a.alias_value).join(", "));
    setEditError(null);
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/admin/members/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: editName,
          joinedOn: editJoinedOn,
          primaryPhone: editPrimaryPhone,
          alternatePhones: splitList(editAlternatePhones),
          shortcodes: splitList(editShortcodes),
          maskedPhones: splitList(editMaskedPhones),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save changes.");
      setEditingId(null);
      await loadMembers();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Could not save changes.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function toggleActive(member: Member) {
    await fetch(`/api/admin/members/${member.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !member.is_active }),
    });
    await loadMembers();
  }

  function handleFileChosen(file: File) {
    setCsvFileName(file.name);
    setPreview(null);
    setCommitResult(null);
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  async function handlePreview() {
    setPreviewing(true);
    setImportError(null);
    setCommitResult(null);
    try {
      const res = await fetch("/api/admin/members/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not read that CSV.");
      setPreview(data);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Could not read that CSV.");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleCommitImport() {
    if (!defaultJoinedOn) {
      setImportError("Set the joining month for this import first.");
      return;
    }
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch("/api/admin/members/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText, defaultJoinedOn, commit: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed.");
      setCommitResult(data);
      setPreview(null);
      setCsvText("");
      setCsvFileName(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadMembers();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setResetting(true);
    setResetError(null);
    setResetDone(false);
    try {
      const res = await fetch("/api/admin/reset-test-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: confirmText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not clear data.");
      setResetDone(true);
      setConfirmText("");
      await loadMembers();
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Could not clear data.");
    } finally {
      setResetting(false);
    }
  }

  // Same order the ledger uses: eldest first where the birth date is known,
  // then everyone else in the order set with the arrows below.
  const orderedMembers = [...members].sort((a, b) => compareMembers(toOrderable(a), toOrderable(b)));
  const orderables = members.map(toOrderable);

  return (
    <div className="space-y-6">
      {/* ---- Action bar ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-serif text-lg font-semibold">
          Members <span className="text-sm font-normal text-ink-soft">({members.length})</span>
        </h2>
        <button onClick={() => setShowImport((v) => !v)} className="btn-secondary px-3 py-1.5 text-sm">
          Import CSV
        </button>
        <button onClick={() => setShowAddForm((v) => !v)} className="btn-primary px-3 py-1.5 text-sm">
          {showAddForm ? "Cancel" : "+ Add member"}
        </button>
      </div>

      {/* ---- Add member (expands on click) ---- */}
      {showAddForm && (
        <form onSubmit={handleAddSubmit} className="paper-card grid gap-2 p-4 sm:grid-cols-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name" className={`${inputCls} sm:col-span-2`} required />
          <div>
            <label className={fieldLabel}>Joining month</label>
            <input type="month" value={newJoinedOn} onChange={(e) => setNewJoinedOn(e.target.value)} className={`${inputCls} w-full`} required />
          </div>
          <div>
            <label className={fieldLabel}>Primary phone</label>
            <input value={newPrimaryPhone} onChange={(e) => setNewPrimaryPhone(e.target.value)} placeholder="07..." className={`${inputCls} w-full`} required />
          </div>
          <input value={newAlternatePhones} onChange={(e) => setNewAlternatePhones(e.target.value)} placeholder="Alternate phones, comma separated" className={`${inputCls} sm:col-span-2`} />
          <input value={newShortcodes} onChange={(e) => setNewShortcodes(e.target.value)} placeholder="Till / business numbers they pay from, comma separated" className={`${inputCls} sm:col-span-2`} />
          <input value={newMaskedPhones} onChange={(e) => setNewMaskedPhones(e.target.value)} placeholder="Numbers as shown on statements, e.g. 254110***358, comma separated" className={`${inputCls} sm:col-span-2`} />
          {addError && <p className="text-xs text-danger sm:col-span-2">{addError}</p>}
          <button type="submit" disabled={adding} className="btn-primary px-4 py-1.5 text-sm sm:col-span-2 sm:w-fit">
            {adding ? "Adding..." : "Add member"}
          </button>
        </form>
      )}

      {/* ---- CSV import (expands on click) ---- */}
      {showImport && (
        <div className="paper-card space-y-3 p-4">
          <p className="text-sm text-ink-soft">
            Upload a CSV with a name column and a primary phone column. Every other column is read automatically as an
            alternate phone, a till/business number, or a number copied from a statement (like 254110***358). A cell can
            hold several, separated by commas. Members who already exist are NOT skipped: any new numbers are added to
            them, and nothing is ever removed. Nothing is saved until you confirm.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => e.target.files?.[0] && handleFileChosen(e.target.files[0])}
              className="text-sm"
            />
            {csvFileName && <span className="text-xs text-ink-soft">{csvFileName}</span>}
            <button onClick={() => setShowPasteInstead((v) => !v)} className="ml-auto text-xs link">
              {showPasteInstead ? "Hide paste option" : "Or paste CSV text"}
            </button>
          </div>
          {showPasteInstead && (
            <textarea
              value={csvText}
              onChange={(e) => {
                setCsvText(e.target.value);
                setCsvFileName(null);
                setPreview(null);
                setCommitResult(null);
              }}
              rows={5}
              className={`${inputCls} w-full font-mono text-xs`}
              placeholder="Primary Member Name,Primary Phone Number,Alternate Payment Phone"
            />
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={handlePreview} disabled={previewing || !csvText.trim()} className="btn-secondary px-3 py-1.5 text-sm">
              {previewing ? "Reading..." : "Preview"}
            </button>
            {preview && (
              <>
                <input type="month" value={defaultJoinedOn} onChange={(e) => setDefaultJoinedOn(e.target.value)} className={inputCls} aria-label="Joining month for everyone in this import" />
                <button onClick={handleCommitImport} disabled={importing || preview.importableCount === 0} className="btn-primary px-3 py-1.5 text-sm">
                  {importing ? "Importing..." : `Import ${preview.importableCount} member(s)`}
                </button>
              </>
            )}
          </div>

          {importError && <p className="text-sm text-danger">{importError}</p>}

          {preview && (
            <div className="max-h-64 overflow-y-auto rounded-md border border-line text-xs">
              <p className="border-b border-line bg-paper px-2 py-1 text-ink-soft">
                {preview.importableCount} importable, {preview.skippedCount} would be skipped
              </p>
              {preview.rows.map((row) => (
                <div key={row.rowNumber} className="border-b border-line px-2 py-1.5 last:border-0">
                  <span className={row.errors.length > 0 ? "text-danger" : "text-ink"}>
                    Row {row.rowNumber}: {row.fullName || "(no name)"}
                  </span>
                  {row.errors.map((e, i) => <p key={i} className="text-danger">&bull; {e}</p>)}
                  {row.warnings.map((w, i) => <p key={i} className="text-ochre">&bull; {w}</p>)}
                </div>
              ))}
            </div>
          )}

          {commitResult && (
            <div className="rounded-md border border-forest/30 bg-forest-soft px-3 py-2 text-sm text-forest">
              <p>
                Created {commitResult.createdCount} member(s), updated {commitResult.updatedCount ?? 0} existing member(s), skipped{" "}
                {commitResult.skippedCount}.
              </p>
              {commitResult.results.filter((r) => r.reason && r.status !== "skipped").length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {commitResult.results
                    .filter((r) => r.reason && r.status !== "skipped")
                    .map((r) => (
                      <li key={r.rowNumber}>
                        {r.fullName}: {r.reason}
                      </li>
                    ))}
                </ul>
              )}
              {commitResult.results.filter((r) => r.status === "skipped" && r.reason && r.reason !== "Already up to date.").length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs" style={{ color: "var(--ochre)" }}>
                  {commitResult.results
                    .filter((r) => r.status === "skipped" && r.reason && r.reason !== "Already up to date.")
                    .map((r) => (
                      <li key={r.rowNumber}>
                        {r.fullName}: skipped. {r.reason}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---- Member list ---- */}
      <p className="text-xs text-ink-soft">
        Members are listed eldest first once their birth date is known (it comes from the family tree). Anyone
        whose age is not known yet can be moved with the arrows; they stay in the order you set until a birth
        date is added.
      </p>
      {orderError && <p className="text-sm text-danger">{orderError}</p>}
      <div className="paper-card overflow-hidden">
        {loadingMembers && <p className="p-4 text-sm text-ink-soft">Loading...</p>}
        {membersError && <p className="p-4 text-sm text-danger">{membersError}</p>}
        {!loadingMembers && members.length === 0 && (
          <p className="p-4 text-sm text-ink-soft">No members yet — add one above or import a CSV.</p>
        )}

        {orderedMembers.map((member, i) => (
          <div key={member.id} className={`px-4 py-3 ${i > 0 ? "border-t border-line" : ""}`}>
            {editingId === member.id ? (
              <form onSubmit={handleEditSubmit} className="grid gap-2 rounded-md bg-paper p-3 sm:grid-cols-2">
                <input value={editName} onChange={(e) => setEditName(e.target.value)} className={`${inputCls} sm:col-span-2`} placeholder="Full name" />
                <input type="month" value={editJoinedOn} onChange={(e) => setEditJoinedOn(e.target.value)} className={inputCls} />
                <input value={editPrimaryPhone} onChange={(e) => setEditPrimaryPhone(e.target.value)} className={inputCls} placeholder="Primary phone" />
                <input value={editAlternatePhones} onChange={(e) => setEditAlternatePhones(e.target.value)} className={`${inputCls} sm:col-span-2`} placeholder="Alternate phones, comma separated" />
                <input value={editShortcodes} onChange={(e) => setEditShortcodes(e.target.value)} className={`${inputCls} sm:col-span-2`} placeholder="Till / business numbers they pay from, comma separated" />
                <input value={editMaskedPhones} onChange={(e) => setEditMaskedPhones(e.target.value)} className={`${inputCls} sm:col-span-2`} placeholder="Numbers as shown on statements, e.g. 254110***358, comma separated" />
                {editError && <p className="text-xs text-danger sm:col-span-2">{editError}</p>}
                <div className="flex gap-2 sm:col-span-2">
                  <button type="submit" disabled={savingEdit} className="btn-primary px-3 py-1 text-xs">
                    {savingEdit ? "Saving..." : "Save"}
                  </button>
                  <button type="button" onClick={() => setEditingId(null)} className="btn-secondary px-3 py-1 text-xs">
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className={`font-medium ${member.is_active ? "text-ink" : "text-ink-soft line-through"}`}>
                    {member.full_name}
                    {member.is_admin && (
                      <span className="ml-2 rounded bg-brass-soft px-1.5 py-0.5 align-middle text-[10px] font-normal text-brass">
                        Admin
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-ink-soft">
                    Joined {monthKeyFromDateString(member.joined_on)} &middot;{" "}
                    {member.member_phones.find((p) => p.is_primary)?.phone_number ?? "no primary phone"}
                    {member.member_phones.filter((p) => !p.is_primary).length > 0 &&
                      ` (+${member.member_phones.filter((p) => !p.is_primary).length} alt)`}
                    {knownBirthDate(member) && <> &middot; Born {knownBirthDate(member)}</>}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  {isManuallyOrdered(toOrderable(member)) ? (
                    <span className="flex items-center gap-1" title="Age not known yet: move this member up or down the list">
                      <button
                        type="button"
                        aria-label={`Move ${member.full_name} up`}
                        onClick={() => moveMember(member, "up")}
                        disabled={movingId !== null || moveWithinManualGroup(orderables, member.id, "up") === null}
                        className="btn-secondary px-2 py-0.5 disabled:opacity-30"
                      >
                        &uarr;
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${member.full_name} down`}
                        onClick={() => moveMember(member, "down")}
                        disabled={movingId !== null || moveWithinManualGroup(orderables, member.id, "down") === null}
                        className="btn-secondary px-2 py-0.5 disabled:opacity-30"
                      >
                        &darr;
                      </button>
                    </span>
                  ) : (
                    <span className="text-ink-soft" title="Placed automatically by age">auto</span>
                  )}
                  <button onClick={() => startEdit(member)} className="link">Edit</button>
                  <button onClick={() => toggleActive(member)} className="link">
                    {member.is_active ? "Deactivate" : "Reactivate"}
                  </button>
                  {isSuperAdmin && (
                    <button onClick={() => toggleMemberAdmin(member)} disabled={togglingAdminId === member.id} className="link disabled:opacity-60">
                      {togglingAdminId === member.id ? "..." : member.is_admin ? "Remove admin" : "Make admin"}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ---- Reset test data ---- */}
      <details className="paper-card p-4" style={{ borderColor: "var(--danger)" }}>
        <summary className="cursor-pointer text-sm font-medium text-danger">Clear test data</summary>
        <p className="mb-3 mt-2 text-xs text-ink-soft">
          Deletes every member, payment, and message so Setup can be tested again from empty. Settings and
          the family tree are not affected.
        </p>
        <form onSubmit={handleReset} className="flex flex-wrap items-center gap-2">
          <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE ALL TEST DATA" className={inputCls} />
          <button type="submit" disabled={resetting || confirmText !== "DELETE ALL TEST DATA"} className="rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            {resetting ? "Clearing..." : "Clear everything"}
          </button>
        </form>
        {resetError && <p className="mt-2 text-sm text-danger">{resetError}</p>}
        {resetDone && <p className="mt-2 text-sm text-forest">Cleared.</p>}
      </details>
    </div>
  );
}
