// Zen Hollywood Field Tour — 2026-05-26
// Real Bailey field-tour data + verified public listing URLs.
//
// This module is the canonical source for Zen field-tour evidence. It gets
// idempotently seeded into the persistence layer on first app load by
// components/ZenSeedBootstrap. Once Supabase is provisioned, the same data
// can be replayed against a real DB without code changes.
//
// NOTE: All five Zen unit observations are seeded with deterministic IDs so
// re-running the seed does not duplicate rows.

import { calculateNetEffectiveRent } from "./services/calc";
import { bulkUpsertObservedUnits } from "./services/competitorUnits";
import { bulkUpsertAmenityObservations } from "./services/amenityObservations";
import { bulkUpsertPhotoEvidence } from "./services/photoEvidence";
import { bulkUpsertSourceVerifications } from "./services/sourceVerification";
import { saveFieldTour } from "./services/fieldTours";
import { createDataQualityFlag } from "./services/dataQuality";
import type {
  CompetitorAmenityObservation,
  CompetitorFieldTour,
  CompetitorSourceVerification,
  CompetitorUnitObservation,
  DataQualityFlag,
  PhotoEvidenceRecord,
} from "./types";

export const ZEN_COMPETITOR_ID = "c-zen-hollywood";
export const ZEN_COMPETITOR_NAME = "Zen Hollywood";
export const ZEN_FIELD_TOUR_ID = "ft-zen-2026-05-26";
export const ZEN_COLLECTION_ID = "zen-field-tour-2026-05-26";
export const ZEN_COLLECTION_NAME = "Zen Hollywood Field Tour — 2026-05-26";
const SOURCE_LABEL = "Bailey Field Tour — 2026-05-26";
const SEED_DATE = "2026-05-26";
const NOW = "2026-05-26T00:00:00.000Z";

// ---------- field tour ----------
function compositeScore(t: Partial<CompetitorFieldTour>): number {
  const parts = [
    t.tourBookingEase, t.kindness, t.professionalism, t.cleanliness,
    t.tourQuality, t.amenityQuality, t.desperationVsConfidence, t.closingStrength,
  ].filter((x): x is number => typeof x === "number");
  if (!parts.length) return 0;
  return Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 10) / 10;
}

const fieldTourBase: Omit<CompetitorFieldTour, "compositeExperienceScore"> = {
  id: ZEN_FIELD_TOUR_ID,
  competitorId: ZEN_COMPETITOR_ID,
  competitorName: ZEN_COMPETITOR_NAME,
  tourDate: SEED_DATE,
  collectedBy: "Bailey",
  assignedTo: "Bailey",
  tourStatus: "completed",
  sourceLabel: SOURCE_LABEL,
  tourBookingEase: 4,
  kindness: 4,
  professionalism: 4,
  cleanliness: 5,
  tourQuality: 5,
  amenityQuality: 5,
  drinksOrSnacksOffered: false,
  pressureLevel: "medium",
  desperationVsConfidence: 4,
  closingStrength: 4,
  actualConcessions:
    "1 month free standard. 19-month option may include 2 months free with good credit / approved credit / select units.",
  hiddenDiscounts: "$1,000 look-and-lease credit if applying within 72 hours.",
  parkingDeal: "Parking included; valet included; 1 spot per bedroom. 2-bedroom units receive 2 parking spots.",
  moveInCost: "Needs verification.",
  feesWaivable: null,
  followUpPromised: null,
  followUpReceived: null,
  wouldRenterChooseOverBaxter: true,
  whyOrWhyNot:
    "Zen has a materially stronger amenity package than Baxter: pool, gym, bar/lounge, event room, theater/game room, business/business-center area, outdoor communal areas, BBQ/grill, included parking and valet, water included, in-unit laundry, polished hallways/floors, and strong common spaces. Rent is higher, but the perceived value is strong.",
  baxterResponseRecommendation:
    "Baxter should not compete with Zen by pretending the amenity package is equivalent. Baxter should compete through sharper net-effective pricing, stronger concessions, better listing photos, clearer value messaging, faster lead follow-up, and unit-specific strengths. Zen should be treated as a premium amenity threat and as a benchmark for what renters see at the high end nearby.",
  fieldConfidence: "high",
  createdAt: NOW,
  updatedAt: NOW,
};

export const ZEN_FIELD_TOUR: CompetitorFieldTour = {
  ...fieldTourBase,
  compositeExperienceScore: compositeScore(fieldTourBase),
};

// ---------- unit observations ----------
function nerSet(gross: number) {
  return {
    effectiveRent13m1Free: calculateNetEffectiveRent(gross, 13, 1, 0),
    effectiveRent19m2Free: calculateNetEffectiveRent(gross, 19, 2, 0),
    effectiveRent13m1FreeLookAndLease: calculateNetEffectiveRent(gross, 13, 1, 1000),
    effectiveRent19m2FreeLookAndLease: calculateNetEffectiveRent(gross, 19, 2, 1000),
  };
}

export const ZEN_OBSERVED_UNITS: CompetitorUnitObservation[] = [
  {
    id: "obs-zen-522",
    competitorId: ZEN_COMPETITOR_ID,
    competitorName: ZEN_COMPETITOR_NAME,
    fieldTourId: ZEN_FIELD_TOUR_ID,
    unitNumber: "522",
    unitNumberConfidence: "high",
    floor: 5,
    bedCount: 1,
    bathCount: 1,
    squareFeet: 762,
    askingRent: 2995,
    grossRent: 2995,
    ...nerSet(2995),
    lookAndLeaseBonus: 1000,
    lookAndLeaseWindowHours: 72,
    leaseMonths: 13,
    freeMonths: 1,
    availabilityStatus: "available",
    parkingIncluded: true,
    valetIncluded: true,
    parkingSpotsIncluded: 1,
    waterIncluded: true,
    powerIncluded: false,
    gasIncluded: false,
    internetIncluded: false,
    inUnitLaundry: true,
    balconyOrPatio: true,
    smartThermostat: true,
    sourceLabel: "Bailey Field Tour + ApartmentFinder public listing",
    sourceDate: SEED_DATE,
    sourceConfidence: "high",
    notes:
      "Smaller single / 1-bedroom. Strong comp against Baxter 1BR units because listed at $2,995 and 762 sqft with included parking/valet, water included, in-unit laundry, balcony/patio evidence, and stronger building amenity package.",
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "obs-zen-625",
    competitorId: ZEN_COMPETITOR_ID,
    competitorName: ZEN_COMPETITOR_NAME,
    fieldTourId: ZEN_FIELD_TOUR_ID,
    unitNumber: "625",
    unitNumberConfidence: "high",
    floor: 6,
    bedCount: 2,
    bathCount: 2,
    squareFeet: 1441,
    askingRent: 4995,
    grossRent: 4995,
    ...nerSet(4995),
    lookAndLeaseBonus: 1000,
    lookAndLeaseWindowHours: 72,
    leaseMonths: 13,
    freeMonths: 1,
    availabilityStatus: "not_ready",
    parkingIncluded: true,
    valetIncluded: true,
    parkingSpotsIncluded: 2,
    waterIncluded: true,
    powerIncluded: false,
    gasIncluded: false,
    internetIncluded: false,
    inUnitLaundry: true,
    balconyOrPatio: true,
    smartThermostat: true,
    sourceLabel: SOURCE_LABEL,
    sourceDate: SEED_DATE,
    sourceConfidence: "medium",
    needsVerification: true,
    notes:
      "Large double layout. Unit 625 was not ready during the tour. Bailey recorded 1441 sqft and $4,995. Strong size and amenity package. Needs verification against live quote/listing before owner-facing use.",
    dataQualityFlags: ["fq-zen-19m-applicability"],
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "obs-zen-630",
    competitorId: ZEN_COMPETITOR_ID,
    competitorName: ZEN_COMPETITOR_NAME,
    fieldTourId: ZEN_FIELD_TOUR_ID,
    unitNumber: "630",
    unitNumberConfidence: "medium",
    floor: 6,
    bedCount: 2,
    bathCount: 2,
    squareFeet: null,
    askingRent: 4500,
    grossRent: 4500,
    ...nerSet(4500),
    lookAndLeaseBonus: 1000,
    lookAndLeaseWindowHours: 72,
    leaseMonths: 13,
    freeMonths: 1,
    availabilityStatus: "available",
    parkingIncluded: true,
    valetIncluded: true,
    parkingSpotsIncluded: 2,
    waterIncluded: true,
    powerIncluded: false,
    gasIncluded: false,
    internetIncluded: false,
    inUnitLaundry: true,
    balconyOrPatio: true,
    smartThermostat: true,
    sourceLabel: SOURCE_LABEL,
    sourceDate: SEED_DATE,
    sourceConfidence: "medium",
    needsVerification: true,
    notes:
      "Bailey note: 6th floor smaller double, probable Unit 630, around $500 cheaper than Unit 625, available around $4,500. Exact unit number and sqft need verification.",
    dataQualityFlags: ["fq-zen-630-sqft"],
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "obs-zen-2f-unknown",
    competitorId: ZEN_COMPETITOR_ID,
    competitorName: ZEN_COMPETITOR_NAME,
    fieldTourId: ZEN_FIELD_TOUR_ID,
    unitNumber: "unknown-2nd-floor-double",
    unitNumberConfidence: "low",
    floor: 2,
    bedCount: 2,
    bathCount: 2,
    squareFeet: 1229,
    askingRent: 4000,
    grossRent: 4000,
    ...nerSet(4000),
    lookAndLeaseBonus: 1000,
    lookAndLeaseWindowHours: 72,
    leaseMonths: 13,
    freeMonths: 1,
    availabilityStatus: "available",
    parkingIncluded: true,
    valetIncluded: true,
    parkingSpotsIncluded: 2,
    waterIncluded: true,
    powerIncluded: false,
    gasIncluded: false,
    internetIncluded: false,
    inUnitLaundry: true,
    balconyOrPatio: true,
    smartThermostat: true,
    sourceLabel: SOURCE_LABEL,
    sourceDate: SEED_DATE,
    sourceConfidence: "medium",
    needsVerification: true,
    notes:
      "Same smaller double layout as the 6th-floor smaller double per Bailey notes, but on the 2nd floor and about $4,000. Exact unit number needs verification.",
    dataQualityFlags: ["fq-zen-2f-unit"],
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "obs-zen-424",
    competitorId: ZEN_COMPETITOR_ID,
    competitorName: ZEN_COMPETITOR_NAME,
    fieldTourId: ZEN_FIELD_TOUR_ID,
    unitNumber: "424",
    unitNumberConfidence: "medium",
    floor: 4,
    availabilityStatus: "needs_verification",
    sourceLabel: SOURCE_LABEL,
    sourceDate: SEED_DATE,
    sourceConfidence: "low",
    needsVerification: true,
    notes:
      "Referenced/toured by Bailey but exact rent, sqft, bed count, bath count, and concession details were not provided. Add to verification queue.",
    dataQualityFlags: ["fq-zen-424"],
    createdAt: NOW,
    updatedAt: NOW,
  },
  // Sprint 4 — public listing units (Apartments.com)
  {
    id: "obs-zen-427",
    competitorId: ZEN_COMPETITOR_ID,
    competitorName: ZEN_COMPETITOR_NAME,
    fieldTourId: ZEN_FIELD_TOUR_ID,
    unitNumber: "427",
    unitNumberConfidence: "high",
    floor: 4,
    bedCount: 2,
    bathCount: 2,
    squareFeet: 1221,
    askingRent: 4195,
    grossRent: 4195,
    ...nerSet(4195),
    lookAndLeaseBonus: 1000,
    lookAndLeaseWindowHours: 72,
    leaseMonths: 13,
    freeMonths: 1,
    availabilityStatus: "available",
    parkingIncluded: true,
    valetIncluded: true,
    parkingSpotsIncluded: 2,
    waterIncluded: true,
    powerIncluded: false,
    gasIncluded: false,
    internetIncluded: false,
    inUnitLaundry: true,
    balconyOrPatio: true,
    smartThermostat: true,
    sourceLabel: "Apartments.com public listing",
    sourceDate: SEED_DATE,
    sourceConfidence: "high",
    notes: "Apartments.com public listing: 2BR/2BA, 1,221 sqft, $4,195, available now. Not directly walked by Bailey.",
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "obs-zen-530",
    competitorId: ZEN_COMPETITOR_ID,
    competitorName: ZEN_COMPETITOR_NAME,
    fieldTourId: ZEN_FIELD_TOUR_ID,
    unitNumber: "530",
    unitNumberConfidence: "high",
    floor: 5,
    bedCount: 2,
    bathCount: 2,
    squareFeet: 1229,
    askingRent: 4345,
    grossRent: 4345,
    ...nerSet(4345),
    lookAndLeaseBonus: 1000,
    lookAndLeaseWindowHours: 72,
    leaseMonths: 13,
    freeMonths: 1,
    availabilityStatus: "available",
    parkingIncluded: true,
    valetIncluded: true,
    parkingSpotsIncluded: 2,
    waterIncluded: true,
    powerIncluded: false,
    gasIncluded: false,
    internetIncluded: false,
    inUnitLaundry: true,
    balconyOrPatio: true,
    smartThermostat: true,
    sourceLabel: "Apartments.com public listing",
    sourceDate: SEED_DATE,
    sourceConfidence: "high",
    notes: "Apartments.com public listing: 2BR/2BA, 1,229 sqft, $4,345, available now. Same 1,229 sqft as Bailey 2F note ($4,000) — verify whether same unit at different price or two different units.",
    dataQualityFlags: ["fq-zen-2f-vs-530"],
    createdAt: NOW,
    updatedAt: NOW,
  },
];

// ---------- amenity observations ----------
const amenity = (
  key: string,
  amenity: string,
  qualityScore: number,
  notes: string,
  sourceLabel = SOURCE_LABEL,
  sourceConfidence: "high" | "medium" | "low" | "unknown" = "high",
): CompetitorAmenityObservation => ({
  id: `am-zen-${key}`,
  competitorId: ZEN_COMPETITOR_ID,
  competitorName: ZEN_COMPETITOR_NAME,
  fieldTourId: ZEN_FIELD_TOUR_ID,
  amenity,
  observed: true,
  qualityScore,
  notes,
  photoEvidenceIds: [],
  sourceLabel,
  sourceDate: SEED_DATE,
  sourceConfidence,
  createdAt: NOW,
  updatedAt: NOW,
});

export const ZEN_AMENITY_OBSERVATIONS: CompetitorAmenityObservation[] = [
  amenity("pool", "pool", 5, "Large outdoor pool with lounge chairs and landscaped setting."),
  amenity("gym", "gym", 4, "Gym / 24-hour gym supported by public listing; Bailey reported gym included. Photo evidence not yet attached unless gym photo is uploaded.", `${SOURCE_LABEL} + Apartments.com + Zillow`, "medium"),
  amenity("bar", "bar", 5, "Bar/lounge seating area visible in amenity lounge."),
  amenity("lounge", "lounge", 5, "Very strong resident lounge with fireplace/media wall, upscale seating, high ceilings, and premium feel."),
  amenity("event_room", "event_room", 5, "Large communal lounge/event area observed."),
  amenity("theater", "theater", 4, "Game/theater/media room observed with pool table, golf simulator/projection, foosball, and seating."),
  amenity("business_area", "business_area", 4, "Business/conference center supported by public listing; exact area/layout should be verified with photo/source.", `${SOURCE_LABEL} + Apartments.com + RentCafe`, "medium"),
  amenity("outdoor_communal_space", "outdoor_communal_space", 5, "Outdoor seating, pool deck, landscaping, patio area."),
  amenity("bbq_grill", "bbq_grill", 4, "Outdoor BBQ/grill area visible."),
  amenity("valet", "valet", 5, "Valet included per Bailey tour notes and public listing support.", `${SOURCE_LABEL} + Apartments.com + Westside Rentals`),
  amenity("parking", "parking", 5, "Parking included; Bailey notes 1 spot per bedroom.", `${SOURCE_LABEL} + Apartments.com + Westside Rentals`),
  amenity("in_unit_laundry", "in_unit_laundry", 5, "Stacked washer/dryer visible in unit photo.", `${SOURCE_LABEL} + Zillow`),
  amenity("smart_thermostat", "smart_thermostat", 4, "Wall thermostat/smart climate control visible in photo."),
  amenity("balcony_or_patio", "balcony_or_patio", 4, "Multiple unit photos show balcony/slider/private outdoor space.", `${SOURCE_LABEL} + Westside Rentals`),
  amenity("modern_kitchen", "modern_kitchen", 5, "Modern kitchen with island, quartz/stone-style countertops, wood cabinetry, stainless appliances, gas range, built-in microwave.", `${SOURCE_LABEL} + Westside Rentals`),
  amenity("premium_bathroom", "premium_bathroom", 4, "Large modern bathrooms, double vanities in some units, glass showers, tub/shower configurations."),
  amenity("closet_storage", "closet_storage", 4, "Closets and built-in shelving/storage observed.", `${SOURCE_LABEL} + Westside Rentals`),
];

// ---------- photo evidence (42 records, filename-sorted ascending) ----------
const ZEN_PHOTO_FILES = [
  "IMG_2251.heic","IMG_2252.heic","IMG_2253.heic","IMG_2254.heic","IMG_2255.heic",
  "IMG_2256.heic","IMG_2257.heic","IMG_2258.heic","IMG_2259.heic","IMG_2260.heic",
  "IMG_2261.heic","IMG_2262.heic","IMG_2263.heic","IMG_2264.heic","IMG_2265.heic",
  "IMG_2266.heic","IMG_2267.heic","IMG_2268.heic","IMG_2269.heic","IMG_2270.heic",
  "IMG_2271.heic","IMG_2272.heic","IMG_2273.heic","IMG_2274.heic","IMG_2275.heic",
  "IMG_2276.heic","IMG_2277.heic","IMG_2278.heic","IMG_2279.heic","IMG_2280.heic",
  "IMG_2281.heic","IMG_2282.heic","IMG_2283.heic","IMG_2284.heic","IMG_2285.heic",
  "IMG_2286.heic","IMG_2287.heic","IMG_2288.heic","IMG_2289.heic","IMG_2290.heic",
  "IMG_2293.heic","IMG_2294.heic",
];

interface PhotoSeed {
  category: string;
  caption: string;
  relatedAmenity?: string;
  relatedUnitNumber?: string;
  strengths?: string;
  weaknesses?: string;
  tags: string[];
}

const PHOTO_SEEDS: PhotoSeed[] = [
  { category: "lobby_common_area", caption: "Polished lobby or seating area with high-end furniture, glass, modern flooring.", relatedAmenity: "lobby", strengths: "Strong first impression; clean; luxury-feeling; professional arrival experience.", tags: ["lobby","seating","clean","luxury","first-impression"] },
  { category: "unit_kitchen", caption: "Modern kitchen with wood cabinetry, stainless appliances, gas range, built-in microwave, light countertop/backsplash.", relatedAmenity: "modern_kitchen", strengths: "Modern finishes; full appliance package; clean kitchen presentation.", tags: ["kitchen","gas-range","stainless","modern-finishes"] },
  { category: "unit_living_room", caption: "Open living area connected to kitchen with balcony/window at far end.", strengths: "Open plan; good depth; decent natural light; balcony/large slider.", tags: ["living-room","open-layout","natural-light","balcony"] },
  { category: "unit_flex_or_bedroom", caption: "Secondary room or flex area with closet nearby.", strengths: "Usable room depth; clean finishes.", weaknesses: "Verify whether this is a true bedroom, den, or flex area.", tags: ["bedroom","den","flex","needs-verification"] },
  { category: "bathroom", caption: "Modern bathroom vanity with large mirror and dark tile flooring.", strengths: "Clean modern finish; good vanity size.", tags: ["bathroom","vanity","modern"] },
  { category: "bathroom_shower", caption: "Large glass-enclosed shower with stone-look wall tile and dark floor tile.", strengths: "Premium shower feel; modern glass enclosure.", tags: ["shower","glass-shower","premium-bathroom"] },
  { category: "bedroom", caption: "Bedroom with window and clean flooring.", strengths: "Actual bedroom window; natural light.", tags: ["bedroom","window","natural-light"] },
  { category: "closet", caption: "Walk-in closet or large closet with built-in shelving and hanging storage.", strengths: "Strong closet storage.", tags: ["closet","walk-in-closet","storage"] },
  { category: "balcony_view", caption: "Large balcony or exterior-facing slider view.", strengths: "Outdoor private space; large glass opening.", tags: ["balcony","outdoor-space","view"] },
  { category: "bathroom_tub", caption: "Bathroom with tub and dark tile floor.", strengths: "Full bathroom with tub.", tags: ["bathroom","tub"] },
  { category: "bathroom_double_vanity", caption: "Large double vanity with two sinks and two mirrors.", strengths: "Strong bathroom size; double sink; premium layout.", tags: ["bathroom","double-vanity","premium"] },
  { category: "bathroom_tub", caption: "Tub area with modern controls and dark tile floor.", strengths: "Large bathroom footprint.", tags: ["bathroom","tub","dark-tile"] },
  { category: "living_or_flex_room", caption: "Large unfurnished room with wood flooring and window.", strengths: "Open usable room; decent natural light.", tags: ["living-room","bedroom","open-space"] },
  { category: "kitchen", caption: "Kitchen island and built-in cabinetry viewed from living area.", strengths: "Large island; modern kitchen; integrated appliances.", tags: ["kitchen","island","modern"] },
  { category: "living_room", caption: "Large open living area with window/balcony.", strengths: "Strong room depth; modern flooring.", tags: ["living-room","open-layout"] },
  { category: "bedroom_closet", caption: "Bedroom with closet and adjacent bathroom/closet access.", strengths: "Functional bedroom layout; storage.", tags: ["bedroom","closet"] },
  { category: "balcony_bedroom_view", caption: "Room with large glass slider to balcony.", strengths: "Private outdoor space; natural light.", tags: ["balcony","bedroom","natural-light"] },
  { category: "bathroom", caption: "Bathroom with vanity, shower, and dark floor tile.", strengths: "Modern full bath.", tags: ["bathroom","shower","vanity"] },
  { category: "living_or_bedroom", caption: "Room with large window and closet.", strengths: "Strong window; natural light.", tags: ["bedroom","window","closet"] },
  { category: "bathroom", caption: "Bathroom with vanity and tub area.", strengths: "Full bath; clean finishes.", tags: ["bathroom","vanity","tub"] },
  { category: "bathroom", caption: "Large bathroom with shower and tub visible.", strengths: "Oversized bathroom; separate shower/tub feel.", tags: ["bathroom","shower","tub","premium"] },
  { category: "bathroom_hallway_view", caption: "Bathroom seen from hallway/bedroom access.", strengths: "Attached bath access.", tags: ["bathroom","hallway"] },
  { category: "in_unit_laundry", caption: "Stacked washer/dryer in closet.", relatedAmenity: "in_unit_laundry", strengths: "In-unit laundry; major renter advantage.", tags: ["washer-dryer","in-unit-laundry"] },
  { category: "bathroom", caption: "Bathroom vanity and toilet with modern finish.", strengths: "Clean bathroom.", tags: ["bathroom","vanity"] },
  { category: "tub", caption: "Close view of tub.", strengths: "Full tub.", tags: ["bathroom","tub"] },
  { category: "bedroom_or_living_entry", caption: "Room entrance view with large window/balcony beyond.", strengths: "Bright room; exterior-facing.", tags: ["room","natural-light"] },
  { category: "pantry_storage", caption: "Built-in shelving/storage cabinet.", relatedAmenity: "closet_storage", strengths: "Extra storage.", tags: ["storage","pantry"] },
  { category: "kitchen_living", caption: "Kitchen and open living area.", strengths: "Open plan; large island; modern kitchen.", tags: ["kitchen","open-layout","island"] },
  { category: "bedroom", caption: "Bedroom with large window and wood floor.", strengths: "Natural light; clean finish.", tags: ["bedroom","window"] },
  { category: "kitchen_living", caption: "Long kitchen and living area view.", strengths: "Modern kitchen; open layout.", tags: ["kitchen","living-room","open-layout"] },
  { category: "hallway_flex_area", caption: "Interior hallway/flex area with closet/door.", strengths: "Usable circulation/storage.", weaknesses: "Verify exact room function.", tags: ["hallway","flex","needs-verification"] },
  { category: "bathroom_to_bedroom_sightline", caption: "Bathroom looking through to bedroom/window.", strengths: "Suite-style layout.", tags: ["bathroom","bedroom","suite"] },
  { category: "bedroom_or_living", caption: "Large room with window and people touring.", strengths: "Room feels large and clean.", tags: ["bedroom","living-room","tour"] },
  { category: "bedroom_closet_bath_access", caption: "Bedroom with closet and bath access.", strengths: "Good bedroom storage and suite configuration.", tags: ["bedroom","closet","bath-access"] },
  { category: "bedroom_balcony", caption: "Room with large slider/balcony and strong natural light.", strengths: "Private balcony; bright room.", tags: ["bedroom","balcony","natural-light"] },
  { category: "smart_thermostat", caption: "Wall thermostat / smart control visible.", relatedAmenity: "smart_thermostat", strengths: "Modern smart/central climate feature.", tags: ["thermostat","smart-home","climate-control"] },
  { category: "lounge_common_area", caption: "Large resident lounge with fireplace/media wall and seating.", relatedAmenity: "lounge", strengths: "Very strong communal amenity; polished finishes; premium feel.", tags: ["lounge","fireplace","resident-lounge","amenity"] },
  { category: "bar_lounge", caption: "Amenity lounge with bar seating and TV.", relatedAmenity: "bar", strengths: "Bar/lounge amenity; social space.", tags: ["bar","lounge","tv","amenity"] },
  { category: "lounge_seating", caption: "Lounge and seating area with high ceiling and polished finishes.", relatedAmenity: "lounge", strengths: "High-quality communal space; strong renter impression.", tags: ["lounge","seating","amenity"] },
  { category: "game_room_theater", caption: "Game/theater area with pool table, golf simulator or projection, foosball, seating.", relatedAmenity: "theater", strengths: "High-value amenity package; social/recreation space.", tags: ["game-room","theater","pool-table","golf-simulator","foosball"] },
  { category: "pool", caption: "Outdoor pool with lounge chairs and landscaping.", relatedAmenity: "pool", strengths: "Major amenity advantage over Baxter if Baxter lacks pool.", tags: ["pool","outdoor-amenity","lounge-chairs"] },
  { category: "outdoor_bbq_communal_patio", caption: "Outdoor seating and BBQ/grill area near landscaping.", relatedAmenity: "bbq_grill", strengths: "Outdoor gathering space; grill amenity; social area.", tags: ["bbq","outdoor-space","grill","communal-area"] },
];

export const ZEN_PHOTO_EVIDENCE: PhotoEvidenceRecord[] = PHOTO_SEEDS.map((seed, i) => ({
  id: `ph-zen-${String(i + 1).padStart(2, "0")}`,
  competitorId: ZEN_COMPETITOR_ID,
  competitorName: ZEN_COMPETITOR_NAME,
  fieldTourId: ZEN_FIELD_TOUR_ID,
  collectionId: ZEN_COLLECTION_ID,
  photoOrder: i + 1,
  originalFilename: ZEN_PHOTO_FILES[i],
  storagePath: undefined, // Bailey must drop converted .jpg into public/zen-tour/
  publicUrl: undefined,
  category: seed.category,
  caption: seed.caption,
  relatedUnitNumber: seed.relatedUnitNumber,
  relatedAmenity: seed.relatedAmenity,
  observedStrengths: seed.strengths,
  observedWeaknesses: seed.weaknesses,
  marketingUsefulnessScore: undefined,
  compEvidenceValueScore: undefined,
  dataConfidence: "high",
  sourceLabel: SOURCE_LABEL,
  sourceDate: SEED_DATE,
  uploadedBy: "Bailey",
  tags: seed.tags,
  createdAt: NOW,
  updatedAt: NOW,
}));

// ---------- source verifications (real URLs only) ----------
export const ZEN_SOURCE_VERIFICATIONS: CompetitorSourceVerification[] = [
  {
    id: "sv-zen-field-tour",
    competitorId: ZEN_COMPETITOR_ID,
    sourceType: "field_tour",
    sourceUrl: "",
    sourceName: SOURCE_LABEL,
    verifiedAt: SEED_DATE,
    verifiedBy: "Bailey",
    verificationStatus: "verified",
    fieldsVerified: [
      "amenities", "parking included", "valet included", "in-unit laundry",
      "lounge", "bar", "game/theater area", "pool", "BBQ/grill", "outdoor communal space",
      "smart thermostat", "modern kitchen", "premium bathroom",
      "Unit 522 layout/finishes", "Unit 625 layout (not ready)", "concession structure",
    ],
    notes: "Real Bailey in-person tour on 2026-05-26.",
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "sv-zen-official",
    competitorId: ZEN_COMPETITOR_ID,
    sourceType: "official_property_website",
    sourceUrl: "https://www.zenhollywoodapts.com/",
    sourceName: "Zen Hollywood — official website",
    verificationStatus: "needs_review",
    fieldsVerified: ["property identity"],
    notes:
      "Official site URL captured. Claude did NOT read page content — do not claim detailed values verified from this page until manually opened.",
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "sv-zen-apartments",
    competitorId: ZEN_COMPETITOR_ID,
    sourceType: "apartments_com",
    sourceUrl: "https://www.apartments.com/zen-hollywood-los-angeles-ca/wr9hjth/",
    sourceName: "Apartments.com — Zen Hollywood",
    verificationStatus: "verified",
    fieldsVerified: [
      "parking included", "valet parking", "gym", "heated pool", "game room",
      "conference center", "bbq/grill/picnic", "amenities",
    ],
    notes: "Public listing supports the listed amenity set.",
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "sv-zen-zillow",
    competitorId: ZEN_COMPETITOR_ID,
    sourceType: "zillow",
    sourceUrl: "https://www.zillow.com/apartments/los-angeles-ca/zen-hollywood/CgJ3Xz/",
    sourceName: "Zillow — Zen Hollywood",
    verificationStatus: "verified",
    fieldsVerified: [
      "$1000 look-and-lease", "72 hour application window", "1 month free",
      "up to 8 weeks free with 19-month lease on approved credit", "in-unit laundry",
      "underground garage",
    ],
    notes: "Concession structure publicly supported.",
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "sv-zen-apartmentfinder",
    competitorId: ZEN_COMPETITOR_ID,
    sourceType: "apartmentfinder",
    sourceUrl: "https://www.apartmentfinder.com/California/Los-Angeles-Apartments/Zen-Hollywood-Apartments-ns9yntm",
    sourceName: "ApartmentFinder — Zen Hollywood",
    verificationStatus: "verified",
    fieldsVerified: [
      "Unit 522", "$2995", "762 sqft", "1 bed", "available now",
      "valet parking", "heated pool", "gym",
    ],
    notes: "Verifies Unit 522 specifically.",
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "sv-zen-westside",
    competitorId: ZEN_COMPETITOR_ID,
    sourceType: "westside_rentals",
    sourceUrl: "https://www.westsiderentals.com/los-angeles-ca/zen-hollywood-wr9hjth",
    sourceName: "Westside Rentals — Zen Hollywood",
    verificationStatus: "verified",
    fieldsVerified: [
      "parking included", "valet parking",
      "unit amenity set including balcony, dishwasher, den, washer/dryer, island kitchen, patio, quartz countertops",
    ],
    notes: "Supports in-unit amenity inventory.",
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "sv-zen-rentcafe",
    competitorId: ZEN_COMPETITOR_ID,
    sourceType: "rentcafe",
    sourceUrl: "https://www.rentcafe.com/apartments/ca/los-angeles/zen-hollywood1/default.aspx",
    sourceName: "RentCafe — Zen Hollywood",
    verificationStatus: "partial",
    fieldsVerified: ["business center", "virtual golf", "valet parking", "property description"],
    notes: "Use as supporting source only.",
    createdAt: NOW,
    updatedAt: NOW,
  },
];

// ---------- data quality flags ----------
export const ZEN_FLAGS: DataQualityFlag[] = [
  { id: "fq-zen-address", issue: "Address discrepancy: prior report/app may list Zen at 1718 N Las Palmas; public listing sources show 1825 N Las Palmas. Verify canonical leasing address.", affectedEntity: "Zen Hollywood", affectedEntityType: "competitor", severity: "medium", status: "needs_verification", createdAt: SEED_DATE },
  { id: "fq-zen-630-sqft", issue: "Verify whether 1229 sqft belongs to probable Unit 630 or to the 2nd-floor same-layout unit.", affectedEntity: "Zen Hollywood — Unit 630", affectedEntityType: "competitor", severity: "medium", status: "needs_verification", createdAt: SEED_DATE },
  { id: "fq-zen-2f-unit", issue: "2nd-floor smaller double — exact unit number needs verification.", affectedEntity: "Zen Hollywood — 2nd-floor double", affectedEntityType: "competitor", severity: "medium", status: "needs_verification", createdAt: SEED_DATE },
  { id: "fq-zen-424", issue: "Unit 424: rent, sqft, bed count, and availability need verification.", affectedEntity: "Zen Hollywood — Unit 424", affectedEntityType: "competitor", severity: "medium", status: "needs_verification", createdAt: SEED_DATE },
  { id: "fq-zen-19m-applicability", issue: "Confirm whether 2 months free / up to 8 weeks free on 19-month lease applies to all observed units or only select units.", affectedEntity: "Zen Hollywood — 19-month concession", affectedEntityType: "competitor", severity: "high", status: "needs_verification", createdAt: SEED_DATE },
  { id: "fq-zen-gym-photo", issue: "Gym is publicly listed and Bailey reported it, but no gym photo is included in the current 42-photo batch.", affectedEntity: "Zen Hollywood — gym photo", affectedEntityType: "competitor", severity: "low", status: "needs_verification", createdAt: SEED_DATE },
  { id: "fq-zen-movein-cost", issue: "Move-in cost and deposits/fees need verification.", affectedEntity: "Zen Hollywood — move-in cost", affectedEntityType: "competitor", severity: "medium", status: "open", createdAt: SEED_DATE },
  { id: "fq-zen-fees-waivable", issue: "Application/admin fee waiver status unknown.", affectedEntity: "Zen Hollywood — fees", affectedEntityType: "competitor", severity: "low", status: "open", createdAt: SEED_DATE },
  { id: "fq-zen-source-merging", issue: "Reconcile Bailey field-tour values, public listing values, and market comp report values without overwriting source history.", affectedEntity: "Zen Hollywood — source merging", affectedEntityType: "competitor", severity: "medium", status: "open", createdAt: SEED_DATE },
];

// ---------- idempotent seed ----------
const SEED_FLAG_KEY = "baxter-ops.zen.seeded.v1";

import { BACKEND_MODE } from "./services/persistence";
import { loadFieldTour } from "./services/fieldTours";

/**
 * Idempotent Zen seed.
 *
 * Supabase mode: checks Supabase for the deterministic field-tour row. If
 * already present (Sprint 4 already wrote it via MCP), this is a no-op and
 * does NOT re-write. If absent, performs full upsert.
 *
 * localStorage mode: gated by a browser-local flag.
 */
export async function ensureZenSeeded(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    if (BACKEND_MODE === "supabase") {
      const existing = await loadFieldTour(ZEN_FIELD_TOUR_ID);
      if (existing) return; // already seeded server-side
      // else fall through and write
    } else {
      if (window.localStorage.getItem(SEED_FLAG_KEY)) return;
    }
    await saveFieldTour(ZEN_FIELD_TOUR);
    await bulkUpsertObservedUnits(ZEN_OBSERVED_UNITS);
    await bulkUpsertAmenityObservations(ZEN_AMENITY_OBSERVATIONS);
    await bulkUpsertPhotoEvidence(ZEN_PHOTO_EVIDENCE);
    await bulkUpsertSourceVerifications(ZEN_SOURCE_VERIFICATIONS);
    for (const f of ZEN_FLAGS) await createDataQualityFlag(f);
    if (BACKEND_MODE === "localStorage") {
      window.localStorage.setItem(SEED_FLAG_KEY, new Date().toISOString());
    }
  } catch (e) {
    console.warn("[zen seed] non-fatal error:", e);
  }
}

/**
 * Force re-upsert of the entire Zen seed regardless of presence.
 * Wired to the "Replay Zen seed into backend" button in /settings.
 */
export async function replayZenSeed(): Promise<{
  fieldTours: number; units: number; amenities: number; photos: number; sources: number; flags: number;
}> {
  await saveFieldTour(ZEN_FIELD_TOUR);
  await bulkUpsertObservedUnits(ZEN_OBSERVED_UNITS);
  await bulkUpsertAmenityObservations(ZEN_AMENITY_OBSERVATIONS);
  await bulkUpsertPhotoEvidence(ZEN_PHOTO_EVIDENCE);
  await bulkUpsertSourceVerifications(ZEN_SOURCE_VERIFICATIONS);
  for (const f of ZEN_FLAGS) await createDataQualityFlag(f);
  return {
    fieldTours: 1,
    units: ZEN_OBSERVED_UNITS.length,
    amenities: ZEN_AMENITY_OBSERVATIONS.length,
    photos: ZEN_PHOTO_EVIDENCE.length,
    sources: ZEN_SOURCE_VERIFICATIONS.length,
    flags: ZEN_FLAGS.length,
  };
}

// Public expected photo count for the field tour.
export const ZEN_PHOTO_COUNT_EXPECTED = 42;
