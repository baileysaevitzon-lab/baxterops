"use client";
// Sprint 23: Income Certification Package Compiler — per-case page.
//
// Combines completed tenant + manager forms, lets staff upload supporting
// documents (bank statements, pay stubs, tax returns, etc.) to Supabase
// Storage, runs a readiness checklist, and generates the official LAHD
// Income Certification Package PDF.
//
// Route: /recertification/compiler/[caseId]

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { getSupabase } from "@/lib/supabase/client";
import {
  getCaseById,
  getMembersForCase,
  getRequiredItemsForCase,
  getIncomeSourcesForCase,
  getDocumentsForCase,
  saveDocument,
  buildSubmissionEmailDraft,
  saveCase,
  computeReadinessScore,
  logAuditEvent,
} from "@/lib/services/recertification";
import { loadSession } from "@/lib/services/recertCompletionForms";
import type {
  RecertificationCase,
  RecertHouseholdMember,
  RecertRequiredItem,
  RecertIncomeSource,
  RecertDocument,
  RecertDocumentType,
} from "@/lib/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_BUCKET = "recert-supporting-docs";

const DOC_CATEGORIES: { value: RecertDocumentType; label: string; group: string }[] = [
  // Income
  { value: "pay_stub",                label: "Pay Stub",                      group: "Income" },
  { value: "voe",                     label: "Verification of Employment (VOE)", group: "Income" },
  { value: "self_employment_document",label: "Self-Employment Document",       group: "Income" },
  { value: "social_security_award_letter", label: "Social Security Award Letter", group: "Income" },
  { value: "benefit_letter",          label: "Benefit / Award Letter",         group: "Income" },
  { value: "unemployment_document",   label: "Unemployment Document",          group: "Income" },
  { value: "pension_retirement",      label: "Pension / Retirement Statement", group: "Income" },
  { value: "public_assistance",       label: "Public Assistance Award Letter", group: "Income" },
  { value: "child_support",           label: "Child Support Documentation",    group: "Income" },
  { value: "alimony",                 label: "Alimony Documentation",          group: "Income" },
  { value: "recurring_income",        label: "Other Recurring Income",         group: "Income" },
  // Assets
  { value: "bank_statement",          label: "Bank Statement",                 group: "Assets" },
  { value: "asset_statement",         label: "Asset / Investment Statement",   group: "Assets" },
  { value: "investment_statement",    label: "Brokerage / Investment Statement", group: "Assets" },
  { value: "real_estate",             label: "Real Estate Documentation",      group: "Assets" },
  { value: "asset_certification",     label: "Asset Certification",            group: "Assets" },
  // Tax
  { value: "tax_return",              label: "Federal Tax Return",             group: "Tax" },
  { value: "irs_non_filing",          label: "IRS Non-Filing Letter",          group: "Tax" },
  // Certification forms
  { value: "ticq",                    label: "TICQ (Tenant Income Cert. Questionnaire)", group: "Forms" },
  { value: "applicant_statement",     label: "Applicant Statement",            group: "Forms" },
  { value: "conflict_of_interest",    label: "Conflict of Interest",           group: "Forms" },
  // Admin / LAHD
  { value: "rent_determination",      label: "Rent Determination Letter",      group: "LAHD Admin" },
  { value: "utility_allowance_table", label: "Utility Allowance Table",        group: "LAHD Admin" },
  { value: "covenant",                label: "Covenant / Regulatory Agreement",group: "LAHD Admin" },
  { value: "rent_schedule",           label: "Rent Schedule",                  group: "LAHD Admin" },
  { value: "clarification",           label: "Clarification Letter",           group: "LAHD Admin" },
  { value: "other",                   label: "Other",                          group: "Other" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDateTime(s: string | undefined | null): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  } catch { return s; }
}

function safeName(s: string) {
  return s.replace(/[^a-z0-9]/gi, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

function docLabel(type: RecertDocumentType): string {
  return DOC_CATEGORIES.find(d => d.value === type)?.label ?? type;
}

type SessionRow = { status: string; submitted_at?: string; submitted_by?: string } | null;

// ── Component ─────────────────────────────────────────────────────────────────

export default function CompilerCasePage() {
  const params = useParams();
  const caseId = String(params?.caseId ?? "");
  const { signedIn, loading: authLoading, profile, authUser } = useAuth();

  const [recertCase, setRecertCase] = useState<RecertificationCase | null>(null);
  const [members, setMembers] = useState<RecertHouseholdMember[]>([]);
  const [requiredItems, setRequiredItems] = useState<RecertRequiredItem[]>([]);
  const [incomeSources, setIncomeSources] = useState<RecertIncomeSource[]>([]);
  const [documents, setDocuments] = useState<RecertDocument[]>([]);
  const [tenantSession, setTenantSession] = useState<SessionRow>(null);
  const [managerSession, setManagerSession] = useState<SessionRow>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  // Upload state
  const [uploadDocType, setUploadDocType] = useState<RecertDocumentType>("bank_statement");
  const [uploadMemberId, setUploadMemberId] = useState<string>("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // PDF generation state
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [filledCount, setFilledCount] = useState(0);
  const [blankCount, setBlankCount] = useState(0);

  const loadData = useCallback(async () => {
    if (!caseId || !signedIn) return;
    try {
      const [c, m, items, inc, docs, ts, ms] = await Promise.all([
        getCaseById(caseId),
        getMembersForCase(caseId),
        getRequiredItemsForCase(caseId),
        getIncomeSourcesForCase(caseId),
        getDocumentsForCase(caseId),
        loadSession(caseId, "tenant"),
        loadSession(caseId, "manager"),
      ]);
      if (!c) { setLoadError("Case not found."); return; }
      setRecertCase(c);
      setMembers(m);
      setRequiredItems(items);
      setIncomeSources(inc);
      setDocuments(docs);
      setTenantSession(ts as SessionRow);
      setManagerSession(ms as SessionRow);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [caseId, signedIn]);

  useEffect(() => { void loadData(); }, [loadData]);

  // ── Document upload ──────────────────────────────────────────────────────────

  async function handleUpload() {
    if (!uploadFile) return;
    setUploading(true); setUploadError(null); setUploadSuccess(null);
    const sb = getSupabase();
    if (!sb) { setUploadError("Supabase not configured."); setUploading(false); return; }

    try {
      const ts = Date.now();
      const safeFn = uploadFile.name.replace(/[^A-Za-z0-9._-]/g, "_");
      const storagePath = `recert/${caseId}/${uploadDocType}/${ts}-${safeFn}`;

      const { error: upErr } = await sb.storage.from(STORAGE_BUCKET).upload(storagePath, uploadFile, {
        contentType: uploadFile.type || "application/octet-stream",
        upsert: false,
      });
      if (upErr) throw new Error(upErr.message);

      const actorEmail = authUser?.email ?? "staff";
      const now = new Date().toISOString();
      const doc: RecertDocument = {
        id: `rdoc-${caseId}-${ts}-${Math.random().toString(36).slice(2, 7)}`,
        caseId,
        ...(uploadMemberId ? { householdMemberId: uploadMemberId } : {}),
        documentType: uploadDocType,
        fileName: uploadFile.name,
        storagePath,
        uploadedBy: actorEmail,
        uploadedAt: now,
        verificationStatus: "pending",
        createdAt: now,
        updatedAt: now,
      };
      await saveDocument(doc);

      setUploadSuccess(`Uploaded "${uploadFile.name}" (${docLabel(uploadDocType)})`);
      setUploadFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await loadData();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  // ── Signed URL download ──────────────────────────────────────────────────────

  async function handleDownloadDoc(doc: RecertDocument) {
    if (!doc.storagePath) return;
    const sb = getSupabase();
    if (!sb) { alert("Supabase not configured."); return; }
    const { data, error } = await sb.storage.from(STORAGE_BUCKET).createSignedUrl(doc.storagePath, 60);
    if (error || !data?.signedUrl) { alert(`Could not generate download link: ${error?.message ?? "unknown error"}`); return; }
    window.open(data.signedUrl, "_blank");
  }

  // ── PDF generation ────────────────────────────────────────────────────────────

  async function handleGenerate() {
    setGenerating(true); setPdfError(null);
    try {
      const sb = getSupabase();
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : null;
      const res = await fetch(`/api/recertification/${caseId}/generate-exact-form`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          managerName: profile?.full_name ?? authUser?.email,
          managerEmail: authUser?.email,
        }),
      });
      if (!res.ok) throw new Error(`Generate failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      const blob = await res.blob();
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(URL.createObjectURL(blob));
      setFilledCount(Number(res.headers.get("X-Filled-Count") ?? 0));
      setBlankCount(Number(res.headers.get("X-Blank-Count") ?? 0));
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function handleMarkSubmitted() {
    if (!recertCase) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const updated = await saveCase({ ...recertCase, caseStatus: "submitted", submittedAt: now });
      setRecertCase(updated);
      await logAuditEvent(caseId, "submitted", "Package marked as submitted to Urban Futures (cert@ufbahc.com).");
    } finally { setSaving(false); }
  }

  async function handleCopyEmail() {
    if (!recertCase) return;
    const draft = buildSubmissionEmailDraft(recertCase);
    await navigator.clipboard.writeText(`To: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.body}`);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2500);
  }

  // ── Guards ────────────────────────────────────────────────────────────────────

  if (authLoading) return <div className="p-6 text-sm text-slate-500">Loading auth…</div>;
  if (!signedIn) return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Sign in required</h1>
      <Link href="/login" className="underline text-sm">Sign in →</Link>
    </div>
  );
  if (loadError) return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-rose-700">Could not load case</h1>
      <p className="text-sm text-slate-700 mt-2 font-mono">{loadError}</p>
      <Link href="/recertification/compiler" className="text-xs underline text-slate-500 mt-3 inline-block">← back to Compiler</Link>
    </div>
  );
  if (!recertCase) return <div className="p-6 text-sm text-slate-500">Loading case…</div>;

  // ── Derived state ─────────────────────────────────────────────────────────────

  const tenantSubmitted = tenantSession?.status === "submitted";
  const managerSubmitted = managerSession?.status === "submitted";
  const adults = members.filter(m => m.isAdult);
  const allSigned = adults.length > 0 && adults.every(m => m.ticqSigned && m.applicantStatementSigned && m.conflictOfInterestSigned);
  const allItemsComplete = requiredItems.length > 0 && requiredItems.every(r => r.status === "complete" || r.status === "not_applicable");
  const allIncomeApproved = incomeSources.length === 0 || incomeSources.every(s => s.managerApproved);
  const score = computeReadinessScore(requiredItems, members, incomeSources, undefined);

  const blockers: string[] = [
    !tenantSubmitted ? "Tenant recertification form not yet submitted" : null,
    !managerSubmitted ? "Managerial recertification form not yet submitted" : null,
    !allSigned ? "Missing adult household member signatures (TICQ, Applicant Statement, COI)" : null,
    !allItemsComplete ? "Not all required checklist items are complete" : null,
    !allIncomeApproved ? "Not all income sources have manager approval" : null,
  ].filter(Boolean) as string[];

  const downloadFilename = `LAHD-Income-Certification-${safeName(recertCase.primaryTenantName ?? "Tenant")}-Unit-${safeName(recertCase.unitNumber ?? "0")}-FINAL.pdf`;
  const draftEmail = buildSubmissionEmailDraft(recertCase);

  // Group docs by type
  const docsByType = documents.reduce<Record<string, RecertDocument[]>>((acc, d) => {
    const k = docLabel(d.documentType);
    (acc[k] = acc[k] ?? []).push(d);
    return acc;
  }, {});

  // Group upload categories by group
  const categoryGroups = DOC_CATEGORIES.reduce<Record<string, typeof DOC_CATEGORIES>>((acc, c) => {
    (acc[c.group] = acc[c.group] ?? []).push(c);
    return acc;
  }, {});

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-16">

      {/* Breadcrumb + header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-slate-500 mb-1 flex-wrap">
          <Link href="/recertification/compiler" className="hover:text-blue-600">Income Cert. Compiler</Link>
          <span>/</span>
          <span className="text-slate-800 font-medium">{recertCase.primaryTenantName}</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Income Certification Package</h1>
        <p className="text-sm text-slate-500 mt-1">
          Unit {recertCase.unitNumber ?? "—"} · {recertCase.propertyName ?? "The Baxter Hollywood"}
          {recertCase.dueDate ? ` · Due ${recertCase.dueDate}` : ""}
        </p>
      </div>

      {/* Manager review notice */}
      <div className="rounded-md border border-violet-300 bg-violet-50 px-4 py-3 text-xs text-violet-900">
        <strong>Manager review required.</strong> This tool assembles the LAHD Income Certification Package.
        All income calculations, eligibility determinations, and document sufficiency decisions remain the property manager&apos;s responsibility.
        Label all outputs as &quot;manager review required.&quot;
      </div>

      {/* Readiness bar */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-slate-800">Submission Readiness</span>
          <span className="text-sm font-bold text-slate-900">{score}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-slate-200 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${score >= 100 ? "bg-emerald-500" : score >= 70 ? "bg-amber-400" : "bg-red-400"}`}
            style={{ width: `${score}%` }}
          />
        </div>
        {blockers.length > 0 && (
          <ul className="mt-3 space-y-1">
            {blockers.map(b => (
              <li key={b} className="flex items-start gap-2 text-xs text-red-800">
                <span className="mt-0.5 shrink-0 text-red-500">✗</span> {b}
              </li>
            ))}
          </ul>
        )}
        {blockers.length === 0 && (
          <p className="mt-2 text-xs text-emerald-700 font-medium">✓ All required items complete — ready to generate final packet.</p>
        )}
      </div>

      {/* Form status cards */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Tenant form */}
        <div className={`rounded-lg border p-4 ${tenantSubmitted ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Tenant Recertification Form</h3>
              {tenantSubmitted ? (
                <p className="text-xs text-emerald-700 mt-1">
                  ✓ Submitted {fmtDateTime(tenantSession?.submitted_at)}
                  {tenantSession?.submitted_by ? ` by ${tenantSession.submitted_by}` : ""}
                </p>
              ) : (
                <p className="text-xs text-amber-700 mt-1">Not yet submitted</p>
              )}
            </div>
            <Link
              href={`/recertification/${caseId}/tenant-doc`}
              className="shrink-0 text-xs px-3 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-700 whitespace-nowrap"
            >
              {tenantSubmitted ? "Review →" : "Open Form →"}
            </Link>
          </div>
        </div>

        {/* Manager form */}
        <div className={`rounded-lg border p-4 ${managerSubmitted ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Managerial Recertification Form</h3>
              {managerSubmitted ? (
                <p className="text-xs text-emerald-700 mt-1">
                  ✓ Submitted {fmtDateTime(managerSession?.submitted_at)}
                  {managerSession?.submitted_by ? ` by ${managerSession.submitted_by}` : ""}
                </p>
              ) : (
                <p className="text-xs text-amber-700 mt-1">Not yet submitted</p>
              )}
            </div>
            <Link
              href={`/recertification/${caseId}/manager-doc`}
              className="shrink-0 text-xs px-3 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-700 whitespace-nowrap"
            >
              {managerSubmitted ? "Review →" : "Open Form →"}
            </Link>
          </div>
        </div>
      </div>

      {/* Supporting document upload */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-900 mb-1">Supporting Documents</h2>
        <p className="text-xs text-slate-500 mb-4">
          Upload bank statements, pay stubs, tax returns, benefit letters, and other supporting docs.
          Files are stored in Supabase Storage (private — staff access only). No public URLs are generated.
        </p>

        {/* Upload form */}
        <div className="grid md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Document type</label>
            <select
              value={uploadDocType}
              onChange={e => setUploadDocType(e.target.value as RecertDocumentType)}
              className="w-full border rounded-md px-2 py-1.5 text-sm text-slate-800 bg-white"
            >
              {Object.entries(categoryGroups).map(([group, items]) => (
                <optgroup key={group} label={group}>
                  {items.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Household member <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <select
              value={uploadMemberId}
              onChange={e => setUploadMemberId(e.target.value)}
              className="w-full border rounded-md px-2 py-1.5 text-sm text-slate-800 bg-white"
            >
              <option value="">— All household / general —</option>
              {members.map(m => (
                <option key={m.id} value={m.id}>{m.fullName ?? m.id}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">File</label>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs text-slate-700 file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-slate-800 file:text-white file:text-xs"
            />
          </div>
        </div>

        {uploadError && (
          <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900">{uploadError}</div>
        )}
        {uploadSuccess && (
          <div className="mb-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">✓ {uploadSuccess}</div>
        )}

        <button
          onClick={handleUpload}
          disabled={!uploadFile || uploading}
          className="px-4 py-2 rounded bg-slate-900 text-white text-sm disabled:bg-slate-300"
        >
          {uploading ? "Uploading…" : "Upload Document"}
        </button>

        {/* Document list */}
        {documents.length > 0 && (
          <div className="mt-5">
            <h3 className="text-xs font-semibold text-slate-700 mb-2">
              Uploaded documents ({documents.length})
            </h3>
            {Object.entries(docsByType).map(([label, docs]) => (
              <div key={label} className="mb-3">
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</div>
                <ul className="space-y-1">
                  {docs.map(d => (
                    <li key={d.id} className="flex items-center justify-between gap-2 rounded border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                      <div className="min-w-0">
                        <span className="font-medium text-slate-800 truncate block">{d.fileName ?? d.id}</span>
                        <span className="text-slate-500">
                          {d.uploadedBy ? `by ${d.uploadedBy}` : ""}
                          {d.uploadedAt ? ` · ${fmtDateTime(d.uploadedAt)}` : ""}
                          {d.householdMemberId ? ` · member: ${members.find(m => m.id === d.householdMemberId)?.fullName ?? d.householdMemberId}` : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          d.verificationStatus === "accepted" ? "bg-emerald-100 text-emerald-800" :
                          d.verificationStatus === "rejected" ? "bg-red-100 text-red-800" :
                          d.verificationStatus === "needs_clarification" ? "bg-amber-100 text-amber-800" :
                          "bg-slate-100 text-slate-600"
                        }`}>
                          {d.verificationStatus}
                        </span>
                        {d.storagePath && (
                          <button
                            onClick={() => handleDownloadDoc(d)}
                            className="text-blue-700 underline hover:text-blue-900"
                          >
                            Download
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {documents.length === 0 && !uploading && (
          <p className="mt-4 text-xs text-slate-400">No supporting documents uploaded yet.</p>
        )}
      </div>

      {/* Required items checklist */}
      {requiredItems.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-bold text-slate-900 mb-3">Required Items Checklist</h2>
          <ul className="space-y-1.5">
            {requiredItems.map(item => {
              const done = item.status === "complete" || item.status === "not_applicable";
              return (
                <li key={item.id} className="flex items-center gap-2 text-xs">
                  <span className={`shrink-0 w-4 text-center font-bold ${done ? "text-emerald-600" : "text-red-500"}`}>
                    {done ? "✓" : "✗"}
                  </span>
                  <span className={done ? "text-slate-700" : "text-red-800 font-medium"}>
                    {item.requirementLabel}
                  </span>
                  <span className="text-slate-400 ml-auto capitalize">{item.status.replace(/_/g, " ")}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Generate PDF */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-900 mb-1">Generate Final Packet</h2>
        <p className="text-xs text-slate-500 mb-4">
          Generates the official LAHD Income Certification Package PDF with all BaxterOps-known fields filled.
          Remaining blanks (tenant signatures, asset balances) must be completed in DocHub on iPad.
          Download named <code className="text-slate-700 bg-slate-100 px-1 rounded">{downloadFilename}</code>.
        </p>

        {pdfError && (
          <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900 font-mono break-all">{pdfError}</div>
        )}

        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-2 rounded bg-emerald-700 text-white text-sm hover:bg-emerald-800 disabled:bg-slate-300"
          >
            {generating ? "Generating…" : pdfUrl ? "Re-generate PDF" : "Generate PDF"}
          </button>
          {pdfUrl && (
            <a
              href={pdfUrl}
              download={downloadFilename}
              className="px-4 py-2 rounded bg-slate-900 text-white text-sm hover:bg-slate-700"
            >
              Download PDF ↓
            </a>
          )}
        </div>

        {pdfUrl && (
          <div className="text-xs text-emerald-700 mb-3 font-medium">
            ✓ PDF ready — {filledCount} fields filled · {blankCount} blanks for tenant/manager in DocHub
          </div>
        )}

        {pdfUrl && (
          <iframe
            src={pdfUrl}
            className="w-full rounded border border-slate-200"
            style={{ height: "70vh" }}
            title="LAHD Income Certification Package preview"
          />
        )}
      </div>

      {/* Submit actions */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-900 mb-3">Submit to Urban Futures</h2>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-mono text-slate-700 mb-3 space-y-0.5">
          <div><strong>To:</strong> {draftEmail.to}</div>
          <div><strong>Subject:</strong> {draftEmail.subject}</div>
          <div className="mt-2 whitespace-pre-wrap text-slate-600">{draftEmail.body}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleCopyEmail}
            className="px-3 py-2 rounded border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50"
          >
            {copySuccess ? "✓ Copied!" : "Copy email draft"}
          </button>
          {recertCase.caseStatus !== "submitted" && recertCase.caseStatus !== "approved" && (
            <button
              onClick={handleMarkSubmitted}
              disabled={saving}
              className="px-4 py-2 rounded bg-emerald-700 text-white text-sm disabled:bg-slate-300 hover:bg-emerald-800"
            >
              {saving ? "Saving…" : "Mark as Submitted"}
            </button>
          )}
          {(recertCase.caseStatus === "submitted" || recertCase.caseStatus === "approved") && (
            <span className="px-3 py-2 rounded bg-emerald-50 border border-emerald-300 text-emerald-800 text-sm font-medium">
              ✓ {recertCase.caseStatus === "approved" ? "Approved" : "Submitted"}
            </span>
          )}
        </div>
      </div>

      {/* Footer links */}
      <div className="flex flex-wrap gap-4 text-xs text-slate-500">
        <Link href="/recertification/compiler" className="underline hover:text-slate-800">← Back to Compiler</Link>
        <Link href={`/recertification/${caseId}`} className="underline hover:text-slate-800">Full case details →</Link>
        <Link href={`/recertification/${caseId}/exact-form-preview`} className="underline hover:text-slate-800">Field classification / PDF preview →</Link>
      </div>
    </div>
  );
}
