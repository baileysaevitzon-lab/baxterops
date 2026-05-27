import { list, upsert, upsertMany, where } from "./persistence";
import { TABLES } from "./tables";
import type { CompetitorAmenityObservation } from "@/lib/types";

export async function getCompetitorAmenityObservations(competitorId: string): Promise<CompetitorAmenityObservation[]> {
  return where<CompetitorAmenityObservation>(TABLES.competitorAmenityObservations, a => a.competitorId === competitorId);
}

export async function getAllAmenityObservations(): Promise<CompetitorAmenityObservation[]> {
  return list<CompetitorAmenityObservation>(TABLES.competitorAmenityObservations);
}

export async function upsertAmenityObservation(a: CompetitorAmenityObservation): Promise<CompetitorAmenityObservation> {
  a.updatedAt = new Date().toISOString();
  return upsert<CompetitorAmenityObservation>(TABLES.competitorAmenityObservations, a);
}

export async function bulkUpsertAmenityObservations(rows: CompetitorAmenityObservation[]): Promise<CompetitorAmenityObservation[]> {
  return upsertMany<CompetitorAmenityObservation>(TABLES.competitorAmenityObservations, rows);
}
