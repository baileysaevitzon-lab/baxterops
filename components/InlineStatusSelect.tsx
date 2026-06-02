"use client";
// Sprint 24 — Reusable inline status dropdown (Airtable-style manual override).
//
// Renders a colored status <select> that persists via a parent-supplied async
// onSave (the parent owns Supabase persistence + provenance — this component
// only handles the dropdown UI and the saving/saved/failed indicator).
//
// Design rules it enforces:
//   - dropdown for known statuses (no free typing)
//   - visible save state: saving / saved / failed
//   - optional confirm() gate for sensitive transitions
//   - never local-only: onSave must hit Supabase and throw on failure
//
// Usage:
//   <InlineStatusSelect
//     value={c.caseStatus}
//     options={CASE_STATUS_OPTIONS}
//     onSave={async (next) => { await updateCaseStatus(c, next, actor); }}
//   />

import { useState } from "react";

export interface StatusOption<T extends string = string> {
  value: T;
  label: string;
  intent?: "good" | "warn" | "bad" | "info" | "neutral";
}

type SaveState = "idle" | "saving" | "saved" | "error";

interface Props<T extends string> {
  value: T;
  options: StatusOption<T>[];
  /** Persist the new value. MUST hit Supabase and throw on failure. */
  onSave: (next: T) => Promise<void>;
  disabled?: boolean;
  /** Return a confirmation message to gate a sensitive change, or null to allow silently. */
  confirm?: (next: T) => string | null;
  className?: string;
}

const INTENT_STYLES: Record<NonNullable<StatusOption["intent"]>, string> = {
  good: "border-emerald-300 bg-emerald-50 text-emerald-800",
  warn: "border-amber-300 bg-amber-50 text-amber-800",
  bad: "border-rose-300 bg-rose-50 text-rose-800",
  info: "border-sky-300 bg-sky-50 text-sky-800",
  neutral: "border-slate-300 bg-white text-slate-700",
};

export function InlineStatusSelect<T extends string>({
  value,
  options,
  onSave,
  disabled = false,
  confirm,
  className = "",
}: Props<T>) {
  const [state, setState] = useState<SaveState>("idle");
  const [err, setErr] = useState<string | null>(null);

  async function handleChange(next: T) {
    if (next === value) return;
    if (confirm) {
      const msg = confirm(next);
      if (msg && typeof window !== "undefined" && !window.confirm(msg)) return;
    }
    setState("saving");
    setErr(null);
    try {
      await onSave(next);
      setState("saved");
      setTimeout(() => setState(s => (s === "saved" ? "idle" : s)), 1800);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
      setState("error");
    }
  }

  const intent = options.find(o => o.value === value)?.intent ?? "neutral";

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <select
        value={value}
        disabled={disabled || state === "saving"}
        onChange={e => handleChange(e.target.value as T)}
        title={err ?? "Manually set status"}
        className={`text-xs rounded-md border px-2 py-1 cursor-pointer disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-slate-400 ${INTENT_STYLES[intent]}`}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {state === "saving" && <span className="text-[10px] text-slate-400">saving…</span>}
      {state === "saved" && <span className="text-[10px] text-emerald-600">✓ saved</span>}
      {state === "error" && (
        <span className="text-[10px] text-rose-600" title={err ?? ""}>⚠ failed</span>
      )}
    </span>
  );
}
