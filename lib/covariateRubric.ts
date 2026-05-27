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

// Composite weighting (must equal 1.0). Editable later via /settings.
export const COMPOSITE_WEIGHTS: Record<string, number> = {
  tour_booking_ease: 0.10,
  kindness: 0.10,
  professionalism: 0.10,
  cleanliness: 0.13,
  amenity_quality: 0.13,
  unit_quality: 0.12,
  hallway_quality: 0.05,
  common_area_quality: 0.10,
  closing_strength: 0.10,
  follow_up_quality: 0.07,
};

// Walkthrough form fields in display order
export const COVARIATE_FIELDS: CovariateFormField[] = [
  { key: "tour_booking_ease", label: "Ease of Booking Tour", type: "rating_1_5" },
  { key: "response_speed_hours", label: "Response Speed (hours)", type: "number", unit: "hours" },
  { key: "kindness", label: "Leasing Agent Kindness", type: "rating_1_5" },
  { key: "professionalism", label: "Leasing Agent Professionalism", type: "rating_1_5" },
  { key: "cleanliness", label: "Building Cleanliness", type: "rating_1_5" },
  { key: "amenity_quality", label: "Amenity Quality", type: "rating_1_5" },
  { key: "unit_quality", label: "Unit Quality", type: "rating_1_5" },
  { key: "hallway_quality", label: "Hallway Quality", type: "rating_1_5" },
  { key: "common_area_quality", label: "Common Area Quality", type: "rating_1_5" },
  { key: "closing_strength", label: "Closing Strength", type: "rating_1_5" },
  { key: "follow_up_quality", label: "Follow-up Quality", type: "rating_1_5" },
  { key: "tour_quality", label: "Overall Tour Quality", type: "rating_1_5" },
  { key: "desperation_vs_confidence", label: "Desperation → Confidence (5=confident)", type: "rating_1_5" },
  { key: "drinks_or_snacks_offered", label: "Drinks/Snacks Offered", type: "boolean" },
  { key: "hidden_concession_offered", label: "Hidden Concession Offered", type: "boolean" },
  { key: "parking_deal_offered", label: "Parking Deal Offered", type: "boolean" },
  { key: "fees_waivable", label: "Fees Waivable", type: "boolean" },
  { key: "would_renter_choose_over_baxter", label: "Would renter choose this over Baxter?", type: "boolean" },
  { key: "pressure_level", label: "Sales Pressure Level", type: "enum", enumValues: ["low","medium","high"] },
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
