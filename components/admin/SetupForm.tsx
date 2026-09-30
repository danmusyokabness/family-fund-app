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

  if (loading) return <p className="text-sm text-ink-soft">Loading...</p>;

  const fields = SETTINGS_SCHEMA.filter((f) => f.key !== "setup_complete");
  const textFields = fields.filter((f) => f.type === "text");
  const shortFields = fields.filter((f) => f.type !== "text");

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h2 className="mb-3 font-serif text-lg font-semibold">Fund settings</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {shortFields.map((field) => (
            <div key={field.key}>
              <label htmlFor={field.key} className="mb-1 block text-sm font-medium text-ink">
                {field.label}
                {field.required && <span className="text-danger"> *</span>}
              </label>
              <input
                id={field.key}
                type={field.type === "integer" ? "number" : "text"}
                min={field.min}
                max={field.max}
                value={values[field.key] ?? ""}
                onChange={(e) => handleChange(field.key, e.target.value)}
                className="w-full px-3 py-2"
              />
              {field.helpText && <p className="mt-1 text-xs text-ink-soft">{field.helpText}</p>}
              {fieldErrors[field.key] && <p className="mt-1 text-xs text-danger">{fieldErrors[field.key]}</p>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-3 font-serif text-lg font-semibold">Message wording</h2>
        <div className="space-y-4">
          {textFields.map((field) => (
            <div key={field.key}>
              <label htmlFor={field.key} className="mb-1 block text-sm font-medium text-ink">{field.label}</label>
              <textarea
                id={field.key}
                value={values[field.key] ?? ""}
                onChange={(e) => handleChange(field.key, e.target.value)}
                rows={3}
                className="w-full px-3 py-2 text-sm"
              />
              {field.helpText && <p className="mt-1 text-xs text-ink-soft">{field.helpText}</p>}
              {fieldErrors[field.key] && <p className="mt-1 text-xs text-danger">{fieldErrors[field.key]}</p>}
            </div>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {saved && <p className="text-sm text-forest">Saved.</p>}

      <button type="submit" disabled={saving} className="btn-primary px-4 py-2 text-sm">
        {saving ? "Saving..." : "Save settings"}
      </button>
    </form>
  );
}
