"use client";
// components/admin/MembersManager.tsx

import { useEffect, useState } from "react";

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
}

interface ParsedRow {
  rowNumber: number;
  fullName: string;
  primaryPhone: string | null;
  alternatePhones: string[];
  shortcodes: string[];
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
  skippedCount: number;
  results: { rowNumber: number; fullName: string; status: "created" | "skipped"; reason?: string }[];
}

function splitList(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function monthKeyFromDateString(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export default function MembersManager() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [togglingAdminId, setTogglingAdminId] = useState<string | null>(null);

  // ---- Add member form ----
  const [newName, setNewName] = useState("");
  const [newJoinedOn, setNewJoinedOn] = useState("");
  const [newPrimaryPhone, setNewPrimaryPhone] = useState("");
  const [newAlternatePhones, setNewAlternatePhones] = useState("");
  const [newShortcodes, setNewShortcodes] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // ---- Edit member ----
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editJoinedOn, setEditJoinedOn] = useState("");
  const [editPrimaryPhone, setEditPrimaryPhone] = useState("");
  const [editAlternatePhones, setEditAlternatePhones] = useState("");
  const [editShortcodes, setEditShortcodes] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // ---- CSV import ----
  const [csvText, setCsvText] = useState("");
  const [defaultJoinedOn, setDefaultJoinedOn] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);

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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not add member.");
      setNewName("");
      setNewJoinedOn("");
      setNewPrimaryPhone("");
      setNewAlternatePhones("");
      setNewShortcodes("");
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
    setEditShortcodes(
      member.payer_aliases
        .filter((a) => a.alias_type === "shortcode")
        .map((a) => a.alias_value)
        .join(", ")
    );
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

  return (
    <div className="space-y-8">
      {/* ---- Member list ---- */}
      <section className="rounded-xl bg-white p-6 shadow">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">
          Members {members.length > 0 && <span className="text-sm font-normal text-slate-400">({members.length})</span>}
        </h2>

        {loadingMembers && <p className="text-sm text-slate-500">Loading...</p>}
        {membersError && <p className="text-sm text-red-600">{membersError}</p>}

        {!loadingMembers && members.length === 0 && (
          <p className="text-sm text-slate-500">No members yet — add one below or import a CSV.</p>
        )}

        <ul className="divide-y divide-slate-100">
          {members.map((member) => (
            <li key={member.id} className="py-3">
              {editingId === member.id ? (
                <form onSubmit={handleEditSubmit} className="space-y-2 rounded-md bg-slate-50 p-3">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                    placeholder="Full name"
                  />
                  <input
                    type="month"
                    value={editJoinedOn}
                    onChange={(e) => setEditJoinedOn(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                  <input
                    value={editPrimaryPhone}
                    onChange={(e) => setEditPrimaryPhone(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                    placeholder="Primary phone"
                  />
                  <input
                    value={editAlternatePhones}
                    onChange={(e) => setEditAlternatePhones(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                    placeholder="Alternate phones, comma separated"
                  />
                  <input
                    value={editShortcodes}
                    onChange={(e) => setEditShortcodes(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                    placeholder="Business/shortcode numbers, comma separated"
                  />
                  {editError && <p className="text-xs text-red-600">{editError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={savingEdit}
                      className="rounded bg-slate-800 px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
                    >
                      {savingEdit ? "Saving..." : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`font-medium ${member.is_active ? "text-slate-800" : "text-slate-400 line-through"}`}>
                      {member.full_name}
                      {member.is_admin && (
                        <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-normal text-white align-middle">
                          Admin
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      Joined {monthKeyFromDateString(member.joined_on)} &middot;{" "}
                      {member.member_phones.find((p) => p.is_primary)?.phone_number ?? "no primary phone"}
                      {member.member_phones.filter((p) => !p.is_primary).length > 0 &&
                        ` (+${member.member_phones.filter((p) => !p.is_primary).length} alt)`}
                    </p>
                  </div>
                  <div className="flex gap-3 text-xs">
                    <button onClick={() => startEdit(member)} className="text-slate-600 underline">
                      Edit
                    </button>
                    <button onClick={() => toggleActive(member)} className="text-slate-600 underline">
                      {member.is_active ? "Deactivate" : "Reactivate"}
                    </button>
                    {isSuperAdmin && (
                      <button
                        onClick={() => toggleMemberAdmin(member)}
                        disabled={togglingAdminId === member.id}
                        className="text-slate-600 underline disabled:opacity-60"
                      >
                        {togglingAdminId === member.id
                          ? "..."
                          : member.is_admin
                            ? "Remove admin"
                            : "Make admin"}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* ---- Add member ---- */}
      <section className="rounded-xl bg-white p-6 shadow">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Add a member</h2>
        <form onSubmit={handleAddSubmit} className="grid gap-2 sm:grid-cols-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Full name"
            className="rounded border border-slate-300 px-2 py-1.5 text-sm sm:col-span-2"
            required
          />
          <input
            type="month"
            value={newJoinedOn}
            onChange={(e) => setNewJoinedOn(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
            required
          />
          <input
            value={newPrimaryPhone}
            onChange={(e) => setNewPrimaryPhone(e.target.value)}
            placeholder="Primary phone (07...)"
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
            required
          />
          <input
            value={newAlternatePhones}
            onChange={(e) => setNewAlternatePhones(e.target.value)}
            placeholder="Alternate phones, comma separated"
            className="rounded border border-slate-300 px-2 py-1.5 text-sm sm:col-span-2"
          />
          <input
            value={newShortcodes}
            onChange={(e) => setNewShortcodes(e.target.value)}
            placeholder="Business/shortcode numbers, comma separated"
            className="rounded border border-slate-300 px-2 py-1.5 text-sm sm:col-span-2"
          />
          {addError && <p className="text-xs text-red-600 sm:col-span-2">{addError}</p>}
          <button
            type="submit"
            disabled={adding}
            className="rounded bg-slate-800 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60 sm:col-span-2 sm:w-fit"
          >
            {adding ? "Adding..." : "Add member"}
          </button>
        </form>
      </section>

      {/* ---- CSV import ---- */}
      <section className="rounded-xl bg-white p-6 shadow">
        <h2 className="mb-1 text-lg font-semibold text-slate-800">Bulk import from CSV</h2>
        <p className="mb-3 text-xs text-slate-500">
          Paste a CSV with a name column and a primary phone column (other columns are read as alternate
          phones or business numbers automatically). Nothing is saved until you confirm the import.
        </p>
        <textarea
          value={csvText}
          onChange={(e) => {
            setCsvText(e.target.value);
            setPreview(null);
            setCommitResult(null);
          }}
          rows={6}
          className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs"
          placeholder="Primary Member Name,Primary Phone Number,Alternate Payment Phone&#10;Jane Mwangi,0712345678,"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={handlePreview}
            disabled={previewing || !csvText.trim()}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-60"
          >
            {previewing ? "Reading..." : "Preview"}
          </button>
          {preview && (
            <>
              <input
                type="month"
                value={defaultJoinedOn}
                onChange={(e) => setDefaultJoinedOn(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                aria-label="Joining month for everyone in this import"
              />
              <button
                onClick={handleCommitImport}
                disabled={importing || preview.importableCount === 0}
                className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
              >
                {importing ? "Importing..." : `Import ${preview.importableCount} member(s)`}
              </button>
            </>
          )}
        </div>

        {importError && <p className="mt-2 text-sm text-red-600">{importError}</p>}

        {preview && (
          <div className="mt-3 max-h-64 overflow-y-auto rounded border border-slate-200 text-xs">
            <p className="border-b border-slate-200 bg-slate-50 px-2 py-1 text-slate-600">
              {preview.importableCount} importable, {preview.skippedCount} would be skipped
            </p>
            {preview.rows.map((row) => (
              <div key={row.rowNumber} className="border-b border-slate-100 px-2 py-1.5 last:border-0">
                <span className={row.errors.length > 0 ? "text-red-600" : "text-slate-700"}>
                  Row {row.rowNumber}: {row.fullName || "(no name)"}
                </span>
                {row.errors.map((e, i) => (
                  <p key={i} className="text-red-500">&bull; {e}</p>
                ))}
                {row.warnings.map((w, i) => (
                  <p key={i} className="text-amber-600">&bull; {w}</p>
                ))}
              </div>
            ))}
          </div>
        )}

        {commitResult && (
          <div className="mt-3 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            Created {commitResult.createdCount} member(s), skipped {commitResult.skippedCount}.
          </div>
        )}
      </section>

      {/* ---- Reset test data ---- */}
      <section className="rounded-xl border border-red-200 bg-white p-6 shadow">
        <h2 className="mb-1 text-lg font-semibold text-red-700">Clear test data</h2>
        <p className="mb-3 text-xs text-slate-500">
          Deletes every member, payment, and message so Setup can be tested again from empty. Settings and
          the family tree are not affected. Type the phrase below to confirm.
        </p>
        <form onSubmit={handleReset} className="flex flex-wrap items-center gap-2">
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE ALL TEST DATA"
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={resetting || confirmText !== "DELETE ALL TEST DATA"}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {resetting ? "Clearing..." : "Clear everything"}
          </button>
        </form>
        {resetError && <p className="mt-2 text-sm text-red-600">{resetError}</p>}
        {resetDone && <p className="mt-2 text-sm text-green-600">Cleared.</p>}
      </section>
    </div>
  );
}