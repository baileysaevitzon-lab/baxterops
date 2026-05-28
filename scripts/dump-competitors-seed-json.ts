// Sprint 12: One-off dumper.
// Reads COMPETITORS from lib/seed.ts and prints a JSON array on stdout
// shaped for Postgres INSERT (snake_case keys, JSONB-friendly types).
// Run: npx tsx scripts/dump-competitors-seed-json.ts > /tmp/competitors_seed.json

import { COMPETITORS } from "../lib/seed";

function snake(c: (typeof COMPETITORS)[number]) {
  return {
    id: c.id,
    name: c.name,
    address: c.address,
    phone: c.phone ?? null,
    website: c.website ?? null,
    distance_miles: c.distanceMiles ?? null,
    units: c.units ?? 0,
    year_built: c.yearBuilt ?? null,
    building_class: c.buildingClass ?? null,
    occupancy_pct: c.occupancyPct ?? null,
    leased_pct: c.leasedPct ?? null,
    tours_last_week: c.toursLastWeek ?? null,
    leases_last_week: c.leasesLastWeek ?? null,
    unit_types: c.unitTypes ?? [],
    deposit: c.deposit ?? null,
    specials: c.specials ?? null,
    free_rent_weeks: c.freeRentWeeks ?? null,
    look_and_lease_bonus: c.lookAndLeaseBonus ?? null,
    parking_included: c.parkingIncluded ?? null,
    amenities: c.amenities ?? [],
    notes: c.notes ?? null,
    threat_level: c.threatLevel ?? null,
    comp_quality_score: c.compQualityScore ?? null,
    source_type: c.sourceType ?? null,
    source_url: c.sourceUrl ?? null,
    official_website_url: c.officialWebsiteUrl ?? null,
    apartments_url: c.apartmentsUrl ?? null,
    zillow_url: c.zillowUrl ?? null,
    zumper_url: c.zumperUrl ?? null,
    google_business_url: c.googleBusinessUrl ?? null,
    last_verified_at: c.lastVerifiedAt ?? null,
    verified_by: c.verifiedBy ?? null,
    data_confidence: c.dataConfidence ?? null,
    data_quality_flags: c.dataQualityFlags ?? null,
    alternate_address: c.alternateAddress ?? null,
    competitor_strategic_type: c.competitorStrategicType ?? null,
    competitor_tags: c.competitorTags ?? null,
    field_verified: c.fieldVerified ?? false,
    field_verified_at: c.fieldVerifiedAt ?? null,
    field_verified_by: c.fieldVerifiedBy ?? null,
    field_verification_confidence: c.fieldVerificationConfidence ?? null,
    amenity_threat_level: c.amenityThreatLevel ?? null,
    parking_threat_level: c.parkingThreatLevel ?? null,
    concession_threat_level: c.concessionThreatLevel ?? null,
    is_active: true,
    created_by: "seed_migration_sprint12",
  };
}

const rows = COMPETITORS.map(snake);
process.stdout.write(JSON.stringify(rows));
