// Sprint 13: manual-edit ledger helper.
//
// Every inline pencil edit (rent, sqft, notes, classification, etc.) must
// create a data_source_ledger row so the change is traceable and shows up
// in /number-inventory + source-conflict review.
//
// Convention:
//   source_type = "manual_user_edit"
//   verification_status = "needs_review" (unless the editor explicitly marks verified)
//   confidence = "medium"

import { upsert } from "./persistence";
import { TABLES } from "./tables";
import { recomputeCompetitorIntelligence, upsertIntelligenceSummary } from "./competitorIntelligence";
import type { DataSourceLedgerRow } from "@/lib/types";

interface ManualEditArgs {
  competitorId: string;
  entityType: DataSourceLedgerRow["entityType"];
  entityId: string;
  entityName: string;
  fieldKey: string;
  fieldLabel: string;
  fieldCategory: DataSourceLedgerRow["fieldCategory"];
  valueType?: DataSourceLedgerRow["valueType"];
  valueNumber?: number;
  valueText?: string;
  valueBoolean?: boolean;
  displayValue: string;
  editedBy: string;
  /** Set true if the editor is also marking this value verified (rare — defaults to needs_review). */
  markVerified?: boolean;
  /** Routes that show this value, so source conflicts / number inventory can link back. */
  pageRoutes?: string[];
}

/**
 * Write a single manual-edit row to the source ledger.
 * Non-fatal: returns false on failure, logs a warning.
 */
export async function writeManualEditLedger(args: ManualEditArgs): Promise<boolean> {
  try {
    const now = new Date().toISOString();
    const row: DataSourceLedgerRow = {
      id: `led-manual-${args.entityId}-${args.fieldKey}-${Date.now()}`,
      entityType: args.entityType,
      entityId: args.entityId,
      entityName: args.entityName,
      fieldKey: args.fieldKey,
      fieldLabel: args.fieldLabel,
      fieldCategory: args.fieldCategory,
      valueType: args.valueType ?? "text",
      ...(args.valueNumber !== undefined && { valueNumber: args.valueNumber }),
      ...(args.valueText !== undefined && { valueText: args.valueText }),
      ...(args.valueBoolean !== undefined && { valueBoolean: args.valueBoolean }),
      displayValue: args.displayValue,
      pageRoutes: args.pageRoutes ?? [`/competitors/${args.competitorId.replace(/^c-/, "")}`],
      sourceType: "manual_user_edit",
      sourceName: `Manual edit by ${args.editedBy}`,
      sourceDate: now.slice(0, 10),
      collectedBy: args.editedBy,
      lastVerifiedAt: now,
      verifiedBy: args.editedBy,
      verificationStatus: args.markVerified ? "verified" : "needs_review",
      confidence: "medium",
      entryMethod: "manual_user_entry",
      requiresManualVerification: !args.markVerified,
      staleAfterDays: 60,
      updatedAt: now,
    };
    await upsert(TABLES.dataSourceLedger, row);
    return true;
  } catch (e) {
    console.warn("[writeManualEditLedger] failed (non-fatal):", e);
    return false;
  }
}

/**
 * Sprint 13: alias for the central re-scoring helper that Bailey asked for by name.
 * Use after any manual edit that changes a value the comparison model reads
 * (rent, sqft, amenity, classification override, tour quality score, etc.).
 *
 * It (a) reloads the competitor row from Supabase, (b) recomputes smart-threat
 * scores via calculateSmartThreat, and (c) upserts the new
 * competitor_intelligence_summary row so all subscribers refresh.
 */
export async function recomputeCompetitorComparisonModel(
  competitorId: string,
): Promise<boolean> {
  try {
    const scores = await recomputeCompetitorIntelligence(competitorId);
    if (!scores) return false;
    await upsertIntelligenceSummary(competitorId, scores);
    return true;
  } catch (e) {
    console.warn("[recomputeCompetitorComparisonModel] failed (non-fatal):", e);
    return false;
  }
}
