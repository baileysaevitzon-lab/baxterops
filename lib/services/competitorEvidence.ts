// High-level read-side aggregator. UI calls this to fetch everything Zen
// (or any competitor) in one shot.

import { loadFieldToursForCompetitor } from "./fieldTours";
import { getCompetitorObservedUnits } from "./competitorUnits";
import { getCompetitorAmenityObservations } from "./amenityObservations";
import { getCompetitorPhotoEvidence } from "./photoEvidence";
import { getSourceVerifications } from "./sourceVerification";
import { getFlagsForEntity } from "./dataQuality";
import type {
  CompetitorAmenityObservation,
  CompetitorFieldTour,
  CompetitorSourceVerification,
  CompetitorUnitObservation,
  DataQualityFlag,
  PhotoEvidenceRecord,
} from "@/lib/types";

export interface CompetitorEvidence {
  fieldTours: CompetitorFieldTour[];
  observedUnits: CompetitorUnitObservation[];
  amenityObservations: CompetitorAmenityObservation[];
  photoEvidence: PhotoEvidenceRecord[];
  sourceVerifications: CompetitorSourceVerification[];
  flags: DataQualityFlag[];
}

export async function loadCompetitorEvidence(competitorId: string): Promise<CompetitorEvidence> {
  const [fieldTours, observedUnits, amenityObservations, photoEvidence, sourceVerifications, flags] = await Promise.all([
    loadFieldToursForCompetitor(competitorId),
    getCompetitorObservedUnits(competitorId),
    getCompetitorAmenityObservations(competitorId),
    getCompetitorPhotoEvidence(competitorId),
    getSourceVerifications(competitorId),
    getFlagsForEntity(competitorId),
  ]);
  return { fieldTours, observedUnits, amenityObservations, photoEvidence, sourceVerifications, flags };
}
