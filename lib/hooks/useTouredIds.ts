// Sprint 13: shared "what counts as toured" logic.
//
// A competitor is "toured" if ANY of these is true:
//   - has a competitor_field_tours row
//   - has competitor_unit_observations with a field_tour_id
//   - has photo_evidence
//   - competitors.field_verified = true (covers /add-tour properties and seed-tagged)
//
// Returns the Set<competitorId> + the underlying competitor list for count math.

"use client";

import { useEffect, useMemo, useState } from "react";
import { useCompetitors } from "@/lib/hooks/useCompetitors";
import { loadAllFieldTours } from "@/lib/services/fieldTours";
import { getAllObservedUnits } from "@/lib/services/competitorUnits";
import { getAllPhotoEvidence } from "@/lib/services/photoEvidence";
import type { CompetitorProperty } from "@/lib/types";

interface Result {
  competitors: CompetitorProperty[];
  touredIds: Set<string>;
  touredCount: number;
  loading: boolean;
}

export function useTouredIds(): Result {
  const { competitors } = useCompetitors();
  const [touredIds, setTouredIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [fieldTours, observedUnits, photoEvidence] = await Promise.all([
          loadAllFieldTours(),
          getAllObservedUnits(),
          getAllPhotoEvidence(),
        ]);
        if (cancelled) return;

        const set = new Set<string>();

        // From competitor_field_tours
        for (const t of fieldTours) {
          if (t.competitorId) set.add(t.competitorId);
        }
        // From unit observations linked to a field tour
        for (const u of observedUnits) {
          if (u.competitorId && u.fieldTourId) set.add(u.competitorId);
        }
        // From photo evidence (any photo = evidence of a tour)
        for (const p of photoEvidence) {
          if (p.competitorId) set.add(p.competitorId);
        }
        // From the field_verified flag on the competitor record itself
        for (const c of competitors) {
          if (c.fieldVerified) set.add(c.id);
        }

        setTouredIds(set);
        setLoading(false);
      } catch {
        // Fall back to field_verified flag only
        const set = new Set<string>();
        for (const c of competitors) if (c.fieldVerified) set.add(c.id);
        setTouredIds(set);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [competitors]);

  const touredCount = useMemo(
    () => competitors.filter(c => touredIds.has(c.id)).length,
    [competitors, touredIds],
  );

  return { competitors, touredIds, touredCount, loading };
}
