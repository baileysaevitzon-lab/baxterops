// Centralized data-quality flag registry.
// Surfaced on /settings (full panel) and inline on the relevant cards.

import type { DataQualityFlag } from "./types";

export const DATA_QUALITY_FLAGS: DataQualityFlag[] = [
  {
    id: "fq-camden-2br-sqft",
    issue: "2BR average sqft 3,272 appears implausible.",
    affectedEntity: "The Camden",
    affectedEntityType: "competitor",
    severity: "medium",
    status: "needs_verification",
    notes: "Source comp report value. Verify against official site / Apartments.com floorplan page.",
    createdAt: "2026-05-26",
  },
  {
    id: "fq-ava-2br-sqft",
    issue: "2BR average sqft 2,525 appears implausible.",
    affectedEntity: "Ava Hollywood",
    affectedEntityType: "competitor",
    severity: "medium",
    status: "needs_verification",
    notes: "Likely call-around transcription error. Confirm.",
    createdAt: "2026-05-26",
  },
  {
    id: "fq-encore-1br-sqft",
    issue: "1BR average sqft 1,699 appears implausible.",
    affectedEntity: "Encore",
    affectedEntityType: "competitor",
    severity: "medium",
    status: "needs_verification",
    notes: "Likely a 2BR mixed into the 1BR bucket on the call-around.",
    createdAt: "2026-05-26",
  },
  {
    id: "fq-1600-vine-address",
    issue: "Name/address mismatch: name says '1600 Vine Avenue' but address shows 1411 N Highland Ave.",
    affectedEntity: "1600 Vine Avenue",
    affectedEntityType: "competitor",
    severity: "high",
    status: "needs_verification",
    notes: "Two different buildings may have been combined. Verify which is the true comp.",
    createdAt: "2026-05-26",
  },
  {
    id: "fq-ardence-2br-rent",
    issue: "2BR average rent $7,150 may be skewed by penthouse inventory.",
    affectedEntity: "Ardence & Bloom",
    affectedEntityType: "competitor",
    severity: "medium",
    status: "needs_verification",
    notes: "Verify unit mix and recompute weighted average without top decile.",
    createdAt: "2026-05-26",
  },
  {
    id: "fq-lead-funnel-mismatch",
    issue: "Marketing ROI shows 3 tours total, but lead funnel shows only 1 toured lead.",
    affectedEntity: "Marketing / Lead funnel",
    affectedEntityType: "marketing",
    severity: "medium",
    status: "open",
    notes: "Reconcile source-level funnel counts between Marketing ROI and Lead Funnel.",
    createdAt: "2026-05-26",
  },
  {
    id: "fq-tenant-unit-blank",
    issue: "3 of 4 tenants show unit number '—'.",
    affectedEntity: "Tenant outreach / Recertification",
    affectedEntityType: "tenant",
    severity: "low",
    status: "open",
    notes: "Clarify whether intentional redaction or missing data.",
    createdAt: "2026-05-26",
  },
  {
    id: "fq-baxter-amenities",
    issue: "Photos/Amenities shows Baxter has no gym, no pool, no parking, no in-unit laundry, no smart locks.",
    affectedEntity: "The Baxter",
    affectedEntityType: "baxter_unit",
    severity: "high",
    status: "needs_verification",
    notes: "Verify actual Baxter amenities and populate inventory.",
    createdAt: "2026-05-26",
  },
  {
    id: "fq-pricing-confidence",
    issue: "Pricing model confidence is uniformly 77-78%.",
    affectedEntity: "Pricing model",
    affectedEntityType: "baxter_unit",
    severity: "low",
    status: "fixed",
    notes: "Sprint 2 fix: confidence now varies with covariate completeness and matched-comp similarity.",
    createdAt: "2026-05-26",
  },
  {
    id: "fq-archer-zip",
    issue: "Archer Hollywood address ZIP showed 90002.",
    affectedEntity: "Archer Hollywood",
    affectedEntityType: "competitor",
    severity: "low",
    status: "fixed",
    notes: "Sprint 2 fix: corrected to 90038.",
    createdAt: "2026-05-26",
  },
  {
    id: "fq-unit-301-rent",
    issue: "Unit 301 rent discrepancy between app ($2,899) and Bailey upload ($2,799).",
    affectedEntity: "Baxter Unit 301",
    affectedEntityType: "baxter_unit",
    severity: "high",
    status: "fixed",
    notes: "Sprint 2 fix: changed to $2,799 with pricingHistory entry. Verify against live listing before owner report.",
    createdAt: "2026-05-26",
  },
  {
    id: "fq-unit-105-concession",
    issue: "Unit 105 was missing structured concession fields.",
    affectedEntity: "Baxter Unit 105",
    affectedEntityType: "baxter_unit",
    severity: "medium",
    status: "fixed",
    notes: "Sprint 2 fix: added 1mo free / 13mo lease, loss-leader strategy, net effective rent computed.",
    createdAt: "2026-05-26",
  },
];

export function flagsFor(entityId: string): DataQualityFlag[] {
  return DATA_QUALITY_FLAGS.filter(f => f.id.includes(entityId) || flagBelongsTo(f, entityId));
}

function flagBelongsTo(f: DataQualityFlag, entityId: string): boolean {
  // crude mapping; flags reference entity ids in the seed
  const map: Record<string, string[]> = {
    "c-camden": ["fq-camden-2br-sqft"],
    "c-ava-hollywood": ["fq-ava-2br-sqft"],
    "c-encore": ["fq-encore-1br-sqft"],
    "c-1600-vine": ["fq-1600-vine-address"],
    "c-ardence-bloom": ["fq-ardence-2br-rent"],
    "c-archer-hollywood": ["fq-archer-zip"],
    "u-301": ["fq-unit-301-rent"],
    "u-105": ["fq-unit-105-concession"],
  };
  return (map[entityId] ?? []).includes(f.id);
}
