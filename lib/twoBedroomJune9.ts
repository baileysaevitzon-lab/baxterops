// Sprint 37: June 9, 2026 2BR owner analysis — research-note layer.
//
// Numeric facts (asking rent / sqft / parking) are read LIVE from Supabase
// competitor_unit_observations staged on 2026-06-09 (needs_verification=true).
// This module supplies what the DB rows can't: the concession-in-weeks from the
// research note, per-competitor strategic analysis, and owner recommendations.
// Everything here is labeled June-9 research note / recommendation — NOT
// field-verified fact. Field-verified rows in Supabase are never overwritten.

export const JUNE9 = "2026-06-09";

/** Baxter's TWO 2BR products. Key reframe: do not blend them. */
export interface BaxterTwoBrProduct {
  key: "market" | "restricted";
  label: string;
  plan: string;
  askingRent: number;
  sqft: number;
  freeWeeks: number;        // current concession, in weeks
  parking: string;
  badges: string[];
  source: string;
  strategyLever: string[];
  notes: string;
}

export const BAXTER_MARKET_2BR: BaxterTwoBrProduct = {
  key: "market",
  label: "Baxter Market-Rate 2BR",
  plan: "2x2 A",
  askingRent: 4350,
  sqft: 1122,
  freeWeeks: 4, // ~1 month free — needs internal confirmation
  parking: "Controlled-access garage (cost unconfirmed)",
  badges: ["Market-rate", "Needs internal verification"],
  source: "thebaxterhollywood.com (official, June 9 2026) — 'Starting at $4,350', up to 1,249 sqft",
  strategyLever: [
    "Concession / effective rent (rivals give 4–8 weeks, we give ~4)",
    "Positioning: full amenity stack + larger than Modera/Hanover entry plans",
    "Parking & fee clarity (several rivals bundle parking)",
    "Listing/photo quality",
  ],
  notes: "Sits at the TOP of the live price band on effective rent because our concession is weaker than rivals'.",
};

export const BAXTER_RESTRICTED_2BR: BaxterTwoBrProduct = {
  key: "restricted",
  label: "Baxter Unit 105",
  plan: "Unit 105",
  askingRent: 2499,
  sqft: 1050,
  freeWeeks: 4.345, // 1 month free on 13-mo lease (internal)
  parking: "Paid garage (not bundled)",
  badges: ["Restricted / income-qualified (likely)", "Needs internal verification"],
  source: "BaxterOps internal. Tell: $2,499 is BELOW Baxter's own market-rate 1BR ($2,599–$2,999) → likely income-restricted.",
  strategyLever: [
    "Eligible-applicant pipeline (income-qualified marketing channels)",
    "LAHD paperwork speed / compliance readiness",
    "NOT a rent-cut problem — price is already capped",
  ],
  notes: "Patio + side yard + den, ground-floor private entry. Must NOT be compared head-to-head with luxury market-rate comps.",
};

/** Per-competitor analysis for the June-9 staged observations (keyed by competitor_id).
 *  freeWeeks reflects the June 9 research note (the staged rows only carry whole free_months). */
export interface June9CompAnalysis {
  competitorId: string;
  displayName: string;
  freeWeeks: number;
  freeWeeksLabel: string;
  rentRange: string;       // verbatim range from research note
  parkingLabel: string;
  advantage: string;       // main advantage over Baxter
  weakness: string;        // main weakness
  whyTheyWin: string;
  howToCounter: string;
  ownerAction: string;
  threat: 1 | 2 | 3 | 4 | 5;
  confidence: "high" | "medium" | "low";
}

export const JUNE9_COMP_ANALYSIS: June9CompAnalysis[] = [
  {
    competitorId: "c-jefferson-highland",
    displayName: "Jefferson / 1724 Highland",
    freeWeeks: 6, freeWeeksLabel: "~6 wks free (one source says up to 2 mo — conflicting)",
    rentRange: "$2,795–$3,898",
    parkingLabel: "2 assigned garage spots incl.",
    advantage: "Cheapest market-rate rival + 2 bundled parking spots",
    weakness: "Rebrand confusion; older building than Hanover/Modera",
    whyTheyWin: "A value shopper sees a lower sticker, a 6-week special, and TWO included parking spaces.",
    howToCounter: "Sell Baxter's bigger 2x2 (1,122 sqft), full amenity stack, and match the concession so effective rents converge.",
    ownerAction: "Call/tour to confirm the rebrand + real concession before any pricing move.",
    threat: 5, confidence: "medium",
  },
  {
    competitorId: "c-el-centro",
    displayName: "El Centro",
    freeWeeks: 8, freeWeeksLabel: "Up to 2 MONTHS free (move-in by 6/30)",
    rentRange: "$3,099–$3,850",
    parkingLabel: "Resident garage (bundled vs fee unstated)",
    advantage: "Most aggressive concession in the set",
    weakness: "Smaller 2BRs (1,058–1,097 sqft); huge 535-unit complex, less personal",
    whyTheyWin: "Two months free crushes everyone's effective rent (~$2,583 on the entry plan).",
    howToCounter: "We can't ignore this while it runs — match with a stronger concession through June or sell against mega-complex anonymity.",
    ownerAction: "Verify the 2-months-free deadline (6/30) — if real, expect it to distort the whole band this month.",
    threat: 4, confidence: "medium",
  },
  {
    competitorId: "c-highland",
    displayName: "The Highland",
    freeWeeks: 8, freeWeeksLabel: "Up to 8 wks free + $1–2k look-&-lease",
    rentRange: "$3,521 (998 sqft) / $4,149 (1,287 sqft)",
    parkingLabel: "NOT included (per ApartmentList; conflicting snippet)",
    advantage: "XL plan is the biggest 2BR in the band; deep concession",
    weakness: "Small 2BR is tiny (998 sqft); parking not bundled",
    whyTheyWin: "8 weeks free + look-and-lease cash makes even the XL plan's effective rent (~$3,513) undercut our market 2x2.",
    howToCounter: "Against the small plan, Baxter is 124 sqft bigger — lead with space + outdoor area. Against the XL, lead with price.",
    ownerAction: "Note the NEW small 998-sqft plan (missing from our DB until now) when quoting 'Highland 2BR' prices.",
    threat: 4, confidence: "medium",
  },
  {
    competitorId: "c-hanover-hollywood",
    displayName: "Hanover Hollywood",
    freeWeeks: 1, freeWeeksLabel: "~1 wk free only (move-in by 6/14) — concession DRIED UP",
    rentRange: "$2,998 (Plan P) – $3,790",
    parkingLabel: "Garage listed as included (cost unconfirmed)",
    advantage: "New build + brand; entry Plan P undercuts on sticker ($2,998)",
    weakness: "Concession collapsed → effective rent rose sharply vs 2 weeks ago",
    whyTheyWin: "Brand-new product and a sub-$3k entry 2BR sticker pulls in price-anchored shoppers.",
    howToCounter: "Their effective rent just jumped. A Baxter concession move NOW lands while Hanover looks expensive.",
    ownerAction: "Re-verify Hanover's offer this week — our June field tour said 6 wks free; live listing says 1 wk. Conflict logged.",
    threat: 5, confidence: "medium",
  },
  {
    competitorId: "c-modera-hollywood",
    displayName: "Modera Hollywood",
    freeWeeks: 4, freeWeeksLabel: "~4 wks free (lease by 6/30) + $1,000 24-hr look-&-lease",
    rentRange: "$3,758–$4,416",
    parkingLabel: "Included (controlled-access garage)",
    advantage: "2019 build, strong amenities, bundled parking",
    weakness: "Live 2BRs are SMALL (843–1,023 sqft — conflicts with our older 1,204 avg)",
    whyTheyWin: "Polished new building with parking included at a similar sticker to our 2x2.",
    howToCounter: "Our 2x2 is ~100–280 sqft bigger than their live plans. Sell space per dollar.",
    ownerAction: "Resolve the sqft conflict (843–1,023 live vs 1,204 in DB) before quoting Modera sizes.",
    threat: 5, confidence: "high",
  },
  {
    competitorId: "c-avenue-hollywood",
    displayName: "Avenue / Aven Hollywood",
    freeWeeks: 0, freeWeeksLabel: "No concession listed",
    rentRange: "$3,757–$4,367",
    parkingLabel: "Included + EV chargers (cost unstated)",
    advantage: "Biggest units (1,228–1,240 sqft) + bundled parking",
    weakness: "Zero concession — highest effective rent in the band",
    whyTheyWin: "Pure product play: large units, parking, EV. Wins renters who don't negotiate.",
    howToCounter: "Any Baxter concession beats their effective rent immediately; our 2x2 is only ~110 sqft smaller.",
    ownerAction: "Low urgency — monitor; they're priced above us on effective rent.",
    threat: 3, confidence: "medium",
  },
];

/** Effective rent per the spec formula (weeks-based).
 *  eff = ask × ((L×4.345 − freeWeeks) / (L×4.345)); estimates only. */
export function effectiveRentWeeks(askingRent: number, freeWeeks: number, leaseMonths = 12): number {
  const weeks = leaseMonths * 4.345;
  if (askingRent <= 0 || weeks <= 0) return 0;
  return Math.round(askingRent * (Math.max(weeks - freeWeeks, 0) / weeks));
}

/** Concession value over the lease (rough). */
export function concessionValue(askingRent: number, freeWeeks: number): number {
  return Math.round((askingRent / 4.345) * freeWeeks);
}

// ───────────────────────── Owner action plan (recommendations) ─────────────────────────
export interface OwnerAction {
  action: string; problem: string; impact: "High" | "Medium" | "Low";
  cost: string; urgency: "Now" | "Soon" | "Later"; confidence: string; decision: string;
}
export const OWNER_ACTION_PLAN: OwnerAction[] = [
  { action: "Confirm which 2BR is vacant + whether Unit 105 is income-restricted", problem: "Everything downstream (price vs pipeline) depends on this", impact: "High", cost: "$0", urgency: "Now", confidence: "High need", decision: "Internal confirmation" },
  { action: "Test a stronger concession (6–8 wks) on the market 2x2 — NOT a headline rent cut", problem: "Rivals give 4–8 wks / 2 mo free; our ~1 mo leaves us top-of-band on effective rent", impact: "High", cost: "$ (concession)", urgency: "Now", confidence: "Medium (live listings)", decision: "Approve concession test" },
  { action: "Call/tour-verify the June 9 specials (Hanover, Jefferson, El Centro)", problem: "All June 9 figures are staged as needs-verification — pricing moves need confirmation", impact: "High", cost: "$ (staff time)", urgency: "Now", confidence: "High need", decision: "Assign call-around" },
  { action: "Re-shoot 2BR photos + listing copy (patio / side yard / den / size)", problem: "Our differentiators are likely under-shown vs new-build marketing", impact: "High", cost: "$ (photographer)", urgency: "Soon", confidence: "Medium (inference)", decision: "Approve photographer" },
  { action: "Market the full amenity stack (roof deck, gym, EV, garage, in-unit W/D)", problem: "'Amenity-light' is a misconception — official list matches the new builds", impact: "Medium", cost: "$0", urgency: "Soon", confidence: "Medium (official site)", decision: "Copy refresh" },
  { action: "Clarify parking cost/bundling in listing", problem: "Jefferson bundles 2 spots; Modera/Avenue include parking — ours reads 'not included'", impact: "Medium", cost: "$0–$$", urgency: "Soon", confidence: "Medium", decision: "Pricing decision on parking" },
  { action: "Separate Unit 105 marketing pipeline (income-qualified channels)", problem: "Restricted unit needs eligible applicants, not price cuts", impact: "Medium", cost: "$ (staff time)", urgency: "Soon", confidence: "High (if restriction confirmed)", decision: "Approve channel plan" },
  { action: "Stand up a weekly competitor concession call-around", problem: "Hanover's offer collapsed within ~1 week — specials move too fast for monthly checks", impact: "Medium", cost: "$ (30 min/wk)", urgency: "Soon", confidence: "High", decision: "Assign owner + cadence" },
];

// ───────────────────────── Marketing / conversion ideas ─────────────────────────
export const MARKETING_IDEAS: { title: string; items: string[] }[] = [
  { title: "Listing copy bullets", items: [
    "\"1,122 sq ft — larger than most Hollywood 2BRs at this price\" (vs Modera 843–1,023, Hanover entry 1,035)",
    "Lead with rooftop sun deck + fireplace, gym, EV charging, controlled-access garage, in-unit full-size W/D",
    "Frame the special in effective-rent terms: \"Effectively $X/mo with N weeks free\"",
    "Unit 105 (if marketed): \"private patio + side yard + den — rare private outdoor space\"",
  ]},
  { title: "2BR photo shot list", items: [
    "Patio + side yard at golden hour (Unit 105's #1 differentiator)",
    "Den staged as office AND nursery (two photos — two renter stories)",
    "Floor-to-ceiling windows with light meter-friendly midday shot",
    "Rooftop deck with Hollywood-sign sightline; gym; garage entry + EV chargers",
    "Kitchen soft-close + Samsung appliance close-ups; deep soaking tub",
  ]},
  { title: "Leasing script / objection handling", items: [
    "\"It's cheaper than I expected — what's wrong with it?\" → explain the two-product setup honestly; value ≠ defect",
    "\"X gives 8 weeks free\" → compute effective rent on the spot with the calculator; show size + amenities per dollar",
    "\"Does parking cost extra?\" → have the exact garage price ready (gap today)",
    "Restricted-unit inquiries → pre-qualify income early; have the LAHD doc checklist ready to send same-day",
  ]},
  { title: "Follow-up cadence", items: [
    "Same-day (≤4 hr) reply to every 2BR inquiry; same-day tour recap text with the effective-rent math",
    "Day-2 follow-up with photo set tailored to what the prospect reacted to",
    "Day-5 'special expiring' nudge tied to a real concession deadline",
  ]},
  { title: "Weekly market check (30 min)", items: [
    "Call/secret-shop: Hanover, Jefferson/1724, El Centro, Modera — record concession + parking in BaxterOps",
    "Log each as a competitor_unit_observation (source: call-around) — never overwrite field-verified rows",
    "Flag any special that moves >2 weeks of free rent — it changes the band",
  ]},
];

// ───────────────────────── Meeting notes (June 9 research) ─────────────────────────
export const MEETING_NOTES_SUMMARY = {
  title: "June 9, 2026 — 2BR Competitive Research (meeting notes)",
  file: "~/Desktop/Baxter-2BR-vs-Competitors-Meeting-Notes.md",
  keyFindings: [
    "Baxter has TWO 2BR products — market-rate 2x2 A (~$4,350 / 1,122 sqft) and restricted Unit 105 ($2,499 / 1,050 sqft). The old '40% below market' line blended them — retired.",
    "'Amenity-light' is FALSE — official amenity list matches the new luxury builds.",
    "The market is in a concession war: 4–8 weeks (El Centro: 2 months) free. Baxter's ~1 month is the weakest in the band.",
    "Live asking band ~$3,400–$4,400; the old 'comp median ~$4,100' is stale — dropped.",
    "Baxter's 2BRs are LARGER than Modera's live plans (843–1,023 sqft) and Hanover's entry plan.",
    "Hanover's concession collapsed (6 wks → ~1 wk) within a week — specials move fast; weekly checks needed.",
  ],
  warning: "All June 9 effective rents are ESTIMATES from advertised specials. Call/tour-verify before final pricing changes.",
};
