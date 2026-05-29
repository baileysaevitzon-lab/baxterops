"use client";
// Sprint 9 — Recertification Case Detail (10-tab workflow).
// Sensitive tenant data lives in Supabase only; no real SSNs / bank account
// numbers / real income details are hard-coded in this file.
//
// Tab labels use "Checklist Review" (not "AI Document Review") — the system
// inspects structured DB fields only; no OCR is performed.
// All calculation outputs are labeled "Manager review required."

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { getSupabase } from "@/lib/supabase/client";
import { OfflineTenantFormPanel } from "@/components/OfflineTenantFormPanel";
import { loadSession } from "@/lib/services/recertCompletionForms";
import {
  getCaseById,
  saveCase,
  getMembersForCase,
  saveMember,
  getDocumentsForCase,
  saveDocument,
  getRequiredItemsForCase,
  saveRequiredItem,
  getIncomeSourcesForCase,
  saveIncomeSource,
  getAssetAccountsForCase,
  getDepositReviewsForCase,
  saveDepositReview,
  getUtilityAllowanceForCase,
  saveUtilityAllowance,
  getAiReviewForCase,
  runChecklistReview,
  getClarificationsForCase,
  saveClarificationRequest,
  buildClarificationMessage,
  getAuditEventsForCase,
  logAuditEvent,
  computeReadinessScore,
  computeUtilityAllowance,
  computeIncomeMethods,
  computeAssetIncome,
  buildSubmissionEmailDraft,
  HUD_PASSBOOK_RATE_2026,
  ASSET_THRESHOLD_2026,
} from "@/lib/services/recertification";
import type {
  RecertificationCase,
  RecertCaseStatus,
  RecertHouseholdMember,
  RecertDocument,
  RecertRequiredItem,
  RecertIncomeSource,
  RecertAssetAccount,
  RecertDepositReview,
  RecertUtilityAllowance,
  RecertAiReview,
  RecertClarificationRequest,
  RecertAuditEvent,
} from "@/lib/types";

// ── Constants ─────────────────────────────────────────────────────────────────

// Sprint 23: Simplified 3-step workflow. Old tabs moved to Advanced accordion.
const PRIMARY_TABS = [
  { key: "tenant-doc",  label: "Tenant Recertification Doc" },
  { key: "manager-doc", label: "Managerial Recertification Doc" },
  { key: "combine",     label: "Combine / Final Submission" },
] as const;

const ADVANCED_TABS = [
  { key: "overview",       label: "Overview" },
  { key: "household",      label: "Household" },
  { key: "documents",      label: "Documents" },
  { key: "review",         label: "Checklist Review" },
  { key: "income",         label: "Income" },
  { key: "assets",         label: "Assets / Deposits" },
  { key: "rent",           label: "Rent + Utility" },
  { key: "clarifications", label: "Clarifications" },
  { key: "audit",          label: "Audit Trail" },
] as const;

type PrimaryTabKey = typeof PRIMARY_TABS[number]["key"];
type AdvancedTabKey = typeof ADVANCED_TABS[number]["key"];
type TabKey = PrimaryTabKey | AdvancedTabKey;

const STATUS_LABEL: Record<RecertCaseStatus, string> = {
  not_started: "Not Started",
  tenant_request_sent: "Request Sent",
  waiting_on_tenant: "Waiting on Tenant",
  documents_uploaded: "Docs Uploaded",
  ai_review_needed: "Review Needed",
  missing_items: "Missing Items",
  clarification_needed: "Clarification Needed",
  manager_calculation_review: "Manager Calc Review",
  ready_to_submit: "Ready to Submit",
  submitted: "Submitted",
  approved: "Approved",
  corrections_needed: "Corrections Needed",
  closed_ineligible: "Closed / Ineligible",
};

const STATUS_COLOR: Record<RecertCaseStatus, string> = {
  not_started:                 "bg-gray-100 text-gray-700 border-gray-200",
  tenant_request_sent:         "bg-blue-100 text-blue-700 border-blue-200",
  waiting_on_tenant:           "bg-yellow-100 text-yellow-700 border-yellow-200",
  documents_uploaded:          "bg-blue-100 text-blue-700 border-blue-200",
  ai_review_needed:            "bg-purple-100 text-purple-700 border-purple-200",
  missing_items:               "bg-red-100 text-red-700 border-red-200",
  clarification_needed:        "bg-orange-100 text-orange-700 border-orange-200",
  manager_calculation_review:  "bg-indigo-100 text-indigo-700 border-indigo-200",
  ready_to_submit:             "bg-green-100 text-green-700 border-green-200",
  submitted:                   "bg-teal-100 text-teal-700 border-teal-200",
  approved:                    "bg-emerald-100 text-emerald-700 border-emerald-200",
  corrections_needed:          "bg-red-100 text-red-700 border-red-200",
  closed_ineligible:           "bg-gray-100 text-gray-500 border-gray-200",
};

const ALL_STATUSES = Object.keys(STATUS_LABEL) as RecertCaseStatus[];

const CERT_TYPE_LABEL: Record<string, string> = {
  initial: "Initial Certification",
  annual: "Annual Recertification",
  move_in: "Move-In Certification",
  correction: "Correction",
};

const DOC_TYPE_LABEL: Record<string, string> = {
  ticq: "TICQ",
  pay_stub: "Pay Stub",
  bank_statement: "Bank Statement",
  asset_statement: "Asset Statement",
  benefit_letter: "Benefit Letter",
  social_security_award_letter: "SS Award Letter",
  unemployment_document: "Unemployment Doc",
  self_employment_document: "Self-Employment Doc",
  voe: "VOE",
  applicant_statement: "Applicant Statement",
  conflict_of_interest: "Conflict of Interest",
  asset_certification: "Asset Certification",
  clarification: "Clarification",
  rent_determination: "Rent Determination",
  utility_allowance_table: "Utility Allowance Table",
  covenant: "Covenant",
  rent_schedule: "Rent Schedule",
  other: "Other",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt$(n: number | undefined | null): string {
  if (n == null) return "—";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtPct(n: number | undefined | null): string {
  if (n == null) return "—";
  return (n * 100).toFixed(2) + "%";
}

function fmtDate(s: string | undefined | null): string {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }); }
  catch { return s; }
}

function fmtDateTime(s: string | undefined | null): string {
  if (!s) return "—";
  try { return new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return s; }
}

function readinessBar(score: number) {
  const bg = score >= 100 ? "bg-emerald-500" : score >= 70 ? "bg-green-400" : score >= 40 ? "bg-yellow-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-gray-200">
        <div className={`h-2 rounded-full transition-all ${bg}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-semibold w-9 text-right">{score}%</span>
    </div>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${color}`}>{label}</span>;
}

function SectionNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm">
      <span>⚠️</span><span>{children}</span>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function RecertCaseDetailPage() {
  const params = useParams();
  const caseId = typeof params.caseId === "string" ? params.caseId : Array.isArray(params.caseId) ? params.caseId[0] : "";

  const [activeTab, setActiveTab] = useState<TabKey>("tenant-doc");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [recertCase, setRecertCase] = useState<RecertificationCase | null>(null);
  const [members, setMembers] = useState<RecertHouseholdMember[]>([]);
  const [documents, setDocuments] = useState<RecertDocument[]>([]);
  const [requiredItems, setRequiredItems] = useState<RecertRequiredItem[]>([]);
  const [incomeSources, setIncomeSources] = useState<RecertIncomeSource[]>([]);
  const [assetAccounts, setAssetAccounts] = useState<RecertAssetAccount[]>([]);
  const [depositReviews, setDepositReviews] = useState<RecertDepositReview[]>([]);
  const [utilityAllowance, setUtilityAllowance] = useState<RecertUtilityAllowance | null>(null);
  const [aiReview, setAiReview] = useState<RecertAiReview | null>(null);
  const [clarifications, setClarifications] = useState<RecertClarificationRequest[]>([]);
  const [auditEvents, setAuditEvents] = useState<RecertAuditEvent[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewRunning, setReviewRunning] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const loadAll = useCallback(async () => {
    if (!caseId) return;
    setLoading(true);
    setError(null);
    try {
      const [c, m, docs, items, inc, assets, deps, ua, air, clars, audit] = await Promise.all([
        getCaseById(caseId),
        getMembersForCase(caseId),
        getDocumentsForCase(caseId),
        getRequiredItemsForCase(caseId),
        getIncomeSourcesForCase(caseId),
        getAssetAccountsForCase(caseId),
        getDepositReviewsForCase(caseId),
        getUtilityAllowanceForCase(caseId),
        getAiReviewForCase(caseId),
        getClarificationsForCase(caseId),
        getAuditEventsForCase(caseId),
      ]);
      if (!c) { setError("Case not found."); return; }
      setRecertCase(c);
      setMembers(m);
      setDocuments(docs);
      setRequiredItems(items);
      setIncomeSources(inc);
      setAssetAccounts(assets);
      setDepositReviews(deps);
      setUtilityAllowance(ua ?? null);
      setAiReview(air ?? null);
      setClarifications(clars);
      setAuditEvents(audit);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // ── Status update ──────────────────────────────────────────────────────────

  async function handleStatusChange(status: RecertCaseStatus) {
    if (!recertCase) return;
    setSaving(true);
    try {
      const updated = await saveCase({ ...recertCase, caseStatus: status });
      setRecertCase(updated);
      await logAuditEvent(caseId, "status_change", `Status changed to: ${STATUS_LABEL[status]}`);
      await loadAll();
    } finally { setSaving(false); }
  }

  // ── Run checklist review ───────────────────────────────────────────────────

  async function handleRunReview() {
    if (!recertCase) return;
    setReviewRunning(true);
    try {
      const result = await runChecklistReview(caseId, members, requiredItems, depositReviews, incomeSources);
      setAiReview(result);
      await logAuditEvent(caseId, "checklist_review_run",
        `Checklist review ran: ${result.reviewStatus}. ${result.issuesJson.length} issue(s) found.`);
    } finally { setReviewRunning(false); }
  }

  // ── Toggle required item status ────────────────────────────────────────────

  async function toggleRequiredItem(item: RecertRequiredItem, status: RecertRequiredItem["status"]) {
    setSaving(true);
    try {
      const updated = await saveRequiredItem({ ...item, status });
      setRequiredItems(prev => prev.map(r => r.id === updated.id ? updated : r));
    } finally { setSaving(false); }
  }

  // ── Manager-approve income ─────────────────────────────────────────────────

  async function handleApproveIncome(src: RecertIncomeSource) {
    setSaving(true);
    try {
      const updated = await saveIncomeSource({
        ...src,
        managerApproved: true,
        managerApprovedAt: new Date().toISOString(),
      });
      setIncomeSources(prev => prev.map(s => s.id === updated.id ? updated : s));
      await logAuditEvent(caseId, "income_approved",
        `Income approved: ${src.employerOrSourceName ?? src.incomeType}. Projected: ${fmt$(src.requiredProjectedIncome)}`);
    } finally { setSaving(false); }
  }

  // ── Send clarification ─────────────────────────────────────────────────────

  async function handleSendClarification(cr: RecertClarificationRequest) {
    setSaving(true);
    try {
      const updated = await saveClarificationRequest({ ...cr, status: "sent", sentAt: new Date().toISOString() });
      setClarifications(prev => prev.map(c => c.id === updated.id ? updated : c));
      await logAuditEvent(caseId, "clarification_sent",
        `Clarification request sent to tenant.`);
    } finally { setSaving(false); }
  }

  // ── Mark submitted ─────────────────────────────────────────────────────────

  async function handleMarkSubmitted() {
    if (!recertCase) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const updated = await saveCase({ ...recertCase, caseStatus: "submitted", submittedAt: now });
      setRecertCase(updated);
      await logAuditEvent(caseId, "submitted", "Package marked as submitted to Urban Futures (cert@ufbahc.com).");
      await loadAll();
    } finally { setSaving(false); }
  }

  // ── Copy email to clipboard ───────────────────────────────────────────────

  async function handleCopyEmail() {
    if (!recertCase) return;
    const draft = buildSubmissionEmailDraft(recertCase);
    await navigator.clipboard.writeText(`To: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.body}`);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2500);
  }

  // ── Loading / error states ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading case…</div>
      </div>
    );
  }

  if (error || !recertCase) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <Link href="/recertification" className="text-sm text-blue-600 hover:underline">← Back to Recertification</Link>
        <div className="mt-4 text-red-600">{error ?? "Case not found."}</div>
      </div>
    );
  }

  const score = computeReadinessScore(requiredItems, members, incomeSources, aiReview ?? undefined);
  const missingCount = requiredItems.filter(r => r.status === "missing" || r.status === "needs_clarification").length;
  const draftEmail = buildSubmissionEmailDraft(recertCase);

  // Navigate to a tab, collapsing advanced section if navigating to a primary tab
  function navigateTo(tab: TabKey) {
    setActiveTab(tab);
    if (PRIMARY_TABS.some(t => t.key === tab)) setShowAdvanced(false);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Page header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
            <Link href="/recertification" className="hover:text-blue-600">Recertification</Link>
            <span>/</span>
            <span className="text-gray-900 font-medium">{recertCase.primaryTenantName}</span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{recertCase.primaryTenantName}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-gray-500">
                <span>Unit {recertCase.unitNumber ?? "—"}</span>
                <span>·</span>
                <span>{CERT_TYPE_LABEL[recertCase.certificationType] ?? recertCase.certificationType}</span>
                {recertCase.dueDate && (
                  <>
                    <span>·</span>
                    <span className={new Date(recertCase.dueDate) < new Date() ? "text-red-600 font-semibold" : ""}>
                      Due {fmtDate(recertCase.dueDate)}
                    </span>
                  </>
                )}
                <span>·</span>
                <Pill label={STATUS_LABEL[recertCase.caseStatus]} color={STATUS_COLOR[recertCase.caseStatus]} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-xs text-gray-500 mb-0.5">Readiness</div>
                <div className="w-40">{readinessBar(score)}</div>
              </div>
              {missingCount > 0 && (
                <span className="text-xs font-semibold bg-red-100 text-red-700 border border-red-200 rounded-full px-2.5 py-1">
                  {missingCount} missing
                </span>
              )}
            </div>
          </div>

          {/* Warning banner */}
          {recertCase.caseStatus !== "approved" && recertCase.caseStatus !== "submitted" && (
            <div className="mt-3 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
              ⚠️ Tenant cannot move in until certification package is complete and approved.
              Incomplete packages will not be reviewed. Complete packages receive determination within 10 business days.
            </div>
          )}
        </div>
      </div>

      {/* Tab bar — Sprint 23: 3 primary steps + Advanced accordion */}
      <div className="bg-white border-b border-gray-200 px-6">
        <div className="max-w-7xl mx-auto">
          {/* Primary workflow tabs */}
          <nav className="-mb-px flex items-center gap-1 overflow-x-auto">
            {PRIMARY_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => { setActiveTab(tab.key); setShowAdvanced(false); }}
                className={`whitespace-nowrap px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${
                  (activeTab as string) === tab.key
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                {tab.key === "tenant-doc"  ? "1. " : tab.key === "manager-doc" ? "2. " : "3. "}
                {tab.label}
              </button>
            ))}
            <div className="ml-auto flex-shrink-0 border-l border-gray-200 pl-3">
              <button
                onClick={() => {
                  const isAdv = ADVANCED_TABS.some(t => t.key === activeTab);
                  if (showAdvanced || isAdv) {
                    setShowAdvanced(false);
                    if (isAdv) setActiveTab("tenant-doc");
                  } else {
                    setShowAdvanced(true);
                    setActiveTab("overview");
                  }
                }}
                className={`whitespace-nowrap px-3 py-3 text-xs font-medium border-b-2 transition-colors ${
                  showAdvanced || ADVANCED_TABS.some(t => t.key === activeTab)
                    ? "border-slate-400 text-slate-600"
                    : "border-transparent text-slate-400 hover:text-slate-600"
                }`}
              >
                Advanced / Audit Details {(showAdvanced || ADVANCED_TABS.some(t => t.key === activeTab)) ? "▲" : "▼"}
              </button>
            </div>
          </nav>
          {/* Advanced tab bar — shown when expanded or when an advanced tab is active */}
          {(showAdvanced || ADVANCED_TABS.some(t => t.key === activeTab)) && (
            <nav className="-mb-px flex gap-1 overflow-x-auto border-t border-slate-100 pt-0.5 bg-slate-50">
              {ADVANCED_TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`whitespace-nowrap px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                    activeTab === tab.key
                      ? "border-slate-600 text-slate-700 bg-white"
                      : "border-transparent text-gray-400 hover:text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {tab.label}
                  {tab.key === "review" && aiReview?.reviewStatus === "not_ready" && (
                    <span className="ml-1 text-xs text-red-500">●</span>
                  )}
                  {tab.key === "documents" && missingCount > 0 && (
                    <span className="ml-1 text-xs bg-red-100 text-red-600 rounded-full px-1.5 py-0">{missingCount}</span>
                  )}
                </button>
              ))}
            </nav>
          )}
        </div>
      </div>

      {/* Tab content */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        {activeTab === "tenant-doc"  && <TenantDocTab caseId={caseId} recertCase={recertCase} />}
        {activeTab === "manager-doc" && <ManagerDocTab caseId={caseId} recertCase={recertCase} />}
        {activeTab === "combine"     && <CombineTab {...{ caseId, recertCase, score, requiredItems, incomeSources, members, aiReview, draftEmail, saving, copySuccess, handleCopyEmail, handleMarkSubmitted }} />}
        {activeTab === "overview"    && <OverviewTab {...{ recertCase, score, members, requiredItems, incomeSources, aiReview, missingCount, saving, handleStatusChange, setActiveTab: navigateTo }} />}
        {activeTab === "household"   && <HouseholdTab {...{ members, saving, setSaving, caseId, setMembers, loadAll }} />}
        {activeTab === "documents"   && <DocumentsTab {...{ documents, requiredItems, saving, setSaving, caseId, setDocuments, toggleRequiredItem }} />}
        {activeTab === "review"      && <ReviewTab {...{ aiReview, reviewRunning, handleRunReview, setActiveTab: navigateTo }} />}
        {activeTab === "income"      && <IncomeTab {...{ incomeSources, saving, handleApproveIncome }} />}
        {activeTab === "assets"      && <AssetsTab {...{ assetAccounts, depositReviews, saving, setSaving, setDepositReviews }} />}
        {activeTab === "rent"        && <RentTab {...{ utilityAllowance, saving, setSaving, caseId, setUtilityAllowance, logAuditEvent: (t: string, s: string) => logAuditEvent(caseId, t, s) }} />}
        {activeTab === "clarifications" && <ClarificationsTab {...{ clarifications, aiReview, recertCase, saving, setClarifications, handleSendClarification, caseId }} />}
        {activeTab === "audit"       && <AuditTab {...{ auditEvents }} />}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Sprint 23: Primary Workflow Tabs
// ════════════════════════════════════════════════════════════════════════════

type SessionRow = { status: string; submitted_at?: string; submitted_by?: string } | null;

function TenantDocTab({ caseId, recertCase }: { caseId: string; recertCase: RecertificationCase }) {
  const [session, setSession] = useState<SessionRow>(null);
  useEffect(() => {
    loadSession(caseId, "tenant").then(s => setSession(s as SessionRow));
  }, [caseId]);
  const submitted = session?.status === "submitted";

  return (
    <div className="space-y-5 max-w-3xl">
      <div className={`rounded-xl border px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${submitted ? "bg-emerald-50 border-emerald-200" : "bg-slate-50 border-slate-200"}`}>
        <div>
          <div className="text-sm font-semibold text-slate-800">
            {submitted ? "✓ Tenant form submitted" : "Tenant form not yet submitted"}
          </div>
          {session?.submitted_at && (
            <div className="text-xs text-slate-500 mt-0.5">
              Submitted {fmtDateTime(session.submitted_at)}{session.submitted_by ? ` by ${session.submitted_by}` : ""}
            </div>
          )}
          {!session && <div className="text-xs text-slate-400 mt-0.5">No session yet — form not started</div>}
        </div>
        <a
          href={`/recertification/${caseId}/tenant-doc`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-lg"
        >
          Open Tenant Recertification Doc →
        </a>
      </div>
      <p className="text-sm text-slate-600">
        The tenant completes their portion of the LAHD recertification questionnaire online.
        Staff can also use the offline workflow below for tenants without reliable internet access.
      </p>
      <OfflineTenantFormPanel caseId={caseId} />
    </div>
  );
}

function ManagerDocTab({ caseId, recertCase }: { caseId: string; recertCase: RecertificationCase }) {
  const [session, setSession] = useState<SessionRow>(null);
  useEffect(() => {
    loadSession(caseId, "manager").then(s => setSession(s as SessionRow));
  }, [caseId]);
  const submitted = session?.status === "submitted";

  return (
    <div className="space-y-5 max-w-3xl">
      <div className={`rounded-xl border px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${submitted ? "bg-emerald-50 border-emerald-200" : "bg-slate-50 border-slate-200"}`}>
        <div>
          <div className="text-sm font-semibold text-slate-800">
            {submitted ? "✓ Manager form submitted" : "Manager form not yet submitted"}
          </div>
          {session?.submitted_at && (
            <div className="text-xs text-slate-500 mt-0.5">
              Submitted {fmtDateTime(session.submitted_at)}{session.submitted_by ? ` by ${session.submitted_by}` : ""}
            </div>
          )}
          {!session && <div className="text-xs text-slate-400 mt-0.5">No session yet — form not started</div>}
        </div>
        <a
          href={`/recertification/${caseId}/manager-doc`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 px-5 py-2.5 bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold rounded-lg"
        >
          Open Managerial Recertification Doc →
        </a>
      </div>
      <p className="text-sm text-slate-600">
        The property manager or authorized agent completes the owner/agent portions of the LAHD recertification.
        This includes rent determination, compliance certifications, and manager signatures.
      </p>
    </div>
  );
}

function CombineTab({
  caseId, recertCase, score, requiredItems, incomeSources, members, aiReview,
  draftEmail, saving, copySuccess, handleCopyEmail, handleMarkSubmitted,
}: {
  caseId: string;
  recertCase: RecertificationCase;
  score: number;
  requiredItems: RecertRequiredItem[];
  incomeSources: RecertIncomeSource[];
  members: RecertHouseholdMember[];
  aiReview: RecertAiReview | null;
  draftEmail: { subject: string; body: string; to: string };
  saving: boolean;
  copySuccess: boolean;
  handleCopyEmail: () => Promise<void>;
  handleMarkSubmitted: () => Promise<void>;
}) {
  const { profile, authUser } = useAuth();
  const [tenantSession, setTenantSession] = useState<SessionRow>(null);
  const [managerSession, setManagerSession] = useState<SessionRow>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [filledCount, setFilledCount] = useState(0);
  const [blankCount, setBlankCount] = useState(0);

  useEffect(() => {
    loadSession(caseId, "tenant").then(s => setTenantSession(s as SessionRow));
    loadSession(caseId, "manager").then(s => setManagerSession(s as SessionRow));
  }, [caseId]);

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
      setPdfUrl(URL.createObjectURL(blob));
      setFilledCount(Number(res.headers.get("X-Filled-Count") ?? 0));
      setBlankCount(Number(res.headers.get("X-Blank-Count") ?? 0));
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  const tenantSubmitted = tenantSession?.status === "submitted";
  const managerSubmitted = managerSession?.status === "submitted";
  const adults = members.filter(m => m.isAdult);
  const allSigned = adults.every(m => m.ticqSigned && m.applicantStatementSigned && m.conflictOfInterestSigned);
  const allItemsComplete = requiredItems.every(r => r.status === "complete" || r.status === "not_applicable");
  const allIncomeApproved = incomeSources.every(s => s.managerApproved);

  const blockers: string[] = [
    !tenantSubmitted ? "Tenant recertification form not yet submitted" : null,
    !managerSubmitted ? "Managerial recertification form not yet submitted" : null,
    !allSigned ? "Missing adult household signatures (TICQ, Applicant Statement, COI)" : null,
    !allItemsComplete ? "Not all required checklist items are complete" : null,
    !allIncomeApproved ? "Not all income sources are manager-approved" : null,
  ].filter(Boolean) as string[];

  const safeName = (s: string) => s.replace(/[^a-z0-9]/gi, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  const downloadFilename = `LAHD-recert-${safeName(recertCase.primaryTenantName ?? "Tenant")}-unit-${safeName(recertCase.unitNumber ?? "0")}-FINAL-SUBMISSION.pdf`;

  return (
    <div className="space-y-6">
      {/* Step status */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { label: "Tenant Recertification Doc", session: tenantSession, href: `/recertification/${caseId}/tenant-doc`, color: "emerald" as const },
          { label: "Managerial Recertification Doc", session: managerSession, href: `/recertification/${caseId}/manager-doc`, color: "sky" as const },
        ].map(({ label, session, href, color }) => {
          const done = session?.status === "submitted";
          const bg = done ? (color === "emerald" ? "bg-emerald-50 border-emerald-200" : "bg-sky-50 border-sky-200") : "bg-slate-50 border-slate-200";
          return (
            <div key={label} className={`rounded-xl border px-4 py-3 flex items-center justify-between gap-3 ${bg}`}>
              <div>
                <div className={`text-xs font-semibold ${done ? (color === "emerald" ? "text-emerald-800" : "text-sky-800") : "text-slate-600"}`}>
                  {done ? "✓" : "○"} {label}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {done ? `Submitted ${fmtDateTime(session?.submitted_at ?? "")}` : "Not yet submitted"}
                </div>
              </div>
              {!done && (
                <a href={href} target="_blank" rel="noopener noreferrer"
                  className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:border-slate-500 bg-white">
                  Open →
                </a>
              )}
            </div>
          );
        })}
      </div>

      {/* Offline tenant form import */}
      <OfflineTenantFormPanel caseId={caseId} />

      {/* Blockers */}
      {blockers.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
          <h3 className="text-sm font-bold text-amber-900 mb-2">
            ⚠ Resolve before generating the final PDF:
          </h3>
          <ul className="space-y-1">
            {blockers.map(b => (
              <li key={b} className="flex items-start gap-2 text-sm text-amber-800">
                <span className="text-amber-400 mt-0.5 flex-shrink-0">○</span>{b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Generate PDF */}
      <div className={`rounded-xl border-2 px-5 py-4 ${blockers.length === 0 ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white"}`}>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <h3 className={`text-base font-bold ${blockers.length === 0 ? "text-emerald-900" : "text-slate-800"}`}>
              Generate Final LAHD Submission Packet
            </h3>
            <p className="text-xs text-slate-600 mt-1 max-w-2xl">
              Merges tenant + manager answers into the official LAHD recertification PDF using the original AcroForm
              field names. Embeds signatures in all required official signature locations.
              Output file: <code className="font-mono text-slate-700">{downloadFilename}</code>
            </p>
            {blockers.length > 0 && (
              <p className="text-[11px] text-amber-700 mt-1 italic">
                {blockers.length} item{blockers.length === 1 ? "" : "s"} above incomplete — PDF will be missing data if generated now.
              </p>
            )}
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex-shrink-0 px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold rounded-lg disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate Final PDF"}
          </button>
        </div>
      </div>

      {pdfError && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 font-mono whitespace-pre-wrap">{pdfError}</div>
      )}

      {/* PDF preview + download */}
      {pdfUrl && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm font-semibold text-emerald-700">
              ✓ PDF ready — {filledCount} fields filled · {blankCount} blanks
            </div>
            <a
              href={pdfUrl}
              download={downloadFilename}
              className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold rounded-lg"
            >
              Download Final Submission PDF ↓
            </a>
          </div>
          <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <iframe src={pdfUrl} className="w-full" style={{ height: "80vh", border: 0 }} title="Final LAHD Submission PDF" />
          </div>
        </div>
      )}

      {/* Readiness gate */}
      <div className={`rounded-xl border px-4 py-4 ${score >= 100 ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className={`text-sm font-bold ${score >= 100 ? "text-green-800" : "text-amber-800"}`}>
              {score >= 100 ? "✓ Package appears ready for submission" : "⚠ Package not ready — resolve items above"}
            </h3>
            <p className="text-xs text-gray-600 mt-1">
              Readiness score: <strong>{score}%</strong>.
              Incomplete packages will not be reviewed. Complete packages receive a determination within 10 business days.
            </p>
          </div>
          {readinessBar(score)}
        </div>
      </div>

      {/* Submission email draft */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Submission Email Draft</h3>
          <button
            onClick={handleCopyEmail}
            className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${copySuccess ? "bg-green-50 text-green-700 border-green-200" : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"}`}
          >
            {copySuccess ? "✓ Copied!" : "Copy to Clipboard"}
          </button>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <div className="flex gap-2">
            <span className="text-gray-400 w-14 flex-shrink-0">To:</span>
            <span className="font-mono text-blue-700 font-semibold">{draftEmail.to}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-400 w-14 flex-shrink-0">Subject:</span>
            <span className="text-gray-800 font-medium">{draftEmail.subject}</span>
          </div>
          <div className="border-t border-gray-100 pt-3">
            <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed bg-gray-50 rounded-lg p-3 border border-gray-100">
              {draftEmail.body}
            </pre>
          </div>
        </div>
      </div>

      {/* Mark submitted */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="text-sm text-gray-600">
          {recertCase.submittedAt
            ? `Submitted on ${fmtDateTime(recertCase.submittedAt)}`
            : "When you have sent the email and attached all documents, mark the case as submitted."}
        </div>
        {recertCase.caseStatus !== "submitted" && recertCase.caseStatus !== "approved" && (
          <button
            onClick={handleMarkSubmitted}
            disabled={saving}
            className={`px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-colors ${saving ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {saving ? "Saving…" : "Mark as Submitted"}
          </button>
        )}
        {(recertCase.caseStatus === "submitted" || recertCase.caseStatus === "approved") && (
          <span className="text-sm font-semibold text-emerald-600">
            ✓ {recertCase.caseStatus === "approved" ? "Approved" : "Submitted"}
          </span>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Tab: Overview
// ════════════════════════════════════════════════════════════════════════════

function OverviewTab({
  recertCase, score, members, requiredItems, incomeSources, aiReview,
  missingCount, saving, handleStatusChange, setActiveTab,
}: {
  recertCase: RecertificationCase;
  score: number;
  members: RecertHouseholdMember[];
  requiredItems: RecertRequiredItem[];
  incomeSources: RecertIncomeSource[];
  aiReview: RecertAiReview | null;
  missingCount: number;
  saving: boolean;
  handleStatusChange: (s: RecertCaseStatus) => Promise<void>;
  setActiveTab: (t: TabKey) => void;
}) {
  const [statusOpen, setStatusOpen] = useState(false);

  return (
    <div className="space-y-6">
      {/* Key numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Max Income Limit",   value: fmt$(recertCase.maxIncomeLimit) },
          { label: "Max Allowable Rent", value: fmt$(recertCase.maxAllowableRent) },
          { label: "Utility Allowance",  value: recertCase.utilityAllowanceRequired ? fmt$(recertCase.totalUtilityAllowance) : "N/A" },
          { label: "Tenant Rent Limit",  value: fmt$(recertCase.calculatedTenantRentLimit) },
          { label: "Proposed Rent",      value: fmt$(recertCase.proposedTenantRent) },
          { label: "Subsidy Amount",     value: recertCase.subsidyAmount ? fmt$(recertCase.subsidyAmount) : "None" },
        ].map(item => (
          <div key={item.label} className="bg-white border border-gray-200 rounded-xl p-3">
            <div className="text-xs text-gray-500 mb-1">{item.label}</div>
            <div className="text-lg font-bold text-gray-900">{item.value}</div>
          </div>
        ))}
      </div>

      {/* Status cards row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Case info */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">Case Info</h3>
          <div className="text-xs space-y-1 text-gray-600">
            <div><span className="text-gray-400">ID:</span> {recertCase.id}</div>
            <div><span className="text-gray-400">Property:</span> {recertCase.propertyName}</div>
            <div><span className="text-gray-400">Unit:</span> {recertCase.unitNumber ?? "—"}</div>
            <div><span className="text-gray-400">Bedrooms:</span> {recertCase.bedroomCount ?? "—"}</div>
            <div><span className="text-gray-400">Covenant:</span> {recertCase.restrictedUnitSchedule ?? "—"}</div>
            <div><span className="text-gray-400">Email:</span> {recertCase.primaryTenantEmail ?? "—"}</div>
            <div><span className="text-gray-400">Phone:</span> {recertCase.primaryTenantPhone ?? "—"}</div>
          </div>
        </div>

        {/* Household */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">Household</h3>
          <div className="text-xs space-y-1 text-gray-600">
            <div><span className="text-gray-400">Size:</span> {recertCase.householdSize ?? "—"}</div>
            <div><span className="text-gray-400">Adults:</span> {recertCase.adultCount}</div>
            <div><span className="text-gray-400">Children:</span> {recertCase.childCount}</div>
            <div><span className="text-gray-400">Members loaded:</span> {members.length}</div>
          </div>
          <button onClick={() => setActiveTab("household")} className="text-xs text-blue-600 hover:underline">View household →</button>
        </div>

        {/* Checklist status */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">Checklist</h3>
          <div className="text-xs space-y-1 text-gray-600">
            <div><span className="text-gray-400">Required items:</span> {requiredItems.length}</div>
            <div><span className="text-gray-400">Complete:</span> {requiredItems.filter(r => r.status === "complete").length}</div>
            <div className="text-red-600"><span className="text-gray-400">Missing:</span> {missingCount}</div>
            <div><span className="text-gray-400">Review:</span> {aiReview?.reviewStatus ?? "not run"}</div>
          </div>
          <button onClick={() => setActiveTab("documents")} className="text-xs text-blue-600 hover:underline">View documents →</button>
        </div>

        {/* Risk + subsidy */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">Risk + Subsidy</h3>
          <div className="text-xs space-y-1 text-gray-600">
            <div><span className="text-gray-400">Risk level:</span> <span className={`font-semibold ${recertCase.riskLevel === "high" || recertCase.riskLevel === "critical" ? "text-red-600" : "text-gray-700"}`}>{recertCase.riskLevel}</span></div>
            <div><span className="text-gray-400">Income status:</span> {recertCase.incomeStatus}</div>
            <div><span className="text-gray-400">Rent status:</span> {recertCase.rentStatus}</div>
            <div><span className="text-gray-400">Subsidy:</span> {recertCase.subsidyStatus.replace(/_/g, " ")}</div>
            <div><span className="text-gray-400">Last contact:</span> {fmtDate(recertCase.lastTenantContactAt)}</div>
          </div>
        </div>
      </div>

      {/* Next action */}
      {recertCase.nextAction && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
          <span className="font-semibold">Next action: </span>{recertCase.nextAction}
        </div>
      )}

      {/* Status update */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Update Status</h3>
        <div className="flex flex-wrap gap-2">
          {ALL_STATUSES.map(s => (
            <button
              key={s}
              onClick={() => handleStatusChange(s)}
              disabled={saving || recertCase.caseStatus === s}
              className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all
                ${recertCase.caseStatus === s ? STATUS_COLOR[s] + " cursor-default" : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"}
                ${saving ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Quick actions */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Quick Actions</h3>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "View Household", tab: "household" as TabKey },
            { label: "Upload / Check Docs", tab: "documents" as TabKey },
            { label: "Run Checklist Review", tab: "review" as TabKey },
            { label: "Calculate Income", tab: "income" as TabKey },
            { label: "Check Assets", tab: "assets" as TabKey },
            { label: "Rent + Utility Calc", tab: "rent" as TabKey },
            { label: "Generate Clarification", tab: "clarifications" as TabKey },
            { label: "Combine & Submit", tab: "combine" as TabKey },
          ].map(a => (
            <button
              key={a.tab}
              onClick={() => setActiveTab(a.tab)}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors"
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Tab: Household
// ════════════════════════════════════════════════════════════════════════════

function HouseholdTab({
  members, saving, setSaving, caseId, setMembers, loadAll,
}: {
  members: RecertHouseholdMember[];
  saving: boolean;
  setSaving: (v: boolean) => void;
  caseId: string;
  setMembers: (m: RecertHouseholdMember[]) => void;
  loadAll: () => Promise<void>;
}) {
  const adults = members.filter(m => m.isAdult);
  const children = members.filter(m => !m.isAdult);

  async function toggleSig(
    member: RecertHouseholdMember,
    field: "ticqSigned" | "applicantStatementSigned" | "conflictOfInterestSigned",
  ) {
    setSaving(true);
    try {
      const updated = await saveMember({ ...member, [field]: !member[field] });
      setMembers(members.map(m => m.id === updated.id ? updated : m));
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-6">
      <SectionNote>
        All adults (18+) must sign TICQ, Applicant Statement, and Conflict of Interest forms.
        Required before package submission.
      </SectionNote>

      {/* Adults */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-700">Adults ({adults.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-500">
                <th className="text-left px-4 py-2">Name</th>
                <th className="text-left px-4 py-2">Relationship</th>
                <th className="text-center px-4 py-2">TICQ Signed</th>
                <th className="text-center px-4 py-2">Applicant Stmt</th>
                <th className="text-center px-4 py-2">COI Signed</th>
              </tr>
            </thead>
            <tbody>
              {adults.map(m => (
                <tr key={m.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-3 font-medium text-gray-900">{m.fullName}</td>
                  <td className="px-4 py-3 text-gray-600 capitalize">{m.relationshipToHead ?? "—"}</td>
                  {(["ticqSigned", "applicantStatementSigned", "conflictOfInterestSigned"] as const).map(field => (
                    <td key={field} className="px-4 py-3 text-center">
                      <button
                        onClick={() => toggleSig(m, field)}
                        disabled={saving}
                        className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                          m[field]
                            ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                            : "bg-red-50 text-red-600 border-red-200 hover:bg-red-100"
                        } ${saving ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        {m[field] ? "✓ Signed" : "✗ Missing"}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
              {adults.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400 text-sm">No adult members on record.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Children */}
      {children.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <h3 className="text-sm font-semibold text-gray-700">Children / Minors ({children.length})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-500">
                  <th className="text-left px-4 py-2">Name</th>
                  <th className="text-left px-4 py-2">Relationship</th>
                </tr>
              </thead>
              <tbody>
                {children.map(m => (
                  <tr key={m.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3 font-medium text-gray-900">{m.fullName}</td>
                    <td className="px-4 py-3 text-gray-600 capitalize">{m.relationshipToHead ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Tab: Documents
// ════════════════════════════════════════════════════════════════════════════

function DocumentsTab({
  documents, requiredItems, saving, setSaving, caseId, setDocuments, toggleRequiredItem,
}: {
  documents: RecertDocument[];
  requiredItems: RecertRequiredItem[];
  saving: boolean;
  setSaving: (v: boolean) => void;
  caseId: string;
  setDocuments: (d: RecertDocument[]) => void;
  toggleRequiredItem: (item: RecertRequiredItem, status: RecertRequiredItem["status"]) => Promise<void>;
}) {
  const missing = requiredItems.filter(r => r.status === "missing" || r.status === "needs_clarification");
  const complete = requiredItems.filter(r => r.status === "complete");
  const notStarted = requiredItems.filter(r => r.status === "not_started" || r.status === "requested" || r.status === "uploaded" || r.status === "reviewed");

  const STATUS_ITEM_COLOR: Record<string, string> = {
    complete: "text-green-700 bg-green-50 border-green-200",
    missing: "text-red-600 bg-red-50 border-red-200",
    needs_clarification: "text-orange-600 bg-orange-50 border-orange-200",
    not_started: "text-gray-500 bg-gray-50 border-gray-200",
    requested: "text-blue-600 bg-blue-50 border-blue-200",
    uploaded: "text-indigo-600 bg-indigo-50 border-indigo-200",
    reviewed: "text-purple-600 bg-purple-50 border-purple-200",
    not_applicable: "text-gray-400 bg-gray-50 border-gray-200",
  };

  const ALL_ITEM_STATUSES: RecertRequiredItem["status"][] = [
    "not_started", "requested", "uploaded", "reviewed", "complete", "missing", "needs_clarification", "not_applicable",
  ];

  return (
    <div className="space-y-6">
      {/* Required items checklist */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Required Items Checklist</h3>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="text-green-600 font-semibold">{complete.length} complete</span>
            {missing.length > 0 && <span className="text-red-600 font-semibold">{missing.length} missing/unclear</span>}
            <span>{notStarted.length} in progress</span>
          </div>
        </div>
        <div className="divide-y divide-gray-50">
          {requiredItems.map(item => (
            <div key={item.id} className="px-4 py-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-gray-900">{item.requirementLabel}</div>
                <div className="text-xs text-gray-500 mt-0.5 capitalize">{item.requirementScope.replace("_", " ")} {item.sourceReason ? "— " + item.sourceReason : ""}</div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <select
                  value={item.status}
                  onChange={e => toggleRequiredItem(item, e.target.value as RecertRequiredItem["status"])}
                  disabled={saving}
                  className={`text-xs px-2 py-1 rounded-md border font-medium cursor-pointer ${STATUS_ITEM_COLOR[item.status] ?? "text-gray-600 bg-white border-gray-200"} ${saving ? "opacity-50" : ""}`}
                >
                  {ALL_ITEM_STATUSES.map(s => (
                    <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}
          {requiredItems.length === 0 && (
            <div className="px-4 py-6 text-center text-gray-400 text-sm">No required items defined for this case.</div>
          )}
        </div>
      </div>

      {/* Uploaded documents */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-700">Uploaded Documents ({documents.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-500">
                <th className="text-left px-4 py-2">Document Type</th>
                <th className="text-left px-4 py-2">Filename</th>
                <th className="text-left px-4 py-2">Uploaded</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-left px-4 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {documents.map(doc => (
                <tr key={doc.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-3 font-medium text-gray-800">{DOC_TYPE_LABEL[doc.documentType] ?? doc.documentType}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs font-mono">{doc.fileName ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(doc.uploadedAt)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                      doc.verificationStatus === "accepted" ? "bg-green-50 text-green-700 border-green-200" :
                      doc.verificationStatus === "needs_clarification" ? "bg-orange-50 text-orange-600 border-orange-200" :
                      doc.verificationStatus === "rejected" ? "bg-red-50 text-red-600 border-red-200" :
                      "bg-gray-50 text-gray-500 border-gray-200"
                    }`}>
                      {doc.verificationStatus.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{doc.notes ?? "—"}</td>
                </tr>
              ))}
              {documents.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400 text-sm">No documents uploaded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Tab: Checklist Review
// ════════════════════════════════════════════════════════════════════════════

function ReviewTab({
  aiReview, reviewRunning, handleRunReview, setActiveTab,
}: {
  aiReview: RecertAiReview | null;
  reviewRunning: boolean;
  handleRunReview: () => Promise<void>;
  setActiveTab: (t: TabKey) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Honest labeling notice */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
        <p className="font-semibold mb-1">Checklist Review — Not AI/OCR Document Review</p>
        <p>
          This review inspects structured fields already stored in the database (signatures, required item statuses,
          deposit flags, income documentation flags). It does <strong>not</strong> parse or extract text from uploaded PDF files.
          Full OCR document parsing is not enabled. Review output is for internal tracking only — manager verification required.
        </p>
      </div>

      {/* Run button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleRunReview}
          disabled={reviewRunning}
          className={`px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors ${reviewRunning ? "opacity-60 cursor-not-allowed" : ""}`}
        >
          {reviewRunning ? "Running…" : "Run Checklist Review"}
        </button>
        {aiReview?.reviewedAt && (
          <span className="text-xs text-gray-500">Last run: {fmtDateTime(aiReview.reviewedAt)}</span>
        )}
      </div>

      {/* Review result */}
      {aiReview && (
        <div className="space-y-4">
          {/* Status banner */}
          <div className={`rounded-xl px-4 py-3 border ${
            aiReview.reviewStatus === "ready"
              ? "bg-green-50 border-green-200"
              : aiReview.reviewStatus === "not_ready"
              ? "bg-red-50 border-red-200"
              : "bg-gray-50 border-gray-200"
          }`}>
            <div className={`font-semibold text-sm ${aiReview.reviewStatus === "ready" ? "text-green-700" : aiReview.reviewStatus === "not_ready" ? "text-red-700" : "text-gray-600"}`}>
              {aiReview.reviewStatus === "ready" && "✓ READY — All checklist fields clear"}
              {aiReview.reviewStatus === "not_ready" && `✗ NOT READY — ${aiReview.issuesJson.length} issue${aiReview.issuesJson.length === 1 ? "" : "s"} found`}
              {aiReview.reviewStatus === "not_run" && "Review has not been run yet"}
            </div>
            {aiReview.summary && (
              <p className="text-xs text-gray-600 mt-1">{aiReview.summary}</p>
            )}
            {aiReview.recommendedNextAction && (
              <p className="text-xs text-gray-700 mt-1 font-medium">→ {aiReview.recommendedNextAction}</p>
            )}
          </div>

          {/* Issues list */}
          {aiReview.issuesJson.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                <h3 className="text-sm font-semibold text-gray-700">Issues Found</h3>
              </div>
              <div className="divide-y divide-gray-50">
                {aiReview.issuesJson.map((iss, i) => (
                  <div key={i} className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      <span className="text-red-500 mt-0.5 flex-shrink-0">⚠</span>
                      <div>
                        <div className="text-sm font-medium text-gray-900">{iss.issue}</div>
                        {iss.why && <div className="text-xs text-gray-500 mt-0.5">Why: {iss.why}</div>}
                        {iss.action && <div className="text-xs text-blue-600 mt-0.5">Action: {iss.action}</div>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommended follow-up */}
          {aiReview.issuesJson.length > 0 && (
            <div className="flex gap-3">
              <button
                onClick={() => setActiveTab("clarifications")}
                className="text-sm px-4 py-2 bg-orange-50 border border-orange-200 text-orange-700 rounded-lg hover:bg-orange-100 font-medium transition-colors"
              >
                Generate Clarification Request →
              </button>
            </div>
          )}
        </div>
      )}

      {!aiReview && !reviewRunning && (
        <div className="text-sm text-gray-400 text-center py-8">No review run yet. Click "Run Checklist Review" to start.</div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Tab: Income
// ════════════════════════════════════════════════════════════════════════════

function IncomeTab({
  incomeSources, saving, handleApproveIncome,
}: {
  incomeSources: RecertIncomeSource[];
  saving: boolean;
  handleApproveIncome: (s: RecertIncomeSource) => Promise<void>;
}) {
  const METHOD_LABELS: Record<string, string> = {
    average_paycheck: "Avg Paycheck × Per Year",
    ytd_paystub: "YTD Paystub Annualized",
    hourly: "Hourly × Hours/Wk × 52",
    voe_ytd: "VOE YTD Annualized",
  };

  return (
    <div className="space-y-6">
      <SectionNote>
        All income calculations are estimates based on the data provided.
        <strong> Manager review required</strong> — the property manager is responsible for verifying and approving
        all projected income figures before submission. Calculations do not constitute a legal determination.
      </SectionNote>

      {incomeSources.length === 0 && (
        <div className="text-sm text-gray-400 text-center py-8">No income sources recorded for this case.</div>
      )}

      {incomeSources.map(src => {
        const methods = computeIncomeMethods(src);
        const rows = [
          { key: "average_paycheck", val: methods.avgPaycheck },
          { key: "ytd_paystub",      val: methods.ytdPaystub },
          { key: "hourly",           val: methods.hourly },
          { key: "voe_ytd",          val: methods.voeYtd },
        ];

        return (
          <div key={src.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-800">
                  {src.employerOrSourceName ?? src.incomeType.replace(/_/g, " ")}
                </h3>
                <div className="text-xs text-gray-500 mt-0.5 capitalize">
                  {src.incomeType.replace(/_/g, " ")}
                  {src.disclosedOnTicq ? " · Disclosed on TICQ" : " · ⚠ Not disclosed on TICQ"}
                  {src.documentationReceived ? " · Docs received" : " · ⚠ Docs missing"}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                {src.managerApproved ? (
                  <span className="text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full font-medium">
                    ✓ Manager Approved
                  </span>
                ) : (
                  <button
                    onClick={() => handleApproveIncome(src)}
                    disabled={saving}
                    className={`text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold transition-colors ${saving ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    Manager Approve
                  </button>
                )}
                {src.managerApprovedBy && (
                  <span className="text-xs text-gray-400">{src.managerApprovedBy} · {fmtDate(src.managerApprovedAt)}</span>
                )}
              </div>
            </div>

            {/* 4-method table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-500">
                    <th className="text-left px-4 py-2">Calculation Method</th>
                    <th className="text-right px-4 py-2">Annual Amount</th>
                    <th className="text-left px-4 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const isHighest = r.key === methods.highestMethod && r.val != null;
                    return (
                      <tr key={r.key} className={`border-b border-gray-50 last:border-0 ${isHighest ? "bg-green-50" : ""}`}>
                        <td className="px-4 py-2.5 text-gray-800">
                          {METHOD_LABELS[r.key]}
                          {isHighest && <span className="ml-2 text-xs text-green-600 font-semibold">★ Highest</span>}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-mono font-semibold ${r.val != null ? isHighest ? "text-green-700" : "text-gray-900" : "text-gray-300"}`}>
                          {r.val != null ? fmt$(r.val) : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-500">
                          {r.key === "average_paycheck" && src.averagePaycheckGross && src.paychecksPerYear
                            ? `${fmt$(src.averagePaycheckGross)} × ${src.paychecksPerYear}/yr`
                            : r.key === "hourly" && src.hourlyRate && src.hoursPerWeek
                            ? `$${src.hourlyRate}/hr × ${src.hoursPerWeek} hrs/wk × 52`
                            : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Projected income + method used */}
            <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between gap-4 flex-wrap">
              <div className="text-xs text-gray-600">
                <span className="text-gray-400">Method used: </span>
                <span className="font-semibold">{src.selectedMethod ? METHOD_LABELS[src.selectedMethod] ?? src.selectedMethod : methods.highestMethod ? METHOD_LABELS[methods.highestMethod] : "—"}</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-xs text-gray-400">Required Projected Income</div>
                  <div className="text-base font-bold text-gray-900">{fmt$(src.requiredProjectedIncome)}</div>
                </div>
                {methods.highest != null && src.requiredProjectedIncome && (
                  <div className={`text-xs font-semibold px-2 py-1 rounded-full border ${
                    methods.highest <= src.requiredProjectedIncome
                      ? "bg-green-50 text-green-700 border-green-200"
                      : "bg-red-50 text-red-700 border-red-200"
                  }`}>
                    {methods.highest <= src.requiredProjectedIncome ? "Within limit" : "⚠ Over limit"}
                  </div>
                )}
              </div>
            </div>

            {src.notes && (
              <div className="px-4 pb-3 text-xs text-gray-500 italic">{src.notes}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Tab: Assets / Deposits
// ════════════════════════════════════════════════════════════════════════════

function AssetsTab({
  assetAccounts, depositReviews, saving, setSaving, setDepositReviews,
}: {
  assetAccounts: RecertAssetAccount[];
  depositReviews: RecertDepositReview[];
  saving: boolean;
  setSaving: (v: boolean) => void;
  setDepositReviews: (d: RecertDepositReview[]) => void;
}) {
  const assetCalc = computeAssetIncome(assetAccounts);

  async function resolveDeposit(dep: RecertDepositReview, status: RecertDepositReview["documentationStatus"]) {
    setSaving(true);
    try {
      const updated = await saveDepositReview({ ...dep, documentationStatus: status });
      setDepositReviews(depositReviews.map(d => d.id === updated.id ? updated : d));
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-6">
      <SectionNote>
        Asset income calculation uses HUD 2026 passbook rate ({fmtPct(HUD_PASSBOOK_RATE_2026)}).
        Imputed income applies when total assets ≥ {fmt$(ASSET_THRESHOLD_2026)}.
        <strong> Manager review required</strong> — all figures must be verified before submission.
      </SectionNote>

      {/* Asset summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Assets",     value: fmt$(assetCalc.totalAssets),     note: assetCalc.thresholdTriggered ? "⚠ Above threshold" : "Below threshold" },
          { label: "Actual Income",    value: fmt$(assetCalc.totalActualIncome),  note: "From known rates" },
          { label: "Imputed Income",   value: fmt$(assetCalc.totalImputedIncome), note: `HUD ${fmtPct(HUD_PASSBOOK_RATE_2026)} passbook` },
          { label: "Income Used",      value: fmt$(assetCalc.totalIncomeUsed),    note: "Higher of actual vs imputed" },
        ].map(item => (
          <div key={item.label} className={`bg-white border rounded-xl p-3 ${assetCalc.thresholdTriggered && item.label === "Total Assets" ? "border-orange-200" : "border-gray-200"}`}>
            <div className="text-xs text-gray-500 mb-1">{item.label}</div>
            <div className={`text-lg font-bold ${assetCalc.thresholdTriggered && item.label === "Total Assets" ? "text-orange-600" : "text-gray-900"}`}>{item.value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{item.note}</div>
          </div>
        ))}
      </div>

      {/* Asset accounts table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-700">Asset Accounts ({assetAccounts.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-500">
                <th className="text-left px-4 py-2">Account</th>
                <th className="text-right px-4 py-2">Balance</th>
                <th className="text-right px-4 py-2">Rate</th>
                <th className="text-right px-4 py-2">Actual Income</th>
                <th className="text-right px-4 py-2">Imputed Income</th>
                <th className="text-right px-4 py-2">Income Used</th>
                <th className="text-center px-4 py-2">Docs</th>
              </tr>
            </thead>
            <tbody>
              {assetAccounts.map(a => {
                const balance = Math.max(0, a.endingBalance);
                const actual  = a.interestRateKnown && a.interestRate != null ? balance * a.interestRate : 0;
                const imputed = assetCalc.thresholdTriggered && !a.interestRateKnown ? balance * HUD_PASSBOOK_RATE_2026 : 0;
                const used    = Math.max(actual, imputed);
                return (
                  <tr key={a.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{a.institutionName ?? "Unknown Institution"}</div>
                      <div className="text-xs text-gray-500">{a.accountType ?? "—"}{a.accountLastFour ? ` ···${a.accountLastFour}` : ""}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{fmt$(balance)}</td>
                    <td className="px-4 py-3 text-right text-xs">
                      {a.interestRateKnown ? fmtPct(a.interestRate) : <span className="text-gray-400">Unknown → HUD rate</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-600">{fmt$(actual)}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-600">{assetCalc.thresholdTriggered ? fmt$(imputed) : <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-gray-900">{fmt$(used)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${a.statementReceived && a.allPagesReceived ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-600 border-red-200"}`}>
                        {a.statementReceived && a.allPagesReceived ? "✓" : "Missing"}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {assetAccounts.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400 text-sm">No asset accounts recorded.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Deposit reviews */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-700">Deposit Reviews ({depositReviews.length})</h3>
          {depositReviews.filter(d => d.documentationStatus === "needs_clarification").length > 0 && (
            <p className="text-xs text-orange-600 mt-0.5">
              {depositReviews.filter(d => d.documentationStatus === "needs_clarification").length} deposit(s) need clarification
            </p>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-500">
                <th className="text-left px-4 py-2">Date</th>
                <th className="text-right px-4 py-2">Amount</th>
                <th className="text-left px-4 py-2">Description</th>
                <th className="text-left px-4 py-2">Suspected Source</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-left px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {depositReviews.map(dep => (
                <tr key={dep.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-3 text-gray-600 text-xs">{fmtDate(dep.depositDate)}</td>
                  <td className="px-4 py-3 text-right font-mono text-gray-900">{fmt$(dep.depositAmount)}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{dep.depositDescription ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{dep.suspectedSource ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                      dep.documentationStatus === "documented" ? "bg-green-50 text-green-700 border-green-200" :
                      dep.documentationStatus === "needs_clarification" ? "bg-orange-50 text-orange-600 border-orange-200" :
                      dep.documentationStatus === "clarified" ? "bg-blue-50 text-blue-700 border-blue-200" :
                      "bg-gray-50 text-gray-400 border-gray-200"
                    }`}>
                      {dep.documentationStatus.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {dep.documentationStatus === "needs_clarification" && (
                      <button
                        onClick={() => resolveDeposit(dep, "clarified")}
                        disabled={saving}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Mark Clarified
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {depositReviews.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400 text-sm">No deposit reviews for this case.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Tab: Rent + Utility Allowance
// ════════════════════════════════════════════════════════════════════════════

function RentTab({
  utilityAllowance, saving, setSaving, caseId, setUtilityAllowance, logAuditEvent: logEvt,
}: {
  utilityAllowance: RecertUtilityAllowance | null;
  saving: boolean;
  setSaving: (v: boolean) => void;
  caseId: string;
  setUtilityAllowance: (ua: RecertUtilityAllowance | null) => void;
  logAuditEvent: (type: string, summary: string) => Promise<unknown>;
}) {
  if (!utilityAllowance) {
    return (
      <div className="space-y-4">
        <SectionNote>
          Utility allowance applies to covenants executed on or after April 1, 2017.
          No utility allowance record found for this case. Add one in the database to proceed.
        </SectionNote>
        <div className="text-sm text-gray-400 text-center py-8">No utility allowance data for this case.</div>
      </div>
    );
  }

  const calc = computeUtilityAllowance(utilityAllowance);

  const UTILITY_FIELDS: { key: keyof RecertUtilityAllowance; label: string; amountKey: keyof RecertUtilityAllowance }[] = [
    { key: "tenantPaysBasicElectricity", label: "Basic Electricity",      amountKey: "allowanceBasicElectricity" },
    { key: "tenantPaysTrash",            label: "Trash",                   amountKey: "allowanceTrash" },
    { key: "tenantPaysGas",              label: "Gas",                     amountKey: "allowanceGas" },
    { key: "tenantPaysWater",            label: "Water",                   amountKey: "allowanceWater" },
    { key: "tenantPaysSewer",            label: "Sewer",                   amountKey: "allowanceSewer" },
    { key: "scepFeeApplies",             label: "SCEP Fee",                amountKey: "allowanceScep" },
    { key: "rsoFeeApplies",              label: "RSO Fee",                 amountKey: "allowanceRso" },
  ];

  return (
    <div className="space-y-6">
      <SectionNote>
        Utility allowance applies only if covenant was executed on or after <strong>April 1, 2017</strong>.
        Formula: <code className="bg-amber-100 px-1 rounded">Max Tenant Rent = Max Allowable Rent − Total Utility Allowance</code>.
        <strong> Manager review required.</strong> All rent calculations must be verified before submission.
      </SectionNote>

      {/* Covenant determination */}
      <div className={`rounded-xl border px-4 py-3 ${utilityAllowance.applies ? "bg-blue-50 border-blue-200" : "bg-gray-50 border-gray-200"}`}>
        <div className="text-sm font-semibold text-gray-800 mb-1">Covenant Determination</div>
        <div className="text-xs text-gray-600">
          <span className="text-gray-400">Covenant execution date: </span>
          <span className="font-mono">{fmtDate(utilityAllowance.covenantExecutionDate)}</span>
        </div>
        <div className={`text-xs mt-1 font-medium ${calc.appliesReason.includes("applies") && !calc.appliesReason.includes("does not") ? "text-blue-700" : "text-gray-500"}`}>
          {calc.appliesReason}
        </div>
      </div>

      {/* Utility items */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-700">Utility Allowance Components</h3>
          <p className="text-xs text-gray-400 mt-0.5">Source: {utilityAllowance.sourceStatus ?? "—"}{utilityAllowance.sourceTableYear ? ` · ${utilityAllowance.sourceTableYear} table` : ""}</p>
        </div>
        <div className="divide-y divide-gray-50">
          {UTILITY_FIELDS.map(f => {
            const applies = Boolean(utilityAllowance[f.key]);
            const amount  = Number(utilityAllowance[f.amountKey] ?? 0);
            return (
              <div key={f.key} className={`px-4 py-3 flex items-center justify-between ${!calc.totalAllowance && !applies ? "opacity-40" : ""}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${applies ? "text-gray-900" : "text-gray-400"}`}>{f.label}</span>
                  {!applies && <span className="text-xs text-gray-400">(not applicable)</span>}
                </div>
                <span className={`font-mono text-sm font-semibold ${applies && amount > 0 ? "text-gray-900" : "text-gray-300"}`}>
                  {applies && amount > 0 ? `$${amount}/mo` : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Calculation summary */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">Rent Calculation</h3>
        <div className="space-y-2 text-sm">
          {[
            { label: "Max Allowable Rent",    value: fmt$(utilityAllowance.maxAllowableRent), bold: false },
            { label: "Total Utility Allowance", value: calc.totalAllowance > 0 ? `− $${calc.totalAllowance}` : "N/A", bold: false, color: "text-orange-600" },
            { label: "Max Tenant Rent Limit", value: fmt$(calc.maxTenantRent),    bold: true  },
            { label: "Proposed Tenant Rent",  value: fmt$(utilityAllowance.proposedTenantRent), bold: false },
          ].map(row => (
            <div key={row.label} className={`flex items-center justify-between ${row.label === "Max Tenant Rent Limit" ? "pt-2 border-t border-gray-100" : ""}`}>
              <span className={`${row.bold ? "font-semibold text-gray-900" : "text-gray-600"}`}>{row.label}</span>
              <span className={`font-mono ${row.bold ? "font-bold text-gray-900 text-base" : "text-gray-700"} ${row.color ?? ""}`}>{row.value}</span>
            </div>
          ))}
        </div>

        {/* Compliance result */}
        {utilityAllowance.proposedTenantRent != null && calc.maxTenantRent > 0 && (
          <div className={`mt-3 rounded-lg px-3 py-2 text-sm font-semibold border ${calc.compliant ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`}>
            {calc.compliant
              ? `✓ Compliant — Proposed rent (${fmt$(utilityAllowance.proposedTenantRent)}) is at or below the limit (${fmt$(calc.maxTenantRent)})`
              : `✗ Non-compliant — Proposed rent (${fmt$(utilityAllowance.proposedTenantRent)}) exceeds the limit (${fmt$(calc.maxTenantRent)})`}
          </div>
        )}

        {utilityAllowance.needsReview && (
          <div className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded px-2 py-1">
            ⚠ This record is flagged for manager review
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Tab: Clarifications
// ════════════════════════════════════════════════════════════════════════════

function ClarificationsTab({
  clarifications, aiReview, recertCase, saving, setClarifications, handleSendClarification, caseId,
}: {
  clarifications: RecertClarificationRequest[];
  aiReview: RecertAiReview | null;
  recertCase: RecertificationCase;
  saving: boolean;
  setClarifications: (c: RecertClarificationRequest[]) => void;
  handleSendClarification: (cr: RecertClarificationRequest) => Promise<void>;
  caseId: string;
}) {
  const [generating, setGenerating] = useState(false);

  const openIssues = aiReview?.issuesJson ?? [];

  async function handleGenerateClarification() {
    if (!openIssues.length) return;
    setGenerating(true);
    try {
      const now = new Date().toISOString();
      const message = buildClarificationMessage(recertCase.primaryTenantName, openIssues);
      const cr: RecertClarificationRequest = {
        id: `cr-${caseId}-${Date.now()}`,
        caseId,
        tenantEmail: recertCase.primaryTenantEmail,
        messageBody: message,
        issuesJson: openIssues,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      };
      const saved = await saveClarificationRequest(cr);
      setClarifications([...clarifications, saved]);
    } finally { setGenerating(false); }
  }

  const STATUS_CL_COLOR: Record<string, string> = {
    draft:     "bg-gray-100 text-gray-600 border-gray-200",
    sent:      "bg-blue-100 text-blue-700 border-blue-200",
    responded: "bg-green-100 text-green-700 border-green-200",
    resolved:  "bg-emerald-100 text-emerald-700 border-emerald-200",
    overdue:   "bg-red-100 text-red-700 border-red-200",
  };

  return (
    <div className="space-y-6">
      {/* Generate button */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-gray-600">
          {openIssues.length > 0
            ? `${openIssues.length} open issue(s) from last checklist review. Generate a clarification request to send to the tenant.`
            : "No open issues from checklist review. Run the review first to auto-populate issues."}
        </div>
        <button
          onClick={handleGenerateClarification}
          disabled={generating || saving || openIssues.length === 0}
          className={`text-sm px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg transition-colors ${(generating || saving || openIssues.length === 0) ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {generating ? "Generating…" : "Generate Clarification Draft"}
        </button>
      </div>

      {/* Existing clarification requests */}
      {clarifications.length === 0 ? (
        <div className="text-sm text-gray-400 text-center py-8">No clarification requests yet.</div>
      ) : (
        <div className="space-y-4">
          {clarifications.map(cr => (
            <div key={cr.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Created {fmtDateTime(cr.createdAt)}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_CL_COLOR[cr.status] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
                    {cr.status}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {cr.status === "draft" && (
                    <button
                      onClick={() => handleSendClarification(cr)}
                      disabled={saving}
                      className={`text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors ${saving ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      Mark as Sent
                    </button>
                  )}
                  {cr.sentAt && <span className="text-xs text-gray-400">Sent {fmtDate(cr.sentAt)}</span>}
                </div>
              </div>

              {/* Tenant email */}
              {cr.tenantEmail && (
                <div className="px-4 py-2 text-xs text-gray-500 border-b border-gray-50">
                  To: <span className="text-gray-800 font-mono">{cr.tenantEmail}</span>
                </div>
              )}

              {/* Message body */}
              {cr.messageBody && (
                <div className="px-4 py-3">
                  <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed bg-gray-50 rounded-lg p-3 border border-gray-100">
                    {cr.messageBody}
                  </pre>
                </div>
              )}

              {/* Issue count */}
              {Array.isArray(cr.issuesJson) && cr.issuesJson.length > 0 && (
                <div className="px-4 pb-3 text-xs text-gray-400">{cr.issuesJson.length} issue(s) included</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Tab: Submission Prep
// ════════════════════════════════════════════════════════════════════════════

function SubmissionTab({
  recertCase, score, requiredItems, incomeSources, members, aiReview, draftEmail,
  saving, copySuccess, handleCopyEmail, handleMarkSubmitted,
}: {
  recertCase: RecertificationCase;
  score: number;
  requiredItems: RecertRequiredItem[];
  incomeSources: RecertIncomeSource[];
  members: RecertHouseholdMember[];
  aiReview: RecertAiReview | null;
  draftEmail: { subject: string; body: string; to: string };
  saving: boolean;
  copySuccess: boolean;
  handleCopyEmail: () => Promise<void>;
  handleMarkSubmitted: () => Promise<void>;
}) {
  const adults = members.filter(m => m.isAdult);
  const allSigned = adults.every(m => m.ticqSigned && m.applicantStatementSigned && m.conflictOfInterestSigned);
  const allItemsComplete = requiredItems.every(r => r.status === "complete" || r.status === "not_applicable");
  const allIncomeApproved = incomeSources.every(s => s.managerApproved);
  const reviewReady = aiReview?.reviewStatus === "ready";
  const isReady = allSigned && allItemsComplete && allIncomeApproved && reviewReady;

  const checks = [
    { label: "All adult signatures complete (TICQ, Applicant Stmt, COI)", ok: allSigned },
    { label: "All required items complete or marked N/A", ok: allItemsComplete },
    { label: "All income calculations manager-approved", ok: allIncomeApproved },
    { label: "Checklist review passed (no open issues)", ok: reviewReady },
  ];

  return (
    <div className="space-y-6">
      {/* Sprint 18 — Completion Portals: guided HTML forms → merge → final PDF */}
      <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 px-4 py-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-base font-bold text-emerald-900">📝 Completion Portals (HTML → final PDF)</h3>
            <p className="text-xs text-emerald-800 mt-1 max-w-2xl">
              Send the tenant a simple guided HTML form (only the questions they need to answer). Manager
              completes a separate manager form. Both sets of answers merge back into the official LAHD PDF
              using the original AcroForm field names — no double data entry, no layout redesign.
            </p>
            <p className="text-[11px] text-emerald-700 italic mt-1">
              Manager review still required. Signature protections from Sprint 16 still apply.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <a
              href={`/recertification/${recertCase.id}/tenant-completion`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-lg"
            >
              Open Tenant Completion Form →
            </a>
            <a
              href={`/recertification/${recertCase.id}/manager-completion`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-lg"
            >
              Open Manager Completion Form →
            </a>
            <a
              href={`/recertification/${recertCase.id}/exact-form-preview`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-white border-2 border-emerald-400 text-emerald-800 text-sm rounded-lg hover:bg-emerald-100"
            >
              Preview Final Official PDF
            </a>
            <a
              href={`/api/recertification/${recertCase.id}/generate-exact-form`}
              className="px-4 py-2 bg-white border-2 border-emerald-400 text-emerald-800 text-sm rounded-lg hover:bg-emerald-100"
              download={`lahd-recert-final-${recertCase.id}.pdf`}
            >
              Download Final PDF
            </a>
            {/* Sprint 19 — Roster invitations + lifecycle tracking */}
            <a
              href="/recertification/roster"
              className="px-4 py-2 bg-white border-2 border-emerald-400 text-emerald-800 text-sm rounded-lg hover:bg-emerald-100"
            >
              📋 Tenant Roster &amp; Invitations
            </a>
          </div>
        </div>
      </div>

      {/* Sprint 15 — Exact-form fill: PRIMARY tenant-facing deliverable */}
      <div className="rounded-xl border-2 border-sky-300 bg-sky-50 px-4 py-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-base font-bold text-sky-900">📄 Generate exact-form fill (DocHub / iPad)</h3>
            <p className="text-xs text-sky-800 mt-1 max-w-2xl">
              Fills the actual official LAHD recertification PDF in place — preserving the original layout — with BaxterOps-known
              fields (property name, address, unit, household members, max income/rent limits, etc.). Tenant signatures,
              initials, TICQ Y/N answers, and asset balances are left blank for the tenant to complete in DocHub on iPad.
            </p>
            <p className="text-[11px] text-sky-700 italic mt-1">
              This is the version to send the tenant. The HTML packet below is for internal preview only.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <a
              href={`/recertification/${recertCase.id}/exact-form-preview`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold rounded-lg"
            >
              Generate exact form fill →
            </a>
            <a
              href={`/api/recertification/${recertCase.id}/generate-exact-form`}
              className="px-4 py-2 bg-white border border-sky-400 text-sky-800 text-sm rounded-lg hover:bg-sky-100"
              download={`lahd-recert-${recertCase.id}.pdf`}
            >
              Download filled PDF
            </a>
          </div>
        </div>
      </div>

      {/* Sprint 14 — Internal HTML preview (NOT the tenant deliverable) */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-slate-700">Internal HTML preview (review-only)</h3>
            <p className="text-[11px] text-slate-600 mt-0.5 max-w-2xl">
              Structured BaxterOps view of the case data. Use to scan readiness before generating the exact-form PDF above.
              Not the document to send to the tenant.
            </p>
          </div>
          <a
            href={`/recertification/${recertCase.id}/packet`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-xs rounded-lg hover:bg-slate-100"
          >
            Open internal HTML preview →
          </a>
        </div>
      </div>

      {/* Readiness gate */}
      <div className={`rounded-xl border px-4 py-4 ${isReady ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className={`text-sm font-bold ${isReady ? "text-green-800" : "text-amber-800"}`}>
              {isReady ? "✓ Package appears ready for submission" : "⚠ Package not ready — resolve items below"}
            </h3>
            <p className="text-xs text-gray-600 mt-1">
              Readiness score: <strong>{score}%</strong>.
              Incomplete packages will not be reviewed.
              Complete packages receive a determination within 10 business days.
            </p>
          </div>
          {readinessBar(score)}
        </div>
      </div>

      {/* Pre-submission checklist */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-700">Pre-Submission Checklist</h3>
        </div>
        <div className="divide-y divide-gray-50">
          {checks.map(c => (
            <div key={c.label} className="px-4 py-3 flex items-center gap-3">
              <span className={`flex-shrink-0 font-bold text-base ${c.ok ? "text-green-500" : "text-gray-300"}`}>
                {c.ok ? "✓" : "○"}
              </span>
              <span className={`text-sm ${c.ok ? "text-gray-700" : "text-gray-500"}`}>{c.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Email draft */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Submission Email Draft</h3>
          <button
            onClick={handleCopyEmail}
            className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${copySuccess ? "bg-green-50 text-green-700 border-green-200" : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"}`}
          >
            {copySuccess ? "✓ Copied!" : "Copy to Clipboard"}
          </button>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <div className="flex gap-2">
            <span className="text-gray-400 w-14 flex-shrink-0">To:</span>
            <span className="font-mono text-blue-700 font-semibold">{draftEmail.to}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-400 w-14 flex-shrink-0">Subject:</span>
            <span className="text-gray-800 font-medium">{draftEmail.subject}</span>
          </div>
          <div className="border-t border-gray-100 pt-3">
            <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed bg-gray-50 rounded-lg p-3 border border-gray-100">
              {draftEmail.body}
            </pre>
          </div>
        </div>
      </div>

      {/* Mark submitted */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="text-sm text-gray-600">
          {recertCase.submittedAt
            ? `Submitted on ${fmtDateTime(recertCase.submittedAt)}`
            : "When you have sent the email and attached all documents, mark the case as submitted."}
        </div>
        {recertCase.caseStatus !== "submitted" && recertCase.caseStatus !== "approved" && (
          <button
            onClick={handleMarkSubmitted}
            disabled={saving}
            className={`px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-colors ${saving ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {saving ? "Saving…" : "Mark as Submitted"}
          </button>
        )}
        {(recertCase.caseStatus === "submitted" || recertCase.caseStatus === "approved") && (
          <span className="text-sm font-semibold text-emerald-600">✓ {recertCase.caseStatus === "approved" ? "Approved" : "Submitted"}</span>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Tab: Audit Trail
// ════════════════════════════════════════════════════════════════════════════

function AuditTab({ auditEvents }: { auditEvents: RecertAuditEvent[] }) {
  const EVENT_ICON: Record<string, string> = {
    status_change:        "🔄",
    checklist_review_run: "🔍",
    income_approved:      "✅",
    clarification_sent:   "📨",
    submitted:            "📬",
    document_uploaded:    "📄",
    member_updated:       "👤",
    deposit_resolved:     "💰",
    default:              "📋",
  };

  return (
    <div className="space-y-2">
      {auditEvents.length === 0 && (
        <div className="text-sm text-gray-400 text-center py-8">No audit events recorded yet.</div>
      )}
      {auditEvents.map(evt => (
        <div key={evt.id} className="bg-white border border-gray-100 rounded-xl px-4 py-3 flex items-start gap-3">
          <span className="text-lg mt-0.5 flex-shrink-0">{EVENT_ICON[evt.eventType] ?? EVENT_ICON.default}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-sm font-medium text-gray-900">{evt.eventSummary ?? evt.eventType.replace(/_/g, " ")}</span>
              <span className="text-xs text-gray-400 flex-shrink-0">{fmtDateTime(evt.createdAt)}</span>
            </div>
            <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
              <span className="font-mono">{evt.eventType}</span>
              {evt.actorEmail && <><span>·</span><span>{evt.actorEmail}</span></>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
