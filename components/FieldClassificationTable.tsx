// Sprint 16: editable field-classification table for the exact-form-fill workflow.
// Renders every mapped field with inline edit controls (fill status, owner,
// confidence, manual value, notes). Supports bulk select + bulk actions and
// filters. Refuses to mark signature fields as filled_known without explicit
// double-confirmation.

"use client";

import { useMemo, useState } from "react";
import type { FieldFillResult, FillStatus } from "@/lib/services/recertExactFormFill";
import { SIGNATURE_FIELD_NAMES } from "@/lib/services/recertExactFormFill";
import type {
  CaseFieldOverride,
  CompletionOwner,
  Confidence,
  ValueSource,
} from "@/lib/services/recertFieldOverrides";

const FILL_STATUSES: { value: FillStatus; label: string; chip: string }[] = [
  { value: "filled_known",                label: "Filled (known)",      chip: "bg-emerald-100 text-emerald-800" },
  { value: "blank_tenant_must_complete",  label: "Tenant must complete", chip: "bg-amber-100 text-amber-800" },
  { value: "blank_manager_must_complete", label: "Manager must complete", chip: "bg-blue-100 text-blue-800" },
  { value: "blank_pending_external",      label: "Pending (HACLA/other)", chip: "bg-amber-100 text-amber-800" },
  { value: "blank_missing_data",          label: "Missing data",         chip: "bg-rose-100 text-rose-800" },
  { value: "needs_review",                label: "Needs review",         chip: "bg-blue-100 text-blue-800" },
  { value: "not_applicable",              label: "Not applicable",       chip: "bg-slate-100 text-slate-600" },
];

const OWNERS: { value: CompletionOwner; label: string }[] = [
  { value: "baxterops",     label: "BaxterOps" },
  { value: "tenant",        label: "Tenant" },
  { value: "manager",       label: "Manager" },
  { value: "employer",      label: "Employer (VOE)" },
  { value: "urban_futures", label: "Urban Futures" },
  { value: "hacla",         label: "HACLA" },
  { value: "unknown",       label: "Unknown" },
];

const CONFIDENCES: Confidence[] = ["high", "medium", "low"];

const VALUE_SOURCES: { value: ValueSource; label: string }[] = [
  { value: "case_data",            label: "Case data" },
  { value: "household_member",     label: "Household member" },
  { value: "income_calculation",   label: "Income calc" },
  { value: "asset_calculation",    label: "Asset calc" },
  { value: "utility_allowance",    label: "Utility allowance" },
  { value: "manager_constant",     label: "Manager constant" },
  { value: "manual_override",      label: "Manual override" },
  { value: "leave_blank",          label: "Leave blank" },
];

export interface FieldRow extends FieldFillResult {
  /** Active override row, if any. */
  override?: CaseFieldOverride;
}

interface Props {
  rows: FieldRow[];
  /** Save one field's classification. Returns ok + optional error. */
  onSaveOne: (fieldName: string, patch: Partial<CaseFieldOverride>, confirmSignatureFill?: boolean) => Promise<{ ok: boolean; error?: string }>;
  /** Bulk-apply a status to many fields. */
  onBulkUpdate: (fieldNames: string[], patch: Partial<CaseFieldOverride>) => Promise<{ ok: boolean; updated: number; error?: string }>;
  /** Clear an override (revert to default). */
  onClearOne: (fieldName: string) => Promise<{ ok: boolean; error?: string }>;
  /** Trigger PDF regeneration after edits. */
  onRegenerate: () => Promise<void>;
}

export function FieldClassificationTable({ rows, onSaveOne, onBulkUpdate, onClearOne, onRegenerate }: Props) {
  const [q, setQ] = useState("");
  const [pageFilter, setPageFilter] = useState<number | "all">("all");
  const [statusFilter, setStatusFilter] = useState<FillStatus | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [savingField, setSavingField] = useState<string | null>(null);
  const [bulkAction, setBulkAction] = useState<FillStatus | "">("");
  const [busy, setBusy] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pages = useMemo(() => Array.from(new Set(rows.map(r => r.pageNumber))).sort((a, b) => a - b), [rows]);

  const filtered = useMemo(() => {
    const qLower = q.toLowerCase();
    return rows.filter(r => {
      if (pageFilter !== "all" && r.pageNumber !== pageFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q.trim()) {
        const hay = `${r.fieldName} ${r.label} ${r.value ?? ""} ${r.notes ?? ""}`.toLowerCase();
        if (!hay.includes(qLower)) return false;
      }
      return true;
    });
  }, [rows, q, pageFilter, statusFilter]);

  const allFilteredSelected = filtered.length > 0 && filtered.every(r => selected.has(r.fieldName));

  function toggleSelection(name: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }
  function toggleAllFiltered() {
    setSelected(prev => {
      if (allFilteredSelected) {
        const next = new Set(prev);
        for (const r of filtered) next.delete(r.fieldName);
        return next;
      }
      const next = new Set(prev);
      for (const r of filtered) next.add(r.fieldName);
      return next;
    });
  }

  async function applyBulk() {
    if (!bulkAction || selected.size === 0) return;
    // Warn if any selected fields are signatures
    const sigSelected = Array.from(selected).filter(n => SIGNATURE_FIELD_NAMES.includes(n));
    if (bulkAction === "filled_known" && sigSelected.length > 0) {
      setError(`Cannot bulk-mark signature fields as filled_known: ${sigSelected.join(", ")}. Tenants must sign in DocHub.`);
      return;
    }
    setBusy(true); setError(null); setNotice(null);
    const res = await onBulkUpdate(Array.from(selected), { fillStatus: bulkAction });
    if (res.ok) {
      setNotice(`Updated ${res.updated} fields to "${FILL_STATUSES.find(s => s.value === bulkAction)?.label}". Click Regenerate to refresh the PDF.`);
      setSelected(new Set());
      setBulkAction("");
    } else {
      setError(res.error ?? "Bulk update failed");
    }
    setBusy(false);
  }

  async function regenerate() {
    setRegenerating(true);
    setError(null);
    setNotice(null);
    try {
      await onRegenerate();
      setNotice("PDF regenerated with the latest classifications.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Regenerate failed");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center mb-3 text-xs">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search field name or label…"
          className="px-2 py-1.5 rounded border border-slate-300 text-xs min-w-[220px]"
        />
        <select
          value={pageFilter}
          onChange={e => setPageFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
          className="px-2 py-1.5 rounded border border-slate-300 text-xs"
        >
          <option value="all">All pages ({rows.length})</option>
          {pages.map(p => <option key={p} value={p}>Page {p} ({rows.filter(r => r.pageNumber === p).length})</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value === "all" ? "all" : (e.target.value as FillStatus))}
          className="px-2 py-1.5 rounded border border-slate-300 text-xs"
        >
          <option value="all">All statuses</option>
          {FILL_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        <div className="ml-auto flex gap-2 items-center">
          <span className="text-slate-500">{selected.size} selected</span>
          <select
            value={bulkAction}
            onChange={e => setBulkAction((e.target.value || "") as FillStatus | "")}
            className="px-2 py-1.5 rounded border border-slate-300 text-xs"
            disabled={selected.size === 0}
          >
            <option value="">Bulk set status…</option>
            {FILL_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button
            onClick={applyBulk}
            disabled={busy || !bulkAction || selected.size === 0}
            className="px-3 py-1.5 rounded bg-slate-900 text-white text-xs disabled:opacity-40"
          >
            Apply
          </button>
          <button
            onClick={regenerate}
            disabled={regenerating}
            className="px-3 py-1.5 rounded bg-emerald-700 text-white text-xs hover:bg-emerald-800 disabled:opacity-40"
          >
            {regenerating ? "Regenerating…" : "Regenerate PDF"}
          </button>
        </div>
      </div>

      {notice && <div className="mb-2 px-3 py-2 rounded bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">{notice}</div>}
      {error && <div className="mb-2 px-3 py-2 rounded bg-rose-50 border border-rose-200 text-xs text-rose-900">{error}</div>}

      {/* Table */}
      <div className="overflow-x-auto border border-slate-200 rounded-md">
        <table className="w-full text-[11px]">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-2 py-2 text-left w-8">
                <input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} aria-label="Select all" />
              </th>
              <th className="px-2 py-2 text-left w-12">Pg</th>
              <th className="px-2 py-2 text-left">PDF Field Name</th>
              <th className="px-2 py-2 text-left">Label</th>
              <th className="px-2 py-2 text-left">Value / Override</th>
              <th className="px-2 py-2 text-left">Status</th>
              <th className="px-2 py-2 text-left">Owner</th>
              <th className="px-2 py-2 text-left">Conf</th>
              <th className="px-2 py-2 text-left">Source</th>
              <th className="px-2 py-2 text-left">Notes</th>
              <th className="px-2 py-2 text-left w-20">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <FieldRowEditable
                key={r.fieldName}
                row={r}
                selected={selected.has(r.fieldName)}
                onToggleSelect={() => toggleSelection(r.fieldName)}
                onSave={async (patch, confirmSig) => {
                  setSavingField(r.fieldName);
                  setError(null);
                  const res = await onSaveOne(r.fieldName, patch, confirmSig);
                  setSavingField(null);
                  if (!res.ok) setError(res.error ?? "Save failed");
                  return res;
                }}
                onClear={async () => {
                  setSavingField(r.fieldName);
                  const res = await onClearOne(r.fieldName);
                  setSavingField(null);
                  if (!res.ok) setError(res.error ?? "Clear failed");
                }}
                saving={savingField === r.fieldName}
              />
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="p-4 text-xs text-slate-500 text-center">No fields match the current filters.</div>
        )}
      </div>
    </div>
  );
}

function FieldRowEditable({
  row, selected, onToggleSelect, onSave, onClear, saving,
}: {
  row: FieldRow;
  selected: boolean;
  onToggleSelect: () => void;
  onSave: (patch: Partial<CaseFieldOverride>, confirmSig?: boolean) => Promise<{ ok: boolean; error?: string }>;
  onClear: () => Promise<void>;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<FillStatus>(row.status);
  const [owner, setOwner] = useState<CompletionOwner | "">("");
  const [conf, setConf] = useState<Confidence | "">("");
  const [valueSource, setValueSource] = useState<ValueSource | "">(row.override?.valueSource ?? "");
  const [manualValue, setManualValue] = useState(row.override?.manualOverrideValue ?? (row.value !== undefined && row.value !== null ? String(row.value) : ""));
  const [notes, setNotes] = useState(row.notes ?? "");

  const isSignature = SIGNATURE_FIELD_NAMES.includes(row.fieldName);
  const statusStyle = FILL_STATUSES.find(s => s.value === row.status);

  async function commit() {
    let confirmSig = false;
    if (isSignature && status === "filled_known") {
      const ok = window.confirm(
        `⚠️ ${row.fieldName} is a signature field. Tenants normally sign in DocHub.\n\nAre you absolutely sure you want to mark it as filled_known with a manual value? (Click OK to confirm twice.)`,
      );
      if (!ok) return;
      const ok2 = window.confirm(`Final confirmation: filling a signature field can violate tenant consent. Proceed?`);
      if (!ok2) return;
      confirmSig = true;
    }
    const patch: Partial<CaseFieldOverride> = {
      fillStatus: status,
      ...(owner ? { completionOwner: owner } : {}),
      ...(conf ? { confidence: conf } : {}),
      ...(valueSource ? { valueSource } : {}),
      ...(manualValue !== "" ? { manualOverrideValue: manualValue } : {}),
      ...(notes !== "" ? { notes } : {}),
    };
    const res = await onSave(patch, confirmSig);
    if (res.ok) setEditing(false);
  }

  return (
    <tr className={`border-t border-slate-100 ${selected ? "bg-sky-50" : ""} ${isSignature ? "bg-rose-50/40" : ""}`}>
      <td className="px-2 py-1.5">
        <input type="checkbox" checked={selected} onChange={onToggleSelect} disabled={isSignature && row.status !== "filled_known"} />
      </td>
      <td className="px-2 py-1.5 font-mono text-slate-500">{row.pageNumber}</td>
      <td className="px-2 py-1.5 font-mono text-[10px] text-slate-700 max-w-[160px] truncate">
        {isSignature && <span className="text-rose-600 mr-1">✍︎</span>}
        {row.fieldName}
      </td>
      <td className="px-2 py-1.5 text-slate-800">{row.label}</td>
      <td className="px-2 py-1.5 max-w-[200px]">
        {editing ? (
          <input
            value={manualValue}
            onChange={e => setManualValue(e.target.value)}
            className="w-full px-1.5 py-1 rounded border border-slate-300 text-[11px]"
            placeholder="Manual value (leave blank to use case data)"
          />
        ) : (
          <span className="text-slate-700 truncate inline-block max-w-full">{row.value !== undefined && row.value !== null ? String(row.value) : <span className="italic text-slate-400">—</span>}</span>
        )}
      </td>
      <td className="px-2 py-1.5">
        {editing ? (
          <select value={status} onChange={e => setStatus(e.target.value as FillStatus)} className="px-1.5 py-1 rounded border border-slate-300 text-[11px]">
            {FILL_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        ) : (
          <span className={`px-2 py-0.5 rounded-full text-[10px] ${statusStyle?.chip ?? "bg-slate-100 text-slate-600"}`}>{statusStyle?.label ?? row.status}</span>
        )}
      </td>
      <td className="px-2 py-1.5">
        {editing ? (
          <select value={owner} onChange={e => setOwner(e.target.value as CompletionOwner)} className="px-1.5 py-1 rounded border border-slate-300 text-[11px]">
            <option value="">(default)</option>
            {OWNERS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <span className="text-slate-500 text-[10px]">{row.override?.completionOwner ?? "—"}</span>
        )}
      </td>
      <td className="px-2 py-1.5">
        {editing ? (
          <select value={conf} onChange={e => setConf(e.target.value as Confidence)} className="px-1.5 py-1 rounded border border-slate-300 text-[11px]">
            <option value="">(default)</option>
            {CONFIDENCES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : (
          <span className="text-slate-500 text-[10px]">{row.confidence ?? row.override?.confidence ?? "—"}</span>
        )}
      </td>
      <td className="px-2 py-1.5">
        {editing ? (
          <select value={valueSource} onChange={e => setValueSource(e.target.value as ValueSource)} className="px-1.5 py-1 rounded border border-slate-300 text-[11px]">
            <option value="">(auto)</option>
            {VALUE_SOURCES.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
        ) : (
          <span className="text-slate-500 text-[10px]">{row.override?.valueSource ?? "—"}</span>
        )}
      </td>
      <td className="px-2 py-1.5 max-w-[180px]">
        {editing ? (
          <input value={notes} onChange={e => setNotes(e.target.value)} className="w-full px-1.5 py-1 rounded border border-slate-300 text-[11px]" placeholder="Notes" />
        ) : (
          <span className="text-slate-500 truncate inline-block max-w-full italic">{row.notes ?? "—"}</span>
        )}
      </td>
      <td className="px-2 py-1.5">
        {editing ? (
          <div className="flex gap-1">
            <button onClick={commit} disabled={saving} className="px-2 py-0.5 rounded bg-emerald-700 text-white text-[10px]">{saving ? "…" : "Save"}</button>
            <button onClick={() => setEditing(false)} className="px-2 py-0.5 rounded bg-white border border-slate-300 text-[10px]">Cancel</button>
          </div>
        ) : (
          <div className="flex gap-1">
            <button onClick={() => setEditing(true)} className="px-2 py-0.5 rounded bg-white border border-slate-300 text-[10px]">Edit</button>
            {row.override && <button onClick={onClear} disabled={saving} className="px-2 py-0.5 rounded bg-white border border-slate-300 text-[10px]" title="Clear override (revert to default)">Reset</button>}
          </div>
        )}
      </td>
    </tr>
  );
}
