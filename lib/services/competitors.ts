// Sprint 12: Competitor service.
// Before this sprint, every list page iterated `seed.COMPETITORS` from
// lib/seed.ts — meaning any property added via /add-tour was invisible to
// every other device. This service makes Supabase the source of truth and
// keeps the seed as a fallback for unauthenticated/offline users.
//
// Reading rules:
//   - If Supabase is configured AND returns rows, return the Supabase merge.
//   - If Supabase returns empty (auth missing or env unset), return seed.
//   - Seed competitors are also written to Supabase via the seed migration,
//     so in normal operation seed and Supabase are kept in sync.
//
// Writing rules:
//   - Every insert/update goes through Supabase. No localStorage.
//   - Writes broadcast via Postgres realtime to all listening tabs/devices.

import { getSupabase, hasSupabaseEnv } from "@/lib/supabase/client";
import type {
  CompetitorProperty,
  CompetitorUnitType,
  DataConfidence,
  CompSourceType,
} from "@/lib/types";
import { COMPETITORS as SEED_COMPETITORS } from "@/lib/seed";

const TABLE = "competitors";

// ---------- Row shape (mirrors the DB) ----------

interface CompetitorRow {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  website: string | null;
  distance_miles: number | null;
  units: number;
  year_built: number | null;
  building_class: string | null;
  occupancy_pct: number | null;
  leased_pct: number | null;
  tours_last_week: number | null;
  leases_last_week: number | null;
  unit_types: CompetitorUnitType[] | null;
  deposit: string | null;
  specials: string | null;
  free_rent_weeks: number | null;
  look_and_lease_bonus: number | null;
  parking_included: boolean | null;
  amenities: string[] | null;
  notes: string | null;
  threat_level: number | null;
  comp_quality_score: number | null;
  source_type: string | null;
  source_url: string | null;
  official_website_url: string | null;
  apartments_url: string | null;
  zillow_url: string | null;
  zumper_url: string | null;
  google_business_url: string | null;
  last_verified_at: string | null;
  verified_by: string | null;
  data_confidence: string | null;
  data_quality_flags: string[] | null;
  alternate_address: string | null;
  competitor_strategic_type: string | null;
  competitor_tags: string[] | null;
  field_verified: boolean | null;
  field_verified_at: string | null;
  field_verified_by: string | null;
  field_verification_confidence: string | null;
  amenity_threat_level: number | null;
  parking_threat_level: number | null;
  concession_threat_level: number | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function rowToCompetitor(row: CompetitorRow): CompetitorProperty {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    phone: row.phone ?? undefined,
    website: row.website ?? undefined,
    distanceMiles: row.distance_miles ?? undefined,
    units: row.units,
    yearBuilt: row.year_built ?? undefined,
    buildingClass: (row.building_class as "A" | "B" | "C" | undefined) ?? undefined,
    occupancyPct: row.occupancy_pct ?? undefined,
    leasedPct: row.leased_pct ?? undefined,
    toursLastWeek: row.tours_last_week ?? undefined,
    leasesLastWeek: row.leases_last_week ?? undefined,
    unitTypes: row.unit_types ?? [],
    deposit: row.deposit ?? undefined,
    specials: row.specials ?? undefined,
    freeRentWeeks: row.free_rent_weeks ?? undefined,
    lookAndLeaseBonus: row.look_and_lease_bonus ?? undefined,
    parkingIncluded: row.parking_included ?? undefined,
    amenities: row.amenities ?? [],
    notes: row.notes ?? undefined,
    threatLevel: (row.threat_level as 1 | 2 | 3 | 4 | 5 | undefined) ?? undefined,
    compQualityScore: row.comp_quality_score ?? undefined,
    sourceType: (row.source_type as CompSourceType | undefined) ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    officialWebsiteUrl: row.official_website_url ?? undefined,
    apartmentsUrl: row.apartments_url ?? undefined,
    zillowUrl: row.zillow_url ?? undefined,
    zumperUrl: row.zumper_url ?? undefined,
    googleBusinessUrl: row.google_business_url ?? undefined,
    lastVerifiedAt: row.last_verified_at ?? undefined,
    verifiedBy: row.verified_by ?? undefined,
    dataConfidence: (row.data_confidence as DataConfidence | undefined) ?? undefined,
    dataQualityFlags: row.data_quality_flags ?? undefined,
    alternateAddress: row.alternate_address ?? undefined,
    competitorStrategicType:
      (row.competitor_strategic_type as CompetitorProperty["competitorStrategicType"]) ?? undefined,
    competitorTags: row.competitor_tags ?? undefined,
    fieldVerified: row.field_verified ?? false,
    fieldVerifiedAt: row.field_verified_at ?? undefined,
    fieldVerifiedBy: row.field_verified_by ?? undefined,
    fieldVerificationConfidence:
      (row.field_verification_confidence as DataConfidence | undefined) ?? undefined,
    amenityThreatLevel:
      (row.amenity_threat_level as 1 | 2 | 3 | 4 | 5 | undefined) ?? undefined,
    parkingThreatLevel:
      (row.parking_threat_level as 1 | 2 | 3 | 4 | 5 | undefined) ?? undefined,
    concessionThreatLevel:
      (row.concession_threat_level as 1 | 2 | 3 | 4 | 5 | undefined) ?? undefined,
  };
}

function competitorToRow(c: Partial<CompetitorProperty> & { id: string }): Partial<CompetitorRow> {
  return {
    id: c.id,
    ...(c.name !== undefined && { name: c.name }),
    ...(c.address !== undefined && { address: c.address }),
    ...(c.phone !== undefined && { phone: c.phone ?? null }),
    ...(c.website !== undefined && { website: c.website ?? null }),
    ...(c.distanceMiles !== undefined && { distance_miles: c.distanceMiles ?? null }),
    ...(c.units !== undefined && { units: c.units }),
    ...(c.yearBuilt !== undefined && { year_built: c.yearBuilt ?? null }),
    ...(c.buildingClass !== undefined && { building_class: c.buildingClass ?? null }),
    ...(c.occupancyPct !== undefined && { occupancy_pct: c.occupancyPct ?? null }),
    ...(c.leasedPct !== undefined && { leased_pct: c.leasedPct ?? null }),
    ...(c.toursLastWeek !== undefined && { tours_last_week: c.toursLastWeek ?? null }),
    ...(c.leasesLastWeek !== undefined && { leases_last_week: c.leasesLastWeek ?? null }),
    ...(c.unitTypes !== undefined && { unit_types: c.unitTypes ?? [] }),
    ...(c.deposit !== undefined && { deposit: c.deposit ?? null }),
    ...(c.specials !== undefined && { specials: c.specials ?? null }),
    ...(c.freeRentWeeks !== undefined && { free_rent_weeks: c.freeRentWeeks ?? null }),
    ...(c.lookAndLeaseBonus !== undefined && { look_and_lease_bonus: c.lookAndLeaseBonus ?? null }),
    ...(c.parkingIncluded !== undefined && { parking_included: c.parkingIncluded ?? null }),
    ...(c.amenities !== undefined && { amenities: c.amenities ?? [] }),
    ...(c.notes !== undefined && { notes: c.notes ?? null }),
    ...(c.threatLevel !== undefined && { threat_level: c.threatLevel ?? null }),
    ...(c.compQualityScore !== undefined && { comp_quality_score: c.compQualityScore ?? null }),
    ...(c.sourceType !== undefined && { source_type: c.sourceType ?? null }),
    ...(c.sourceUrl !== undefined && { source_url: c.sourceUrl ?? null }),
    ...(c.officialWebsiteUrl !== undefined && { official_website_url: c.officialWebsiteUrl ?? null }),
    ...(c.apartmentsUrl !== undefined && { apartments_url: c.apartmentsUrl ?? null }),
    ...(c.zillowUrl !== undefined && { zillow_url: c.zillowUrl ?? null }),
    ...(c.zumperUrl !== undefined && { zumper_url: c.zumperUrl ?? null }),
    ...(c.googleBusinessUrl !== undefined && { google_business_url: c.googleBusinessUrl ?? null }),
    ...(c.lastVerifiedAt !== undefined && { last_verified_at: c.lastVerifiedAt ?? null }),
    ...(c.verifiedBy !== undefined && { verified_by: c.verifiedBy ?? null }),
    ...(c.dataConfidence !== undefined && { data_confidence: c.dataConfidence ?? null }),
    ...(c.dataQualityFlags !== undefined && { data_quality_flags: c.dataQualityFlags ?? null }),
    ...(c.alternateAddress !== undefined && { alternate_address: c.alternateAddress ?? null }),
    ...(c.competitorStrategicType !== undefined && {
      competitor_strategic_type: c.competitorStrategicType ?? null,
    }),
    ...(c.competitorTags !== undefined && { competitor_tags: c.competitorTags ?? null }),
    ...(c.fieldVerified !== undefined && { field_verified: c.fieldVerified ?? false }),
    ...(c.fieldVerifiedAt !== undefined && { field_verified_at: c.fieldVerifiedAt ?? null }),
    ...(c.fieldVerifiedBy !== undefined && { field_verified_by: c.fieldVerifiedBy ?? null }),
    ...(c.fieldVerificationConfidence !== undefined && {
      field_verification_confidence: c.fieldVerificationConfidence ?? null,
    }),
    ...(c.amenityThreatLevel !== undefined && { amenity_threat_level: c.amenityThreatLevel ?? null }),
    ...(c.parkingThreatLevel !== undefined && { parking_threat_level: c.parkingThreatLevel ?? null }),
    ...(c.concessionThreatLevel !== undefined && {
      concession_threat_level: c.concessionThreatLevel ?? null,
    }),
  };
}

// ---------- Reads ----------

/**
 * Load all competitors. Supabase is the source of truth when configured;
 * falls back to the static seed for unauthenticated/offline users.
 *
 * IMPORTANT: This is the ONE function the UI should call. Do not import
 * COMPETITORS from lib/seed.ts in pages — always go through this.
 */
export async function loadAllCompetitors(): Promise<CompetitorProperty[]> {
  if (!hasSupabaseEnv) {
    return SEED_COMPETITORS;
  }
  const client = getSupabase();
  if (!client) return SEED_COMPETITORS;

  const { data, error } = await client
    .from(TABLE)
    .select("*")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    // Could be RLS (unauthenticated), network, etc. — fall back to seed silently.
    // The page will show LiveDataBanner so the user knows they're unauthenticated.
    if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
      console.warn("[competitors] Supabase select failed, falling back to seed:", error.message);
    }
    return SEED_COMPETITORS;
  }

  if (!data || data.length === 0) {
    // Unauthenticated reads succeed but return [] under RLS. Use seed.
    return SEED_COMPETITORS;
  }

  return data.map(rowToCompetitor);
}

/**
 * Load one competitor by ID. Returns null if neither Supabase nor seed has it.
 */
export async function loadCompetitor(id: string): Promise<CompetitorProperty | null> {
  if (!hasSupabaseEnv) {
    return SEED_COMPETITORS.find(c => c.id === id) ?? null;
  }
  const client = getSupabase();
  if (!client) return SEED_COMPETITORS.find(c => c.id === id) ?? null;

  const { data, error } = await client
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    return SEED_COMPETITORS.find(c => c.id === id) ?? null;
  }
  return rowToCompetitor(data as CompetitorRow);
}

// ---------- Writes ----------

/**
 * Upsert a competitor record. Used by /add-tour and inline editors.
 * Throws on failure so callers can show an error toast.
 */
export async function upsertCompetitor(
  competitor: CompetitorProperty & { createdBy?: string },
): Promise<CompetitorProperty> {
  const client = getSupabase();
  if (!client) {
    throw new Error("Supabase not configured. Cannot write competitor.");
  }
  const row = competitorToRow(competitor);
  if (competitor.createdBy) {
    (row as Partial<CompetitorRow>).created_by = competitor.createdBy;
  }
  (row as Partial<CompetitorRow>).is_active = true;

  const { data, error } = await client
    .from(TABLE)
    .upsert(row, { onConflict: "id" })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to save competitor: ${error.message}`);
  }
  return rowToCompetitor(data as CompetitorRow);
}

/**
 * Partial update (PATCH semantics). For inline pencil edits that touch
 * only a single field. Throws on failure.
 *
 * Sprint 13: when called with `editedBy` AND `fieldLabel`, also writes a
 * data_source_ledger row (source_type=manual_user_edit) and triggers a
 * comparison-model recompute. Pass either nothing (legacy callers, no ledger)
 * or the full object to opt into the full pipeline.
 */
export async function updateCompetitorFields(
  id: string,
  patch: Partial<CompetitorProperty>,
  opts?: { editedBy: string; fieldLabel: string; fieldKey: string; displayValue: string },
): Promise<CompetitorProperty> {
  const client = getSupabase();
  if (!client) {
    throw new Error("Supabase not configured. Cannot update competitor.");
  }

  const row = competitorToRow({ id, ...patch });
  const { data, error } = await client
    .from(TABLE)
    .update(row)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update competitor: ${error.message}`);
  }

  // Sprint 13: ledger + recompute pipeline (opt-in via opts to preserve old call sites).
  if (opts) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { writeManualEditLedger, recomputeCompetitorComparisonModel } = require("./manualEdits") as typeof import("./manualEdits");
      await writeManualEditLedger({
        competitorId: id,
        entityType: "competitor",
        entityId: id,
        entityName: (data as CompetitorRow).name,
        fieldKey: opts.fieldKey,
        fieldLabel: opts.fieldLabel,
        fieldCategory: "other",
        valueType: "text",
        valueText: opts.displayValue,
        displayValue: opts.displayValue,
        editedBy: opts.editedBy,
        pageRoutes: ["/competitors", `/competitors/${id.replace(/^c-/, "")}`, "/competitor-intelligence"],
      });
      // Recompute comparison model if the changed field affects scoring.
      const scoringFields = ["specials", "freeRentWeeks", "amenities", "competitorStrategicType", "threatLevel"];
      if (Object.keys(patch).some(k => scoringFields.includes(k))) {
        await recomputeCompetitorComparisonModel(id);
      }
    } catch {
      /* non-fatal */
    }
  }

  return rowToCompetitor(data as CompetitorRow);
}

/**
 * Soft-delete by flipping is_active. Keeps history + audit references.
 */
export async function deactivateCompetitor(id: string): Promise<void> {
  const client = getSupabase();
  if (!client) {
    throw new Error("Supabase not configured. Cannot deactivate competitor.");
  }
  const { error } = await client
    .from(TABLE)
    .update({ is_active: false })
    .eq("id", id);
  if (error) {
    throw new Error(`Failed to deactivate competitor: ${error.message}`);
  }
}

/**
 * Hard delete — only for /sync-test QA cleanup. Cascades to child rows
 * via existing FK constraints (or, if no FKs, leaves orphans).
 */
export async function deleteCompetitor(id: string): Promise<void> {
  const client = getSupabase();
  if (!client) {
    throw new Error("Supabase not configured. Cannot delete competitor.");
  }
  const { error } = await client.from(TABLE).delete().eq("id", id);
  if (error) {
    throw new Error(`Failed to delete competitor: ${error.message}`);
  }
}
