"use client";
// Sprint 23: Combine / Final Submission Packet — standalone route.
// Merges saved tenant + manager answers (or uploaded offline forms) into
// the official LAHD recertification PDF. Shows blockers before generation.
// Route: /recertification/[caseId]/combine

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { getSupabase } from "@/lib/supabase/client";
import { OfflineTenantFormPanel } from "@/components/OfflineTenantFormPanel";
import { loadSession } from "@/lib/services/recertCompletionForms";
import { getCaseById, getMembersForCase, getRequiredItemsForCase, getIncomeSourcesForCase, buildSubmissionEmailDraft, saveCase, computeReadinessScore, logAuditEvent } from "@/lib/services/recertification";
import type { RecertificationCase, RecertHouseholdMember, RecertRequiredItem, RecertIncomeSource } from "@/lib/types";

type SessionRow = { status: string; submitted_at?: string; submitted_by?: string } | null;

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

export default function CombinePage() {
  const params = useParams();
  const caseId = String(params?.caseId ?? "");
  const { signedIn, loading: authLoading, profile, authUser } = useAuth();

  const [recertCase, setRecertCase] = useState<RecertificationCase | null>(null);
  const [members, setMembers] = useState<RecertHouseholdMember[]>([]);
  const [requiredItems, setRequiredItems] = useState<RecertRequiredItem[]>([]);
  const [incomeSources, setIncomeSources] = useState<RecertIncomeSource[]>([]);
  const [tenantSession, setTenantSession] = useState<SessionRow>(null);
  const [managerSession, setManagerSession] = useState<SessionRow>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [filledCount, setFilledCount] = useState(0);
  const [blankCount, setBlankCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const loadData = useCallback(async () => {
    if (!caseId || !signedIn) return;
    try {
      const [c, m, items, inc, ts, ms] = await Promise.all([
        getCaseById(caseId),
        getMembersForCase(caseId),
        getRequiredItemsForCase(caseId),
        getIncomeSourcesForCase(caseId),
        loadSession(caseId, "tenant"),
        loadSession(caseId, "manager"),
      ]);
      if (!c) { setLoadError("Case not found."); return; }
      setRecertCase(c);
      setMembers(m);
      setRequiredItems(items);
      setIncomeSources(inc);
      setTenantSession(ts as SessionRow);
      setManagerSession(ms as SessionRow);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [caseId, signedIn]);

  useEffect(() => { void loadData(); }, [loadData]);

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

  async function handleMarkSubmitted() {
    if (!recertCase) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const updated = await saveCase({ ...recertCase, caseStatus: "submitted", submittedAt: now });
      setRecertCase(updated);
      await logAuditEvent(caseId, "submitted", "Package marked as submitted to Urban Futures (cert@ufbahc.com).");
      await loadData();
    } finally { setSaving(false); }
  }

  async function handleCopyEmail() {
    if (!recertCase) return;
    const draft = buildSubmissionEmailDraft(recertCase);
    await navigator.clipboard.writeText(`To: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.body}`);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2500);
  }

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
      <Link href="/recertification" className="text-xs underline text-slate-500 mt-3 inline-block">← back to Recertification</Link>
    </div>
  );
  if (!recertCase) return <div className="p-6 text-sm text-slate-500">Loading case…</div>;

  const tenantSubmitted = tenantSession?.status === "submitted";
  const managerSubmitted = managerSession?.status === "submitted";
  const adults = members.filter(m => m.isAdult);
  const allSigned = adults.every(m => m.ticqSigned && m.applicantStatementSigned && m.conflictOfInterestSigned);
  const allItemsComplete = requiredItems.every(r => r.status === "complete" || r.status === "not_applicable");
  const allIncomeApproved = incomeSources.every(s => s.managerApproved);
  const score = computeReadinessScore(requiredItems, members, incomeSources, undefined);

  const blockers: string[] = [
    !tenantSubmitted ? "Tenant recertification form not yet submitted" : null,
    !managerSubmitted ? "Managerial recertification form not yet submitted" : null,
    !allSigned ? "Missing adult household signatures (TICQ, Applicant Statement, COI)" : null,
    !allItemsComplete ? "Not all required checklist items are complete" : null,
    !allIncomeApproved ? "Not all income sources are manager-approved" : null,
  ].filter(Boolean) as string[];

  const safeName = (s: string) => s.replace(/[^a-z0-9]/gi, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  const downloadFilename = `LAHD-recert-${safeName(recertCase.primaryTenantName ?? "Tenant")}-unit-${safeName(recertCase.unitNumber ?? "0")}-FINAL-SUBMISSION.pdf`;
  const draftEmail = buildSubmissionEmailDraft(recertCase);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
          <Link href="/recertification" className="hover:text-blue-600">Recertification</Link>
          <span>/</span>
          <Link href={`/recertification/${caseId}`} className="hover:text-blue-600">{recertCase.primaryTenantName}</Link>
          <span>/</span>
          <span className="text-slate-800 font-medium">Combine / Final Submission</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Combine / Final Submission Packet</h1>
        <p className="text-sm text-slate-500 mt-1">Unit {recertCase.unitNumber ?? "—"} · {recertCase.propertyName}</p>
      </div>

      {/* Form status */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { label: "1. Tenant Recertification Doc", session: tenantSession, href: `/recertification/${caseId}/tenant-doc`, color: "emerald" as const },
          { label: "2. Managerial Recertification Doc", session: managerSession, href: `/recertification/${caseId}/manager-doc`, color: "sky" as const },
        ].map(({ label, session, href, color }) => {
          const done = session?.status === "submitted";
          const bg = done
            ? (color === "emerald" ? "bg-emerald-50 border-emerald-200" : "bg-sky-50 border-sky-200")
            : "bg-slate-50 border-slate-200";
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
                  className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:border-slate-500 bg-white whitespace-nowrap">
                  Open →
                </a>
              )}
            </div>
          );
        })}
      </div>

      {/* Offline tenant form import */}
      <OfflineTenantFormPanel caseId={caseId} />

      {/* Blockers list */}
      {blockers.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
          <h3 className="text-sm font-bold text-amber-900 mb-2">
            ⚠ Resolve before generating the final PDF:
          </h3>
          <ul className="space-y-1.5">
            {blockers.map(b => (
              <li key={b} className="flex items-start gap-2 text-sm text-amber-800">
                <span className="text-amber-400 mt-0.5 flex-shrink-0">○</span>{b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Generate PDF */}
      <div className={`rounded-xl border-2 px-5 py-5 ${blockers.length === 0 ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white"}`}>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <h2 className={`text-base font-bold ${blockers.length === 0 ? "text-emerald-900" : "text-slate-800"}`}>
              Generate Final LAHD Submission Packet
            </h2>
            <p className="text-xs text-slate-600 mt-1 max-w-xl">
              Merges tenant + manager answers into the official LAHD recertification PDF using the original AcroForm
              field names. Embeds signatures in all required official signature fields.
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              Output: <code className="font-mono">{downloadFilename}</code>
            </p>
            {blockers.length > 0 && (
              <p className="text-[11px] text-amber-700 mt-1 italic">
                {blockers.length} item{blockers.length === 1 ? "" : "s"} above incomplete — PDF will be generated but may be missing data.
              </p>
            )}
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex-shrink-0 px-6 py-3 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold rounded-lg disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate Final PDF"}
          </button>
        </div>
      </div>

      {pdfError && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 font-mono whitespace-pre-wrap">
          {pdfError}
        </div>
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
            <iframe
              src={pdfUrl}
              className="w-full"
              style={{ height: "80vh", border: 0 }}
              title="Final LAHD Submission PDF"
            />
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
              Readiness score: <strong>{score}%</strong>. Incomplete packages will not be reviewed.
              Complete packages receive a determination within 10 business days.
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
            className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
              copySuccess ? "bg-green-50 text-green-700 border-green-200" : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
            }`}
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
      <div className="flex items-center justify-between gap-4 flex-wrap pb-8">
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
