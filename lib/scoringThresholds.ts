// Phase 4 (Task 5) — centralized COSMETIC / display thresholds only.
//
// These drive badge colors and a couple of summary labels in the UI. They do NOT
// affect any scoring MATH. Deliberately NOT centralized here (left untouched):
//   - lib/services/competitorIntelligence.ts occupancy/score tiers (real scoring logic)
//   - recertification readiness gates (score >= 100, etc.)
// Changing a value here only changes how a badge is colored / a count is labeled.
export const SCORING_THRESHOLDS = {
  /** comp_quality_score at/above which a competitor counts as "high-quality". */
  highQualityComp: 75,
  /** comp_quality_score at/above which the quality badge flips to the strong/high-threat color. */
  threatBadgeScore: 80,
  /** Comp-match similarity at/above which the match badge is "strong" (good). */
  similarityStrong: 70,
  /** Comp-match similarity at/above which the match badge is "medium" (warn). */
  similarityMedium: 50,
} as const;
