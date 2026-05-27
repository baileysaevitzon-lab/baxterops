import { list, upsert, upsertMany, where } from "./persistence";
import { TABLES } from "./tables";
import type { CompetitorSourceVerification } from "@/lib/types";

export async function getSourceVerifications(competitorId: string): Promise<CompetitorSourceVerification[]> {
  return where<CompetitorSourceVerification>(TABLES.competitorSourceVerifications, v => v.competitorId === competitorId);
}

export async function getAllSourceVerifications(): Promise<CompetitorSourceVerification[]> {
  return list<CompetitorSourceVerification>(TABLES.competitorSourceVerifications);
}

export async function upsertCompetitorVerification(v: CompetitorSourceVerification): Promise<CompetitorSourceVerification> {
  v.updatedAt = new Date().toISOString();
  return upsert<CompetitorSourceVerification>(TABLES.competitorSourceVerifications, v);
}

export async function bulkUpsertSourceVerifications(rows: CompetitorSourceVerification[]): Promise<CompetitorSourceVerification[]> {
  return upsertMany<CompetitorSourceVerification>(TABLES.competitorSourceVerifications, rows);
}

export async function markSourceVerified(id: string, verifiedBy: string): Promise<CompetitorSourceVerification | undefined> {
  const all = await getAllSourceVerifications();
  const row = all.find(r => r.id === id);
  if (!row) return undefined;
  row.verifiedAt = new Date().toISOString();
  row.verifiedBy = verifiedBy;
  row.verificationStatus = "verified";
  return upsertCompetitorVerification(row);
}

export async function getFieldVerifiedCompetitors(): Promise<string[]> {
  const verifications = await getAllSourceVerifications();
  const ids = new Set<string>();
  for (const v of verifications) {
    if (v.sourceType === "field_tour" || v.verificationStatus === "verified") ids.add(v.competitorId);
  }
  return Array.from(ids);
}
