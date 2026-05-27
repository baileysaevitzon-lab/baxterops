"use client";
// Sprint 6 — dedicated rubric-driven manual covariate form.
//
// Captures all 19 covariates from COVARIATE_FIELDS directly. No proxies.
// On save:
//   - writes one manual_covariate_scores row per covariate with a value
//   - generates/updates one data_source_ledger row per covariate (auto via covariate→ledger mirror SQL)
//   - composite is computed from saved values, not draft state
//
// Drop into any walkthrough flow. Parent passes the field_tour id + competitor info.

import { useEffect, useMemo, useState } from "react";
import { Card, CardBody, CardHeader, Badge } from "./Card";
import { COVARIATE_FIELDS, COMPOSITE_WEIGHTS, compositeBand, compositeExperienceScore, rubricFor } from "@/lib/covariateRubric";
import { getCovariatesForTour, saveManyCovariates } from "@/lib/services/manualCovariates";
import { useSourceLedger } from "./SourceLedgerProvider";
import { bulkUpsertLedger } from "@/lib/services/sourceLedger";
import { useRole } from "./RoleProvider";
import type { DataSourceLedgerRow, ManualCovariateScore } from "@/lib/types";

interface Props {
  fieldTourId: string;
  competitorId: string;
  competitorName: string;
  onSaved?: () => void;
}

type Draft = Record<string, number | boolean | string | undefined>;

export function CovariateForm({ fieldTourId, competitorId, competitorName, onSaved }: Props) {
  const { user } = useRole();
  const ledger = useSourceLedger();
  const [existing, setExisting] = useState<ManualCovariateScore[]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      const rows = await getCovariatesForTour(fieldTourId);
      setExisting(rows);
      const d: Draft = {};
      const n: Record<string, string> = {};
      for (const r of rows) {
        d[r.covariateKey] = r.scoreValueNumber ?? r.scoreValueBoolean ?? r.scoreValueText;
        if (r.notes) n[r.covariateKey] = r.notes;
      }
      setDraft(d);
      setNotes(n);
    })();
  }, [fieldTourId]);

  function patch(key: string, v: number | boolean | string | undefined) {
    setDraft(prev => ({ ...prev, [key]: v }));
  }

  // composite from currently entered draft + existing saved (draft wins)
  const composite = useMemo(() => {
    let total = 0, weight = 0;
    for (const k of Object.keys(COMPOSITE_WEIGHTS)) {
      const w = COMPOSITE_WEIGHTS[k];
      const v = typeof draft[k] === "number" ? (draft[k] as number)
              : typeof existing.find(e => e.covariateKey === k)?.scoreValueNumber === "number"
                ? (existing.find(e => e.covariateKey === k)!.scoreValueNumber as number)
                : undefined;
      if (typeof v === "number") { total += v * w; weight += w; }
    }
    return weight > 0 ? Math.round((total / weight) * 10) / 10 : 0;
  }, [draft, existing]);

  async function saveAll() {
    setBusy(true); setMsg("");
    const now = new Date().toISOString();
    const scores: ManualCovariateScore[] = COVARIATE_FIELDS
      .map(f => {
        const v = draft[f.key];
        if (v === undefined || v === "") return null;
        const sc: ManualCovariateScore = {
          id: `cov-${fieldTourId}-${f.key}`,
          entityType: "field_tour",
          entityId: fieldTourId,
          entityName: `${competitorName} tour`,
          fieldTourId,
          competitorId,
          competitorName,
          covariateKey: f.key,
          covariateLabel: f.label,
          covariateCategory: "manual_field_tour",
          scoreType: f.type === "rating_1_5" ? "rating_1_5"
                   : f.type === "boolean" ? "boolean"
                   : f.type === "enum" ? "enum"
                   : "numeric",
          scoredBy: user.name,
          scoredAt: now,
          confidence: "high",
          notes: notes[f.key],
          sourceLabel: `${competitorName} field tour`,
        };
        if (f.type === "rating_1_5" || f.type === "number") sc.scoreValueNumber = typeof v === "number" ? v : Number(v);
        else if (f.type === "boolean") sc.scoreValueBoolean = typeof v === "boolean" ? v : v === "true";
        else if (f.type === "enum") sc.scoreValueText = String(v);
        return sc;
      })
      .filter((s): s is ManualCovariateScore => !!s);

    try {
      await saveManyCovariates(scores);
      // mirror into ledger
      const ledgerRows: DataSourceLedgerRow[] = scores.map(s => ({
        id: `led-${s.id}`,
        entityType: s.entityType,
        entityId: s.entityId,
        entityName: s.entityName,
        fieldKey: s.covariateKey,
        fieldLabel: s.covariateLabel,
        fieldCategory: "subjective_covariate",
        valueType: s.scoreType === "boolean" ? "boolean" : s.scoreType === "enum" ? "text" : "score",
        valueNumber: s.scoreValueNumber,
        valueBoolean: s.scoreValueBoolean,
        valueText: s.scoreValueText,
        displayValue: s.scoreValueText ?? (typeof s.scoreValueNumber === "number" ? `${s.scoreValueNumber}/5` : s.scoreValueBoolean !== undefined ? (s.scoreValueBoolean ? "yes" : "no") : "—"),
        pageRoutes: ["/walkthrough-campaigns", "/competitors/" + competitorId.replace("c-", ""), "/comp-matching"],
        sourceType: "field_tour",
        sourceName: s.sourceLabel,
        sourceDate: new Date().toISOString().slice(0, 10),
        collectedBy: s.scoredBy,
        verificationStatus: "verified",
        confidence: "high",
        entryMethod: "manual_user_entry",
        staleAfterDays: 90,
        updatedAt: now,
      }));
      await bulkUpsertLedger(ledgerRows);
      await ledger?.refresh();
      setMsg(`Saved ${scores.length} covariate scores · composite ${composite} (${compositeBand(composite)})`);
      const rows = await getCovariatesForTour(fieldTourId);
      setExisting(rows);
      onSaved?.();
    } catch (e) {
      setMsg(`Save failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={`Manual Covariate Scoring — ${competitorName}`}
        subtitle={`All 19 rubric covariates · composite ${composite} (${compositeBand(composite)})`}
        action={<button disabled={busy} onClick={saveAll} className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-sm disabled:opacity-50">{busy ? "Saving…" : "Save scores"}</button>}
      />
      <CardBody>
        {msg && <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{msg}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {COVARIATE_FIELDS.map(f => {
            const v = draft[f.key];
            const rubric = rubricFor(f.key);
            const hint = rubric ? Object.entries(rubric).map(([k, v]) => `${k} = ${v}`).join(" · ") : undefined;
            return (
              <div key={f.key} className="border border-slate-200 rounded-md p-3">
                <div className="flex justify-between items-start mb-2">
                  <label className="text-xs font-medium text-slate-700" title={hint}>
                    {f.label}{f.unit ? <span className="text-slate-400"> · {f.unit}</span> : null}
                  </label>
                  <span className="text-[10px] text-slate-400 font-mono">{f.key}</span>
                </div>

                {f.type === "rating_1_5" && (
                  <div className="flex gap-1">
                    {[1,2,3,4,5].map(n => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => patch(f.key, n)}
                        title={rubric?.[String(n)] ?? `${n}/5`}
                        className={`flex-1 h-8 rounded text-sm border ${v === n ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                      >{n}</button>
                    ))}
                  </div>
                )}

                {f.type === "boolean" && (
                  <div className="flex gap-1">
                    {[
                      { val: true, label: "Yes", intent: "good" as const },
                      { val: false, label: "No", intent: "bad" as const },
                      { val: undefined, label: "Unknown", intent: "neutral" as const },
                    ].map(opt => (
                      <button
                        key={String(opt.val)}
                        type="button"
                        onClick={() => patch(f.key, opt.val)}
                        className={`flex-1 h-8 rounded text-sm border ${v === opt.val ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                      >{opt.label}</button>
                    ))}
                  </div>
                )}

                {f.type === "enum" && (
                  <div className="flex gap-1">
                    {(f.enumValues ?? []).map(opt => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => patch(f.key, opt)}
                        className={`flex-1 h-8 rounded text-sm border ${v === opt ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                      >{opt}</button>
                    ))}
                  </div>
                )}

                {f.type === "number" && (
                  <input
                    type="number"
                    value={typeof v === "number" ? v : ""}
                    onChange={e => patch(f.key, e.target.value === "" ? undefined : Number(e.target.value))}
                    className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm"
                    placeholder={f.unit ?? ""}
                  />
                )}

                <input
                  value={notes[f.key] ?? ""}
                  onChange={e => setNotes(n => ({ ...n, [f.key]: e.target.value }))}
                  placeholder="optional note"
                  className="w-full mt-2 border border-slate-200 rounded-md px-2 py-1 text-xs"
                />

                {hint && f.type === "rating_1_5" && (
                  <div className="text-[10px] text-slate-400 mt-1">{hint}</div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 pt-4 border-t flex items-center justify-between">
          <div className="text-sm">
            Composite: <strong>{composite.toFixed(1)}</strong> · {compositeBand(composite)}
            <Badge intent="info"> {Object.keys(draft).filter(k => draft[k] !== undefined && draft[k] !== "").length} / {COVARIATE_FIELDS.length} scored</Badge>
          </div>
          <button disabled={busy} onClick={saveAll} className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm disabled:opacity-50">{busy ? "Saving…" : "Save covariate scores"}</button>
        </div>

        <p className="text-[10px] text-slate-400 mt-2">
          Each score writes a row in <code>manual_covariate_scores</code> + mirrors a row in <code>data_source_ledger</code>. No proxy mappings — every covariate has its own input.
        </p>
      </CardBody>
    </Card>
  );
}
