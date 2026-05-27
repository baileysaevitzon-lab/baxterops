// Pure-function calculators used by the dashboard, matching engine, and pricing model.

import type {
  BaxterUnit,
  CompMatch,
  CompetitorProperty,
  CompetitorUnitType,
  MatchingWeights,
  RegressionEstimate,
  UnitType,
} from "./types";

export const fmtMoney = (n: number | undefined): string =>
  n === undefined || Number.isNaN(n) ? "—" : `$${Math.round(n).toLocaleString()}`;

export const fmtPct = (n: number | undefined, digits = 0): string =>
  n === undefined || Number.isNaN(n) ? "—" : `${n.toFixed(digits)}%`;

export const fmtNum = (n: number | undefined, digits = 0): string =>
  n === undefined || Number.isNaN(n) ? "—" : n.toFixed(digits);

export function netEffectiveRent(monthlyRent: number, freeMonths: number, leaseMonths = 12): number {
  if (!monthlyRent || !leaseMonths) return 0;
  return ((monthlyRent * leaseMonths) - monthlyRent * (freeMonths || 0)) / leaseMonths;
}

export function rentPerSqft(rent: number | undefined, sqft: number | undefined): number {
  if (!rent || !sqft) return 0;
  return rent / sqft;
}

export function vacancyLoss(units: BaxterUnit[]): number {
  return units.filter(u => u.occupancy === "vacant").reduce((sum, u) => sum + u.askingRent, 0);
}

// --- aggregate competitor stats by unit type ---
export function compAverageRent(comps: CompetitorProperty[], type: UnitType): number {
  const rents = comps
    .map(c => c.unitTypes.find(t => t.type === type)?.avgRent)
    .filter((r): r is number => typeof r === "number" && r > 0);
  if (rents.length === 0) return 0;
  return rents.reduce((a, b) => a + b, 0) / rents.length;
}

export function compAverageSqft(comps: CompetitorProperty[], type: UnitType): number {
  const sqfts = comps
    .map(c => c.unitTypes.find(t => t.type === type)?.avgSqft)
    .filter((s): s is number => typeof s === "number" && s > 0);
  if (sqfts.length === 0) return 0;
  return sqfts.reduce((a, b) => a + b, 0) / sqfts.length;
}

export function compAverageOccupancy(comps: CompetitorProperty[]): number {
  const vals = comps.map(c => c.occupancyPct).filter((v): v is number => typeof v === "number");
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function compAverageLeased(comps: CompetitorProperty[]): number {
  const vals = comps.map(c => c.leasedPct).filter((v): v is number => typeof v === "number");
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// --- weighted-distance similarity score ---
export function similarityScore(
  unit: BaxterUnit,
  comp: CompetitorProperty,
  compUnit: CompetitorUnitType,
  weights: MatchingWeights,
): number {
  const bedScore = unit.bedrooms === bedroomsForType(compUnit.type) ? 1 : 0;
  const sqftScore =
    compUnit.avgSqft ? Math.max(0, 1 - Math.abs(unit.sqft - compUnit.avgSqft) / Math.max(unit.sqft, compUnit.avgSqft)) : 0;
  const distScore = comp.distanceMiles !== undefined ? Math.max(0, 1 - comp.distanceMiles / 2) : 0.5;
  const amenScore = Math.min(1, comp.amenities.length / 6);
  const classScore = comp.buildingClass === "A" ? 1 : comp.buildingClass === "B" ? 0.7 : 0.5;
  const concScore = comp.freeRentWeeks ? Math.min(1, comp.freeRentWeeks / 8) : 0.3;
  const qualScore = (comp.compQualityScore ?? 50) / 100;

  const score =
    weights.bedrooms * bedScore +
    weights.sqft * sqftScore +
    weights.distance * distScore +
    weights.amenities * amenScore +
    weights.buildingClass * classScore +
    weights.concessions * concScore +
    weights.qualitative * qualScore;
  return Math.round(score * 100);
}

export function bedroomsForType(type: UnitType): number {
  switch (type) {
    case "studio":
      return 0;
    case "1BR":
      return 1;
    case "2BR":
      return 2;
    case "3BR":
      return 3;
  }
}

export function unitTypeForBedrooms(b: number): UnitType {
  if (b === 0) return "studio";
  if (b === 1) return "1BR";
  if (b === 2) return "2BR";
  return "3BR";
}

// --- closest comps for a Baxter unit ---
export function closestComps(
  unit: BaxterUnit,
  comps: CompetitorProperty[],
  weights: MatchingWeights,
  topN = 5,
): CompMatch[] {
  const targetType = unitTypeForBedrooms(unit.bedrooms);
  const matches: CompMatch[] = [];

  for (const comp of comps) {
    const ct = comp.unitTypes.find(t => t.type === targetType);
    if (!ct || !ct.avgRent) continue;
    const sim = similarityScore(unit, comp, ct, weights);
    const rentGap = unit.askingRent - ct.avgRent;
    const drivers: string[] = [];
    if (Math.abs(unit.sqft - (ct.avgSqft ?? unit.sqft)) > 100) {
      drivers.push(
        `Sq ft delta: Baxter ${unit.sqft} vs comp ${ct.avgSqft}`,
      );
    }
    if (comp.freeRentWeeks && comp.freeRentWeeks >= 6) {
      drivers.push(`Comp offers ${comp.freeRentWeeks} weeks free — stronger concession`);
    }
    if (comp.lookAndLeaseBonus) {
      drivers.push(`Look-and-lease bonus $${comp.lookAndLeaseBonus}`);
    }
    if (unit.covariates.bedroomWindow === false) {
      drivers.push(`Baxter unit has no bedroom window — apply −$100 to −$200 adjustment`);
    }
    matches.push({
      baxterUnitId: unit.id,
      competitorId: comp.id,
      competitorUnitType: targetType,
      similarity: sim,
      rentGap,
      percentRentGap: ct.avgRent ? rentGap / ct.avgRent : 0,
      driverNotes: drivers,
    });
  }
  return matches.sort((a, b) => b.similarity - a.similarity).slice(0, topN);
}

// --- explainable pseudo-regression rent estimate ---
export function estimateRent(unit: BaxterUnit, comps: CompetitorProperty[], weights: MatchingWeights): RegressionEstimate {
  const top = closestComps(unit, comps, weights, 5);
  const compAvg = top.length
    ? top.reduce((s, m) => {
        const ct = comps.find(c => c.id === m.competitorId)?.unitTypes.find(t => t.type === m.competitorUnitType);
        return s + (ct?.avgRent ?? 0);
      }, 0) / top.length
    : 0;

  // covariate adjustments
  let adj = 0;
  const drivers: { feature: string; contribution: number }[] = [];

  if (unit.covariates.bedroomWindow === false) {
    adj -= 150;
    drivers.push({ feature: "No bedroom window", contribution: -150 });
  }
  if (unit.covariates.walkInCloset && unit.covariates.walkInCloset >= 4) {
    adj += 50;
    drivers.push({ feature: "Premium walk-in closet", contribution: +50 });
  }
  if (unit.covariates.patio) {
    adj += 40;
    drivers.push({ feature: "Patio/balcony", contribution: +40 });
  }
  if (unit.covariates.den) {
    adj += 60;
    drivers.push({ feature: "Den", contribution: +60 });
  }
  if (unit.covariates.cornerUnit) {
    adj += 30;
    drivers.push({ feature: "Corner unit", contribution: +30 });
  }
  if (unit.covariates.naturalLight && unit.covariates.naturalLight >= 4) {
    adj += 25;
    drivers.push({ feature: "Strong natural light", contribution: +25 });
  }
  if (unit.covariates.naturalLight && unit.covariates.naturalLight <= 2) {
    adj -= 40;
    drivers.push({ feature: "Weak natural light", contribution: -40 });
  }
  // floor premium
  if (unit.floor >= 3) {
    adj += 30;
    drivers.push({ feature: "Higher floor", contribution: +30 });
  }

  const predictedRent = compAvg + adj;
  const predictedNet = predictedRent * 0.95; // assume 1-month concession on 12mo lease ≈ ~8% off, conservative
  const difference = unit.askingRent - predictedRent;
  const flag: "overpriced" | "fair" | "underpriced" =
    difference > 100 ? "overpriced" : difference < -100 ? "underpriced" : "fair";

  // Confidence varies with: matched-comp similarity, covariate completeness, days-of-data
  const avgSim = top.length ? top.reduce((s, m) => s + m.similarity, 0) / top.length : 0;
  const filledCovariates = Object.values(unit.covariates).filter(v => v !== undefined && v !== null).length;
  const totalCovariates = 14; // matches the optional fields in UnitCovariates
  const covariateCompleteness = filledCovariates / totalCovariates;
  const dataAge = unit.daysVacant && unit.daysVacant > 60 ? -10 : 0;
  const confidence = Math.max(35, Math.min(95, Math.round(40 + avgSim / 2 + covariateCompleteness * 20 + dataAge)));

  let suggestedAction = "";
  if (flag === "overpriced" && unit.daysVacant && unit.daysVacant > 21) {
    suggestedAction = `Cut by ~$${Math.round(difference)} or add 2-week concession.`;
  } else if (flag === "underpriced" && unit.covariates.walkInCloset && unit.covariates.walkInCloset >= 4) {
    suggestedAction = "Use as premium upsell. Do not over-discount.";
  } else if (flag === "fair" && unit.daysVacant && unit.daysVacant > 30) {
    suggestedAction = "Pricing fair — fix the traffic problem (channels, photos, walkthroughs).";
  } else {
    suggestedAction = "Hold pricing. Reassess in 7 days.";
  }

  return {
    baxterUnitId: unit.id,
    predictedRent,
    predictedNetEffective: predictedNet,
    askingRent: unit.askingRent,
    difference,
    flag,
    confidence,
    topDrivers: drivers,
    suggestedAction,
  };
}

// --- helpers for tenant burden ---
export function tenantBurden(tenantRent: number, utilityAllowance: number): number {
  return (tenantRent || 0) + (utilityAllowance || 0);
}

export function isOverLahdCap(tenantRent: number, utilityAllowance: number, cap: number): boolean {
  return tenantBurden(tenantRent, utilityAllowance) > cap;
}
