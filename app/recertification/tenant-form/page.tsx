"use client";
// Sprint 23: Tenant Recertification Form — case selector.
// Lists all active recertification cases and links to the per-case tenant form.
// Route: /recertification/tenant-form

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/Card";
import { InlineStatusSelect, type StatusOption } from "@/components/InlineStatusSelect";
import { useAuth } from "@/components/AuthProvider";
import { getAllCases, updateCaseStatus, createCase } from "@/lib/services/recertification";
import type { RecertificationCase, RecertCaseStatus, RecertCertType } from "@/lib/types";

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

// Canonical case-status dropdown options (writes to recertification_cases.case_status).
const CASE_STATUS_OPTIONS: StatusOption<RecertCaseStatus>[] =
  (Object.keys(STATUS_LABEL) as RecertCaseStatus[]).map(v => ({
    value: v,
    label: STATUS_LABEL[v],
    intent: STATUS_INTENT[v],
  }));

export default function TenantFormPage() {
  const { signedIn, loading: authLoading, profile, authUser } = useAuth();
  const [cases, setCases] = useState<RecertificationCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  // ── Create-case modal state ──
  const [showCreate, setShowCreate] = useState(false);
  const [cName, setCName] = useState("");
  const [cUnit, setCUnit] = useState("");
  const [cType, setCType] = useState<RecertCertType>("annual");
  const [cDue, setCDue] = useState("");
  const [cNotes, setCNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [dupWarn, setDupWarn] = useState<RecertificationCase | null>(null);

  function resetCreateForm() {
    setCName(""); setCUnit(""); setCType("annual"); setCDue(""); setCNotes("");
    setCreateError(null); setDupWarn(null); setSaving(false);
  }
  function openCreate() { resetCreateForm(); setShowCreate(true); }
  function closeCreate() { setShowCreate(false); resetCreateForm(); }

  const loadCases = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const all = await getAllCases();
      setCases(all.filter(c => !["approved", "closed_ineligible"].includes(c.caseStatus)));
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

  async function submitCreate(allowDuplicate = false) {
    setSaving(true); setCreateError(null);
    const actor = profile?.full_name ?? authUser?.email ?? undefined;
    const res = await createCase(
      { primaryTenantName: cName, unitNumber: cUnit, certificationType: cType, dueDate: cDue || undefined, notes: cNotes || undefined },
      { allowDuplicate, createdBy: actor },
    );
    setSaving(false);
    if (!res.ok) {
      if (res.duplicateOf) { setDupWarn(res.duplicateOf); return; } // warn, do not block
      setCreateError(res.error ?? "Could not create case."); return;
    }
    setShowCreate(false); resetCreateForm();
    setToast(`✓ Created case for ${res.case?.primaryTenantName} (unit ${res.case?.unitNumber}).`);
    await loadCases();
  }

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
        title="Tenant Recertification Form"
        subtitle="Select a case to open the tenant completion form. Staff fills this form on behalf of the tenant (or imports the offline version the tenant mailed back)."
      />

      {error && (
        <div className="mb-4 rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div>
      )}
      {toast && (
        <div className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 flex justify-between items-center">
          <span>{toast}</span>
          <button onClick={() => setToast(null)} className="text-emerald-700 text-xs underline">dismiss</button>
        </div>
      )}

      <div className="mb-4 flex gap-3 items-center flex-wrap">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tenant or unit…"
          className="border rounded-md px-3 py-1.5 text-sm w-56"
        />
        <button onClick={loadCases} className="px-3 py-1.5 rounded border border-slate-200 text-sm text-slate-600 bg-white hover:bg-slate-50">
          Refresh
        </button>
        <button
          onClick={openCreate}
          className="ml-auto px-4 py-1.5 rounded bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800"
        >
          + Add Tenant / Create Case
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading cases…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center max-w-xl">
          <p className="text-slate-500 text-sm">{search ? "No matching cases." : "No active cases found."}</p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <table className="bx text-sm w-full">
            <thead>
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase bg-slate-50">Tenant</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase bg-slate-50">Unit</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase bg-slate-50">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase bg-slate-50">Due</th>
                <th className="bg-slate-50"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{c.primaryTenantName}</td>
                  <td className="px-4 py-3 text-slate-600">{c.unitNumber ?? "—"}</td>
                  <td className="px-4 py-3">
                    <InlineStatusSelect
                      value={c.caseStatus}
                      options={CASE_STATUS_OPTIONS}
                      onSave={async (next) => {
                        const actor = profile?.full_name ?? authUser?.email ?? undefined;
                        const updated = await updateCaseStatus(c, next, actor, "manual_override");
                        setCases(prev => prev.map(x => (x.id === c.id ? updated : x)));
                      }}
                    />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{c.dueDate ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/recertification/${c.id}/tenant-doc`}
                      className="px-3 py-1.5 rounded bg-slate-900 text-white text-xs hover:bg-slate-700 whitespace-nowrap"
                    >
                      Open Tenant Form →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-slate-400 mt-6">
        Showing active cases only. Approved and closed cases are hidden.{" "}
        <Link href="/recertification" className="underline">View all cases →</Link>
      </p>

      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={closeCreate}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-1">
              <h2 className="text-lg font-semibold text-slate-900">Create recertification case</h2>
              <button onClick={closeCreate} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
            </div>
            <p className="text-xs text-slate-500 mb-4">Saves a new case to Supabase. Status defaults to “Not Started”. The case id is generated automatically.</p>

            {createError && <div className="mb-3 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{createError}</div>}
            {dupWarn && (
              <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                ⚠ A case for <strong>{dupWarn.primaryTenantName}</strong> in unit <strong>{dupWarn.unitNumber ?? "—"}</strong> already exists. Create another anyway?
                <div className="mt-2 flex gap-2">
                  <button onClick={() => submitCreate(true)} disabled={saving} className="px-3 py-1 rounded bg-amber-600 text-white text-xs disabled:opacity-50">{saving ? "Creating…" : "Create anyway"}</button>
                  <button onClick={() => setDupWarn(null)} className="px-3 py-1 rounded border border-slate-300 text-xs text-slate-600">Keep editing</button>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-600 mb-1">Tenant full name <span className="text-rose-500">*</span></label>
                <input value={cName} onChange={e => { setCName(e.target.value); setDupWarn(null); }} placeholder="e.g. Jane Doe" className="w-full px-3 py-2 rounded border border-slate-300 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Unit number <span className="text-rose-500">*</span></label>
                <input value={cUnit} onChange={e => { setCUnit(e.target.value); setDupWarn(null); }} placeholder="e.g. 502" className="w-full px-3 py-2 rounded border border-slate-300 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Case type</label>
                <select value={cType} onChange={e => setCType(e.target.value as RecertCertType)} className="w-full px-3 py-2 rounded border border-slate-300 text-sm bg-white">
                  <option value="annual">Annual</option>
                  <option value="initial">Initial</option>
                  <option value="move_in">Move-in</option>
                  <option value="correction">Correction</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Due date (optional)</label>
                <input type="date" value={cDue} onChange={e => setCDue(e.target.value)} className="w-full px-3 py-2 rounded border border-slate-300 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Notes (optional)</label>
                <textarea value={cNotes} onChange={e => setCNotes(e.target.value)} rows={2} placeholder="Any context for staff" className="w-full px-3 py-2 rounded border border-slate-300 text-sm" />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={closeCreate} disabled={saving} className="px-4 py-2 rounded border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              <button
                onClick={() => submitCreate(false)}
                disabled={saving || !cName.trim() || !cUnit.trim()}
                className="px-4 py-2 rounded bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800 disabled:opacity-50"
              >
                {saving ? "Creating…" : "Create Tenant"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
