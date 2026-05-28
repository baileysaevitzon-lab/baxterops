"use client";
// Sprint 9 — Recertification Command Center main dashboard.
//
// Pulls live data from Supabase (recertification_cases + child tables).
// Tracks every restricted-unit household from "needs cert" → "approved."
// No real tenant SSNs / sensitive income / real private notes in this file.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { getAllCases } from "@/lib/services/recertification";
import type { RecertCaseStatus, RecertificationCase, RecertRiskLevel } from "@/lib/types";

// ── Status helpers ────────────────────────────────────────────────────────────

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

const STATUS_INTENT: Record<RecertCaseStatus, "good" | "warn" | "bad" | "info" | "neutral"> = {
  not_started: "neutral",
  tenant_request_sent: "info",
  waiting_on_tenant: "warn",
  documents_uploaded: "info",
  ai_review_needed: "warn",
  missing_items: "bad",
  clarification_needed: "bad",
  manager_calculation_review: "warn",
  ready_to_submit: "good",
  submitted: "good",
  approved: "good",
  corrections_needed: "bad",
  closed_ineligible: "neutral",
};

const RISK_INTENT: Record<RecertRiskLevel, "good" | "warn" | "bad" | "neutral"> = {
  low: "good", medium: "warn", high: "bad", critical: "bad",
};

const CERT_TYPE_LABEL: Record<string, string> = {
  initial: "Initial",
  annual: "Annual",
  move_in: "Move-in",
  correction: "Correction",
};

function readinessBg(score: number) {
  if (score >= 100) return "bg-emerald-500";
  if (score >= 70) return "bg-amber-400";
  if (score >= 40) return "bg-orange-400";
  return "bg-red-400";
}

const TODAY = new Date();
function isDueSoon(d?: string) {
  if (!d) return false;
  const due = new Date(d);
  const diff = (due.getTime() - TODAY.getTime()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= 30;
}
function isOverdue(d?: string) {
  if (!d) return false;
  return new Date(d) < TODAY;
}

// ── Component ─────────────────────────────────────────────────────────────────

type FilterState = {
  status: RecertCaseStatus | "all";
  certType: string;
  riskLevel: string;
  incomeStatus: string;
  rentStatus: string;
  search: string;
};

export default function RecertificationCenter() {
  const [cases, setCases] = useState<RecertificationCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCase, setSelectedCase] = useState<RecertificationCase | null>(null);
  const [filter, setFilter] = useState<FilterState>({
    status: "all", certType: "all", riskLevel: "all",
    incomeStatus: "all", rentStatus: "all", search: "",
  });

  useEffect(() => {
    getAllCases().then(c => { setCases(c); setLoading(false); });
  }, []);

  // Stat cards
  const stats = useMemo(() => {
    const active = cases.filter(c => !["approved","closed_ineligible"].includes(c.caseStatus)).length;
    const dueSoon = cases.filter(c => isDueSoon(c.dueDate) && !["approved","submitted","closed_ineligible"].includes(c.caseStatus)).length;
    const overdue = cases.filter(c => isOverdue(c.dueDate) && !["approved","submitted","closed_ineligible"].includes(c.caseStatus)).length;
    const waitingOnTenant = cases.filter(c => c.caseStatus === "waiting_on_tenant" || c.caseStatus === "tenant_request_sent").length;
    const missingDocs = cases.filter(c => c.missingItemsCount > 0).length;
    const needsManagerReview = cases.filter(c => c.caseStatus === "manager_calculation_review").length;
    const readyToSubmit = cases.filter(c => c.caseStatus === "ready_to_submit").length;
    const submitted = cases.filter(c => c.caseStatus === "submitted").length;
    const approved = cases.filter(c => c.caseStatus === "approved").length;
    const corrections = cases.filter(c => c.caseStatus === "corrections_needed").length;
    const ineligible = cases.filter(c => c.caseStatus === "closed_ineligible").length;
    return { active, dueSoon, overdue, waitingOnTenant, missingDocs, needsManagerReview, readyToSubmit, submitted, approved, corrections, ineligible };
  }, [cases]);

  const filtered = useMemo(() => cases.filter(c => {
    if (filter.status !== "all" && c.caseStatus !== filter.status) return false;
    if (filter.certType !== "all" && c.certificationType !== filter.certType) return false;
    if (filter.riskLevel !== "all" && c.riskLevel !== filter.riskLevel) return false;
    if (filter.incomeStatus !== "all" && c.incomeStatus !== filter.incomeStatus) return false;
    if (filter.rentStatus !== "all" && c.rentStatus !== filter.rentStatus) return false;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      if (!c.primaryTenantName.toLowerCase().includes(q) && !(c.unitNumber ?? "").includes(q)) return false;
    }
    return true;
  }), [cases, filter]);

  if (loading) return <p className="p-8 text-sm text-slate-500">Loading cases…</p>;

  return (
    <>
      <PageHeader
        title="Recertification Center"
        subtitle="Track tenant certifications, collect documents, calculate income/assets, check rent compliance, and prepare complete LAHD/Urban Futures submission packets."
        action={
          <div className="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 max-w-sm">
            <strong>⚠ IMPORTANT:</strong> Tenant cannot move in until certification package is complete and approved. Incomplete packages will not be reviewed. Determination takes up to 10 business days after complete submission.
          </div>
        }
      />

      {/* Status cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {[
          { label: "Active Cases", val: stats.active, intent: "info", status: "all" as const },
          { label: "Due Soon (30d)", val: stats.dueSoon, intent: "warn", status: "all" as const },
          { label: "Overdue", val: stats.overdue, intent: "bad", status: "all" as const },
          { label: "Waiting on Tenant", val: stats.waitingOnTenant, intent: "warn", status: "waiting_on_tenant" as RecertCaseStatus },
          { label: "Missing Docs", val: stats.missingDocs, intent: "bad", status: "missing_items" as RecertCaseStatus },
          { label: "Mgr Review", val: stats.needsManagerReview, intent: "warn", status: "manager_calculation_review" as RecertCaseStatus },
          { label: "Ready to Submit", val: stats.readyToSubmit, intent: "good", status: "ready_to_submit" as RecertCaseStatus },
          { label: "Submitted", val: stats.submitted, intent: "good", status: "submitted" as RecertCaseStatus },
          { label: "Approved", val: stats.approved, intent: "good", status: "approved" as RecertCaseStatus },
          { label: "Corrections", val: stats.corrections, intent: "bad", status: "corrections_needed" as RecertCaseStatus },
          { label: "Ineligible", val: stats.ineligible, intent: "neutral", status: "closed_ineligible" as RecertCaseStatus },
        ].map(s => (
          <button
            key={s.label}
            onClick={() => setFilter(f => ({ ...f, status: f.status === s.status ? "all" : s.status }))}
            className={`text-left p-3 rounded-lg border transition-all ${filter.status === s.status ? "ring-2 ring-slate-900 border-slate-900" : "border-slate-200 hover:border-slate-300"} bg-white`}
          >
            <div className="text-xs text-slate-500 leading-tight">{s.label}</div>
            <div className={`text-2xl font-bold mt-1 ${s.intent === "bad" ? "text-red-600" : s.intent === "warn" ? "text-amber-600" : s.intent === "good" ? "text-emerald-600" : "text-slate-700"}`}>
              {s.val}
            </div>
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-4 text-xs">
        <input
          value={filter.search}
          onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
          placeholder="Search tenant or unit…"
          className="border rounded-md px-3 py-1.5 text-sm w-48"
        />
        {(["all","initial","annual","move_in","correction"] as const).map(t => (
          <button key={t} onClick={() => setFilter(f => ({ ...f, certType: t }))}
            className={`px-2.5 py-1 rounded-md border ${filter.certType === t ? "bg-slate-900 text-white" : "bg-white border-slate-200 text-slate-600"}`}>
            {t === "all" ? "All types" : CERT_TYPE_LABEL[t]}
          </button>
        ))}
        {(["all","low","medium","high","critical"] as const).map(r => (
          <button key={r} onClick={() => setFilter(f => ({ ...f, riskLevel: r }))}
            className={`px-2.5 py-1 rounded-md border ${filter.riskLevel === r ? "bg-slate-900 text-white" : "bg-white border-slate-200 text-slate-600"}`}>
            {r === "all" ? "Any risk" : `${r} risk`}
          </button>
        ))}
        {filter.status !== "all" && (
          <button onClick={() => setFilter(f => ({ ...f, status: "all" }))} className="px-2.5 py-1 rounded-md border bg-slate-100 text-slate-700">
            ✕ clear status filter
          </button>
        )}
      </div>

      <div className="flex gap-4">
        {/* Main table */}
        <div className="flex-1 min-w-0">
          <Card>
            <CardHeader
              title={`Cases (${filtered.length})`}
              subtitle="Click a row for quick actions. Open full case for all tabs."
            />
            <CardBody className="p-0 overflow-x-auto">
              <table className="bx text-sm">
                <thead>
                  <tr>
                    <th>Tenant</th>
                    <th>Unit</th>
                    <th>Type</th>
                    <th>Due</th>
                    <th>Status</th>
                    <th>Missing</th>
                    <th>Income</th>
                    <th>Rent</th>
                    <th>Ready%</th>
                    <th>Risk</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={11} className="py-8 text-center text-slate-400 text-sm">No cases match current filters.</td></tr>
                  )}
                  {filtered.map(c => {
                    const over = isOverdue(c.dueDate);
                    const soon = isDueSoon(c.dueDate);
                    return (
                      <tr
                        key={c.id}
                        onClick={() => setSelectedCase(sel => sel?.id === c.id ? null : c)}
                        className={`cursor-pointer ${selectedCase?.id === c.id ? "bg-slate-50 ring-1 ring-inset ring-slate-300" : "hover:bg-slate-50"}`}
                      >
                        <td className="font-medium">{c.primaryTenantName}</td>
                        <td>{c.unitNumber ?? "—"}</td>
                        <td className="text-xs">{CERT_TYPE_LABEL[c.certificationType]}</td>
                        <td className={`text-xs ${over ? "text-red-700 font-semibold" : soon ? "text-amber-700" : "text-slate-500"}`}>
                          {c.dueDate ?? "—"}{over ? " ⚠" : soon ? " ↑" : ""}
                        </td>
                        <td><Badge intent={STATUS_INTENT[c.caseStatus]}>{STATUS_LABEL[c.caseStatus]}</Badge></td>
                        <td className="text-center">
                          {c.missingItemsCount > 0
                            ? <span className="text-red-700 font-semibold">{c.missingItemsCount}</span>
                            : <span className="text-emerald-600">—</span>
                          }
                        </td>
                        <td>
                          <Badge intent={c.incomeStatus === "eligible" ? "good" : c.incomeStatus === "over_income" ? "bad" : c.incomeStatus === "needs_review" ? "warn" : "neutral"}>
                            {c.incomeStatus.replace("_", " ")}
                          </Badge>
                        </td>
                        <td>
                          <Badge intent={c.rentStatus === "compliant" ? "good" : c.rentStatus === "non_compliant" ? "bad" : c.rentStatus === "needs_review" ? "warn" : "neutral"}>
                            {c.rentStatus.replace("_", " ")}
                          </Badge>
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            <div className="w-14 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                              <div className={`h-full ${readinessBg(c.readinessScore)} transition-all`} style={{ width: `${c.readinessScore}%` }} />
                            </div>
                            <span className="text-xs text-slate-600">{c.readinessScore}%</span>
                          </div>
                        </td>
                        <td><Badge intent={RISK_INTENT[c.riskLevel]}>{c.riskLevel}</Badge></td>
                        <td className="text-right">
                          <Link href={`/recertification/${c.id}`} onClick={e => e.stopPropagation()} className="text-xs px-2 py-1 bg-slate-900 text-white rounded whitespace-nowrap">Open →</Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardBody>
          </Card>
        </div>

        {/* Side panel */}
        {selectedCase && (
          <div className="w-80 shrink-0">
            <Card>
              <CardHeader
                title={selectedCase.primaryTenantName}
                subtitle={`Unit ${selectedCase.unitNumber ?? "—"} · ${CERT_TYPE_LABEL[selectedCase.certificationType]}`}
                action={<button onClick={() => setSelectedCase(null)} className="text-xs text-slate-400 hover:text-slate-700">✕</button>}
              />
              <CardBody>
                <div className="space-y-3 text-sm">
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Status</div>
                    <Badge intent={STATUS_INTENT[selectedCase.caseStatus]}>{STATUS_LABEL[selectedCase.caseStatus]}</Badge>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Readiness</div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                        <div className={`h-full ${readinessBg(selectedCase.readinessScore)}`} style={{ width: `${selectedCase.readinessScore}%` }} />
                      </div>
                      <span className="font-medium">{selectedCase.readinessScore}%</span>
                    </div>
                  </div>
                  {selectedCase.missingItemsCount > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-md p-2 text-xs text-red-800">
                      <strong>{selectedCase.missingItemsCount} missing item{selectedCase.missingItemsCount === 1 ? "" : "s"}</strong> before submission
                    </div>
                  )}
                  {selectedCase.incomeStatus === "over_income" && (
                    <div className="bg-red-100 border border-red-300 rounded-md p-2 text-xs text-red-900 font-semibold">
                      ⛔ Over income. Do NOT submit this household's package.
                    </div>
                  )}
                  {selectedCase.subsidyStatus !== "none" && selectedCase.subsidyStatus !== "final_determination_received" && (
                    <div className="bg-amber-50 border border-amber-200 rounded-md p-2 text-xs text-amber-800">
                      Subsidy determination pending — leave tenant portion blank until final determination received.
                    </div>
                  )}
                  <div className="text-xs text-slate-600">
                    <div><strong>Due:</strong> {selectedCase.dueDate ?? "—"}</div>
                    <div><strong>Move-in:</strong> {selectedCase.moveInOrRenewalDate ?? "—"}</div>
                    <div><strong>HH size:</strong> {selectedCase.householdSize ?? "—"} ({selectedCase.adultCount} adults, {selectedCase.childCount} children)</div>
                    <div><strong>Max income:</strong> {selectedCase.maxIncomeLimit ? `$${selectedCase.maxIncomeLimit.toLocaleString()}` : "—"}</div>
                    <div><strong>Max rent:</strong> {selectedCase.maxAllowableRent ? `$${selectedCase.maxAllowableRent.toLocaleString()}` : "—"}</div>
                    <div><strong>Proposed rent:</strong> {selectedCase.proposedTenantRent ? `$${selectedCase.proposedTenantRent.toLocaleString()}` : "—"}</div>
                    <div><strong>Utility allowance:</strong> {selectedCase.totalUtilityAllowance ? `$${selectedCase.totalUtilityAllowance}/mo` : selectedCase.utilityAllowanceRequired ? "Required — not yet calculated" : "Not required"}</div>
                  </div>
                  {selectedCase.nextAction && (
                    <div className="bg-blue-50 border border-blue-200 rounded-md p-2 text-xs text-blue-800">
                      <strong>Next action:</strong> {selectedCase.nextAction}
                    </div>
                  )}
                  <div className="pt-3 border-t space-y-2">
                    <Link href={`/recertification/${selectedCase.id}`} className="block w-full text-center px-3 py-2 bg-slate-900 text-white text-xs rounded-md">
                      Open Full Case →
                    </Link>
                    <Link href={`/recertification/${selectedCase.id}?tab=documents`} className="block w-full text-center px-3 py-2 border border-slate-200 text-xs rounded-md hover:bg-slate-50">
                      Upload Documents
                    </Link>
                    <Link href={`/recertification/${selectedCase.id}?tab=ai_review`} className="block w-full text-center px-3 py-2 border border-slate-200 text-xs rounded-md hover:bg-slate-50">
                      Run Checklist Review
                    </Link>
                    <Link href={`/recertification/${selectedCase.id}?tab=income`} className="block w-full text-center px-3 py-2 border border-slate-200 text-xs rounded-md hover:bg-slate-50">
                      Calculate Income
                    </Link>
                    <Link href={`/recertification/${selectedCase.id}?tab=rent`} className="block w-full text-center px-3 py-2 border border-slate-200 text-xs rounded-md hover:bg-slate-50">
                      Check Rent Compliance
                    </Link>
                    <Link href={`/recertification/${selectedCase.id}?tab=submission`} className="block w-full text-center px-3 py-2 border border-slate-200 text-xs rounded-md hover:bg-slate-50">
                      Generate Packet
                    </Link>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-400 mt-6">
        Data from Supabase <code>recertification_cases</code>. Submit complete packages to Urban Futures Bond Administration at <code>cert@ufbahc.com</code>. Manager remains responsible for all income calculations and eligibility determinations. Label all outputs as "manager review required."
      </p>
    </>
  );
}
