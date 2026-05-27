"use client";
import { useState } from "react";
import { RatingStars } from "./RatingStars";
import { BooleanSegment } from "./BooleanSegment";
import { EnumSegment } from "./EnumSegment";
import type { CovariateFormField } from "@/lib/covariateRubric";
import { rubricFor } from "@/lib/covariateRubric";

export type ScoreState = "saved" | "unsaved" | "saving" | "error";

interface Props {
  field: CovariateFormField;
  value: number | boolean | string | undefined;
  onChange: (v: number | boolean | string | undefined) => void;
  notes: string;
  onNotesChange: (s: string) => void;
  state?: ScoreState;
  compact?: boolean;
}

export function CovariateScoreCard({ field, value, onChange, notes, onNotesChange, state = "saved", compact }: Props) {
  const [showNote, setShowNote] = useState(Boolean(notes));
  const rubric = rubricFor(field.key);
  const ratingLabels = rubric ? (Object.fromEntries(Object.entries(rubric).map(([k, v]) => [Number(k), v])) as Record<number, string>) : undefined;

  return (
    <div className={`bg-white rounded-lg border ${state === "unsaved" ? "border-amber-300" : "border-slate-200"} ${compact ? "p-3" : "p-4"}`}>
      <div className="flex justify-between items-start mb-2">
        <div>
          <div className="text-sm font-medium text-slate-800">{field.label}</div>
          {field.type === "rating_1_5" && rubric && (
            <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">1 = {rubric["1"]} · 5 = {rubric["5"]}</div>
          )}
        </div>
        <StateBadge state={state} />
      </div>

      <div>
        {field.type === "rating_1_5" && (
          <RatingStars value={typeof value === "number" ? value : undefined} onChange={onChange} labels={ratingLabels} />
        )}
        {field.type === "boolean" && (
          <BooleanSegment value={typeof value === "boolean" ? value : undefined} onChange={v => onChange(v)} />
        )}
        {field.type === "enum" && (
          <EnumSegment value={typeof value === "string" ? value : undefined} onChange={v => onChange(v)} options={field.enumValues ?? []} />
        )}
        {field.type === "number" && (
          <input
            type="number"
            value={typeof value === "number" ? value : ""}
            onChange={e => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
            className="w-32 h-10 border border-slate-200 rounded-md px-3 text-sm"
            placeholder={field.unit ?? ""}
          />
        )}
      </div>

      <div className="mt-2">
        {showNote ? (
          <input
            value={notes}
            onChange={e => onNotesChange(e.target.value)}
            placeholder="optional note"
            className="w-full border border-slate-200 rounded-md px-2 py-1 text-xs"
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowNote(true)}
            className="text-[11px] text-slate-400 hover:text-slate-600"
          >+ add note</button>
        )}
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: ScoreState }) {
  if (state === "saving") return <span className="text-[10px] text-sky-600">saving…</span>;
  if (state === "unsaved") return <span className="text-[10px] text-amber-600">unsaved</span>;
  if (state === "error") return <span className="text-[10px] text-rose-600">save failed</span>;
  return null;
}
