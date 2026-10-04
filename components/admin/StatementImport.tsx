"use client";
// components/admin/StatementImport.tsx

import { useRef, useState } from "react";

interface PreviewRow {
  receiptNo: string;
  completionTime: string;
  kind: "payment" | "charge" | "other";
  amount: number;
  payerName: string | null;
  payerPhoneMasked: string | null;
  payerRef: string | null;
  isDuplicate: boolean;
}
interface PreviewResult {
  source: "csv" | "pdf";
  integrityOk: boolean;
  reportedClosingBalance: number | null;
  calculatedClosingBalance: number;
  totalPaidIn: number;
  totalWithdrawn: number;
  skippedCount: number;
  brokenReceipts: string[];
  newCount: number;
  duplicateCount: number;
  rows: PreviewRow[];
  lines?: string[];
}

const inputCls = "rounded-md px-2.5 py-1.5 text-sm";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function StatementImport() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skippedDuplicates: number } | null>(null);
  const [showLines, setShowLines] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isPdf = file?.name.toLowerCase().endsWith(".pdf");
  const isCsv = file?.name.toLowerCase().endsWith(".csv");

  async function buildPayload(commit: boolean) {
    if (!file) throw new Error("Choose a file first.");
    if (isPdf) {
      const pdfBase64 = await fileToBase64(file);
      return { pdfBase64, password: password || undefined, filename: file.name, commit };
    }
    const text = await file.text();
    return { csv: text, filename: file.name, commit };
  }

  async function handlePreview() {
    setPreviewing(true);
    setError(null);
    setResult(null);
    try {
      const payload = await buildPayload(false);
      const res = await fetch("/api/admin/statements/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not read that file.");
      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleImport() {
    setImporting(true);
    setError(null);
    try {
      const payload = await buildPayload(true);
      const res = await fetch("/api/admin/statements/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed.");
      setResult(data);
      setPreview(null);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  function money(n: number): string {
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-lg font-semibold">Import a statement</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Upload a CSV or PDF M-PESA statement. Nothing is saved until you review the preview below and
          click Import. A PDF needs its password — that password is used once for this upload and never
          stored.
        </p>
      </div>

      <div className="paper-card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv,.pdf,application/pdf"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setResult(null);
              setError(null);
            }}
            className="text-sm"
          />
          {isPdf && (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="PDF password"
              className={inputCls}
            />
          )}
        </div>
        {file && !isPdf && !isCsv && <p className="text-xs text-danger">Choose a .csv or .pdf file.</p>}

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={handlePreview} disabled={previewing || !file} className="btn-secondary px-3 py-1.5 text-sm">
            {previewing ? "Reading..." : "Preview"}
          </button>
          {preview && (
            <button
              onClick={handleImport}
              disabled={importing || !preview.integrityOk || preview.newCount === 0}
              className="btn-primary px-3 py-1.5 text-sm"
            >
              {importing ? "Importing..." : `Import ${preview.newCount} new row(s)`}
            </button>
          )}
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
        {result && (
          <div className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "var(--forest)", background: "var(--forest-soft)", color: "var(--forest)" }}>
            Imported {result.created} row(s). {result.skippedDuplicates} already on file, skipped.
          </div>
        )}
      </div>

      {preview && (
        <div className="paper-card overflow-hidden">
          <div
            className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3"
            style={{ background: preview.integrityOk ? "var(--forest-soft)" : "var(--ochre-soft)" }}
          >
            <p className="text-sm font-medium" style={{ color: preview.integrityOk ? "var(--forest)" : "var(--ochre)" }}>
              {preview.integrityOk ? "Balance reconciles — safe to import." : "Balance did NOT reconcile — import is blocked."}
            </p>
            <p className="figures text-xs text-ink-soft">
              Reported: KES {preview.reportedClosingBalance !== null ? money(preview.reportedClosingBalance) : "?"} &middot;
              Calculated: KES {money(preview.calculatedClosingBalance)}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 border-b border-line p-4 text-sm sm:grid-cols-4">
            <div><p className="text-xs text-ink-soft">Paid in</p><p className="figures font-medium">KES {money(preview.totalPaidIn)}</p></div>
            <div><p className="text-xs text-ink-soft">Withdrawn</p><p className="figures font-medium">KES {money(preview.totalWithdrawn)}</p></div>
            <div><p className="text-xs text-ink-soft">New rows</p><p className="font-medium">{preview.newCount}</p></div>
            <div><p className="text-xs text-ink-soft">Already on file</p><p className="font-medium">{preview.duplicateCount}</p></div>
          </div>

          {!preview.integrityOk && preview.brokenReceipts.length > 0 && (
            <p className="border-b border-line px-4 py-2 text-xs text-danger">
              Did not reconcile at receipt(s): {preview.brokenReceipts.join(", ")}
            </p>
          )}

          <div className="max-h-80 overflow-y-auto text-xs">
            {preview.rows.map((row, i) => (
              <div key={i} className={`flex items-center justify-between px-4 py-1.5 ${i > 0 ? "border-t border-line" : ""} ${row.isDuplicate ? "opacity-50" : ""}`}>
                <span>
                  {row.completionTime} &middot; {row.kind} &middot; KES {money(row.amount)}
                  {row.payerName && <> &middot; {row.payerName}</>}
                  {row.payerPhoneMasked && <> ({row.payerPhoneMasked})</>}
                </span>
                {row.isDuplicate && <span className="text-ink-soft">already on file</span>}
              </div>
            ))}
          </div>

          {preview.lines && (
            <div className="border-t border-line p-4">
              <button onClick={() => setShowLines((v) => !v)} className="text-xs link">
                {showLines ? "Hide" : "Show"} raw text read from the PDF ({preview.lines.length} lines)
              </button>
              {showLines && (
                <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-paper p-2 text-[11px] text-ink-soft">
                  {preview.lines.join("\n")}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
