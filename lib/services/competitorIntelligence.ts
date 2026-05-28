/**
 * Competitor Intelligence Service — Sprint 10
 *
 * Implements the 3-score Smart Threat Classification system:
 *   directThreatScore  — how much this comp competes for the SAME renter as Baxter
 *   tourQualityScore   — how good the in-person leasing experience is (field tour only)
 *   learningScore      — how much Baxter can learn/copy from this comp
 *
 * Classification labels:
 *   direct_threat | partial_threat | premium_aspirational_comp |
 *   budget_comp | weak_threat | not_comparable_but_instructive
 *
 * IMPORTANT: All outputs are for internal planning only.
 * Label calculation outputs "manager review required" before sharing externally.
 */

import { getSupabase } from "@/lib/supabase/client";
import type {
  CompetitorProperty,
  CompetitorIntelligenceSummary,
  CompetitorTakeaway,
  CompetitorClassification,
  SmartThreatScores,
} from "@/lib/types";

// ─── Baxter reference point ───────────────────────────────────────────────────
// Updated as of 2026-05-26. Keep in sync with BAXTER_UNITS in seed.ts.
const BAXTER_REF = {
  rent1BR: { min: 2499, max: 2799 }, // range across vacant 1BRs
  rent2BR: { min: 2499, max: 2499 }, // unit 105 only
  amenities: new Set(["rooftop", "gym", "lounge"]),
  hasPool: false,
  hasParking: false,
  hasInUnitLaundry: false,
  hasValet: false,
  hasCoffee: false,
  hasCoworking: false,
  hasBar: false,
  hasTheater: false,
  unitCount: 86,
};

// ─── Pure scoring helpers ──────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function round1(v: number) {
  return Math.round(v * 10) / 10;
}

/**
 * How closely does the comp's price overlap with Baxter's 1BR/2BR effective range?
 * Score: 5 = near-identical price, 1 = $1,500+ gap (different market tier).
 */
function scorePriceOverlap(comp: CompetitorProperty): number {
  const targets = [
    { bMin: BAXTER_REF.rent1BR.min, bMax: BAXTER_REF.rent1BR.max, type: "1BR" },
    { bMin: BAXTER_REF.rent2BR.min, bMax: BAXTER_REF.rent2BR.max, type: "2BR" },
  ];
  let best = 1.0;
  for (const ut of comp.unitTypes ?? []) {
    const t = targets.find(x => x.type === ut.type);
    if (!t || !ut.avgRent) continue;
    const bCenter = (t.bMin + t.bMax) / 2;
    const gap = Math.abs(ut.avgRent - bCenter);
    // $0 gap → 5.0, $500 gap → 3.5, $1000 gap → 2.0, $1500+ gap → 1.0
    const score = Math.max(1.0, 5.0 - (gap / 300));
    best = Math.max(best, score);
  }
  return clamp(round1(best), 1, 5);
}

/**
 * How similar is the product mix (unit types, sqft) to Baxter's?
 * Baxter offers 1BR (720–820 sqft) and 2BR (1,050 sqft).
 */
function scoreProductOverlap(comp: CompetitorProperty): number {
  const hasTypes = new Set((comp.unitTypes ?? []).map(u => u.type));
  let score = 2.0; // base
  if (hasTypes.has("1BR")) score += 1.0;
  if (hasTypes.has("2BR")) score += 0.5;
  // Penalty if the only product is very different size
  const avgSqft1BR = comp.unitTypes?.find(u => u.type === "1BR")?.avgSqft;
  if (avgSqft1BR && avgSqft1BR > 1200) score -= 0.5; // much larger than Baxter
  if (avgSqft1BR && avgSqft1BR < 550) score -= 0.5; // much smaller
  return clamp(round1(score), 1, 5);
}

/**
 * Are they chasing the same renter segment as Baxter (workforce/market-rate Hollywood)?
 * Premium-only or luxury-only properties target a different buyer.
 */
function scoreRenterSegmentOverlap(comp: CompetitorProperty): number {
  const type = comp.competitorStrategicType;
  // Luxury-tier / premium-only = low overlap
  if (type === "luxury_high_end") return 1.5;
  // Premium amenity comps overlap more on product but differ on price ceiling
  if (type === "premium_amenity_comp") {
    // Check if their prices actually land near Baxter's range
    const overlap = scorePriceOverlap(comp);
    return overlap > 3.5 ? 3.5 : 2.0;
  }
  // Balanced or value comps = high overlap
  if (type === "balanced_comp" || type === "value_comp") return 4.0;
  // Default: use price signal
  const po = scorePriceOverlap(comp);
  if (po >= 4.0) return 4.0;
  if (po >= 3.0) return 3.5;
  if (po >= 2.0) return 2.5;
  return 2.0;
}

/**
 * Are they under pressure to fill units right now?
 * High = many tours + low occupancy + long specials.
 */
function scoreAvailabilityPressure(comp: CompetitorProperty): number {
  let score = 2.0;
  const occ = comp.occupancyPct ?? comp.leasedPct;
  if (occ !== undefined) {
    if (occ < 88) score += 1.5;
    else if (occ < 93) score += 0.75;
    else if (occ >= 97) score -= 0.5;
  }
  const tours = comp.toursLastWeek;
  if (tours !== undefined) {
    if (tours >= 10) score += 1.0;
    else if (tours >= 5) score += 0.5;
  }
  return clamp(round1(score), 1, 5);
}

/**
 * How aggressively are they buying traffic with free rent + look-and-lease bonuses?
 */
function scoreConcessionPressure(comp: CompetitorProperty): number {
  const weeks = comp.freeRentWeeks ?? 0;
  const lal = comp.lookAndLeaseBonus ?? 0;
  let score = 1.0;
  if (weeks >= 8) score += 3.0;
  else if (weeks >= 6) score += 2.5;
  else if (weeks >= 4) score += 1.5;
  else if (weeks >= 2) score += 0.75;
  if (lal >= 1000) score += 0.5;
  else if (lal >= 500) score += 0.25;
  return clamp(round1(score), 1, 5);
}

/**
 * How much better is their amenity package than Baxter's?
 * High = Baxter has a clear gap to close.
 */
function scoreAmenityGap(comp: CompetitorProperty): number {
  const amenities = new Set(comp.amenities ?? []);
  let gap = 0;
  // Each premium amenity Baxter lacks is a gap
  if (amenities.has("pool") || amenities.has("rooftop_pool")) gap += 1;
  if (amenities.has("parking") || amenities.has("parking_garage") || amenities.has("valet")) gap += 0.75;
  if (amenities.has("in_unit_laundry") || amenities.has("washer_dryer")) gap += 0.75;
  if (amenities.has("concierge") || amenities.has("security_24_7")) gap += 0.5;
  if (amenities.has("coworking") || amenities.has("business_center")) gap += 0.5;
  if (amenities.has("bar") || amenities.has("game_room") || amenities.has("theater")) gap += 0.5;
  // Cap at 4.5 — any single comp rarely has everything
  return clamp(round1(1 + gap), 1, 5);
}

/**
 * How much better is their service presentation than Baxter?
 * Without field tour data this is estimated from comp quality score.
 */
function scoreServiceGap(comp: CompetitorProperty, tourQualityScore: number | null): number {
  if (tourQualityScore !== null) {
    // Field tour gives us direct signal. Baxter's baseline is ~3.0.
    return clamp(round1(tourQualityScore - 3.0 + 2.5), 1, 5);
  }
  // Estimate from quality score proxy
  const qs = comp.compQualityScore ?? 70;
  return clamp(round1((qs - 65) / 8), 1, 5);
}

/**
 * How much better are their units (finish, layout, unique features)?
 * Estimated from quality score when no field tour.
 */
function scoreUnitQualityGap(comp: CompetitorProperty): number {
  const qs = comp.compQualityScore ?? 70;
  return clamp(round1((qs - 60) / 8), 1, 5);
}

/**
 * How much better is their marketing presentation (photos, online listing quality)?
 */
function scoreMarketingGap(comp: CompetitorProperty): number {
  const qs = comp.compQualityScore ?? 70;
  // Marketing follows overall quality loosely
  return clamp(round1((qs - 62) / 10), 1, 4);
}

/**
 * How much better is the renter's end-to-end experience (from search to move-in)?
 */
function scoreRenterExperienceGap(comp: CompetitorProperty, tourQualityScore: number | null): number {
  if (tourQualityScore !== null) {
    return clamp(round1(tourQualityScore - 3.0 + 2.5), 1, 5);
  }
  // Fall back to field verification signal
  if (comp.fieldVerificationConfidence === "high") return 3.5;
  const qs = comp.compQualityScore ?? 70;
  return clamp(round1((qs - 62) / 10), 1, 4);
}

// ─── Static tour quality overrides (field-verified comps) ────────────────────
// tourQualityScore can only be computed from an actual field tour.
// These are Bailey's observed values from the 2026-05-27 tours.
const FIELD_TOUR_QUALITY_OVERRIDES: Record<string, number> = {
  "c-jardine": 4.5,    // Luxury lobby, scent control, coffee offered, rooftop pool, polished leasing
  "c-zen-hollywood": 4.0,  // Premium amenity stack, valet, bar, theater, well-staffed
  "c-highland": 3.0,   // Rooftop pool strong; exterior circulation (motel-style) weak
  "c-vine-1600": 2.0,  // Large two-story unit; agent was rude and dismissive (Bailey's observation)
};

// ─── Main scoring function ────────────────────────────────────────────────────

/**
 * Calculate all three Smart Threat scores for a competitor.
 * Pass `tourQualityOverride` to inject a field-verified tour quality score.
 * Returns null tourQualityScore if no field tour is available.
 */
export function calculateSmartThreat(
  comp: CompetitorProperty,
  tourQualityOverride?: number | null,
): SmartThreatScores {
  const tourQuality =
    tourQualityOverride !== undefined
      ? tourQualityOverride
      : FIELD_TOUR_QUALITY_OVERRIDES[comp.id] ?? null;

  // Direct threat sub-components
  const priceOverlapScore = scorePriceOverlap(comp);
  const productOverlapScore = scoreProductOverlap(comp);
  const renterSegmentOverlapScore = scoreRenterSegmentOverlap(comp);
  const availabilityPressure = scoreAvailabilityPressure(comp);
  const concessionPressure = scoreConcessionPressure(comp);

  const directThreatScore = round1(
    priceOverlapScore * 0.30 +
    productOverlapScore * 0.25 +
    renterSegmentOverlapScore * 0.25 +
    availabilityPressure * 0.10 +
    concessionPressure * 0.10,
  );

  // Learning sub-components
  const amenityGapScore = scoreAmenityGap(comp);
  const serviceGapScore = scoreServiceGap(comp, tourQuality);
  const unitQualityGap = scoreUnitQualityGap(comp);
  const marketingPresentationGap = scoreMarketingGap(comp);
  const renterExperienceGap = scoreRenterExperienceGap(comp, tourQuality);

  const learningScore = round1(
    amenityGapScore * 0.25 +
    serviceGapScore * 0.20 +
    unitQualityGap * 0.20 +
    marketingPresentationGap * 0.15 +
    renterExperienceGap * 0.20,
  );

  const systemClassification = classifyCompetitor(directThreatScore, tourQuality, learningScore, comp);

  // Sprint 13 — explanation strings (why these scores, in plain English)
  const explanation: string[] = [];
  if (priceOverlapScore >= 4) explanation.push(`Rent band overlaps Baxter heavily (price overlap ${priceOverlapScore}/5).`);
  else if (priceOverlapScore <= 2) explanation.push(`Rent band sits ${priceOverlapScore <= 1 ? "well above/below" : "noticeably away from"} Baxter (price overlap ${priceOverlapScore}/5) — not a clean rent anchor.`);

  if (productOverlapScore >= 4) explanation.push(`Same product mix (studios/1BR/2BR) as Baxter.`);
  else if (productOverlapScore <= 2) explanation.push(`Product mix doesn't match Baxter — ${productOverlapScore <= 1 ? "fundamentally different building" : "limited unit-type overlap"}.`);

  if (renterSegmentOverlapScore <= 2) explanation.push(`Targets a different renter segment than Baxter.`);
  if (concessionPressure >= 4) explanation.push(`Heavy concessions (${comp.freeRentWeeks ?? 0}+ weeks free) put real pricing pressure on Baxter.`);
  if (availabilityPressure >= 4) explanation.push(`Active leasing pressure: ${comp.toursLastWeek ?? 0} tours / ${comp.leasesLastWeek ?? 0} leases last week.`);

  if (tourQuality !== null && tourQuality >= 4) explanation.push(`Toured leasing experience scored ${tourQuality}/5 — high quality.`);
  if (amenityGapScore >= 4) explanation.push(`Significantly stronger amenity stack than Baxter.`);
  if (serviceGapScore >= 4) explanation.push(`Service polish (greeting, coffee, scent, follow-up) outperforms Baxter's current baseline.`);
  if (unitQualityGap >= 4) explanation.push(`Unit finishes / quality noticeably better than Baxter's current state.`);

  // Classification footnote
  if (systemClassification === "premium_aspirational_comp") explanation.push(`Classification: premium aspirational — learn from it, do not anchor Baxter rents to it.`);
  if (systemClassification === "direct_threat") explanation.push(`Classification: direct threat — Baxter actively loses prospects to this comp.`);
  if (systemClassification === "partial_threat") explanation.push(`Classification: partial threat — overlapping renter but differentiated price or product.`);
  if (systemClassification === "not_comparable_but_instructive") explanation.push(`Classification: not directly comparable, but worth tracking for learnings.`);

  // Sprint 13 — derive plain-string baxterTakeaways from the same source `generateTakeaways` uses
  const generated = generateTakeaways(comp, {
    directThreatScore,
    tourQualityScore: tourQuality,
    learningScore,
    priceOverlapScore,
    productOverlapScore,
    renterSegmentOverlapScore,
    availabilityPressure,
    concessionPressure,
    amenityGapScore,
    serviceGapScore,
    unitQualityGap,
    marketingPresentationGap,
    renterExperienceGap,
    systemClassification,
  });
  const baxterTakeaways = generated
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 6)
    .map(t => t.takeawayTitle);

  return {
    directThreatScore,
    tourQualityScore: tourQuality,
    learningScore,
    priceOverlapScore,
    productOverlapScore,
    renterSegmentOverlapScore,
    availabilityPressure,
    concessionPressure,
    amenityGapScore,
    serviceGapScore,
    unitQualityGap,
    marketingPresentationGap,
    renterExperienceGap,
    systemClassification,
    explanation,
    baxterTakeaways,
  };
}

// ─── Classification logic ─────────────────────────────────────────────────────

export function classifyCompetitor(
  directThreatScore: number,
  tourQualityScore: number | null,
  learningScore: number,
  comp?: CompetitorProperty,
): CompetitorClassification {
  const tq = tourQualityScore ?? 3.0; // conservative fallback

  // High direct overlap → direct threat
  if (directThreatScore >= 3.7) return "direct_threat";

  // Meaningful overlap but differentiated
  if (directThreatScore >= 2.8) return "partial_threat";

  // Low direct threat but high quality + high learning = aspirational comp
  if (directThreatScore < 2.8 && tq >= 3.5 && learningScore >= 3.0) {
    return "premium_aspirational_comp";
  }

  // Low direct threat, explicitly lower price tier
  if (directThreatScore < 2.5 && comp) {
    const min1BR = comp.unitTypes?.find(u => u.type === "1BR")?.minRent;
    if (min1BR && min1BR < 2200) return "budget_comp";
  }

  // High learning value despite no direct threat
  if (directThreatScore < 2.0 && learningScore >= 2.5) {
    return "not_comparable_but_instructive";
  }

  return "weak_threat";
}

// ─── Pre-computed smart threats for all 17 comps ──────────────────────────────
// These are the canonical scores used by list/intelligence pages (no DB round-trip).
// The DB stores the same values and allows manager overrides.

let _cachedSmartThreats: Map<string, SmartThreatScores> | null = null;

export function getStaticSmartThreats(): Map<string, SmartThreatScores> {
  if (_cachedSmartThreats) return _cachedSmartThreats;
  // Lazy import to avoid circular deps
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { COMPETITORS } = require("@/lib/seed") as { COMPETITORS: CompetitorProperty[] };
  const map = new Map<string, SmartThreatScores>();
  for (const comp of COMPETITORS) {
    map.set(comp.id, calculateSmartThreat(comp));
  }
  _cachedSmartThreats = map;
  return map;
}

export function getStaticSmartThreat(competitorId: string): SmartThreatScores | null {
  return getStaticSmartThreats().get(competitorId) ?? null;
}

// ─── DB persistence ───────────────────────────────────────────────────────────

type DbRow = {
  id: string;
  competitor_id: string;
  direct_threat_score: number;
  tour_quality_score: number | null;
  learning_score: number;
  price_overlap_score: number;
  product_overlap_score: number;
  renter_segment_overlap_score: number;
  availability_pressure: number;
  concession_pressure: number;
  amenity_gap_score: number;
  service_gap_score: number;
  unit_quality_gap: number;
  marketing_presentation_gap: number;
  renter_experience_gap: number;
  system_classification: CompetitorClassification;
  manual_classification: CompetitorClassification | null;
  manual_classification_reason: string | null;
  manual_classification_set_by: string | null;
  manual_classification_set_at: string | null;
  summary_notes: string | null;
  last_computed_at: string;
  created_at: string;
  updated_at: string;
};

function rowToSummary(row: DbRow): CompetitorIntelligenceSummary {
  return {
    id: row.id,
    competitorId: row.competitor_id,
    directThreatScore: Number(row.direct_threat_score),
    tourQualityScore: row.tour_quality_score !== null ? Number(row.tour_quality_score) : null,
    learningScore: Number(row.learning_score),
    priceOverlapScore: Number(row.price_overlap_score),
    productOverlapScore: Number(row.product_overlap_score),
    renterSegmentOverlapScore: Number(row.renter_segment_overlap_score),
    availabilityPressure: Number(row.availability_pressure),
    concessionPressure: Number(row.concession_pressure),
    amenityGapScore: Number(row.amenity_gap_score),
    serviceGapScore: Number(row.service_gap_score),
    unitQualityGap: Number(row.unit_quality_gap),
    marketingPresentationGap: Number(row.marketing_presentation_gap),
    renterExperienceGap: Number(row.renter_experience_gap),
    systemClassification: row.system_classification,
    manualClassification: row.manual_classification ?? undefined,
    manualClassificationReason: row.manual_classification_reason ?? undefined,
    manualClassificationSetBy: row.manual_classification_set_by ?? undefined,
    manualClassificationSetAt: row.manual_classification_set_at ?? undefined,
    summaryNotes: row.summary_notes ?? undefined,
    lastComputedAt: row.last_computed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getCompetitorIntelligenceSummary(
  competitorId: string,
): Promise<CompetitorIntelligenceSummary | null> {
  try {
    const client = getSupabase();
    if (!client) return null;
    const { data, error } = await client
      .from("competitor_intelligence_summary")
      .select("*")
      .eq("competitor_id", competitorId)
      .single();
    if (error || !data) return null;
    return rowToSummary(data as DbRow);
  } catch {
    return null;
  }
}

export async function getAllIntelligenceSummaries(): Promise<Map<string, CompetitorIntelligenceSummary>> {
  try {
    const client = getSupabase();
    if (!client) return new Map();
    const { data, error } = await client
      .from("competitor_intelligence_summary")
      .select("*");
    if (error || !data) return new Map();
    return new Map((data as DbRow[]).map(row => [row.competitor_id, rowToSummary(row)]));
  } catch {
    return new Map();
  }
}

export async function upsertIntelligenceSummary(
  competitorId: string,
  scores: SmartThreatScores,
): Promise<boolean> {
  try {
    const client = getSupabase();
    if (!client) return false;
    const { error } = await client
      .from("competitor_intelligence_summary")
      .upsert(
        {
          competitor_id: competitorId,
          direct_threat_score: scores.directThreatScore,
          tour_quality_score: scores.tourQualityScore,
          learning_score: scores.learningScore,
          price_overlap_score: scores.priceOverlapScore,
          product_overlap_score: scores.productOverlapScore,
          renter_segment_overlap_score: scores.renterSegmentOverlapScore,
          availability_pressure: scores.availabilityPressure,
          concession_pressure: scores.concessionPressure,
          amenity_gap_score: scores.amenityGapScore,
          service_gap_score: scores.serviceGapScore,
          unit_quality_gap: scores.unitQualityGap,
          marketing_presentation_gap: scores.marketingPresentationGap,
          renter_experience_gap: scores.renterExperienceGap,
          system_classification: scores.systemClassification,
          last_computed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "competitor_id" },
      );
    return !error;
  } catch {
    return false;
  }
}

/**
 * Sprint 11 — Patch only summary_notes on the intelligence row without touching scores.
 * Upserts a skeleton row if none exists yet.
 */
export async function updateSummaryNotes(
  competitorId: string,
  notes: string,
  editedBy = "Bailey",
): Promise<boolean> {
  try {
    const client = getSupabase();
    if (!client) return false;
    const { error } = await client
      .from("competitor_intelligence_summary")
      .upsert(
        {
          competitor_id: competitorId,
          summary_notes: notes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "competitor_id" },
      );
    if (error) { console.error("[updateSummaryNotes]", error.message); return false; }

    // Sprint 13: write a source-ledger row so the edit is traceable.
    // Lazy-require avoids a circular import between this file and manualEdits.ts.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { writeManualEditLedger } = require("./manualEdits") as typeof import("./manualEdits");
      await writeManualEditLedger({
        competitorId,
        entityType: "competitor",
        entityId: competitorId,
        entityName: competitorId,
        fieldKey: "summary_notes",
        fieldLabel: "Intelligence notes",
        fieldCategory: "other",
        valueType: "text",
        valueText: notes,
        displayValue: notes.length > 80 ? notes.slice(0, 77) + "…" : notes,
        editedBy,
        pageRoutes: ["/competitors", `/competitors/${competitorId.replace(/^c-/, "")}`, "/competitor-intelligence"],
      });
    } catch {
      /* ledger write is non-fatal */
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Set a manual classification override — preserves the system score.
 * Call after manager reviews the automated classification.
 */
export async function setManualClassification(
  competitorId: string,
  classification: CompetitorClassification,
  reason: string,
  setBy: string,
): Promise<boolean> {
  try {
    const client = getSupabase();
    if (!client) return false;
    const { error } = await client
      .from("competitor_intelligence_summary")
      .update({
        manual_classification: classification,
        manual_classification_reason: reason,
        manual_classification_set_by: setBy,
        manual_classification_set_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("competitor_id", competitorId);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Master recompute — fetches all available data for a competitor and
 * recomputes all three scores. Call this after adding a field tour,
 * editing covariate scores, or updating unit observations.
 *
 * Persists results to competitor_intelligence_summary via upsert.
 */
export async function recomputeCompetitorIntelligence(competitorId: string): Promise<SmartThreatScores | null> {
  try {
    // Sprint 12: read from Supabase competitors table first, fall back to seed.
    // This is what makes /add-tour properties actually get scored — previously
    // we only looked in the seed and silently failed for new properties.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { loadCompetitor } = require("@/lib/services/competitors") as {
      loadCompetitor: (id: string) => Promise<CompetitorProperty | null>;
    };
    const comp = await loadCompetitor(competitorId);
    if (!comp) return null;

    // Try to pull latest compositeExperienceScore from competitor_field_tours
    let tourQualityOverride: number | null = FIELD_TOUR_QUALITY_OVERRIDES[competitorId] ?? null;
    try {
      const client = getSupabase();
      if (client) {
        const { data } = await client
          .from("competitor_field_tours")
          .select("composite_experience_score, tour_quality")
          .eq("competitor_id", competitorId)
          .eq("tour_status", "completed")
          .order("tour_date", { ascending: false })
          .limit(1)
          .single();
        if (data) {
          // Prefer composite_experience_score (0–100 → scaled to 0–5), fall back to tour_quality
          const raw = data.composite_experience_score ?? data.tour_quality;
          if (typeof raw === "number" && raw > 0) {
            tourQualityOverride = raw > 5 ? round1(raw / 20) : round1(raw);
          }
        }
      }
    } catch {
      // No tour on record — tourQualityOverride stays as static override or null
    }

    const scores = calculateSmartThreat(comp, tourQualityOverride);
    await upsertIntelligenceSummary(competitorId, scores);
    // Invalidate cache so next call recomputes
    _cachedSmartThreats = null;
    return scores;
  } catch {
    return null;
  }
}

// ─── Auto-generate takeaways ──────────────────────────────────────────────────

/**
 * Derive actionable takeaways from a competitor's smart threat scores.
 * These are inserted into competitor_takeaways and shown on detail pages.
 */
export function generateTakeaways(
  comp: CompetitorProperty,
  scores: SmartThreatScores,
): Omit<CompetitorTakeaway, "id" | "createdAt" | "updatedAt">[] {
  const takeaways: Omit<CompetitorTakeaway, "id" | "createdAt" | "updatedAt">[] = [];
  const amenities = new Set(comp.amenities ?? []);
  const now = new Date().toISOString();
  void now; // not needed here — timestamps added at upsert

  // High amenity gap
  if (scores.amenityGapScore >= 3.5) {
    if (amenities.has("pool") || amenities.has("rooftop_pool")) {
      takeaways.push({
        competitorId: comp.id,
        category: "amenity",
        takeawayTitle: `${comp.name} has a pool — Baxter does not`,
        takeawayDetail: "Pool access is a consistent selling point in Bailey's field notes. Baxter should promote rooftop lounge upgrades as an alternative, or add pool access as a partnership with nearby gym.",
        priority: 4,
        actionForBaxter: "Add 'rooftop lounge upgrade' to capital plan discussion; research gym partnership deals for Baxter residents.",
        status: "open",
        autoGenerated: true,
      });
    }
    if (amenities.has("parking") || amenities.has("valet") || amenities.has("parking_garage")) {
      takeaways.push({
        competitorId: comp.id,
        category: "amenity",
        takeawayTitle: `${comp.name} includes parking — Baxter does not`,
        takeawayDetail: "Hollywood parking is ~$200/mo at street garages. Comps bundling parking have a meaningful advantage in effective rent comparison.",
        priority: 3,
        actionForBaxter: "Surface the explicit parking cost gap in Baxter's pricing rationale. If Baxter negotiates a nearby parking deal, advertise the effective savings.",
        status: "open",
        autoGenerated: true,
      });
    }
    if (amenities.has("in_unit_laundry") || amenities.has("washer_dryer")) {
      takeaways.push({
        competitorId: comp.id,
        category: "amenity",
        takeawayTitle: `${comp.name} has in-unit washer/dryer`,
        takeawayDetail: "In-unit laundry is increasingly expected at $2,500+ rents. Baxter has shared laundry. This is a weaker point in Baxter tours.",
        priority: 4,
        actionForBaxter: "Verify Baxter's shared laundry quality and accessibility. Consider in-unit stackable W/D as a premium option in select units.",
        status: "open",
        autoGenerated: true,
      });
    }
  }

  // High service gap
  if (scores.serviceGapScore >= 3.5 && scores.tourQualityScore !== null && scores.tourQualityScore >= 4.0) {
    takeaways.push({
      competitorId: comp.id,
      category: "service",
      takeawayTitle: `${comp.name}'s leasing experience scores significantly higher than Baxter's baseline`,
      takeawayDetail: `Field tour quality score: ${scores.tourQualityScore}/5. Coffee, scent, warm greeting, and tour choreography all rated above Baxter's current walk-in experience.`,
      priority: 5,
      actionForBaxter: "Implement Baxter Leasing Playbook: coffee/water offering, scent management, cleaned tour units, scripted building highlights, immediate follow-up within 2 hours.",
      status: "open",
      autoGenerated: true,
    });
  }

  // Direct threat — concession pressure
  if (scores.concessionPressure >= 4.0 && scores.directThreatScore >= 3.5) {
    takeaways.push({
      competitorId: comp.id,
      category: "pricing",
      takeawayTitle: `${comp.name} is actively buying traffic with ${comp.freeRentWeeks}+ weeks free`,
      takeawayDetail: `Concession pressure score: ${scores.concessionPressure}/5. Prospective renters comparison-shopping will see this as $${((comp.freeRentWeeks ?? 0) / 52 * ((comp.unitTypes?.[0]?.avgRent ?? 3000))).toFixed(0)} in free rent.`,
      priority: 5,
      actionForBaxter: "Anchor Baxter pitch on NET effective rent vs gross, not free-rent months. Price Baxter 1BRs using effective-rent math against this comp.",
      status: "open",
      autoGenerated: true,
    });
  }

  // Premium aspirational — copy their marketing/experience
  if (scores.systemClassification === "premium_aspirational_comp" && scores.learningScore >= 4.0) {
    takeaways.push({
      competitorId: comp.id,
      category: "experience",
      takeawayTitle: `${comp.name} is a premium aspirational comp — high learning value`,
      takeawayDetail: `${comp.name} is NOT a direct rent anchor for Baxter — their price point and renter segment differ. But their tour quality, marketing polish, and leasing service are worth copying directly.`,
      priority: 4,
      actionForBaxter: "Do a deep comparison walkthrough. Document every tactile/sensory element (scent, music, lighting, signage, leasing desk setup). Map it against Baxter's current walkthrough experience.",
      status: "open",
      autoGenerated: true,
    });
  }

  // Marketing gap
  if (scores.marketingPresentationGap >= 3.5) {
    takeaways.push({
      competitorId: comp.id,
      category: "marketing",
      takeawayTitle: `${comp.name}'s marketing presentation outscores Baxter's current online presence`,
      takeawayDetail: "Listing quality (professional photography, virtual tours, floor plans) is a decision factor before the prospect even contacts the property.",
      priority: 3,
      actionForBaxter: "Commission professional photos of best Baxter units (301, 105). Build a before/after social campaign. Update Apartments.com listing with updated assets.",
      status: "open",
      autoGenerated: true,
    });
  }

  return takeaways;
}

// ─── Persist takeaways ────────────────────────────────────────────────────────

export async function saveGeneratedTakeaways(
  competitorId: string,
  takeaways: Omit<CompetitorTakeaway, "id" | "createdAt" | "updatedAt">[],
): Promise<boolean> {
  if (takeaways.length === 0) return true;
  try {
    const client = getSupabase();
    if (!client) return false;
    // Delete existing auto-generated takeaways for this competitor
    await client
      .from("competitor_takeaways")
      .delete()
      .eq("competitor_id", competitorId)
      .eq("auto_generated", true);
    // Insert new ones
    const rows = takeaways.map(t => ({
      competitor_id: t.competitorId,
      category: t.category,
      takeaway_title: t.takeawayTitle,
      takeaway_detail: t.takeawayDetail ?? null,
      priority: t.priority,
      action_for_baxter: t.actionForBaxter ?? null,
      status: t.status,
      auto_generated: t.autoGenerated,
    }));
    const { error } = await client.from("competitor_takeaways").insert(rows);
    return !error;
  } catch {
    return false;
  }
}

export async function getTakeawaysForCompetitor(competitorId: string): Promise<CompetitorTakeaway[]> {
  try {
    const client = getSupabase();
    if (!client) return [];
    const { data, error } = await client
      .from("competitor_takeaways")
      .select("*")
      .eq("competitor_id", competitorId)
      .order("priority", { ascending: false });
    if (error || !data) return [];
    return (data as Array<{
      id: string; competitor_id: string; category: CompetitorTakeaway["category"];
      takeaway_title: string; takeaway_detail: string | null; priority: number;
      action_for_baxter: string | null; status: CompetitorTakeaway["status"];
      auto_generated: boolean; created_at: string; updated_at: string;
    }>).map(r => ({
      id: r.id,
      competitorId: r.competitor_id,
      category: r.category,
      takeawayTitle: r.takeaway_title,
      takeawayDetail: r.takeaway_detail ?? undefined,
      priority: r.priority as CompetitorTakeaway["priority"],
      actionForBaxter: r.action_for_baxter ?? undefined,
      status: r.status,
      autoGenerated: r.auto_generated,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  } catch {
    return [];
  }
}

// ─── Classification display helpers ──────────────────────────────────────────

export const CLASSIFICATION_LABELS: Record<CompetitorClassification, string> = {
  direct_threat: "Direct Threat",
  partial_threat: "Partial Threat",
  premium_aspirational_comp: "Premium Aspirational",
  budget_comp: "Budget Comp",
  weak_threat: "Weak Threat",
  not_comparable_but_instructive: "Not Comparable — Instructive",
};

export const CLASSIFICATION_COLORS: Record<CompetitorClassification, "bad" | "warn" | "info" | "neutral" | "good"> = {
  direct_threat: "bad",
  partial_threat: "warn",
  premium_aspirational_comp: "info",
  budget_comp: "neutral",
  weak_threat: "neutral",
  not_comparable_but_instructive: "good",
};

export const CLASSIFICATION_DESCRIPTIONS: Record<CompetitorClassification, string> = {
  direct_threat: "Same renter, same price band, active concession pressure. Baxter must differentiate.",
  partial_threat: "Overlapping renter segment with some price or product differentiation.",
  premium_aspirational_comp: "Higher tier — NOT a rent anchor. Use for leasing service + amenity benchmarking only.",
  budget_comp: "Lower price tier. Competes on cost rather than product quality.",
  weak_threat: "Limited overlap with Baxter's target renter or price range.",
  not_comparable_but_instructive: "Not a direct comp, but operational or marketing learnings apply.",
};
