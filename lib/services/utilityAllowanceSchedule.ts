// Sprint 39: HACLA Utility Allowance schedule — DRY-RUN calculator only.
//
// Utility Allowance is determined by (a) bedroom count / unit type and
// (b) which utilities the TENANT pays — never by income, grant, Social
// Security, or subsidy amount. Verified against the official schedule:
//
//   Source: HACLA "Utility Allowances for Multi-Family Residential Housing"
//   URL:    https://hacla.org/sites/default/files/Section%208/Utility%20Allowances/Utility%20Allowance%20Schedule%202025%20-SFR%20%26%20MFR.pdf
//   Index:  https://www.hacla.org/en/about-section-8/utility-allowances
//   Effective: 2025-12-01 (retrieved 2026-06-11)
//
// IMPORTANT: this module is advisory. It NEVER feeds the packet generator —
// the generator keeps using manager-entered case data until Katherine
// confirms the bedroom treatment and component set for each unit type.

export type UaBedroomCol = "SRO" | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7";

export type UaComponent =
  | "gas_space_heating" | "gas_cooking" | "gas_water_heating"
  | "water_and_sewer"
  | "basic_electricity" | "electric_space_heating" | "electric_cooking"
  | "electric_water_heating" | "electric_air_conditioning"
  | "range_stove" | "refrigerator" | "trash_collection"
  | "scep_code_enforcement" | "rso_registration_fee";

/** City of Los Angeles — MULTI-FAMILY Residential, effective 12/01/2025 (U25).
 *  Columns: SRO, 0BR … 7BR. Transcribed verbatim from the official PDF. */
export const HACLA_MFR_2025: Record<UaComponent, Record<UaBedroomCol, number>> = {
  gas_space_heating:        { SRO: 5,  "0": 9,  "1": 12, "2": 16, "3": 19, "4": 24, "5": 28, "6": 31, "7": 35 },
  gas_cooking:              { SRO: 2,  "0": 3,  "1": 4,  "2": 5,  "3": 7,  "4": 8,  "5": 10, "6": 11, "7": 12 },
  gas_water_heating:        { SRO: 6,  "0": 10, "1": 14, "2": 18, "3": 22, "4": 28, "5": 32, "6": 36, "7": 40 },
  water_and_sewer:          { SRO: 36, "0": 61, "1": 85, "2": 109,"3": 133,"4": 169,"5": 194,"6": 218,"7": 242 },
  basic_electricity:        { SRO: 10, "0": 17, "1": 24, "2": 30, "3": 37, "4": 47, "5": 54, "6": 61, "7": 67 },
  electric_space_heating:   { SRO: 4,  "0": 7,  "1": 9,  "2": 12, "3": 15, "4": 19, "5": 21, "6": 24, "7": 27 },
  electric_cooking:         { SRO: 2,  "0": 3,  "1": 4,  "2": 6,  "3": 7,  "4": 9,  "5": 10, "6": 11, "7": 12 },
  electric_water_heating:   { SRO: 8,  "0": 14, "1": 20, "2": 25, "3": 31, "4": 39, "5": 45, "6": 50, "7": 56 },
  electric_air_conditioning:{ SRO: 5,  "0": 8,  "1": 11, "2": 14, "3": 17, "4": 22, "5": 25, "6": 28, "7": 31 },
  range_stove:              { SRO: 12, "0": 12, "1": 12, "2": 12, "3": 12, "4": 12, "5": 12, "6": 12, "7": 12 },
  refrigerator:             { SRO: 10, "0": 10, "1": 10, "2": 10, "3": 10, "4": 10, "5": 10, "6": 10, "7": 10 },
  trash_collection:         { SRO: 56, "0": 56, "1": 56, "2": 56, "3": 56, "4": 56, "5": 56, "6": 56, "7": 56 },
  // City fees (MFR sheet): SCEP $3/mo (2+ units on a lot, with exceptions);
  // RSO $2/mo (voucher tenants in pre-Oct-1978 buildings only — Baxter is a
  // 2019-era build, so RSO should NOT apply; SCEP applicability needs Katherine).
  scep_code_enforcement:    { SRO: 3,  "0": 3,  "1": 3,  "2": 3,  "3": 3,  "4": 3,  "5": 3,  "6": 3,  "7": 3 },
  rso_registration_fee:     { SRO: 2,  "0": 2,  "1": 2,  "2": 2,  "3": 2,  "4": 2,  "5": 2,  "6": 2,  "7": 2 },
};

export const UA_SCHEDULE_SOURCE = {
  label: "HACLA Single & Multi-Family Residential Utility Allowance Schedule",
  url: "https://hacla.org/sites/default/files/Section%208/Utility%20Allowances/Utility%20Allowance%20Schedule%202025%20-SFR%20%26%20MFR.pdf",
  indexUrl: "https://www.hacla.org/en/about-section-8/utility-allowances",
  effectiveDate: "2025-12-01",
  retrievedDate: "2026-06-11",
  housingType: "multifamily" as const,
};

/** The tenant-paid utility set the golden (KBI) Victoria packet checks on the
 *  TIRC — Baxter's all-electric configuration. */
export const BAXTER_ALL_ELECTRIC_COMPONENTS: UaComponent[] = [
  "electric_cooking", "basic_electricity", "electric_air_conditioning", "electric_space_heating",
];

export interface UaCalcInput {
  housingType: "multifamily";          // only MFR is transcribed (Baxter)
  bedroomCol: UaBedroomCol;            // schedule column to use
  tenantPaidUtilities: UaComponent[];
  scheduleYear?: "2025-12-01";
}

export interface UaCalcResult {
  total: number;
  breakdown: { component: UaComponent; amount: number }[];
  bedroomCol: UaBedroomCol;
  source: typeof UA_SCHEDULE_SOURCE;
  confidence: "schedule_exact";
  warnings: string[];
  /** Always true — schedule math is advisory until Katherine signs off. */
  pendingKatherineApproval: true;
}

/** Pure schedule lookup. Does NOT write anywhere and is NOT used by the
 *  packet generator. */
export function calculateUtilityAllowance(input: UaCalcInput): UaCalcResult {
  const warnings: string[] = [];
  const breakdown = input.tenantPaidUtilities.map(component => ({
    component,
    amount: HACLA_MFR_2025[component][input.bedroomCol],
  }));
  if (input.tenantPaidUtilities.includes("rso_registration_fee")) {
    warnings.push("RSO fee applies only to pre-Oct-1978 buildings — The Baxter is a modern build; confirm before including.");
  }
  if (input.tenantPaidUtilities.includes("scep_code_enforcement")) {
    warnings.push("SCEP $3/mo applies to 2+ unit rental properties with exceptions — confirm applicability with Katherine.");
  }
  warnings.push("Advisory schedule math — pending Katherine approval; the generator uses manager-entered case values.");
  return {
    total: breakdown.reduce((s, b) => s + b.amount, 0),
    breakdown,
    bedroomCol: input.bedroomCol,
    source: UA_SCHEDULE_SOURCE,
    confidence: "schedule_exact",
    warnings,
    pendingKatherineApproval: true,
  };
}

/** All plausible bedroom treatments for a unit whose TIRC says "Single".
 *  LAHD "Single" is ambiguous (SRO vs studio vs 1BR) — compute all three. */
export function singleUnitScenarios(tenantPaidUtilities: UaComponent[]) {
  return (["SRO", "0", "1"] as UaBedroomCol[]).map(col =>
    calculateUtilityAllowance({ housingType: "multifamily", bedroomCol: col, tenantPaidUtilities }));
}
