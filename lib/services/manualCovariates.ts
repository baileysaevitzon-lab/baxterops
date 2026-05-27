// Sprint 5 — Manual covariate scores service.

import { list, upsert, upsertMany, where, remove } from "./persistence";
import { TABLES } from "./tables";
import type { ManualCovariateScore } from "@/lib/types";

export async function getCovariatesForTour(fieldTourId: string): Promise<ManualCovariateScore[]> {
  return where<ManualCovariateScore>(TABLES.manualCovariateScores, c => c.fieldTourId === fieldTourId);
}

export async function getCovariatesForCompetitor(competitorId: string): Promise<ManualCovariateScore[]> {
  return where<ManualCovariateScore>(TABLES.manualCovariateScores, c => c.competitorId === competitorId);
}

export async function getAllCovariates(): Promise<ManualCovariateScore[]> {
  return list<ManualCovariateScore>(TABLES.manualCovariateScores);
}

export async function saveCovariate(score: ManualCovariateScore): Promise<ManualCovariateScore> {
  return upsert<ManualCovariateScore>(TABLES.manualCovariateScores, score);
}

export async function saveManyCovariates(scores: ManualCovariateScore[]): Promise<ManualCovariateScore[]> {
  return upsertMany<ManualCovariateScore>(TABLES.manualCovariateScores, scores);
}

export async function deleteCovariate(id: string): Promise<void> {
  return remove(TABLES.manualCovariateScores, id);
}
