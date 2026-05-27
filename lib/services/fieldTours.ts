import { list, upsert, where, findById, remove } from "./persistence";
import { TABLES } from "./tables";
import type { CompetitorFieldTour } from "@/lib/types";

export async function loadAllFieldTours(): Promise<CompetitorFieldTour[]> {
  return list<CompetitorFieldTour>(TABLES.competitorFieldTours);
}

export async function loadFieldToursForCompetitor(competitorId: string): Promise<CompetitorFieldTour[]> {
  return where<CompetitorFieldTour>(TABLES.competitorFieldTours, t => t.competitorId === competitorId);
}

export async function loadFieldTour(id: string): Promise<CompetitorFieldTour | undefined> {
  return findById<CompetitorFieldTour>(TABLES.competitorFieldTours, id);
}

export async function loadZenFieldTour(): Promise<CompetitorFieldTour | undefined> {
  const tours = await loadFieldToursForCompetitor("zen-hollywood");
  return tours.find(t => t.tourStatus === "completed") ?? tours[0];
}

export async function saveFieldTour(tour: CompetitorFieldTour): Promise<CompetitorFieldTour> {
  tour.updatedAt = new Date().toISOString();
  return upsert<CompetitorFieldTour>(TABLES.competitorFieldTours, tour);
}

export async function deleteFieldTour(id: string): Promise<void> {
  await remove(TABLES.competitorFieldTours, id);
}
