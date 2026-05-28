// Sprint 16: per-case field-classification overrides for the exact-form-fill
// workflow. The base mapping for each form template lives in code
// (e.g. resolveLahdRecert2026Fields). Bailey can override any field's
// fill status / completion owner / manual value / confidence per case
// via the Field Classification tab on /exact-form-preview.

import { getSupabase } from "@/lib/supabase/client";
import { SIGNATURE_FIELD_NAMES, type FillStatus } from "./recertExactFormFill";

export type CompletionOwner =
  | "baxterops"
  | "tenant"
  | "manager"
  | "employer"
  | "urban_futures"
  | "hacla"
  | "unknown";

export type FieldType =
  | "text"
  | "checkbox"
  | "radio"
  | "signature"
  | "initial"
  | "date"
  | "calculated"
  | "manager_review";

export type Confidence = "high" | "medium" | "low";

export type ValueSource =
  | "case_data"
  | "household_member"
  | "income_calculation"
  | "asset_calculation"
  | "utility_allowance"
  | "manager_constant"
  | "manual_override"
  | "leave_blank";

export interface CaseFieldOverride {
  id?: string;
  caseId: string;
  templateId: string;
  fieldName: string;
  fillStatus?: FillStatus;
  completionOwner?: CompletionOwner;
  fieldType?: FieldType;
  confidence?: Confidence;
  manualOverrideValue?: string;
  valueSource?: ValueSource;
  notes?: string;
  updatedBy?: string;
  updatedAt?: string;
}

interface DbRow {
  id: string;
  case_id: string;
  template_id: string;
  field_name: string;
  fill_status: string | null;
  completion_owner: string | null;
  field_type: string | null;
  confidence: string | null;
  manual_override_value: string | null;
  value_source: string | null;
  notes: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

function rowToOverride(r: DbRow): CaseFieldOverride {
  return {
    id: r.id,
    caseId: r.case_id,
    templateId: r.template_id,
    fieldName: r.field_name,
    fillStatus: (r.fill_status as FillStatus | null) ?? undefined,
    completionOwner: (r.completion_owner as CompletionOwner | null) ?? undefined,
    fieldType: (r.field_type as FieldType | null) ?? undefined,
    confidence: (r.confidence as Confidence | null) ?? undefined,
    manualOverrideValue: r.manual_override_value ?? undefined,
    valueSource: (r.value_source as ValueSource | null) ?? undefined,
    notes: r.notes ?? undefined,
    updatedBy: r.updated_by ?? undefined,
    updatedAt: r.updated_at,
  };
}

const TABLE = "recert_case_field_overrides";

/**
 * Load every override row for a given case. Returns a Map keyed by field_name
 * so the resolver can look up overrides in O(1).
 */
export async function loadCaseFieldOverrides(
  caseId: string,
): Promise<Map<string, CaseFieldOverride>> {
  const sb = getSupabase();
  if (!sb) return new Map();
  const { data, error } = await sb.from(TABLE).select("*").eq("case_id", caseId);
  if (error || !data) return new Map();
  const out = new Map<string, CaseFieldOverride>();
  for (const r of data as DbRow[]) out.set(r.field_name, rowToOverride(r));
  return out;
}

/**
 * Save (upsert) a single override. Refuses to mark a signature field as
 * filled_known unless `confirmSignatureFill=true` is passed (UI double-confirm).
 */
export async function saveFieldOverride(args: {
  caseId: string;
  templateId: string;
  fieldName: string;
  patch: Partial<CaseFieldOverride>;
  editedBy?: string;
  confirmSignatureFill?: boolean;
  /** Old override (for audit diff). Optional. */
  previous?: CaseFieldOverride;
}): Promise<{ ok: boolean; error?: string }> {
  const { caseId, templateId, fieldName, patch, editedBy, confirmSignatureFill, previous } = args;

  // Signature field protection
  const isSignature = SIGNATURE_FIELD_NAMES.includes(fieldName) || patch.fieldType === "signature";
  if (isSignature && patch.fillStatus === "filled_known" && !confirmSignatureFill) {
    return { ok: false, error: "Signature fields cannot be marked filled_known without explicit double-confirmation. Tenants must sign in DocHub." };
  }

  const sb = getSupabase();
  if (!sb) return { ok: false, error: "Supabase not configured" };

  const id = previous?.id ?? `cfo-${caseId}-${fieldName}`.replace(/[^a-zA-Z0-9_-]+/g, "_");

  const row: Partial<DbRow> = {
    id,
    case_id: caseId,
    template_id: templateId,
    field_name: fieldName,
    fill_status: patch.fillStatus ?? null,
    completion_owner: patch.completionOwner ?? null,
    field_type: patch.fieldType ?? null,
    confidence: patch.confidence ?? null,
    manual_override_value: patch.manualOverrideValue ?? null,
    value_source: patch.valueSource ?? null,
    notes: patch.notes ?? null,
    updated_by: editedBy ?? null,
  };

  const { error } = await sb.from(TABLE).upsert(row, { onConflict: "case_id,template_id,field_name" });
  if (error) return { ok: false, error: error.message };

  // Audit event: 'recert_field_mapping_updated'
  try {
    await sb.from("recert_audit_events").insert({
      id: `ae-fm-${id}-${Date.now()}`,
      case_id: caseId,
      event_type: "recert_field_mapping_updated",
      event_summary: `Field ${fieldName}: ${previous?.fillStatus ?? "(default)"} → ${patch.fillStatus ?? "(default)"}`,
      actor_email: editedBy ?? null,
      event_payload_json: {
        templateId,
        fieldName,
        old: {
          fillStatus: previous?.fillStatus,
          value: previous?.manualOverrideValue,
          completionOwner: previous?.completionOwner,
          confidence: previous?.confidence,
          notes: previous?.notes,
        },
        new: {
          fillStatus: patch.fillStatus,
          value: patch.manualOverrideValue,
          completionOwner: patch.completionOwner,
          confidence: patch.confidence,
          notes: patch.notes,
        },
      },
    });
  } catch {
    /* non-fatal: the override itself is saved */
  }

  return { ok: true };
}

/**
 * Bulk-update multiple fields in one upsert + one audit row.
 * Used by "Mark selected as tenant must complete" etc.
 */
export async function bulkUpdateFieldOverrides(args: {
  caseId: string;
  templateId: string;
  fieldNames: string[];
  patch: Partial<CaseFieldOverride>;
  editedBy?: string;
}): Promise<{ ok: boolean; updated: number; error?: string }> {
  const { caseId, templateId, fieldNames, patch, editedBy } = args;
  const sb = getSupabase();
  if (!sb) return { ok: false, updated: 0, error: "Supabase not configured" };

  const rows = fieldNames.map(fieldName => ({
    id: `cfo-${caseId}-${fieldName}`.replace(/[^a-zA-Z0-9_-]+/g, "_"),
    case_id: caseId,
    template_id: templateId,
    field_name: fieldName,
    fill_status: patch.fillStatus ?? null,
    completion_owner: patch.completionOwner ?? null,
    field_type: patch.fieldType ?? null,
    confidence: patch.confidence ?? null,
    manual_override_value: patch.manualOverrideValue ?? null,
    value_source: patch.valueSource ?? null,
    notes: patch.notes ?? null,
    updated_by: editedBy ?? null,
  }));

  const { error } = await sb.from(TABLE).upsert(rows, { onConflict: "case_id,template_id,field_name" });
  if (error) return { ok: false, updated: 0, error: error.message };

  // Single audit row summarising the bulk change
  try {
    await sb.from("recert_audit_events").insert({
      id: `ae-fm-bulk-${caseId}-${Date.now()}`,
      case_id: caseId,
      event_type: "recert_field_mapping_updated",
      event_summary: `Bulk update: ${fieldNames.length} fields → ${patch.fillStatus ?? "(unchanged)"}`,
      actor_email: editedBy ?? null,
      event_payload_json: {
        templateId,
        fieldNames,
        patch,
      },
    });
  } catch {
    /* non-fatal */
  }

  return { ok: true, updated: fieldNames.length };
}

/**
 * Delete an override (reverts to the in-code default).
 */
export async function clearFieldOverride(args: {
  caseId: string;
  templateId: string;
  fieldName: string;
  editedBy?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "Supabase not configured" };
  const id = `cfo-${args.caseId}-${args.fieldName}`.replace(/[^a-zA-Z0-9_-]+/g, "_");
  const { error } = await sb.from(TABLE).delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  try {
    await sb.from("recert_audit_events").insert({
      id: `ae-fm-clear-${id}-${Date.now()}`,
      case_id: args.caseId,
      event_type: "recert_field_mapping_updated",
      event_summary: `Field ${args.fieldName}: override cleared, reverted to default`,
      actor_email: args.editedBy ?? null,
      event_payload_json: { templateId: args.templateId, fieldName: args.fieldName, action: "clear" },
    });
  } catch { /* non-fatal */ }

  return { ok: true };
}
