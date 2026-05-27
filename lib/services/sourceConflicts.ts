// Sprint 5 — Source Conflicts service.

import { list, upsert, where } from "./persistence";
import { TABLES } from "./tables";
import type { SourceConflictRow } from "@/lib/types";

export async function getAllConflicts(): Promise<SourceConflictRow[]> {
  return list<SourceConflictRow>(TABLES.sourceConflicts);
}

export async function getConflictsForEntity(entityType: string, entityId: string): Promise<SourceConflictRow[]> {
  return where<SourceConflictRow>(TABLES.sourceConflicts, c => c.entityType === entityType && c.entityId === entityId);
}

export async function getConflictsForField(fieldKey: string): Promise<SourceConflictRow[]> {
  return where<SourceConflictRow>(TABLES.sourceConflicts, c => c.fieldKey === fieldKey);
}

export async function upsertConflict(row: SourceConflictRow): Promise<SourceConflictRow> {
  return upsert<SourceConflictRow>(TABLES.sourceConflicts, row);
}
