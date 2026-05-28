// Canonical table name registry. Used by every service module so that
// future schema changes happen in one place.

export const TABLES = {
  // Sprint 12 — first-class competitors table (was: seed-only)
  competitors: "competitors",
  competitorFieldTours: "competitor_field_tours",
  competitorUnitObservations: "competitor_unit_observations",
  competitorAmenityObservations: "competitor_amenity_observations",
  photoEvidence: "photo_evidence",
  competitorSourceVerifications: "competitor_source_verifications",
  dataQualityFlags: "data_quality_flags",
  // Sprint 4.1
  auditLogs: "audit_logs",
  appTasks: "app_tasks",
  localPartnerships: "local_partnerships",
  // Sprint 5 trust layer
  dataSourceLedger: "data_source_ledger",
  manualCovariateScores: "manual_covariate_scores",
  sourceConflicts: "source_conflicts",
  manualVerificationQueue: "manual_verification_queue",
  // Sprint 9 — Recertification Command Center
  recertificationCases: "recertification_cases",
  recertHouseholdMembers: "recert_household_members",
  recertDocuments: "recert_documents",
  recertRequiredItems: "recert_required_items",
  recertIncomeSources: "recert_income_sources",
  recertAssetAccounts: "recert_asset_accounts",
  recertDepositReviews: "recert_deposit_reviews",
  recertUtilityAllowance: "recert_utility_allowance",
  recertAiReviews: "recert_ai_reviews",
  recertClarificationRequests: "recert_clarification_requests",
  recertAuditEvents: "recert_audit_events",
  // Sprint 19 — tenant roster (eligible / blocked list + lifecycle)
  recertTenantRoster: "recert_tenant_roster",
  recertCompletionSessions: "recert_completion_sessions",
} as const;

export type TableName = (typeof TABLES)[keyof typeof TABLES];
