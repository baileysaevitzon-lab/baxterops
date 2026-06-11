"use client";
// Sprint 40: Manager Auto-Fill Draft panel for the compiler.
// Read-only preview of the reusable derivation engine; gated apply writes only
// draft / needs_review values and never submits or overwrites manager values.

import { useState } from "react";
import {
  buildManagerAutoFillDraft, applyManagerAutoFillDraft,
  type ManagerAutoFillDraft, type ApplyResult,
} from "@/lib/services/recertManagerAutoFill";

const money = (n?: number | string) =>
  n === undefined || n === null || n === "" ? "—" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: Math.abs(Number(n) - Math.round(Number(n))) > 0.004 ? 2 : 0, maximumFractionDigits: 2 })}`;

function Conf({ c }: { c: "high" | "medium" | "low" }) {
  const cls = c === "high" ? "bg-emerald-100 text-emerald-800" : c === "medium" ? "bg-sky-100 text-sky-800" : "bg-amber-100 text-amber-800";
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ${cls}`}>{c}</span>;
}

export function ManagerAutoFillPanel({ caseId, appliedBy }: { caseId: string; appliedBy?: string }) {
  const [draft, setDraft] = useState<ManagerAutoFillDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);

  async function preview() {
    setBusy(true); setErr(null); setResult(null);
    try {
      const d = await buildManagerAutoFillDraft(caseId);
      if (!d) setErr("Could not build a draft for this case.");
      setDraft(d);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  async function apply(opts: { rentLimits?: boolean; ua?: boolean; incomeAssets?: boolean }) {
    const what = [opts.ua && "utility allowance", opts.rentLimits && "rent/income limits", opts.incomeAssets && "proposed income/asset rows"].filter(Boolean).join(", ");
    if (!window.confirm(`Apply ${what} as DRAFT / needs_review values?\n\nThis will NOT submit, will NOT mark the manager form complete, and will NOT overwrite existing manager-entered values. You can review and edit everything afterward.`)) return;
    setBusy(true); setErr(null);
    try {
      const r = await applyManagerAutoFillDraft(caseId, {
        applyUtilityAllowance: opts.ua, applyRentLimits: opts.rentLimits,
        applyProposedIncomeAssets: opts.incomeAssets, overwriteExisting: false, appliedBy,
      });
      setResult(r);
      await preview(); // refresh
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="text-sm font-bold text-slate-900">
          Manager Auto-Fill Draft <span className="font-normal text-xs text-slate-500">(reusable derivation — preview only; nothing is written until you apply)</span>
        </h2>
        <div className="flex gap-2">
          <button onClick={preview} disabled={busy} className="text-xs px-2 py-1 rounded bg-indigo-600 text-white disabled:opacity-50">
            {busy ? "Working…" : draft ? "Refresh draft" : "Preview Auto-Fill Draft"}
          </button>
          {draft && <button onClick={() => { setDraft(null); setResult(null); }} className="text-xs px-2 py-1 rounded border border-slate-300">Clear</button>}
        </div>
      </div>

      {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2 my-2">{err}</div>}
      {result && (
        <div className="text-xs bg-white border border-slate-200 rounded p-2 my-2 space-y-0.5">
          <div className="font-semibold">Apply result:</div>
          {result.applied.map((a, i) => <div key={i} className="text-emerald-700">✓ {a}</div>)}
          {result.skipped.map((a, i) => <div key={i} className="text-slate-500">↷ skipped: {a}</div>)}
          {result.errors.map((a, i) => <div key={i} className="text-rose-700">✗ {a}</div>)}
        </div>
      )}

      {draft && (
        <div className="space-y-3 mt-2 text-xs">
          {/* Utility allowance */}
          <section className="bg-white rounded border border-slate-200 p-2">
            <div className="font-semibold text-slate-700 mb-1">Utility allowance {draft.ua.total && <Conf c={draft.ua.total.confidence} />}</div>
            {draft.ua.total ? (
              <>
                <div>Computed <strong>{money(draft.ua.total.value)}</strong> — {draft.ua.unitTypeLabel}/{draft.ua.bedroomCol}BR · {draft.ua.components.map(c => `${c.component.replace(/_/g, " ")} $${c.amount}`).join(" + ")}{draft.ua.scepIncluded ? " · SCEP applies" : ""}</div>
                <div className="text-slate-400">→ fields {draft.ua.total.fieldTargets.join(", ")}</div>
              </>
            ) : <div className="text-amber-700">{draft.ua.warnings[0]}</div>}
            {draft.ua.conflicts.map((c, i) => <div key={i} className="text-rose-700">⚠ {c}</div>)}
            {draft.ua.warnings.map((w, i) => <div key={i} className="text-slate-500">• {w}</div>)}
            {draft.ua.total && <button onClick={() => apply({ ua: true })} disabled={busy} className="mt-1 text-[11px] px-2 py-0.5 rounded border border-indigo-300 text-indigo-700">Apply UA as draft</button>}
          </section>

          {/* Rent / subsidy */}
          <section className="bg-white rounded border border-slate-200 p-2">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-slate-700 mb-1">Rent / subsidy</div>
              <button onClick={() => apply({ rentLimits: true })} disabled={busy} className="text-[11px] px-2 py-0.5 rounded border border-indigo-300 text-indigo-700">Apply covenant limits as draft</button>
            </div>
            <table className="w-full">
              <tbody>
                {draft.rent.map(f => (
                  <tr key={f.key} className="border-t border-slate-50">
                    <td className="py-0.5 pr-2">{f.label}</td>
                    <td className="py-0.5 pr-2 font-medium">{f.value != null ? (typeof f.value === "number" || /^\d/.test(String(f.value)) ? money(f.value) : String(f.value)) : <span className="text-slate-300">—</span>}</td>
                    <td className="py-0.5 pr-2"><Conf c={f.confidence} /></td>
                    <td className="py-0.5 pr-2 text-slate-500">{f.autoDerived ? `auto · ${f.provenance}` : `manager · ${f.provenance}`}</td>
                    <td className="py-0.5 text-slate-400">{f.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Income */}
          <section className="bg-white rounded border border-slate-200 p-2">
            <div className="font-semibold text-slate-700 mb-1">Income ({draft.income.existingApproved} manager-approved)</div>
            {draft.income.proposed.length === 0 && <div className="text-slate-400">No income sources or income docs found.</div>}
            {draft.income.proposed.map((p, i) => (
              <div key={i} className="border-t border-slate-50 py-0.5">
                <span className="font-medium">{p.incomeType.replace(/_/g, " ")}</span> {p.sourceName ? `· ${p.sourceName} ` : ""}
                {p.annual != null ? `· ${money(p.annual)}/yr` : "· amount needed"} <Conf c={p.confidence} />
                {p.alreadyExists ? <span className="text-emerald-600"> (exists)</span> : <span className="text-amber-600"> (proposed)</span>}
                <div className="text-slate-400">{p.notes}</div>
              </div>
            ))}
            {draft.income.warnings.map((w, i) => <div key={i} className="text-rose-700">⚠ {w}</div>)}
          </section>

          {/* Assets */}
          <section className="bg-white rounded border border-slate-200 p-2">
            <div className="font-semibold text-slate-700 mb-1">Assets ({draft.assets.existingCount} existing)</div>
            {draft.assets.proposed.length === 0 && <div className="text-slate-400">No asset rows or bank statements found.</div>}
            {draft.assets.proposed.map((p, i) => (
              <div key={i} className="border-t border-slate-50 py-0.5">
                <span className="font-medium">{p.accountType}</span>{p.institutionName ? ` · ${p.institutionName}` : ""}{p.lastFour ? ` ····${p.lastFour}` : ""} · {p.endingBalance != null ? money(p.endingBalance) : "balance needed"} <Conf c={p.confidence} />
                {p.alreadyExists ? <span className="text-emerald-600"> (exists)</span> : <span className="text-amber-600"> (proposed)</span>}
                <div className="text-slate-400">{p.notes}</div>
              </div>
            ))}
          </section>

          {(draft.income.proposed.some(p => !p.alreadyExists) || draft.assets.proposed.some(p => !p.alreadyExists)) && (
            <button onClick={() => apply({ incomeAssets: true })} disabled={busy} className="text-[11px] px-2 py-0.5 rounded border border-indigo-300 text-indigo-700">Add proposed income/asset rows (blank amounts, needs review)</button>
          )}

          {/* Docs + missing + conflicts */}
          <div className="grid md:grid-cols-2 gap-2">
            <section className="bg-white rounded border border-slate-200 p-2">
              <div className="font-semibold text-slate-700 mb-1">Required docs: {draft.docs.satisfied}/{draft.docs.requiredTotal} satisfied · {draft.docs.needsReview} to review</div>
              {draft.docs.missing.length > 0 && <div className="text-amber-700">Missing: {draft.docs.missing.join(", ")}</div>}
            </section>
            <section className="bg-white rounded border border-amber-200 p-2">
              <div className="font-semibold text-amber-800 mb-1">Needs manager / Katherine ({draft.missingManagerInputs.length})</div>
              <ul className="list-disc pl-4 text-slate-600">{draft.missingManagerInputs.map((m, i) => <li key={i}>{m}</li>)}</ul>
            </section>
          </div>
          {draft.conflicts.length > 0 && (
            <section className="bg-rose-50 rounded border border-rose-200 p-2">
              <div className="font-semibold text-rose-800 mb-1">Conflicts ({draft.conflicts.length})</div>
              <ul className="list-disc pl-4 text-rose-700">{draft.conflicts.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </section>
          )}

          <p className="text-[10px] text-slate-400">
            Applying writes draft / needs_review values only — never submits, never marks the manager form complete, never overwrites existing manager-entered values. Review and approve each value before generating the final packet.
          </p>
        </div>
      )}
    </div>
  );
}
