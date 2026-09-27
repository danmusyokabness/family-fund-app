"use client";
// components/admin/SetupForm.tsx

import { useEffect, useState } from "react";
import { SETTINGS_SCHEMA } from "@/lib/settings";

export default function SetupForm() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((res) => res.json())
      .then((data) => setValues(data.settings ?? {}))
      .catch(() => setError("Could not load settings."))
      .finally(() => setLoading(false));
  }, []);

  function handleChange(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});
    setSaved(false);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not save settings.");
        setFieldErrors(data.fieldErrors ?? {});
        return;
      }
      setValues(data.settings);
      setSaved(true);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading...</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-xl bg-white p-6 shadow">
      {SETTINGS_SCHEMA.filter((f) => f.key !== "setup_complete").map((field) => (
        <div key={field.key}>
          <label htmlFor={field.key} className="mb-1 block text-sm font-medium text-slate-700">
            {field.label}
            {field.required && <span className="text-red-500"> *</span>}
          </label>

          {field.type === "text" ? (
            <textarea
              id={field.key}
              value={values[field.key] ?? ""}
              onChange={(e) => handleChange(field.key, e.target.value)}
              rows={3}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
            />
          ) : field.type === "integer" ? (
            <input
              id={field.key}
              type="number"
              min={field.min}
              max={field.max}
              value={values[field.key] ?? ""}
              onChange={(e) => handleChange(field.key, e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800"
            />
          ) : (
            <input
              id={field.key}
              type="text"
              value={values[field.key] ?? ""}
              onChange={(e) => handleChange(field.key, e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800"
            />
          )}

          {field.helpText && <p className="mt-1 text-xs text-slate-400">{field.helpText}</p>}
          {fieldErrors[field.key] && <p className="mt-1 text-xs text-red-600">{fieldErrors[field.key]}</p>}
        </div>
      ))}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-green-600">Saved.</p>}

      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-slate-800 px-4 py-2 font-medium text-white disabled:opacity-60"
      >
        {saving ? "Saving..." : "Save settings"}
      </button>
    </form>
  );
}