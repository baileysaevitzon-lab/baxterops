// Sprint 5 — manual covariate rubric.
//
// The full per-field rubric (1-5 anchors, boolean meanings, enums) lives inside
// the data dictionary as the `rubric` field. This file exposes:
//   - the canonical ordered list of subjective covariates the walkthrough form prompts for
//   - the composite weighting used by COMPOSITE_EXPERIENCE_SCORE
//   - helpers to compute and label scores

import { DATA_DICTIONARY } from "./dataDictionary";
import type { ManualCovariateScore } from "./types";

export interface CovariateFormField {
  key: string;
  label: string;
  type: "rating_1_5" | "boolean" | "enum" | "number" | "text";
  unit?: string;
  hint?: string;
  rubric?: Record<string, string>;
  enumValues?: string[];
}

// Composite weighting (sums to ~1.0). Editable later via /settings.
// Sprint 8 — added punctuality, service_quality, layout_quality, closet_storage_quality,
// bedroom_size_quality, balcony_quality, hallway_entry_quality, maintenance_presence,
// quietness, concession_aggressiveness. Re-balanced to keep total ~1.0.
export const COMPOSITE_WEIGHTS: Record<string, number> = {
  tour_booking_ease: 0.04,
  punctuality: 0.04,
  kindness: 0.04,
  professionalism: 0.04,
  service_quality: 0.06,
  cleanliness: 0.06,
  amenity_quality: 0.10,
  unit_quality: 0.07,
  layout_quality: 0.05,
  bedroom_size_quality: 0.04,
  closet_storage_quality: 0.04,
  balcony_quality: 0.03,
  hallway_quality: 0.03,
  hallway_entry_quality: 0.03,
  common_area_quality: 0.05,
  exterior_quality: 0.05,
  scent_quality: 0.03,
  quietness: 0.03,
  maintenance_presence: 0.03,
  luxury_feel: 0.08,
  closing_strength: 0.03,
  follow_up_quality: 0.03,
};

// Walkthrough form fields in display order, grouped by section.
// Each field carries a `section` so the form can collapse by section.
export const COVARIATE_FIELDS: CovariateFormField[] = [
  // ── Leasing Experience
  { key: "tour_booking_ease", label: "Ease of Booking Tour", type: "rating_1_5" },
  { key: "response_speed_hours", label: "Response Speed (hours)", type: "number", unit: "hours" },
  { key: "punctuality", label: "Tour Started On Time", type: "rating_1_5", hint: "1 = badly late · 5 = exactly on time." },
  { key: "kindness", label: "Leasing Agent Kindness", type: "rating_1_5" },
  { key: "professionalism", label: "Leasing Agent Professionalism", type: "rating_1_5" },
  { key: "service_quality", label: "Overall Service Quality", type: "rating_1_5" },
  { key: "closing_strength", label: "Closing Strength", type: "rating_1_5" },
  { key: "follow_up_quality", label: "Follow-up Quality", type: "rating_1_5" },
  { key: "tour_quality", label: "Overall Tour Quality", type: "rating_1_5" },
  { key: "desperation_vs_confidence", label: "Desperation → Confidence (5=confident)", type: "rating_1_5" },
  { key: "pressure_level", label: "Sales Pressure Level", type: "enum", enumValues: ["low","medium","high"] },
  { key: "drinks_or_snacks_offered", label: "Drinks/Snacks Offered", type: "boolean" },
  { key: "coffee_offered", label: "Coffee Offered", type: "boolean" },
  // ── Building Feel
  { key: "cleanliness", label: "Building Cleanliness", type: "rating_1_5" },
  { key: "scent_quality", label: "Smell / Scent Quality", type: "rating_1_5", hint: "Does the building smell good? Air freshener, fresh air, no funky hallways." },
  { key: "luxury_feel", label: "Luxury Feel", type: "rating_1_5", hint: "Lobby, finishes, materials, overall premium presentation." },
  { key: "exterior_quality", label: "Exterior / Outside Quality", type: "rating_1_5" },
  { key: "hallway_quality", label: "Hallway Quality", type: "rating_1_5" },
  { key: "hallway_entry_quality", label: "Circulation / Entry Quality", type: "rating_1_5", hint: "1 = motel-style exterior corridors · 5 = enclosed luxury hallways." },
  { key: "common_area_quality", label: "Common Area Quality", type: "rating_1_5" },
  { key: "quietness", label: "Quietness", type: "rating_1_5", hint: "1 = noisy / loud neighbors · 5 = very quiet building." },
  { key: "maintenance_presence", label: "Maintenance Presence", type: "rating_1_5", hint: "How visible / responsive is on-site maintenance?" },
  // ── Unit Quality
  { key: "unit_quality", label: "Unit Quality", type: "rating_1_5" },
  { key: "layout_quality", label: "Layout Quality", type: "rating_1_5" },
  { key: "bedroom_size_quality", label: "Bedroom Size", type: "rating_1_5" },
  { key: "closet_storage_quality", label: "Closet / Storage Quality", type: "rating_1_5" },
  { key: "balcony_quality", label: "Balcony / Patio Quality", type: "rating_1_5", hint: "1 = none / tiny + unusable · 5 = large outdoor space, real furniture fits." },
  // ── Amenities
  { key: "amenity_quality", label: "Amenity Quality (overall)", type: "rating_1_5" },
  // ── Deal Terms / Fees
  { key: "concession_aggressiveness", label: "Concession Aggressiveness", type: "rating_1_5", hint: "1 = none · 5 = heavy free rent / big LAL bonus." },
  { key: "hidden_concession_offered", label: "Hidden Concession Offered", type: "boolean" },
  { key: "parking_deal_offered", label: "Parking Deal Offered", type: "boolean" },
  { key: "fees_waivable", label: "Fees Waivable", type: "boolean" },
  { key: "fees_transparency", label: "Fees Transparency", type: "rating_1_5", hint: "1 = surprise fees / opaque · 5 = clear fee guide handed to you." },
  { key: "utilities_transparency", label: "Utilities Transparency", type: "rating_1_5", hint: "Were utility costs clearly disclosed?" },
  // ── Baxter Comparability
  { key: "would_renter_choose_over_baxter", label: "Would renter choose this over Baxter?", type: "boolean" },
  { key: "not_directly_comparable_to_baxter", label: "Not directly comparable to Baxter (different product)", type: "boolean", hint: "Toggle ON when the competitor is too luxury / different segment to anchor Baxter pricing against." },
];

/** Attach rubric anchors from the data dictionary. */
export function rubricFor(key: string): Record<string, string> | undefined {
  return DATA_DICTIONARY.find(d => d.key === key)?.rubric?.values;
}

export function compositeExperienceScore(scores: ManualCovariateScore[]): number {
  let total = 0;
  let weight = 0;
  for (const s of scores) {
    const w = COMPOSITE_WEIGHTS[s.covariateKey];
    if (w && typeof s.scoreValueNumber === "number") {
      total += s.scoreValueNumber * w;
      weight += w;
    }
  }
  if (weight === 0) return 0;
  return Math.round((total / weight) * 10) / 10;
}

export function compositeBand(s: number): string {
  if (s >= 4.5) return "Excellent";
  if (s >= 3.5) return "Strong";
  if (s >= 2.5) return "Average";
  if (s >= 1.5) return "Weak";
  if (s > 0) return "Poor";
  return "—";
}
