// Canonical table name registry. Used by every service module so that
// future schema changes happen in one place.

export const TABLES = {
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
} as const;

export type TableName = (typeof TABLES)[keyof typeof TABLES];
