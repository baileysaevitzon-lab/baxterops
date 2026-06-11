// Sprint 35: Staff-facing supporting-document workflow for a recertification case.
// Required items + uploads + review + missing/blocking — all Supabase-backed.
"use client";

import { useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { getSupabase } from "@/lib/supabase/client";
import type { RecertRequiredItem, RecertDocument, RecertHouseholdMember } from "@/lib/types";
import { updateDocumentStatus } from "@/lib/services/recertification";
import {
  DOC_TYPE_CATALOG, STANDARD_TEMPLATE_SETS, catalogEntry,
  addRequiredItem, addStandardSet, deleteRequiredItem, setRequirementLevel,
  uploadSupportingDoc, signedUrlForDoc, uploadSupportLevel, computeDocsReadiness,
  isRequiredItemSatisfied,
} from "@/lib/services/recertSupportingDocs";

type Setter<T> = (updater: T | ((prev: T) => T)) => void;

interface Props {
  caseId: string;
  documents: RecertDocument[];
  requiredItems: RecertRequiredItem[];
  members: RecertHouseholdMember[];
  setDocuments: Setter<RecertDocument[]>;
  setRequiredItems: Setter<RecertRequiredItem[]>;
}

const LEVEL_BADGE: Record<string, string> = {
  required: "bg-red-50 text-red-700 border-red-200",
  optional: "bg-slate-50 text-slate-600 border-slate-200",
  waived: "bg-amber-50 text-amber-700 border-amber-200",
  not_applicable: "bg-gray-100 text-gray-500 border-gray-200",
};
const DOC_STATUS_BADGE: Record<string, string> = {
  accepted: "bg-green-50 text-green-700 border-green-200",
  needs_clarification: "bg-orange-50 text-orange-700 border-orange-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  pending: "bg-gray-50 text-gray-600 border-gray-200",
  received: "bg-gray-50 text-gray-600 border-gray-200",
  reviewed: "bg-indigo-50 text-indigo-700 border-indigo-200",
};

export function RecertDocumentsManager({ caseId, documents, requiredItems, members, setDocuments, setRequiredItems }: Props) {
  const { profile, authUser } = useAuth();
  const actor = profile?.full_name ?? authUser?.email ?? "staff";

  const [showAdd, setShowAdd] = useState(false);
  const [typeKey, setTypeKey] = useState(DOC_TYPE_CATALOG[0].key);
  const [customLabel, setCustomLabel] = useState("");
  const [level, setLevel] = useState<NonNullable<RecertRequiredItem["requirementLevel"]>>("required");
  const [dueDate, setDueDate] = useState("");
  const [instructions, setInstructions] = useState("");
  const [memberId, setMemberId] = useState("");
  const [addErr, setAddErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tmpl, setTmpl] = useState(STANDARD_TEMPLATE_SETS[0].key);
  const [banner, setBanner] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  // Combined-bundle state
  const [bundleBusy, setBundleBusy] = useState(false);
  const [bundleErr, setBundleErr] = useState<string | null>(null);
  const [bundleUrl, setBundleUrl] = useState<string | null>(null);
  const [bundleResult, setBundleResult] = useState<{ pages: number; included: number; omitted: number; unsupported: number; notAccepted: number } | null>(null);

  const readiness = useMemo(() => computeDocsReadiness(requiredItems, documents), [requiredItems, documents]);
  const docsByItem = useMemo(() => {
    const m: Record<string, RecertDocument[]> = {};
    for (const d of documents) { const k = d.requiredItemId ?? "_unlinked"; (m[k] ??= []).push(d); }
    return m;
  }, [documents]);

  const isCustom = typeKey === "other";
  const resolvedLabel = isCustom ? customLabel.trim() : (catalogEntry(typeKey)?.label ?? "");

  async function handleAdd() {
    setBusy(true); setAddErr(null);
    try {
      const res = await addRequiredItem({
        caseId, requirementKey: typeKey, requirementLabel: resolvedLabel,
        requirementLevel: level, dueDate: dueDate || undefined,
        instructions: instructions || undefined, householdMemberId: memberId || undefined, createdBy: actor,
      }, requiredItems);
      if (!res.ok) { setAddErr(res.error ?? "Could not add requirement."); return; }
      setRequiredItems(prev => [res.item!, ...prev]);
      setShowAdd(false); setCustomLabel(""); setInstructions(""); setDueDate(""); setMemberId(""); setLevel("required");
      setBanner(`Added requirement: ${res.item!.requirementLabel}`);
    } finally { setBusy(false); }
  }

  async function handleAddStandard() {
    setBusy(true); setAddErr(null);
    try {
      const { created, skipped } = await addStandardSet(caseId, tmpl, actor);
      if (created.length) setRequiredItems(prev => [...created, ...prev]);
      setBanner(`Added ${created.length} requirement(s)${skipped.length ? ` · ${skipped.length} already present` : ""}.`);
    } finally { setBusy(false); }
  }

  async function handleUpload(item: RecertRequiredItem, file: File) {
    setBusy(true); setBanner(null);
    try {
      const support = uploadSupportLevel(file.name);
      const docType = catalogEntry(item.requirementKey)?.docType ?? "other";
      const doc = await uploadSupportingDoc({ caseId, file, documentType: docType, requiredItemId: item.id, householdMemberId: item.householdMemberId, uploadedBy: actor });
      setDocuments(prev => [doc, ...prev]);
      if (item.status !== "complete") {
        const updated = await setRequirementLevel({ ...item, status: "uploaded" }, item.requirementLevel ?? "required");
        setRequiredItems(prev => prev.map(r => r.id === updated.id ? updated : r));
      }
      setBanner(
        support === "supported" ? `Uploaded ${file.name}. Review and accept it below.` :
        support === "separate_only" ? `Uploaded ${file.name}. DOC/DOCX is tracked but must be converted to PDF before bundling.` :
        `Uploaded ${file.name}. This type (e.g. HEIC) cannot be bundled — convert to PDF/JPG before the final packet.`
      );
    } catch (e) {
      setBanner(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  }

  async function review(doc: RecertDocument, status: RecertDocument["verificationStatus"], needReason = false) {
    let notes = doc.notes;
    if (needReason) {
      const r = window.prompt(`Reason (${status.replace("_", " ")}):`, doc.notes ?? "");
      if (r === null) return; // cancelled
      notes = r.trim() || undefined;
    }
    setBusy(true);
    try {
      const updated = await updateDocumentStatus({ ...doc, notes }, status, actor, "manager_update");
      setDocuments(prev => prev.map(d => d.id === updated.id ? updated : d));
      // When accepted, mark the linked requirement complete.
      if (status === "accepted" && doc.requiredItemId) {
        const item = requiredItems.find(r => r.id === doc.requiredItemId);
        if (item && item.status !== "complete") {
          const u = await setRequirementLevel({ ...item, status: "complete" }, item.requirementLevel ?? "required");
          setRequiredItems(prev => prev.map(r => r.id === u.id ? u : r));
        }
      }
    } finally { setBusy(false); }
  }

  async function changeLevel(item: RecertRequiredItem, lvl: NonNullable<RecertRequiredItem["requirementLevel"]>) {
    let reason: string | undefined;
    if (lvl === "waived" || lvl === "not_applicable") {
      const r = window.prompt(`Reason for ${lvl === "waived" ? "waiving" : "marking N/A"}:`, item.waiverReason ?? "");
      if (r === null) return;
      reason = r.trim() || undefined;
    }
    setBusy(true);
    try {
      const u = await setRequirementLevel(item, lvl, reason);
      setRequiredItems(prev => prev.map(r => r.id === u.id ? u : r));
    } finally { setBusy(false); }
  }

  async function removeItem(item: RecertRequiredItem) {
    if (!window.confirm(`Delete requirement "${item.requirementLabel}"? Uploaded files are not deleted.`)) return;
    setBusy(true);
    try {
      await deleteRequiredItem(item.id);
      setRequiredItems(prev => prev.filter(r => r.id !== item.id));
    } finally { setBusy(false); }
  }

  async function openDoc(doc: RecertDocument) {
    // Prefer a signed URL for files stored in Supabase Storage; fall back to an
    // external source link (e.g. a Google Drive original imported by reference).
    const url = (await signedUrlForDoc(doc)) ?? doc.fileUrl ?? null;
    if (url) window.open(url, "_blank"); else setBanner("Could not generate a download link for this file.");
  }

  const acceptedCount = documents.filter(d => d.verificationStatus === "accepted").length;

  async function handleBundle() {
    setBundleBusy(true); setBundleErr(null); setBundleResult(null);
    try {
      const sb = getSupabase();
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : null;
      const res = await fetch(`/api/recertification/${caseId}/generate-bundle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`Bundle failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      const blob = await res.blob();
      if (bundleUrl) URL.revokeObjectURL(bundleUrl);
      setBundleUrl(URL.createObjectURL(blob));
      setBundleResult({
        pages: Number(res.headers.get("X-Bundle-Pages") ?? 0),
        included: Number(res.headers.get("X-Docs-Included") ?? 0),
        omitted: Number(res.headers.get("X-Docs-Omitted") ?? 0),
        unsupported: Number(res.headers.get("X-Docs-Unsupported") ?? 0),
        notAccepted: Number(res.headers.get("X-Docs-Not-Accepted") ?? 0),
      });
    } catch (e) {
      setBundleErr(e instanceof Error ? e.message : String(e));
    } finally { setBundleBusy(false); }
  }

  return (
    <div className="space-y-6">
      {banner && (
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 flex justify-between gap-3">
          <span>{banner}</span>
          <button onClick={() => setBanner(null)} className="text-sky-500 hover:text-sky-700">✕</button>
        </div>
      )}

      {/* ── Toolbar ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => { setShowAdd(s => !s); setAddErr(null); }} className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
          + Add Required Document
        </button>
        <div className="flex items-center gap-1">
          <select value={tmpl} onChange={e => setTmpl(e.target.value)} className="text-sm border border-slate-300 rounded-md px-2 py-2">
            {STANDARD_TEMPLATE_SETS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button onClick={handleAddStandard} disabled={busy} className="px-3 py-2 rounded-md bg-slate-700 text-white text-sm hover:bg-slate-800 disabled:bg-slate-300">
            Add Standard LAHD Supporting Docs
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-slate-700">Document type
              <select value={typeKey} onChange={e => setTypeKey(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-2 text-sm font-normal">
                {DOC_TYPE_CATALOG.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-700">Requirement label{isCustom ? " (required)" : ""}
              <input value={isCustom ? customLabel : (catalogEntry(typeKey)?.label ?? "")} onChange={e => setCustomLabel(e.target.value)} disabled={!isCustom}
                placeholder={isCustom ? "e.g. Notarized guardianship letter" : ""}
                className="mt-1 w-full border border-slate-300 rounded-md px-2 py-2 text-sm font-normal disabled:bg-slate-100" />
            </label>
            <label className="text-xs font-semibold text-slate-700">Requirement level
              <select value={level} onChange={e => setLevel(e.target.value as typeof level)} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-2 text-sm font-normal">
                <option value="required">Required</option>
                <option value="optional">Optional</option>
                <option value="waived">Waived</option>
                <option value="not_applicable">Not applicable</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-700">Due date (optional)
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-2 text-sm font-normal" />
            </label>
            {members.length > 0 && (
              <label className="text-xs font-semibold text-slate-700">Related household member (optional)
                <select value={memberId} onChange={e => setMemberId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-2 text-sm font-normal">
                  <option value="">— Whole household —</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.fullName}</option>)}
                </select>
              </label>
            )}
            <label className="text-xs font-semibold text-slate-700 sm:col-span-2">Instructions to tenant (optional)
              <textarea value={instructions} onChange={e => setInstructions(e.target.value)} rows={2} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-2 text-sm font-normal" />
            </label>
          </div>
          {addErr && <div className="text-xs text-rose-700 font-medium">{addErr}</div>}
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={busy || (isCustom && !customLabel.trim())} className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:bg-slate-300">
              {busy ? "Adding…" : "Add requirement"}
            </button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 rounded-md border border-slate-300 text-sm text-slate-600">Cancel</button>
          </div>
        </div>
      )}

      {/* ── Section 1: Required items checklist ───────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Required Items Checklist</h3>
          <div className="text-xs text-gray-500">
            <span className="text-green-600 font-semibold">{readiness.satisfied}/{readiness.requiredTotal} required satisfied</span>
            {readiness.waivedOrNa.length > 0 && <span className="ml-2 text-amber-600">{readiness.waivedOrNa.length} waived/N-A</span>}
          </div>
        </div>
        <div className="divide-y divide-gray-50">
          {requiredItems.map(item => {
            const itemDocs = docsByItem[item.id] ?? [];
            const satisfied = isRequiredItemSatisfied(item, documents);
            const lvl = item.requirementLevel ?? "required";
            return (
              <div key={item.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 flex items-center gap-2 flex-wrap">
                      <span className={satisfied ? "text-green-600" : lvl === "required" ? "text-red-500" : "text-slate-400"}>{satisfied ? "✓" : lvl === "required" ? "✗" : "○"}</span>
                      {item.requirementLabel}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${LEVEL_BADGE[lvl]}`}>{lvl.replace("_", " ")}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {catalogEntry(item.requirementKey)?.label ?? item.requirementKey}
                      {item.dueDate ? ` · due ${item.dueDate}` : ""}
                      {item.householdMemberId ? ` · ${members.find(m => m.id === item.householdMemberId)?.fullName ?? "member"}` : ""}
                      {` · ${itemDocs.length} file(s)`}
                    </div>
                    {item.instructions && <div className="text-xs text-slate-400 mt-0.5 italic">{item.instructions}</div>}
                    {item.waiverReason && (lvl === "waived" || lvl === "not_applicable") && <div className="text-xs text-amber-600 mt-0.5">Reason: {item.waiverReason}</div>}
                    {/* attached docs */}
                    {itemDocs.map(d => (
                      <div key={d.id} className="mt-1 ml-4 flex items-center gap-2 text-xs">
                        <button onClick={() => openDoc(d)} className="text-sky-700 underline font-mono truncate max-w-[200px]">{d.fileName ?? d.id}</button>
                        <span className={`px-1.5 py-0.5 rounded-full border ${DOC_STATUS_BADGE[d.verificationStatus] ?? "bg-gray-50 text-gray-500 border-gray-200"}`}>{d.verificationStatus.replace("_", " ")}</span>
                        {uploadSupportLevel(d.fileName ?? "") !== "supported" && <span className="text-amber-600">{uploadSupportLevel(d.fileName ?? "") === "separate_only" ? "convert to PDF for bundle" : "not bundleable"}</span>}
                        <button onClick={() => review(d, "accepted")} disabled={busy} className="text-green-700 hover:underline">Accept</button>
                        <button onClick={() => review(d, "needs_clarification", true)} disabled={busy} className="text-orange-700 hover:underline">Clarify</button>
                        <button onClick={() => review(d, "rejected", true)} disabled={busy} className="text-red-700 hover:underline">Reject</button>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <label className="px-2 py-1 rounded-md bg-blue-600 text-white text-xs font-semibold cursor-pointer hover:bg-blue-700">
                      Upload / Attach
                      <input ref={el => { fileInputs.current[item.id] = el; }} type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.heic" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) void handleUpload(item, f); e.target.value = ""; }} />
                    </label>
                    <div className="flex gap-1">
                      <button onClick={() => changeLevel(item, "waived")} disabled={busy} className="text-[11px] text-amber-700 hover:underline">Waive</button>
                      <button onClick={() => changeLevel(item, "not_applicable")} disabled={busy} className="text-[11px] text-gray-500 hover:underline">N/A</button>
                      {lvl !== "required" && <button onClick={() => changeLevel(item, "required")} disabled={busy} className="text-[11px] text-red-600 hover:underline">Required</button>}
                      <button onClick={() => removeItem(item)} disabled={busy} className="text-[11px] text-rose-400 hover:underline">Delete</button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {requiredItems.length === 0 && (
            <div className="px-4 py-6 text-center text-gray-400 text-sm">
              No required items yet. Use <strong>Add Required Document</strong> or <strong>Add Standard LAHD Supporting Docs</strong> above.
            </div>
          )}
        </div>
      </div>

      {/* ── Section 2: All uploaded documents ─────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-700">Uploaded Documents ({documents.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 text-xs text-gray-500">
              <th className="text-left px-4 py-2">Filename</th><th className="text-left px-4 py-2">Requirement</th>
              <th className="text-left px-4 py-2">Uploaded</th><th className="text-left px-4 py-2">Status</th><th className="text-left px-4 py-2">Actions</th>
            </tr></thead>
            <tbody>
              {documents.map(doc => {
                const item = requiredItems.find(r => r.id === doc.requiredItemId);
                return (
                  <tr key={doc.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3"><button onClick={() => openDoc(doc)} className="text-sky-700 underline text-xs font-mono">{doc.fileName ?? "—"}</button></td>
                    <td className="px-4 py-3 text-xs text-gray-600">{item?.requirementLabel ?? <span className="text-gray-400">unlinked</span>}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{doc.uploadedAt?.slice(0, 10) ?? "—"}</td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full border ${DOC_STATUS_BADGE[doc.verificationStatus] ?? "bg-gray-50 text-gray-500 border-gray-200"}`}>{doc.verificationStatus.replace("_", " ")}</span>{doc.notes ? <span className="block text-[10px] text-gray-400 mt-0.5">{doc.notes}</span> : null}</td>
                    <td className="px-4 py-3 text-xs space-x-2">
                      <button onClick={() => review(doc, "accepted")} disabled={busy} className="text-green-700 hover:underline">Accept</button>
                      <button onClick={() => review(doc, "needs_clarification", true)} disabled={busy} className="text-orange-700 hover:underline">Clarify</button>
                      <button onClick={() => review(doc, "rejected", true)} disabled={busy} className="text-red-700 hover:underline">Reject</button>
                    </td>
                  </tr>
                );
              })}
              {documents.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400 text-sm">No documents uploaded yet. Use “Upload / Attach” on a requirement above.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section 3: Missing / blocking ─────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Missing / Blocking Items</h3>
        {readiness.allRequiredSatisfied && readiness.needsReview.length === 0 && readiness.needsClarification.length === 0 && readiness.rejected.length === 0 ? (
          <p className="text-sm text-green-700">✓ All required supporting documents are satisfied (accepted, waived, or N/A).</p>
        ) : (
          <ul className="text-sm space-y-1">
            {readiness.missingRequired.map(i => <li key={i.id} className="text-red-700">✗ Missing required: <strong>{i.requirementLabel}</strong> (no accepted document)</li>)}
            {readiness.needsReview.map(d => <li key={d.id} className="text-gray-600">• Uploaded, awaiting review: {d.fileName}</li>)}
            {readiness.needsClarification.map(d => <li key={d.id} className="text-orange-700">! Needs clarification: {d.fileName}{d.notes ? ` — ${d.notes}` : ""}</li>)}
            {readiness.rejected.map(d => <li key={d.id} className="text-red-700">✗ Rejected: {d.fileName}{d.notes ? ` — ${d.notes}` : ""}</li>)}
            {readiness.unsupported.map(d => <li key={d.id} className="text-amber-700">⚠ Unsupported for bundle (convert first): {d.fileName}</li>)}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-slate-400">Supporting docs are tracked separately from the editable official LAHD PDF. Only <strong>accepted</strong> docs are included in the combined bundle.</p>
      </div>

      {/* ── Combined bundle (non-editable submission packet) ─── */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Combined supporting-doc bundle</h3>
        <div className="grid sm:grid-cols-2 gap-3 mb-3 text-xs">
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2">
            <div className="font-semibold text-emerald-900">📄 Editable official LAHD PDF</div>
            <div className="text-emerald-800 mt-0.5">For DocHub / signing. Generated from the Compiler (Full / Tenant-Only / Manager-Only / Preview). <strong>Not</strong> in this bundle.</div>
          </div>
          <div className="rounded-md border border-sky-200 bg-sky-50 p-2">
            <div className="font-semibold text-sky-900">📦 Combined bundle</div>
            <div className="text-sky-800 mt-0.5">Non-editable review/submission packet: official LAHD pages → Supporting Documents Index → <strong>accepted</strong> docs appended.</div>
          </div>
        </div>
        {acceptedCount === 0 && <p className="text-[11px] text-amber-700 mb-2">No accepted documents yet — the bundle will be the official PDF + an index noting none were included.</p>}
        {bundleErr && <div className="mb-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900 font-mono break-all">Bundle failed: {bundleErr}</div>}
        <div className="flex flex-wrap gap-2 items-center">
          <button onClick={handleBundle} disabled={bundleBusy} className="px-4 py-2 rounded-md bg-sky-700 text-white text-sm font-semibold hover:bg-sky-800 disabled:bg-slate-300">
            {bundleBusy ? "Building bundle…" : "Download Combined Bundle"}
          </button>
          {bundleUrl && (
            <a href={bundleUrl} download="LAHD-Combined-Bundle.pdf" className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm hover:bg-slate-700">Download bundle ↓ (non-editable)</a>
          )}
        </div>
        {bundleResult && (
          <div className="mt-2 text-xs text-slate-700">
            ✓ Bundle ready — <strong>{bundleResult.pages}</strong> pages · <strong>{bundleResult.included}</strong> docs included
            {bundleResult.unsupported > 0 && <> · <span className="text-amber-700">{bundleResult.unsupported} unsupported</span></>}
            {bundleResult.omitted > 0 && <> · <span className="text-rose-700">{bundleResult.omitted} omitted</span></>}
            {bundleResult.notAccepted > 0 && <> · {bundleResult.notAccepted} not-yet-accepted</>}. See the Supporting Documents Index page in the bundle.
          </div>
        )}
      </div>
    </div>
  );
}
