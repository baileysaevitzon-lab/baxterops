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
import {
  singleUnitScenarios, BAXTER_ALL_ELECTRIC_COMPONENTS, UA_SCHEDULE_SOURCE,
} from "@/lib/services/utilityAllowanceSchedule";
import { ManagerAutoFillPanel } from "@/components/ManagerAutoFillPanel";
import { useAuth } from "@/components/AuthProvider";
import { getSupabase } from "@/lib/supabase/client";
import { InlineStatusSelect, type StatusOption } from "@/components/InlineStatusSelect";
import { InlineEditField } from "@/components/InlineEditField";
import {
  getCaseById,
  getMembersForCase,
  getRequiredItemsForCase,
  getIncomeSourcesForCase,
  getDocumentsForCase,
  saveDocument,
  updateDocumentStatus,
  updateDocumentNotes,
  buildSubmissionEmailDraft,
  saveCase,
  computeReadinessScore,
  logAuditEvent,
} from "@/lib/services/recertification";
import { loadSession } from "@/lib/services/recertCompletionForms";
import { computeDocsReadiness } from "@/lib/services/recertSupportingDocs";
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

// Supporting-document status dropdown (writes to recert_documents.verification_status).
const DOC_STATUS_OPTIONS: StatusOption<RecertDocument["verificationStatus"]>[] = [
  { value: "missing",             label: "Missing",             intent: "bad" },
  { value: "received",            label: "Received",            intent: "info" },
  { value: "pending_review",      label: "Pending Review",      intent: "warn" },
  { value: "reviewed",            label: "Reviewed",            intent: "info" },
  { value: "accepted",            label: "Accepted",            intent: "good" },
  { value: "needs_clarification", label: "Needs Clarification", intent: "warn" },
  { value: "rejected",            label: "Rejected",            intent: "bad" },
];

// Statuses that represent a manager review decision → logged as manager_update.
const MANAGER_DECISION_STATUSES = new Set<RecertDocument["verificationStatus"]>([
  "reviewed", "accepted", "needs_clarification", "rejected",
]);

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

// Sprint 31: official-format generation modes.
type GenMode = "full" | "tenant_only" | "manager_only" | "preview";
const MODE_LABEL: Record<GenMode, string> = {
  full: "Full Final Packet",
  tenant_only: "Tenant-Only Official Format",
  manager_only: "Manager-Only Official Format",
  preview: "Preview / Missing Items",
};
const MODE_FILE_TAG: Record<GenMode, string> = {
  full: "FINAL",
  tenant_only: "TENANT-ONLY-OFFICIAL-FORMAT",
  manager_only: "MANAGER-ONLY-OFFICIAL-FORMAT",
  preview: "PREVIEW",
};

// Sprint 33: read-only generated-packet history row + mode derivation.
interface GeneratedPacketRow {
  id: string;
  generated_at: string;
  generated_by?: string | null;
  filled_count?: number | null;
  blank_count?: number | null;
  status: string;
  missing_data_json?: { mode?: string } | null;
}
// A packet's mode lives in missing_data_json.mode (Sprint 31+). Older rows have
// status = mode for non-full and "draft" for full.
function packetMode(p: GeneratedPacketRow): GenMode {
  const m = p.missing_data_json?.mode ?? (p.status === "draft" ? "full" : p.status);
  return (["full", "tenant_only", "manager_only", "preview"] as const).includes(m as GenMode) ? (m as GenMode) : "full";
}

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
  const [lastMode, setLastMode] = useState<GenMode | null>(null);
  // Sprint 33: latest generated packets (read-only history from recert_generated_packets)
  const [recentPackets, setRecentPackets] = useState<GeneratedPacketRow[]>([]);
  // Sprint 34: combined-bundle state
  const [bundleUrl, setBundleUrl] = useState<string | null>(null);
  const [bundleBusy, setBundleBusy] = useState(false);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [bundleResult, setBundleResult] = useState<{ pages: number; included: number; omitted: number; unsupported: number; notAccepted: number } | null>(null);

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

      // Best-effort: load recent generated-packet history (read-only; non-fatal).
      try {
        const sb = getSupabase();
        if (sb) {
          const { data: gp } = await sb
            .from("recert_generated_packets")
            .select("id, generated_at, generated_by, filled_count, blank_count, status, missing_data_json")
            .eq("case_id", caseId)
            .order("generated_at", { ascending: false })
            .limit(40);
          setRecentPackets((gp ?? []) as GeneratedPacketRow[]);
        }
      } catch { /* non-fatal — panel just shows "none yet" */ }
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
        verificationStatus: "received",
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

  async function handleGenerate(mode: GenMode = "full") {
    setGenerating(true); setPdfError(null); setLastMode(mode);
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
          mode,
        }),
      });
      if (!res.ok) throw new Error(`Generate failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      const blob = await res.blob();
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(URL.createObjectURL(blob));
      setFilledCount(Number(res.headers.get("X-Filled-Count") ?? 0));
      setBlankCount(Number(res.headers.get("X-Blank-Count") ?? 0));
      void loadData(); // refresh the "Latest generated output" panel with the new packet
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function handleBundle() {
    setBundleBusy(true); setBundleError(null); setBundleResult(null);
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
      setBundleError(e instanceof Error ? e.message : String(e));
    } finally {
      setBundleBusy(false);
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
  // Sprint 35: supporting-doc readiness (handles required/optional/waived/NA + accepted docs).
  const docsReadiness = computeDocsReadiness(requiredItems, documents);
  const allItemsComplete = docsReadiness.requiredTotal === 0 || docsReadiness.allRequiredSatisfied;
  const allIncomeApproved = incomeSources.length === 0 || incomeSources.every(s => s.managerApproved);
  const score = computeReadinessScore(requiredItems, members, incomeSources, undefined);

  const blockers: string[] = [
    !tenantSubmitted ? "Tenant recertification form not yet submitted" : null,
    !managerSubmitted ? "Managerial recertification form not yet submitted" : null,
    !allSigned ? "Missing adult household member signatures (TICQ, Applicant Statement, COI)" : null,
    !allItemsComplete ? "Not all required checklist items are complete" : null,
    !allIncomeApproved ? "Not all income sources have manager approval" : null,
  ].filter(Boolean) as string[];

  // Supporting-doc status summary (Task 4 / Option A — docs are NOT merged into
  // the PDF; this is an honest "uploaded separately" summary).
  const docAccepted = documents.filter(d => d.verificationStatus === "accepted").length;
  const docInReview = documents.filter(d => ["received", "reviewed", "pending_review"].includes(d.verificationStatus)).length;
  const docNeedsClar = documents.filter(d => ["needs_clarification", "rejected"].includes(d.verificationStatus)).length;

  // Actionable missing-info checklist (Task 3). Each row carries source, severity,
  // and an action link. Only "blocker" items gate the Full Final Packet.
  type CheckItem = { key: string; label: string; ok: boolean; source: string; severity: "blocker" | "warning" | "optional"; actionLabel: string; href: string };
  const checklist: CheckItem[] = [
    { key: "tenant", label: "Tenant recertification form submitted", ok: tenantSubmitted, source: "tenant", severity: "blocker", actionLabel: tenantSubmitted ? "Review tenant form" : "Open tenant form", href: `/recertification/${caseId}/tenant-doc` },
    { key: "manager", label: "Manager recertification form submitted", ok: managerSubmitted, source: "manager", severity: "blocker", actionLabel: managerSubmitted ? "Review manager form" : "Open manager form", href: `/recertification/${caseId}/manager-doc` },
    { key: "tenant_sig", label: "Household-member signatures (TICQ / Applicant Statement / COI)", ok: allSigned, source: "tenant", severity: "blocker", actionLabel: "Capture tenant signature", href: `/recertification/${caseId}/exact-form-preview` },
    { key: "manager_sig", label: "Manager / Owner signature (OPM, pages 11 & 16)", ok: managerSubmitted, source: "manager", severity: "warning", actionLabel: "Sign on Manager Form", href: `/recertification/${caseId}/manager-doc` },
    { key: "items", label: docsReadiness.requiredTotal === 0 ? "Required supporting documents (none defined)" : `Required supporting documents accepted/waived (${docsReadiness.satisfied}/${docsReadiness.requiredTotal})`, ok: allItemsComplete, source: "supporting docs", severity: "blocker", actionLabel: "Manage documents", href: `/recertification/${caseId}` },
    { key: "income", label: "Income sources manager-approved", ok: allIncomeApproved, source: "manager review", severity: "warning", actionLabel: "Open case detail", href: `/recertification/${caseId}` },
    { key: "docs", label: "Supporting documents uploaded (separate from PDF)", ok: documents.length > 0, source: "supporting docs", severity: "optional", actionLabel: "Upload documents", href: `#supporting-docs` },
  ];

  // Latest generated packet per official mode (recentPackets is ordered newest-first).
  // Bundle records (status/mode 'bundle') are excluded — they are not an official mode.
  const latestByMode: Partial<Record<GenMode, GeneratedPacketRow>> = {};
  for (const p of recentPackets) {
    if (p.status === "bundle" || p.missing_data_json?.mode === "bundle") continue;
    const md = packetMode(p);
    if (!latestByMode[md]) latestByMode[md] = p;
  }

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
        {/* Task 3: actionable missing-info checklist */}
        <div className="mt-3 divide-y divide-slate-100">
          {checklist.map(item => (
            <div key={item.key} className="flex items-center justify-between gap-3 py-1.5">
              <div className="flex items-start gap-2 min-w-0">
                <span className={`mt-0.5 shrink-0 ${item.ok ? "text-emerald-600" : item.severity === "blocker" ? "text-red-500" : item.severity === "warning" ? "text-amber-500" : "text-slate-400"}`}>
                  {item.ok ? "✓" : item.severity === "blocker" ? "✗" : item.severity === "optional" ? "○" : "!"}
                </span>
                <span className="text-xs text-slate-700 min-w-0">
                  {item.label}
                  <span className="ml-1 text-[10px] text-slate-400">· {item.source} · {item.severity}</span>
                </span>
              </div>
              {!item.ok && (
                <Link href={item.href} className="shrink-0 text-[11px] text-sky-700 underline whitespace-nowrap">{item.actionLabel} →</Link>
              )}
            </div>
          ))}
        </div>
        {blockers.length === 0 ? (
          <p className="mt-2 text-xs text-emerald-700 font-medium">✓ All blocker items complete — Full Final Packet can be generated.</p>
        ) : (
          <p className="mt-2 text-[11px] text-slate-500">Blocker (✗) items must clear for the Full Final Packet. Tenant-Only / Manager-Only official formats can be generated regardless. Need to fix a specific field value? Use <Link href={`/recertification/${caseId}/exact-form-preview`} className="underline text-sky-700">field overrides</Link> (saved to recert_case_field_overrides; tenant/manager values are not overwritten silently).</p>
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
      <div id="supporting-docs" className="rounded-lg border border-slate-200 bg-white p-4 scroll-mt-4">
        <h2 className="text-sm font-bold text-slate-900 mb-1">Supporting Documents</h2>
        <p className="text-xs text-slate-500 mb-3">
          Upload bank statements, pay stubs, tax returns, benefit letters, and other supporting docs.
          Files are stored in Supabase Storage (private — staff access only). No public URLs are generated.
        </p>

        {/* Task 4 / Option A: honest separate-docs status summary */}
        <div className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          📎 <strong>Supporting docs are uploaded separately and are NOT merged into the generated LAHD PDF.</strong>{" "}
          Submit them alongside the packet (e.g., in the Urban Futures email below).{" "}
          Status: <strong>{documents.length}</strong> uploaded · <strong>{docAccepted}</strong> accepted ·{" "}
          <strong>{docInReview}</strong> in review · <strong className={docNeedsClar ? "text-rose-700" : ""}>{docNeedsClar}</strong> need clarification/rejected.
          {documents.length === 0 && <span className="block mt-1 text-sky-700">No documents uploaded yet.</span>}
        </div>

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
                  {docs.map(d => {
                    const actor = profile?.full_name ?? authUser?.email ?? undefined;
                    // Tolerate any value not in the standard set (e.g. legacy "pending"
                    // or a future connector-suggested status) so the select stays valid.
                    const rowOptions: StatusOption<RecertDocument["verificationStatus"]>[] =
                      DOC_STATUS_OPTIONS.some(o => o.value === d.verificationStatus)
                        ? DOC_STATUS_OPTIONS
                        : [{ value: d.verificationStatus, label: d.verificationStatus, intent: "neutral" }, ...DOC_STATUS_OPTIONS];
                    return (
                    <li key={d.id} className="flex items-start justify-between gap-2 rounded border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                      <div className="min-w-0 flex-1">
                        <span className="font-medium text-slate-800 truncate block">{d.fileName ?? d.id}</span>
                        <span className="text-slate-500">
                          {d.uploadedBy ? `by ${d.uploadedBy}` : ""}
                          {d.uploadedAt ? ` · ${fmtDateTime(d.uploadedAt)}` : ""}
                          {d.householdMemberId ? ` · member: ${members.find(m => m.id === d.householdMemberId)?.fullName ?? d.householdMemberId}` : ""}
                        </span>
                        <div className="mt-1">
                          <InlineEditField
                            value={d.notes}
                            placeholder="+ add note (e.g. missing page 2)"
                            multiline
                            onSave={async (v) => {
                              const updated = await updateDocumentNotes(d, v, actor);
                              setDocuments(prev => prev.map(x => (x.id === d.id ? updated : x)));
                            }}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <InlineStatusSelect
                          value={d.verificationStatus}
                          options={rowOptions}
                          onSave={async (next) => {
                            const st: "manager_update" | "manual_override" =
                              MANAGER_DECISION_STATUSES.has(next) ? "manager_update" : "manual_override";
                            const updated = await updateDocumentStatus(d, next, actor, st);
                            setDocuments(prev => prev.map(x => (x.id === d.id ? updated : x)));
                          }}
                        />
                        {d.storagePath && (
                          <button
                            onClick={() => handleDownloadDoc(d)}
                            className="text-blue-700 underline hover:text-blue-900 whitespace-nowrap"
                          >
                            Download
                          </button>
                        )}
                      </div>
                    </li>
                    );
                  })}
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

      {/* Generate official LAHD PDF — mode selector */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-900 mb-1">Generate official LAHD format</h2>
        <p className="text-xs text-slate-500 mb-1">
          Uses the actual official LAHD template (<code className="text-slate-700 bg-slate-100 px-1 rounded">lahd-recert-2026.pdf</code>),
          not a recreation. Remaining blanks are left as fillable widgets for DocHub on iPad. Supporting documents are
          <strong> uploaded separately</strong> (not merged into this PDF).
        </p>

        {/* Readiness banner */}
        <div className={`mb-3 rounded-md px-3 py-2 text-sm border ${
          blockers.length === 0 ? "border-emerald-300 bg-emerald-50 text-emerald-900"
          : (tenantSubmitted || managerSubmitted) ? "border-amber-300 bg-amber-50 text-amber-900"
          : "border-rose-300 bg-rose-50 text-rose-900"}`}>
          {blockers.length === 0
            ? "✓ Ready — all blockers clear. Full Final Packet can be generated."
            : (tenantSubmitted || managerSubmitted)
              ? `Partially ready — Full Final Packet is blocked, but ${tenantSubmitted ? "Tenant-Only" : "Manager-Only"} official format can still be generated.`
              : "Blocked for Full Final Packet — neither form submitted. You can still generate a single-side official format below."}
          {blockers.length > 0 && (
            <ul className="list-disc pl-5 mt-1 text-xs">{blockers.map(b => <li key={b}>{b}</li>)}</ul>
          )}
        </div>

        {pdfError && (
          <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900 font-mono break-all">Generation failed: {pdfError}</div>
        )}

        <div className="grid sm:grid-cols-2 gap-2 mb-4">
          <button
            onClick={() => handleGenerate("full")}
            disabled={generating || blockers.length > 0}
            title={blockers.length > 0 ? "Blocked: resolve the items above (tenant + manager submitted, signatures present)." : "Merge tenant + manager + signatures."}
            className="px-4 py-2 rounded bg-emerald-700 text-white text-sm hover:bg-emerald-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-left"
          >
            {generating && lastMode === "full" ? "Generating…" : "Generate Full Final Packet"}
            <span className="block text-[11px] opacity-80">Requires both forms + signatures</span>
          </button>
          <button
            onClick={() => handleGenerate("tenant_only")}
            disabled={generating}
            className="px-4 py-2 rounded bg-sky-700 text-white text-sm hover:bg-sky-800 disabled:bg-slate-300 text-left"
          >
            {generating && lastMode === "tenant_only" ? "Generating…" : "Generate Tenant-Only Official Format"}
            <span className="block text-[11px] opacity-80">{tenantSubmitted ? "Tenant form submitted" : "Tenant form not submitted — output may be mostly blank"}</span>
          </button>
          <button
            onClick={() => handleGenerate("manager_only")}
            disabled={generating}
            className="px-4 py-2 rounded bg-violet-700 text-white text-sm hover:bg-violet-800 disabled:bg-slate-300 text-left"
          >
            {generating && lastMode === "manager_only" ? "Generating…" : "Generate Manager-Only Official Format"}
            <span className="block text-[11px] opacity-80">{managerSubmitted ? "Manager form submitted" : "Manager form not submitted — output may be mostly blank"}</span>
          </button>
          <button
            onClick={() => handleGenerate("preview")}
            disabled={generating}
            className="px-4 py-2 rounded border border-slate-300 text-slate-700 text-sm hover:bg-slate-50 disabled:opacity-50 text-left"
          >
            {generating && lastMode === "preview" ? "Generating…" : "Preview Official PDF (not final)"}
            <span className="block text-[11px] opacity-70">Shows everything; not marked final</span>
          </button>
        </div>

        {pdfUrl && lastMode && (
          <>
            <div className={`text-xs mb-2 font-medium ${lastMode === "full" ? "text-emerald-700" : "text-sky-700"}`}>
              ✓ Generated: <strong>{MODE_LABEL[lastMode]}</strong> — {filledCount} fields filled · {blankCount} blanks left for DocHub.
              {lastMode !== "full" && <span className="text-amber-700"> This is NOT the final merged packet.</span>}
            </div>
            <a
              href={pdfUrl}
              download={`LAHD-Income-Certification-${safeName(recertCase.primaryTenantName ?? "Tenant")}-Unit-${safeName(recertCase.unitNumber ?? "0")}-${MODE_FILE_TAG[lastMode]}.pdf`}
              className="inline-block mb-3 px-4 py-2 rounded bg-slate-900 text-white text-sm hover:bg-slate-700"
            >
              Download {MODE_LABEL[lastMode]} ↓
            </a>
            <iframe
              src={pdfUrl}
              className="w-full rounded border border-slate-200"
              style={{ height: "70vh" }}
              title="LAHD Income Certification Package preview"
            />
          </>
        )}
      </div>

      {/* Sprint 34: Combined supporting-doc bundle (separate, non-editable) */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-900 mb-1">Combined supporting-doc bundle</h2>
        <div className="grid sm:grid-cols-2 gap-3 mb-3 text-xs">
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2">
            <div className="font-semibold text-emerald-900">📄 Editable official LAHD PDF</div>
            <div className="text-emerald-800 mt-0.5">For DocHub / signing. Generated above (Full / Tenant-Only / Manager-Only / Preview). Preserves official form fields. <strong>Not</strong> in the bundle.</div>
          </div>
          <div className="rounded-md border border-sky-200 bg-sky-50 p-2">
            <div className="font-semibold text-sky-900">📦 Combined bundle</div>
            <div className="text-sky-800 mt-0.5">For review / submission. <strong>Non-editable.</strong> Official LAHD pages first, then a Supporting Documents Index, then accepted documents appended.</div>
          </div>
        </div>
        <p className="text-[11px] text-slate-500 mb-3">
          Only <strong>accepted</strong> documents are appended. DOC/DOCX and HEIC are listed as unsupported (convert first); unreadable/over-cap docs are listed as omitted — never silently dropped. With no accepted docs, the bundle is still produced as the official PDF + an index noting none were included.
        </p>

        {bundleError && <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900 font-mono break-all">Bundle failed: {bundleError}</div>}

        <div className="flex flex-wrap gap-2 items-center">
          <button
            onClick={handleBundle}
            disabled={bundleBusy}
            className="px-4 py-2 rounded bg-sky-700 text-white text-sm font-medium hover:bg-sky-800 disabled:bg-slate-300"
          >
            {bundleBusy ? "Building bundle…" : "Download Combined Bundle"}
          </button>
          {bundleUrl && (
            <a
              href={bundleUrl}
              download={`LAHD-Income-Certification-${safeName(recertCase.primaryTenantName ?? "Tenant")}-Unit-${safeName(recertCase.unitNumber ?? "0")}-BUNDLE.pdf`}
              className="px-4 py-2 rounded bg-slate-900 text-white text-sm hover:bg-slate-700"
            >
              Download bundle ↓ (non-editable)
            </a>
          )}
        </div>

        {bundleResult && (
          <div className="mt-3 text-xs text-slate-700 rounded-md border border-slate-200 bg-slate-50 p-2">
            ✓ Bundle ready — <strong>{bundleResult.pages}</strong> pages · <strong>{bundleResult.included}</strong> docs included
            {bundleResult.unsupported > 0 && <> · <span className="text-amber-700">{bundleResult.unsupported} unsupported</span></>}
            {bundleResult.omitted > 0 && <> · <span className="text-rose-700">{bundleResult.omitted} omitted</span></>}
            {bundleResult.notAccepted > 0 && <> · {bundleResult.notAccepted} not-yet-accepted</>}.
            See the Supporting Documents Index page in the bundle for the full list.
          </div>
        )}
        {bundleUrl && (
          <iframe src={bundleUrl} className="w-full mt-3 rounded border border-slate-200" style={{ height: "60vh" }} title="Combined bundle preview" />
        )}
      </div>

      {/* Sprint 40: Manager auto-fill draft (reusable derivation engine; preview/gated-apply) */}
      <ManagerAutoFillPanel caseId={caseId} appliedBy={authUser?.email ?? undefined} />

      {/* Sprint 39: Utility-allowance / rent-math advisory (never blocks generation) */}
      <UaAdvisoryCard recertCase={recertCase} />

      {/* Sprint 33: Latest generated output per mode (read-only history) */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-900 mb-1">Latest generated output</h2>
        <p className="text-xs text-slate-500 mb-3">
          Most recent PDF generated for each mode (from the generation history). PDFs are produced on-demand — use the
          buttons above to re-generate and download the current version.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          {(["full", "tenant_only", "manager_only", "preview"] as GenMode[]).map(mode => {
            const p = latestByMode[mode];
            return (
              <div key={mode} className={`rounded-md border p-3 ${p ? "border-slate-200 bg-slate-50" : "border-dashed border-slate-200"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800">{MODE_LABEL[mode]}</span>
                  {p ? (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${mode === "full" ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"}`}>
                      {mode === "full" ? "draft (final)" : "non-final"}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400">not generated yet</span>
                  )}
                </div>
                {p ? (
                  <div className="mt-1 text-[11px] text-slate-600 space-y-0.5">
                    <div>Generated {p.generated_at?.replace("T", " ").slice(0, 19)} UTC{p.generated_by ? ` · by ${p.generated_by}` : ""}</div>
                    <div>{p.filled_count ?? 0} filled · {p.blank_count ?? 0} blank{p.missing_data_json?.mode ? ` · status ${p.status}` : ""}</div>
                  </div>
                ) : (
                  <div className="mt-1 text-[11px] text-slate-400">Use “Generate {MODE_LABEL[mode]}” above to create it.</div>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-slate-400 mt-2">History is read-only. Generating a packet here never marks the case submitted; only an explicit “Mark as Submitted” does.</p>
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

// Sprint 39: advisory-only utility-allowance / rent-math card. Compares the
// case's manager-entered UA against the HACLA schedule scenarios (SRO / 0BR /
// 1BR, Baxter all-electric component set). Never blocks generation and never
// changes generator math — pending Katherine confirmation.
function UaAdvisoryCard({ recertCase }: { recertCase: import("@/lib/types").RecertificationCase }) {
  const caseUa = recertCase.totalUtilityAllowance;
  if (caseUa === undefined || caseUa === null || !recertCase.utilityAllowanceRequired) return null;

  const scenarios = singleUnitScenarios(BAXTER_ALL_ELECTRIC_COMPONENTS);
  const matching = scenarios.find(s => s.total === Number(caseUa));
  const bedroomLabelByCol: Record<string, string> = { SRO: "SRO", "0": "Studio / 0BR", "1": "1-Bedroom" };
  const impliedCol = recertCase.bedroomCount === 1 ? "1" : recertCase.bedroomCount === 0 ? "0" : undefined;
  const matchesImplied = matching && impliedCol && matching.bedroomCol === impliedCol;

  return (
    <div className={`rounded-lg border p-4 ${matchesImplied ? "border-emerald-200 bg-emerald-50/60" : "border-amber-300 bg-amber-50/70"}`}>
      <h2 className="text-sm font-bold text-slate-900 mb-1">
        Utility allowance check <span className="font-normal text-xs text-slate-500">(advisory — pending Katherine confirmation; does not change the generated PDF)</span>
      </h2>
      <div className="text-xs text-slate-700 space-y-1">
        <p>
          Case UA: <strong>${Number(caseUa)}</strong> · HACLA MFR schedule (eff. {UA_SCHEDULE_SOURCE.effectiveDate}), all-electric set
          {" "}(cooking + basic + A/C + space heating): {scenarios.map(s => `${bedroomLabelByCol[s.bedroomCol]} = $${s.total}`).join(" · ")}
        </p>
        {matching ? (
          <p>
            ✓ Case UA matches the <strong>{bedroomLabelByCol[matching.bedroomCol]}</strong> column.
            {!matchesImplied && recertCase.bedroomCount != null && (
              <span className="text-amber-800"> ⚠ But case bedroom count is {recertCase.bedroomCount} — confirm with Katherine whether this unit is treated as {bedroomLabelByCol[matching.bedroomCol]} for UA purposes.</span>
            )}
          </p>
        ) : (
          <p className="text-amber-800">⚠ Case UA does not match any schedule scenario for the all-electric set — verify the component selection or amount with Katherine.</p>
        )}
        <p className="text-slate-500">
          KBI-confirmed rules (2026-06-11): covenant &quot;Single&quot; units use the <strong>Studio/0BR</strong> column; SCEP $3 is included (note: Electric Cooking and SCEP are both $3 at 0BR, so the $35 total is identical either way); Total Unit Rent follows the printed formula (tenant + UA + subsidy); studio max allowable rent is <strong>$876</strong>. Source: <a className="underline" href={UA_SCHEDULE_SOURCE.indexUrl} target="_blank" rel="noreferrer">hacla.org utility allowances</a>.
        </p>
      </div>
    </div>
  );
}
