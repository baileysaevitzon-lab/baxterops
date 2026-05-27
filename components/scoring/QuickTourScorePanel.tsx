"use client";
// Sprint 6.1 — Quick Tour Grading panel.
//
// Field-usable: large tap targets, grouped sections, live composite, autosave per field.
// Drops into walkthrough-campaigns and competitors/zen-hollywood without admin overhead.

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardBody, CardHeader, Badge } from "@/components/Card";
import { CovariateScoreCard, type ScoreState } from "./CovariateScoreCard";
import { COVARIATE_FIELDS, COMPOSITE_WEIGHTS, compositeBand } from "@/lib/covariateRubric";
import { getCovariatesForTour, saveCovariate } from "@/lib/services/manualCovariates";
import { bulkUpsertLedger } from "@/lib/services/sourceLedger";
import { useSourceLedger } from "@/components/SourceLedgerProvider";
import { useRole } from "@/components/RoleProvider";
import type { DataSourceLedgerRow, ManualCovariateScore } from "@/lib/types";

interface Props {
  fieldTourId: string;
  competitorId: string;
  competitorName: string;
  onSaved?: () => void;
  /** Skip section grouping (compact one-flow layout). */
  compact?: boolean;
}

// Section groupings per spec
const SECTIONS: Array<{ label: string; keys: string[] }> = [
  { label: "Booking", keys: ["tour_booking_ease", "response_speed_hours"] },
  { label: "Leasing Agent", keys: ["kindness", "professionalism"] },
  { label: "Building / Cleanliness", keys: ["cleanliness", "hallway_quality", "common_area_quality"] },
  { label: "Amenities / Unit", keys: ["amenity_quality", "unit_quality", "tour_quality"] },
  { label: "Concessions / Closing", keys: ["closing_strength", "follow_up_quality", "desperation_vs_confidence", "pressure_level", "drinks_or_snacks_offered", "hidden_concession_offered", "parking_deal_offered", "fees_waivable"] },
  { label: "Final Verdict", keys: ["would_renter_choose_over_baxter"] },
];

type Val = number | boolean | string | undefined;

export function QuickTourScorePanel({ fieldTourId, competitorId, competitorName, onSaved, compact }: Props) {
  const { user } = useRole();
  const ledger = useSourceLedger();
  const [values, setValues] = useState<Record<string, Val>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [stateByKey, setStateByKey] = useState<Record<string, ScoreState>>({});
  const [loaded, setLoaded] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(Object.fromEntries(SECTIONS.map(s => [s.label, true])));
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  async function reload() {
    const rows = await getCovariatesForTour(fieldTourId);
    const v: Record<string, Val> = {}; const n: Record<string, string> = {};
    for (const r of rows) {
      v[r.covariateKey] = r.scoreValueNumber ?? r.scoreValueBoolean ?? r.scoreValueText;
      if (r.notes) n[r.covariateKey] = r.notes;
    }
    setValues(v); setNotes(n); setLoaded(true);
    setStateByKey({});
  }
  useEffect(() => { reload(); }, [fieldTourId]);

  // Persist one covariate. Mirrors a ledger row. Auto-fills source metadata.
  async function persist(key: string, val: Val, note: string) {
    if (val === undefined || val === "") return; // skip empty
    setStateByKey(s => ({ ...s, [key]: "saving" }));
    try {
      const field = COVARIATE_FIELDS.find(f => f.key === key);
      const now = new Date().toISOString();
      const score: ManualCovariateScore = {
        id: `cov-${fieldTourId}-${key}`,
        entityType: "field_tour",
        entityId: fieldTourId,
        entityName: `${competitorName} tour`,
        fieldTourId,
        competitorId,
        competitorName,
        covariateKey: key,
        covariateLabel: field?.label,
        covariateCategory: "manual_field_tour",
        scoreType: field?.type === "rating_1_5" ? "rating_1_5"
                 : field?.type === "boolean" ? "boolean"
                 : field?.type === "enum" ? "enum"
                 : "numeric",
        scoredBy: user.name,
        scoredAt: now,
        confidence: "high",
        notes: note,
        sourceLabel: "Manual field-tour score",
      };
      if (field?.type === "rating_1_5" || field?.type === "number") score.scoreValueNumber = typeof val === "number" ? val : Number(val);
      else if (field?.type === "boolean") score.scoreValueBoolean = typeof val === "boolean" ? val : val === "true";
      else if (field?.type === "enum") score.scoreValueText = String(val);

      await saveCovariate(score);

      const ledgerRow: DataSourceLedgerRow = {
        id: `led-${score.id}`,
        entityType: "field_tour",
        entityId: fieldTourId,
        entityName: `${competitorName} tour`,
        fieldKey: key,
        fieldLabel: field?.label,
        fieldCategory: "subjective_covariate",
        valueType: field?.type === "boolean" ? "boolean" : field?.type === "enum" ? "text" : "score",
        valueNumber: score.scoreValueNumber,
        valueBoolean: score.scoreValueBoolean,
        valueText: score.scoreValueText,
        displayValue:
          score.scoreValueText ??
          (typeof score.scoreValueNumber === "number" ? `${score.scoreValueNumber}/5` :
           score.scoreValueBoolean !== undefined ? (score.scoreValueBoolean ? "yes" : "no") : "—"),
        pageRoutes: ["/walkthrough-campaigns", `/competitors/${competitorId.replace("c-", "")}`, "/comp-matching"],
        sourceType: "manual_entry",
        sourceName: "Manual field-tour score",
        sourceNote: "Entered by user in Quick Tour Grading UI",
        sourceDate: now.slice(0, 10),
        collectedBy: user.name,
        lastVerifiedAt: now,
        verifiedBy: user.name,
        verificationStatus: "verified",
        confidence: "high",
        entryMethod: "manual_user_entry",
        requiresManualVerification: false,
        staleAfterDays: 90,
        updatedAt: now,
      };
      await bulkUpsertLedger([ledgerRow]);
      await ledger?.refresh();
      setStateByKey(s => ({ ...s, [key]: "saved" }));
      onSaved?.();
    } catch (e) {
      console.warn("[QuickTourScorePanel] save failed:", e);
      setStateByKey(s => ({ ...s, [key]: "error" }));
    }
  }

  // Debounced autosave on any change
  function setValue(key: string, v: Val) {
    setValues(prev => ({ ...prev, [key]: v }));
    setStateByKey(s => ({ ...s, [key]: "unsaved" }));
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => persist(key, v, notes[key] ?? ""), 400);
  }
  function setNote(key: string, n: string) {
    setNotes(prev => ({ ...prev, [key]: n }));
    setStateByKey(s => ({ ...s, [key]: "unsaved" }));
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => persist(key, values[key], n), 800);
  }

  // Composite from saved + currently-entered values
  const composite = useMemo(() => {
    let total = 0, weight = 0;
    for (const k of Object.keys(COMPOSITE_WEIGHTS)) {
      const v = values[k];
      if (typeof v === "number") { total += v * COMPOSITE_WEIGHTS[k]; weight += COMPOSITE_WEIGHTS[k]; }
    }
    return weight > 0 ? Math.round((total / weight) * 10) / 10 : 0;
  }, [values]);

  const scored = COVARIATE_FIELDS.filter(f => values[f.key] !== undefined && values[f.key] !== "").length;
  const total = COVARIATE_FIELDS.length;

  if (!loaded) return <p className="p-4 text-sm text-slate-500">Loading scores…</p>;

  const renderCard = (key: string) => {
    const field = COVARIATE_FIELDS.find(f => f.key === key);
    if (!field) return null;
    return (
      <CovariateScoreCard
        key={key}
        field={field}
        value={values[key]}
        onChange={v => setValue(key, v)}
        notes={notes[key] ?? ""}
        onNotesChange={n => setNote(key, n)}
        state={stateByKey[key] ?? "saved"}
        compact={compact}
      />
    );
  };

  return (
    <Card>
      <CardHeader
        title={`Quick Tour Grading — ${competitorName}`}
        subtitle={`${scored} / ${total} scored · composite ${composite.toFixed(1)} (${compositeBand(composite)}) · autosaves to Supabase`}
        action={
          <div className="flex items-center gap-3 text-xs">
            <Badge intent={composite >= 4 ? "good" : composite >= 3 ? "warn" : "bad"}>
              {composite.toFixed(1)} / 5 · {compositeBand(composite)}
            </Badge>
            <div className="bg-slate-100 rounded-full overflow-hidden w-32 h-2">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(scored / total) * 100}%` }} />
            </div>
          </div>
        }
      />
      <CardBody>
        <div className="space-y-6">
          {SECTIONS.map(section => (
            <div key={section.label}>
              <button
                type="button"
                onClick={() => setOpenSections(s => ({ ...s, [section.label]: !s[section.label] }))}
                className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2 hover:text-slate-900"
              >
                <span className="text-slate-400">{openSections[section.label] ? "▾" : "▸"}</span>
                {section.label}
                <span className="text-xs text-slate-400">
                  ({section.keys.filter(k => values[k] !== undefined && values[k] !== "").length} / {section.keys.length})
                </span>
              </button>
              {openSections[section.label] && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {section.keys.map(renderCard)}
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mt-4">
          Autosaves to <code>manual_covariate_scores</code> ~0.4s after each click. Source metadata auto-filled: <code>manual_entry</code> · scored by <strong>{user.name}</strong> · today · field tour <code>{fieldTourId}</code>.
        </p>
      </CardBody>
    </Card>
  );
}
