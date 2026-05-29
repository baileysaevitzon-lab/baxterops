"use client";
// Sprint 23: Income Certification Package Compiler — case selector.
// Lists all active cases; click to open the per-case compiler with document
// upload, checklist, and official LAHD PDF generation.
// Route: /recertification/compiler

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader, Badge } from "@/components/Card";
import { useAuth } from "@/components/AuthProvider";
import { getAllCases } from "@/lib/services/recertification";
import type { RecertificationCase, RecertCaseStatus } from "@/lib/types";

const STATUS_LABEL: Record<RecertCaseStatus, string> = {
  not_started: "Not Started",
  tenant_request_sent: "Request Sent",
  waiting_on_tenant: "Waiting on Tenant",
  documents_uploaded: "Docs Uploaded",
  ai_review_needed: "Review Needed",
  missing_items: "Missing Items",
  clarification_needed: "Clarification Needed",
  manager_calculation_review: "Mgr Review",
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

export default function CompilerIndexPage() {
  const { signedIn, loading: authLoading } = useAuth();
  const [cases, setCases] = useState<RecertificationCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const loadCases = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setCases(await getAllCases());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!signedIn) { setLoading(false); return; }
    loadCases();
  }, [authLoading, signedIn, loadCases]);

  const filtered = cases.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.primaryTenantName.toLowerCase().includes(q) || (c.unitNumber ?? "").includes(q);
  });

  if (authLoading) return <p className="p-8 text-sm text-slate-500">Loading…</p>;
  if (!signedIn) return (
    <div className="p-8 max-w-lg">
      <h1 className="text-xl font-semibold text-slate-900">Sign in required</h1>
      <Link href="/login" className="inline-block mt-4 px-4 py-2 rounded bg-slate-900 text-white text-sm">Sign in →</Link>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Income Certification Package Compiler"
        subtitle="Select a case to compile the complete LAHD Income Certification Package. Upload supporting documents, verify the checklist, and generate the final submission PDF."
      />

      <div className="mb-4 rounded-md border border-violet-200 bg-violet-50 px-4 py-3 text-xs text-violet-900">
        <strong>Manager review required.</strong> All income calculations, eligibility determinations, and document sufficiency decisions remain the property manager&apos;s responsibility. This tool assembles the packet — it does not make determinations.
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div>
      )}

      <div className="mb-4 flex gap-3 items-center">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tenant or unit…"
          className="border rounded-md px-3 py-1.5 text-sm w-56"
        />
        <button onClick={loadCases} className="px-3 py-1.5 rounded border border-slate-200 text-sm text-slate-600 bg-white hover:bg-slate-50">
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading cases…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center max-w-xl">
          <p className="text-slate-500 text-sm">{search ? "No matching cases." : "No cases found."}</p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <table className="bx text-sm w-full">
            <thead>
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase bg-slate-50">Tenant</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase bg-slate-50">Unit</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase bg-slate-50">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase bg-slate-50">Missing</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase bg-slate-50">Ready%</th>
                <th className="bg-slate-50"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{c.primaryTenantName}</td>
                  <td className="px-4 py-3 text-slate-600">{c.unitNumber ?? "—"}</td>
                  <td className="px-4 py-3"><Badge intent={STATUS_INTENT[c.caseStatus]}>{STATUS_LABEL[c.caseStatus]}</Badge></td>
                  <td className="px-4 py-3 text-center text-xs">
                    {c.missingItemsCount > 0
                      ? <span className="text-red-700 font-semibold">{c.missingItemsCount}</span>
                      : <span className="text-emerald-600 font-medium">—</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="w-12 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${c.readinessScore >= 100 ? "bg-emerald-500" : c.readinessScore >= 70 ? "bg-amber-400" : "bg-red-400"}`}
                          style={{ width: `${c.readinessScore}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-600">{c.readinessScore}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/recertification/compiler/${c.id}`}
                      className="px-3 py-1.5 rounded bg-emerald-700 text-white text-xs hover:bg-emerald-800 whitespace-nowrap"
                    >
                      Open Compiler →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-slate-400 mt-6">
        All cases shown (including approved). Submit complete packages to Urban Futures at <code>cert@ufbahc.com</code>.
      </p>
    </>
  );
}
