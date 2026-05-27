// Sprint 5 — Source Ledger service.

import { list, upsert, upsertMany, where, findById } from "./persistence";
import { TABLES } from "./tables";
import type { DataSourceLedgerRow } from "@/lib/types";

export async function getLedgerEntry(
  entityType: string,
  entityId: string,
  fieldKey: string,
): Promise<DataSourceLedgerRow | undefined> {
  const all = await list<DataSourceLedgerRow>(TABLES.dataSourceLedger);
  return all.find(r => r.entityType === entityType && r.entityId === entityId && r.fieldKey === fieldKey);
}

export async function getLedgerForEntity(entityType: string, entityId: string): Promise<DataSourceLedgerRow[]> {
  return where<DataSourceLedgerRow>(TABLES.dataSourceLedger, r => r.entityType === entityType && r.entityId === entityId);
}

export async function getLedgerByFieldKey(fieldKey: string): Promise<DataSourceLedgerRow[]> {
  return where<DataSourceLedgerRow>(TABLES.dataSourceLedger, r => r.fieldKey === fieldKey);
}

export async function getAllLedger(): Promise<DataSourceLedgerRow[]> {
  return list<DataSourceLedgerRow>(TABLES.dataSourceLedger);
}

export async function upsertLedger(row: DataSourceLedgerRow): Promise<DataSourceLedgerRow> {
  return upsert<DataSourceLedgerRow>(TABLES.dataSourceLedger, row);
}

export async function bulkUpsertLedger(rows: DataSourceLedgerRow[]): Promise<DataSourceLedgerRow[]> {
  return upsertMany<DataSourceLedgerRow>(TABLES.dataSourceLedger, rows);
}

/** Returns true if a ledger entry is older than its stale_after_days threshold. */
export function isStale(row: DataSourceLedgerRow): boolean {
  if (!row.sourceDate || !row.staleAfterDays) return false;
  const ms = Date.now() - new Date(row.sourceDate).getTime();
  return ms > row.staleAfterDays * 86_400_000;
}

/** Look up a single record by ID. */
export async function findLedger(id: string): Promise<DataSourceLedgerRow | undefined> {
  return findById<DataSourceLedgerRow>(TABLES.dataSourceLedger, id);
}
