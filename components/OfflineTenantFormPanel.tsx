"use client";
// Sprint 20: staff-facing panel for the offline / email tenant form workflow.
//
//   • Download a self-contained fillable .html to EMAIL to the tenant.
//   • Import the .html the tenant filled out + sent back, preview the parsed
//     answers, then commit them into the case (same store the localhost form
//     writes to). Drawn signatures route to the signature-overlay table.
//
// This panel only renders for signed-in staff (the page is auth-gated). The
// tenant never touches this page — they use the downloaded file offline.

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import {
  buildTenantOfflineHtml,
  parseOfflineFormPayload,
  commitImportedAnswers,
  type ParsedOfflineForm,
  type ImportResult,
} from "@/lib/services/recertOfflineForm";
import { buildTenantFormSchema, type CompletionFormField } from "@/lib/services/recertCompletionForms";

type LabelMap = Map<string, CompletionFormField>;

export function OfflineTenantFormPanel({ caseId }: { caseId: string }) {
  const { profile, authUser } = useAuth();
  const actorName = profile?.full_name ?? authUser?.email ?? "Staff";

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadedName, setDownloadedName] = useState<string | null>(null);

  // Import state
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedOfflineForm | null>(null);
  const [labels, setLabels] = useState<LabelMap>(new Map());
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  // ── Download the fillable form ─────────────────────────────────────────────
  const handleDownload = useCallback(async () => {
    setBusy(true); setError(null); setDownloadedName(null);
    try {
      const built = await buildTenantOfflineHtml(caseId);
      if (!built) { setError("Could not build the form — case not found or no access."); return; }
      const blob = new Blob([built.html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = built.filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      setDownloadedName(built.filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [caseId]);

  // ── Read + parse a returned file (no commit yet) ───────────────────────────
  const handleFile = useCallback(async (file: File | null) => {
    setError(null); setResult(null); setParsed(null); setFileName(null);
    if (!file) return;
    setFileName(file.name);
    try {
      const text = await file.text();
      const p = parseOfflineFormPayload(text);
      setParsed(p);
      // Fetch the live schema purely for human-readable labels in the preview.
      const schema = await buildTenantFormSchema(caseId);
      const map: LabelMap = new Map();
      if (schema) for (const s of schema.sections) for (const f of s.fields) map.set(f.pdfFieldName, f);
      setLabels(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [caseId]);

  // ── Commit parsed answers into the case ────────────────────────────────────
  const handleImport = useCallback(async () => {
    if (!parsed) return;
    setImporting(true); setError(null); setResult(null);
    try {
      const res = await commitImportedAnswers({ caseId, parsed, actorName });
      if (!res.ok) { setError(res.error ?? "Import failed."); return; }
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }, [caseId, parsed, actorName]);

  // Build a preview list: each answered field with a friendly label + value,
  // flagging orphaned follow-ups (skipped at commit) and signatures.
  const preview = useMemo(() => {
    if (!parsed) return null;
    const answerValue = (name: string) => parsed.answers[name]?.value ?? "";
    const rows: { name: string; label: string; display: string; orphan: boolean; unknown: boolean }[] = [];
    let signature = false;
    for (const name of Object.keys(parsed.answers)) {
      const a = parsed.answers[name];
      const def = labels.get(name);
      let orphan = false;
      if (def?.parentFieldName && def.parentTriggerValue) {
        orphan = answerValue(def.parentFieldName) !== def.parentTriggerValue;
      }
      let display: string;
      if (a.isSignature || def?.fieldType === "signature") {
        const drawn = a.value.startsWith("data:image/");
        if (drawn) signature = true;
        display = drawn ? "✍️ Drawn signature captured" : "(no signature drawn)";
      } else if (def?.fieldType === "yesno") {
        display = a.value === "yes" ? "Yes" : a.value === "no" ? "No" : a.value;
      } else {
        display = a.value.length > 80 ? a.value.slice(0, 80) + "…" : a.value;
      }
      rows.push({
        name,
        label: def?.label ?? name,
        display,
        orphan,
        unknown: !def,
      });
    }
    return { rows, signature, count: rows.filter(r => !r.orphan && !r.unknown).length };
  }, [parsed, labels]);

  return (
    <div className="rounded-xl border-2 border-sky-200 bg-sky-50/60 p-4 mb-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-sm font-bold text-sky-900">Offline / email workflow (staff)</h2>
        <span className="text-[11px] text-sky-700 font-mono">case {caseId}</span>
      </div>
      <p className="text-xs text-slate-600 mt-1 mb-3">
        Email a self-contained form the tenant fills out on any device with no internet, then import the
        file they send back. Nothing is sent automatically — you email the file and import the reply yourself.
      </p>

      {error && (
        <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</div>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        {/* ── Download ── */}
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <h3 className="text-xs font-semibold text-slate-800 mb-1">1 · Send to tenant</h3>
          <p className="text-[11px] text-slate-500 mb-2">
            Downloads one <code>.html</code> file. Attach it to an email to the tenant.
          </p>
          <button
            onClick={handleDownload}
            disabled={busy}
            className="px-3 py-2 rounded bg-slate-900 text-white text-sm disabled:bg-slate-400"
          >
            {busy ? "Building…" : "Download fillable form ↓"}
          </button>
          {downloadedName && (
            <p className="text-[11px] text-emerald-700 mt-2">
              ✓ Downloaded <code className="break-all">{downloadedName}</code> — attach it to your email to the tenant.
            </p>
          )}
        </div>

        {/* ── Import ── */}
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <h3 className="text-xs font-semibold text-slate-800 mb-1">2 · Import returned form</h3>
          <p className="text-[11px] text-slate-500 mb-2">
            Upload the <code>.html</code> the tenant emailed back. You will preview before saving.
          </p>
          <input
            type="file"
            accept=".html,text/html"
            onChange={e => handleFile(e.target.files?.[0] ?? null)}
            className="block w-full text-xs text-slate-700 file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-sky-700 file:text-white file:text-xs"
          />
          {fileName && !parsed && !error && (
            <p className="text-[11px] text-slate-500 mt-2">Reading {fileName}…</p>
          )}
        </div>
      </div>

      {/* ── Preview + commit ── */}
      {parsed && preview && !result && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <h3 className="text-xs font-semibold text-amber-900">
              Preview — {preview.count} answer{preview.count === 1 ? "" : "s"} ready to import
              {preview.signature && <span className="ml-2 text-emerald-700">· signature ✍️</span>}
              {!parsed.complete && <span className="ml-2 text-amber-700">· tenant marked DRAFT</span>}
            </h3>
            <span className="text-[11px] text-amber-700 font-mono">from {fileName}</span>
          </div>
          <div className="max-h-64 overflow-auto mt-2 rounded border border-amber-200 bg-white">
            <table className="w-full text-xs">
              <tbody>
                {preview.rows.map(r => (
                  <tr key={r.name} className={`border-b border-slate-100 last:border-b-0 ${r.orphan || r.unknown ? "opacity-50" : ""}`}>
                    <td className="px-2 py-1.5 text-slate-700 align-top w-1/2">
                      {r.label}
                      {r.orphan && <span className="ml-1 text-[10px] text-rose-600">(skipped — parent changed)</span>}
                      {r.unknown && <span className="ml-1 text-[10px] text-rose-600">(unknown field — ignored)</span>}
                    </td>
                    <td className="px-2 py-1.5 text-slate-900 font-medium align-top break-words">{r.display}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex gap-2 items-center">
            <button
              onClick={handleImport}
              disabled={importing || preview.count === 0}
              className="px-4 py-2 rounded bg-emerald-700 text-white text-sm disabled:bg-slate-300"
            >
              {importing ? "Importing…" : `Import ${preview.count} answer${preview.count === 1 ? "" : "s"} into this case`}
            </button>
            <button
              onClick={() => { setParsed(null); setFileName(null); }}
              className="px-3 py-2 rounded border border-slate-300 bg-white text-sm text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Result ── */}
      {result && (
        <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          <strong>✓ Imported.</strong>{" "}
          {result.written} field{result.written === 1 ? "" : "s"} written
          {result.signatures > 0 && ` · ${result.signatures} signature${result.signatures === 1 ? "" : "s"} captured`}
          {result.skippedOrphans > 0 && ` · ${result.skippedOrphans} orphaned skipped`}
          {result.skippedUnknown > 0 && ` · ${result.skippedUnknown} unknown ignored`}
          {result.clearedOrphans > 0 && ` · ${result.clearedOrphans} stale cleared`}.
          <div className="mt-2 text-xs">
            Next: generate the final packet on the{" "}
            <Link href={`/recertification/${caseId}/exact-form-preview`} className="underline font-semibold">
              exact-form preview
            </Link>{" "}
            to merge these answers into the LAHD PDF.
          </div>
        </div>
      )}
    </div>
  );
}
