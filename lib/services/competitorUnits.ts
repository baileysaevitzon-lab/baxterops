import { list, upsert, upsertMany, where, remove } from "./persistence";
import { TABLES } from "./tables";
import type { CompetitorUnitObservation } from "@/lib/types";

export async function getCompetitorObservedUnits(competitorId: string): Promise<CompetitorUnitObservation[]> {
  return where<CompetitorUnitObservation>(TABLES.competitorUnitObservations, u => u.competitorId === competitorId);
}

export async function getAllObservedUnits(): Promise<CompetitorUnitObservation[]> {
  return list<CompetitorUnitObservation>(TABLES.competitorUnitObservations);
}

export async function getObservedUnitsByBedCount(beds: number): Promise<CompetitorUnitObservation[]> {
  return where<CompetitorUnitObservation>(TABLES.competitorUnitObservations, u => u.bedCount === beds);
}

export async function upsertCompetitorUnitObservation(u: CompetitorUnitObservation): Promise<CompetitorUnitObservation> {
  u.updatedAt = new Date().toISOString();
  return upsert<CompetitorUnitObservation>(TABLES.competitorUnitObservations, u);
}

export async function bulkUpsertObservedUnits(units: CompetitorUnitObservation[]): Promise<CompetitorUnitObservation[]> {
  return upsertMany<CompetitorUnitObservation>(TABLES.competitorUnitObservations, units);
}

export async function deleteObservedUnit(id: string): Promise<void> {
  await remove(TABLES.competitorUnitObservations, id);
}
