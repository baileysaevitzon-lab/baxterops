"use client";
// Sprint 6 — cache-backed SourceBadge.
// Reads from SourceLedgerProvider (single fetch per page) instead of one fetch per badge.

import { Badge } from "./Card";
import { useLedgerRow } from "./SourceLedgerProvider";
import { isStale } from "@/lib/services/sourceLedger";
import { getDictionaryEntry } from "@/lib/dataDictionary";
import type { DataSourceLedgerRow } from "@/lib/types";

interface Props {
  fieldKey: string;
  entityType: string;
  entityId: string;
  compact?: boolean;
}

export function SourceBadge({ fieldKey, entityType, entityId, compact }: Props) {
  const row = useLedgerRow(entityType, entityId, fieldKey);
  const dict = getDictionaryEntry(fieldKey);

  if (!row) {
    return (
      <span title={dict?.sourceRequirement ?? "No source ledger entry yet."}>
        <Badge intent="bad">⚠ unverified</Badge>
      </span>
    );
  }

  const stale = isStale(row);
  const intent: "good" | "warn" | "bad" | "neutral" =
    stale ? "warn" :
    row.verificationStatus === "verified" ? "good" :
    row.verificationStatus === "conflicting_sources" ? "bad" :
    row.verificationStatus === "partial" ? "neutral" :
    "warn";

  const label = stale ? "stale" : row.verificationStatus.replace("_", " ");

  const tooltip = [
    row.sourceName ? `Source: ${row.sourceName}` : `Source type: ${row.sourceType}`,
    `Confidence: ${row.confidence}`,
    row.sourceDate ? `Collected: ${row.sourceDate}` : "",
    row.collectedBy ? `By: ${row.collectedBy}` : "",
    row.formula ? `Formula: ${row.formula}` : "",
    row.dependsOn?.length ? `Depends on: ${row.dependsOn.join(", ")}` : "",
    stale ? `STALE — older than ${row.staleAfterDays} days` : "",
  ].filter(Boolean).join("\n");

  return (
    <span title={tooltip} className="inline-flex items-center gap-1 align-middle">
      <Badge intent={intent}>
        {label}
        {row.confidence !== "unknown" && ` · ${row.confidence}`}
        {row.isComputed && " · computed"}
      </Badge>
      {row.sourceUrl && !compact && (
        <a href={row.sourceUrl} target="_blank" rel="noreferrer" className="text-[10px] text-sky-700 underline">src</a>
      )}
    </span>
  );
}

interface ValueProps {
  value: React.ReactNode;
  fieldKey: string;
  entityType: string;
  entityId: string;
  compact?: boolean;
}

export function ValueWithSource({ value, fieldKey, entityType, entityId, compact = true }: ValueProps) {
  return (
    <span className="inline-flex items-center gap-2 align-middle whitespace-nowrap">
      <span>{value}</span>
      <SourceBadge fieldKey={fieldKey} entityType={entityType} entityId={entityId} compact={compact} />
    </span>
  );
}

export function useLedger(entityType: string, entityId: string, fieldKey: string): DataSourceLedgerRow | undefined {
  return useLedgerRow(entityType, entityId, fieldKey);
}
