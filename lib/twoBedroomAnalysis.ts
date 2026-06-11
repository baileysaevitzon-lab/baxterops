// Sprint 36: Owner-facing 2BR competitive analysis — pure, read-only derivation.
// No new tables, no writes. Derives everything from existing data sources:
//   (1) Supabase competitors.unit_types + competitor_intelligence_summary
//   (2) Bailey field-tour observations (competitor_unit_observations, bed_count=2)
//   (3) Baxter seed (BAXTER_UNITS) for the subject 2BR baseline
// Subjective/model scores are labelled as such; missing data stays undefined (never faked).
import type {
  CompetitorProperty, CompetitorUnitObservation, BaxterUnit, CompetitorIntelligenceSummary,
} from "./types";
import { netEffectiveRent, rentPerSqft } from "./calc";

export type SourceClass = "internal" | "field" | "public";

export interface Baxter2br {
  unitNumber: string;
  sqft: number;
  askingRent: number;
  effectiveRent: number;
  freeMonths: number;
  leaseMonths: number;
  parkingIncluded: boolean;
  daysVacant?: number;
  psfAsking: number;
  psfEffective: number;
}

export interface TwoBrRow {
  id: string;
  name: string;
  avgRent?: number;
  minRent?: number;
  maxRent?: number;
  avgSqft?: number;
  psf?: number;
  /** Field-verified concession-adjusted effective rent (from tour observations), if any. */
  effectiveRent?: number;
  parkingIncluded?: boolean | null;
  inUnitLaundry?: boolean | null;
  /** comp avgRent − Baxter asking (positive = comp costs more). */
  rentDeltaVsBaxter?: number;
  psfDeltaVsBaxter?: number;
  threatLevel?: number;
  productGap?: number;   // 0–5, comp 2BR product vs Baxter (model/subjective)
  amenityGap?: number;   // 0–5
  serviceGap?: number;   // 0–5
  fieldVerified: boolean;
  dataConfidence: string;
  sourceClass: SourceClass;
  lastVerifiedAt?: string;
  dataQualityFlags?: string[];
  observationCount: number;
  beatsBaxter: string[];     // inference from data
  baxterBeats: string[];     // inference from data
  recommendedAction: string; // recommendation
}

const num = (v: unknown): number | undefined =>
  v === null || v === undefined || v === "" ? undefined : Number(v);

/** Derive the Baxter 2BR baseline from the seed units (uses the first tracked 2BR). */
export function deriveBaxter2br(units: BaxterUnit[]): Baxter2br | null {
  const u = units.find(x => x.type === "2BR");
  if (!u) return null;
  const freeMonths = u.freeMonths ?? 0;
  const leaseMonths = u.leaseMonths ?? u.leaseTermMonths ?? 12;
  const eff = u.freeMonths ? netEffectiveRent(u.askingRent, freeMonths, leaseMonths) : u.askingRent;
  return {
    unitNumber: u.unitNumber,
    sqft: u.sqft,
    askingRent: u.askingRent,
    effectiveRent: Math.round(eff),
    freeMonths,
    leaseMonths,
    parkingIncluded: !!u.parkingIncluded,
    daysVacant: u.daysVacant,
    psfAsking: rentPerSqft(u.askingRent, u.sqft),
    psfEffective: rentPerSqft(eff, u.sqft),
  };
}

/** One analysis row per competitor that has a 2BR unit type. */
export function buildTwoBrRows(
  competitors: CompetitorProperty[],
  baxter: Baxter2br,
  observations: CompetitorUnitObservation[],
  summaries: Map<string, CompetitorIntelligenceSummary>,
): TwoBrRow[] {
  const rows: TwoBrRow[] = [];
  for (const c of competitors) {
    const ut = c.unitTypes?.find(t => t.type === "2BR");
    if (!ut) continue;

    const obs2br = observations.filter(o => o.competitorId === c.id && (o.bedCount === 2 || /2br/i.test(o.unitNumber)));
    const effObs = obs2br.map(o => o.effectiveRent13m1Free).filter((x): x is number => typeof x === "number" && x > 0);
    const effectiveRent = effObs.length ? Math.round(effObs.reduce((a, b) => a + b, 0) / effObs.length) : undefined;
    const parkingObs = obs2br.find(o => typeof o.parkingIncluded === "boolean");
    const laundryObs = obs2br.find(o => typeof o.inUnitLaundry === "boolean");

    const avgRent = num(ut.avgRent);
    const avgSqft = num(ut.avgSqft);
    const psf = avgRent && avgSqft ? avgRent / avgSqft : undefined;
    const summary = summaries.get(c.id);

    const sourceClass: SourceClass = c.fieldVerified ? "field" : "public";
    const fieldVerified = !!c.fieldVerified;

    // ---- inference (clearly labelled in UI) ----
    const beatsBaxter: string[] = [];
    const baxterBeats: string[] = [];
    if (avgRent && avgRent < baxter.askingRent) beatsBaxter.push(`Cheaper 2BR ($${avgRent.toLocaleString()} vs Baxter $${baxter.askingRent.toLocaleString()})`);
    if (avgSqft && avgSqft - baxter.sqft > 100) beatsBaxter.push(`Larger 2BR (~${Math.round(avgSqft)} sqft vs ${baxter.sqft})`);
    if ((summary?.amenityGapScore ?? 0) >= 3) beatsBaxter.push("Stronger amenity package (model-scored)");
    if ((summary?.unitQualityGap ?? 0) >= 3) beatsBaxter.push("Higher-rated unit finishes/layout (model-scored)");
    if (parkingObs?.parkingIncluded) beatsBaxter.push("Parking included");
    if ((c.freeRentWeeks ?? 0) > 0 || effectiveRent) beatsBaxter.push("Advertises concessions");

    if (avgRent && avgRent > baxter.askingRent) baxterBeats.push(`Baxter is $${(avgRent - baxter.askingRent).toLocaleString()}/mo cheaper`);
    if (avgSqft && baxter.sqft - avgSqft > 50) baxterBeats.push(`Baxter 2BR is larger (${baxter.sqft} vs ~${Math.round(avgSqft)} sqft)`);
    if (psf && baxter.psfAsking < psf) baxterBeats.push(`Lower $/sqft ($${baxter.psfAsking.toFixed(2)} vs $${psf.toFixed(2)})`);
    baxterBeats.push("Private patio + side yard + den (ground-floor 105)"); // Baxter 2BR differentiators (seed-verified)

    // ---- recommendation ----
    let recommendedAction = "Hold; monitor.";
    if (avgRent && baxter.askingRent < avgRent * 0.85) {
      recommendedAction = `Baxter 2BR is >15% below this comp — test a rent increase toward market, OR if velocity is the problem, fix listing/photos/tour rather than cut further.`;
    } else if (avgRent && Math.abs(avgRent - baxter.askingRent) <= 300) {
      recommendedAction = "Direct price-band rival — match concession structure and win on patio/den + service.";
    }

    rows.push({
      id: c.id, name: c.name,
      avgRent, minRent: num(ut.minRent), maxRent: num(ut.maxRent), avgSqft,
      psf, effectiveRent,
      parkingIncluded: parkingObs ? parkingObs.parkingIncluded ?? null : (c.parkingIncluded ?? null),
      inUnitLaundry: laundryObs ? laundryObs.inUnitLaundry ?? null : null,
      rentDeltaVsBaxter: avgRent ? avgRent - baxter.askingRent : undefined,
      psfDeltaVsBaxter: psf ? psf - baxter.psfAsking : undefined,
      threatLevel: c.threatLevel,
      productGap: summary?.unitQualityGap,
      amenityGap: summary?.amenityGapScore,
      serviceGap: summary?.serviceGapScore,
      fieldVerified, dataConfidence: c.dataConfidence ?? "unknown", sourceClass,
      lastVerifiedAt: c.fieldVerifiedAt ?? c.lastVerifiedAt,
      dataQualityFlags: c.dataQualityFlags,
      observationCount: obs2br.length,
      beatsBaxter, baxterBeats, recommendedAction,
    });
  }
  // Sort: direct price-band threats first (smallest |rent delta|), then by threat level.
  return rows.sort((a, b) => {
    const da = a.rentDeltaVsBaxter === undefined ? 1e9 : Math.abs(a.rentDeltaVsBaxter);
    const db = b.rentDeltaVsBaxter === undefined ? 1e9 : Math.abs(b.rentDeltaVsBaxter);
    return da - db || (b.threatLevel ?? 0) - (a.threatLevel ?? 0);
  });
}

// ───────────────────────── Calculators (Part 5) ─────────────────────────

/** Concession-adjusted effective rent. */
export function effectiveRent(rent: number, freeMonths: number, leaseMonths: number): number {
  return Math.round(netEffectiveRent(rent, freeMonths, leaseMonths));
}

/** Vacancy cost so far = daily rent × days empty. */
export function vacancyCost(monthlyRent: number, daysVacant: number): number {
  return Math.round((monthlyRent / 30) * daysVacant);
}

/**
 * Rent-reduction breakeven: if you cut rent by ΔR on an L-month lease, you forgo ΔR×L.
 * To be worth it you must fill the unit at least this many days sooner (vacancy saved).
 */
export function rentCutBreakevenDays(currentRent: number, rentCut: number, leaseMonths: number): number {
  if (currentRent <= 0 || rentCut <= 0) return 0;
  const dailyRent = currentRent / 30;
  return Math.round((rentCut * leaseMonths) / dailyRent);
}

/** Annualized revenue delta from a rent change (one lease term). */
export function leaseTermRevenueDelta(rentChange: number, leaseMonths: number): number {
  return Math.round(rentChange * leaseMonths);
}

export interface ExecSummary {
  baxterWinningOnPrice: boolean;
  velocityProblem: boolean;
  cheapestCompRent?: number;
  medianCompRent?: number;
  baxterVsMedianPct?: number;
  directThreats: { name: string; rent?: number; delta?: number; fieldVerified: boolean }[];
  conversionKillers: string[];
  topActions: string[];
  missingData: string[];
}

export function buildExecSummary(baxter: Baxter2br, rows: TwoBrRow[]): ExecSummary {
  const rents = rows.map(r => r.avgRent).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  const median = rents.length ? rents[Math.floor(rents.length / 2)] : undefined;
  const cheapest = rents[0];
  const baxterVsMedianPct = median ? Math.round(((baxter.askingRent - median) / median) * 100) : undefined;
  const velocityProblem = (baxter.daysVacant ?? 0) >= 14 && !!median && baxter.askingRent < median;

  const directThreats = rows
    .filter(r => r.rentDeltaVsBaxter !== undefined && Math.abs(r.rentDeltaVsBaxter) <= 1300)
    .slice(0, 5)
    .map(r => ({ name: r.name, rent: r.avgRent, delta: r.rentDeltaVsBaxter, fieldVerified: r.fieldVerified }));

  const conversionKillers: string[] = [];
  if (velocityProblem) conversionKillers.push(`2BR is ~${Math.abs(baxterVsMedianPct ?? 0)}% below the comp median yet vacant ${baxter.daysVacant} days — pricing is NOT the blocker; suspect listing photos, tour experience, or unit condition.`);
  if (!baxter.parkingIncluded) conversionKillers.push("No parking included — confirm whether comps in the price band bundle parking (Zen does).");
  conversionKillers.push("Listing may under-show the patio / side-yard / den, which are Baxter's strongest 2BR differentiators.");

  const topActions = [
    velocityProblem
      ? "Diagnose the conversion gap on unit 105 (photos, listing copy, tour script) before any further price cut — it's already well below market."
      : "Test a rent increase toward the comp median to capture revenue.",
    "Re-shoot 2BR listing photos emphasizing patio, side yard, den, and natural light.",
    "Match the prevailing concession (≈1 month free) cleanly in the listing's effective-rent framing.",
    "Pull field-verified data on the missing/stale price-band comps (Hanover, Jefferson Highland, El Centro).",
    "Define a same-day tour follow-up cadence — service is a common conversion killer at this price point.",
  ];

  const missingData = rows.filter(r => !r.fieldVerified).map(r => r.name);

  return {
    baxterWinningOnPrice: !!median && baxter.askingRent < median,
    velocityProblem,
    cheapestCompRent: cheapest,
    medianCompRent: median,
    baxterVsMedianPct,
    directThreats,
    conversionKillers,
    topActions,
    missingData,
  };
}
