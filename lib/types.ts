// Core domain types for BaxterOps.
// Designed around the Baxter Competitive Intelligence + Recertification Command Center spec.

export type UnitType = "studio" | "1BR" | "2BR" | "3BR";
export type OccupancyStatus = "occupied" | "vacant" | "notice";
export type ProgramType = "conventional" | "affordable" | "section8" | "brilliant_corners" | "unknown";
export type ContactMethod = "email" | "sms" | "phone" | "in_person";

export interface Property {
  id: string;
  name: string;
  address: string;
  phone?: string;
  website?: string;
  units: number;
  yearBuilt?: number;
  isBaxter?: boolean;
}

export interface UnitCovariates {
  bedroomWindow?: boolean;
  patio?: boolean;
  sideYard?: boolean;
  den?: boolean;
  walkInCloset?: 0 | 1 | 2 | 3 | 4 | 5;
  naturalLight?: 0 | 1 | 2 | 3 | 4 | 5;
  viewQuality?: 0 | 1 | 2 | 3 | 4 | 5;
  finishQuality?: 0 | 1 | 2 | 3 | 4 | 5;
  layoutQuality?: 0 | 1 | 2 | 3 | 4 | 5;
  noiseExposure?: 0 | 1 | 2 | 3 | 4 | 5; // higher = worse
  cornerUnit?: boolean;
  streetFacing?: boolean;
  washerDryer?: boolean;
  floorPremium?: number; // $ premium for higher floor
}

export interface PricingHistoryEntry {
  oldRent: number;
  newRent: number;
  reason: string;
  changedAt: string;
  changedBy: string;
}

export interface BaxterUnit {
  id: string;
  unitNumber: string;
  floor: number;
  type: UnitType;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  askingRent: number;
  previousAskingRent?: number;
  netEffectiveRent?: number;
  leaseTermMonths?: number;
  // concession schema (parity with competitor cards)
  concession?: string;
  concessionDescription?: string;
  weeksFree?: number;
  freeMonths?: number;
  leaseMonths?: number;
  lookAndLeaseBonus?: number;
  deposit?: number | string;
  applicationFee?: number;
  adminFee?: number;
  petFee?: number | string;
  parkingCost?: number | string;
  parkingIncluded?: boolean;
  utilitiesBilling?: string;
  pricingHistory?: PricingHistoryEntry[];
  occupancy: OccupancyStatus;
  vacantSince?: string;
  daysVacant?: number;
  program: ProgramType;
  covariates: UnitCovariates;
  strengths: string[];
  weaknesses: string[];
  notes?: string;
  suggestedAction?: string;
  confidence?: number; // 0-100
  photoCount?: number;
  dataQualityFlags?: string[]; // flag ids referencing DATA_QUALITY_FLAGS
}

export interface CompetitorUnitType {
  type: UnitType;
  minRent?: number;
  maxRent?: number;
  avgRent?: number;
  minSqft?: number;
  maxSqft?: number;
  avgSqft?: number;
}

export type CompSourceType =
  | "uploaded_market_comp_report"
  | "call_around"
  | "official_property_website"
  | "apartments_com"
  | "zillow"
  | "zumper"
  | "google_business"
  | "other_listing"
  | "field_tour"
  | "unverified";

export type DataConfidence = "high" | "medium" | "low" | "unknown";

export interface CompetitorProperty {
  id: string;
  name: string;
  address: string;
  phone?: string;
  website?: string;
  distanceMiles?: number;
  units: number;
  yearBuilt?: number;
  buildingClass?: "A" | "B" | "C";
  occupancyPct?: number; // 0..100
  leasedPct?: number;
  toursLastWeek?: number;
  leasesLastWeek?: number;
  unitTypes: CompetitorUnitType[];
  deposit?: string;
  specials?: string;
  freeRentWeeks?: number;
  lookAndLeaseBonus?: number;
  parkingIncluded?: boolean;
  amenities: string[];
  notes?: string;
  threatLevel?: 1 | 2 | 3 | 4 | 5;
  compQualityScore?: number; // 0..100
  // verification fields (Sprint 2). Optional in seed; defaulted in the loader.
  sourceType?: CompSourceType;
  sourceUrl?: string;
  officialWebsiteUrl?: string;
  apartmentsUrl?: string;
  zillowUrl?: string;
  zumperUrl?: string;
  googleBusinessUrl?: string;
  lastVerifiedAt?: string;
  verifiedBy?: string;
  dataConfidence?: DataConfidence;
  dataQualityFlags?: string[];
  // Sprint 3 — field-tour intelligence
  alternateAddress?: string;
  competitorStrategicType?: "premium_amenity_comp" | "value_comp" | "balanced_comp" | "luxury_high_end" | "unknown";
  competitorTags?: string[];
  fieldVerified?: boolean;
  fieldVerifiedAt?: string;
  fieldVerifiedBy?: string;
  fieldVerificationConfidence?: DataConfidence;
  amenityThreatLevel?: 1 | 2 | 3 | 4 | 5;
  parkingThreatLevel?: 1 | 2 | 3 | 4 | 5;
  concessionThreatLevel?: 1 | 2 | 3 | 4 | 5;
  // Sprint 10 — Smart threat classification (optional, loaded on demand)
  smartThreat?: SmartThreatScores;
}

// ---- Sprint 10 — Smart Competitive Threat System ----

/**
 * Classification labels for the 3-score smart threat system.
 * - direct_threat: same renter, same price band, active concession pressure
 * - partial_threat: overlapping renter segment but differentiated price or product
 * - premium_aspirational_comp: higher price/quality tier; learning value > direct threat
 * - budget_comp: undercuts Baxter on price; different (lower) product tier
 * - weak_threat: little price/product/segment overlap
 * - not_comparable_but_instructive: no meaningful comp basis but worth tracking
 */
export type CompetitorClassification =
  | "direct_threat"
  | "partial_threat"
  | "premium_aspirational_comp"
  | "budget_comp"
  | "weak_threat"
  | "not_comparable_but_instructive";

export interface SmartThreatScores {
  /** 0–5 — how likely this comp's renter would choose it over Baxter */
  directThreatScore: number;
  /** 0–5 — how good the in-person leasing experience and product quality are (requires field tour) */
  tourQualityScore: number | null;
  /** 0–5 — how much Baxter can learn / copy from this comp */
  learningScore: number;
  // directThreat sub-components (all 0–5)
  priceOverlapScore: number;
  productOverlapScore: number;
  renterSegmentOverlapScore: number;
  availabilityPressure: number;
  concessionPressure: number;
  // learningScore sub-components (all 0–5)
  amenityGapScore: number;
  serviceGapScore: number;
  unitQualityGap: number;
  marketingPresentationGap: number;
  renterExperienceGap: number;
  /** System-derived label */
  systemClassification: CompetitorClassification;
  /**
   * Sprint 13 — short, plain-language reasons that drove the scores/classification.
   * Used by /competitor-intelligence and CompareAgainstBaxterPanel to explain
   * "why this comp is a 2/5 direct threat" without forcing the reader to interpret raw sub-scores.
   */
  explanation?: string[];
  /**
   * Sprint 13 — action-oriented strings ("Add scent control", "Don't anchor rents to Jardine", etc.)
   * Derived from generateTakeaways(); kept on the score object so charts can rank them per competitor.
   */
  baxterTakeaways?: string[];
}

export interface CompetitorIntelligenceSummary extends SmartThreatScores {
  id: string;
  competitorId: string;
  /** Manager-set override — takes precedence over systemClassification in UI */
  manualClassification?: CompetitorClassification;
  manualClassificationReason?: string;
  manualClassificationSetBy?: string;
  manualClassificationSetAt?: string;
  summaryNotes?: string;
  lastComputedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompetitorTakeaway {
  id: string;
  competitorId: string;
  category: "amenity" | "service" | "marketing" | "pricing" | "unit_quality" | "experience" | "operations";
  takeawayTitle: string;
  takeawayDetail?: string;
  priority: 1 | 2 | 3 | 4 | 5;
  actionForBaxter?: string;
  status: "open" | "in_progress" | "implemented" | "dismissed";
  autoGenerated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CompMatch {
  baxterUnitId: string;
  competitorId: string;
  competitorUnitType: UnitType;
  similarity: number; // 0..100
  rentGap: number;
  percentRentGap: number;
  driverNotes: string[];
}

export interface RegressionEstimate {
  baxterUnitId: string;
  predictedRent: number;
  predictedNetEffective: number;
  askingRent: number;
  difference: number;
  flag: "overpriced" | "fair" | "underpriced";
  confidence: number;
  topDrivers: { feature: string; contribution: number }[];
  suggestedAction: string;
}

// Legacy/queue-only walkthrough entry (still used for the priority queue seed).
export interface WalkthroughTour {
  id: string;
  competitorId: string;
  assignedTo: "Bailey" | "Shane" | "Other";
  scheduledDate?: string;
  completedDate?: string;
  status: "queued" | "called" | "scheduled" | "completed" | "no_show";
  persona?: string;
  notes?: string;
  hiddenConcessions?: string;
  agentBehavior?: string;
  followUpReceived?: boolean;
  realRenterChoice?: "baxter" | "competitor" | "tied";
  realRenterReason?: string;
  photoCount?: number;
  priority: 1 | 2 | 3 | 4 | 5;
}

// Persisted post-tour record (Sprint 2)
export interface WalkthroughTourRecord {
  id: string;
  competitorId: string;
  competitorName: string;
  assignedTo: "Bailey" | "Shane" | "Other";
  tourDateTime: string;
  leasingAgentName?: string;
  tourBookingEase: number; // 1-5
  responseSpeedHours?: number;
  kindness: number;
  professionalism: number;
  cleanliness: number;
  tourQuality: number;
  buildingFirstImpression: string;
  unitFirstImpression: string;
  amenityQuality: number;
  drinksOrSnacksOffered: boolean;
  actualConcessions?: string;
  hiddenDiscounts?: string;
  parkingDeal?: string;
  feesWaivable?: boolean;
  moveInCost?: string;
  pressureLevel?: "low" | "medium" | "high";
  desperationVsConfidence?: number;
  closingStrength?: number;
  followUpPromised?: boolean;
  followUpReceived?: boolean;
  photoIds?: string[];
  wouldRenterChooseOverBaxter: boolean;
  whyOrWhyNot: string;
  baxterResponseRecommendation: string;
  compositeExperienceScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface MarketingSource {
  id: string;
  name: string;
  monthlyCost: number;
  leads: number;
  tours: number;
  applications: number;
  leases: number;
  notes?: string;
  recommendation?: string;
}

export interface Lead {
  id: string;
  name?: string;
  source: string;
  receivedDate: string;
  stage:
    | "lead"
    | "contacted"
    | "tour_scheduled"
    | "toured"
    | "applied"
    | "approved"
    | "lease_sent"
    | "lease_signed"
    | "lost";
  lostReason?: string;
  unitOfInterest?: string;
  notes?: string;
}

export interface Tenant {
  id: string;
  name: string;
  unitNumber: string;
  email?: string;
  phone?: string;
  preferredContact?: ContactMethod;
  language?: string;
  program: ProgramType;
  subsidyProvider?: string;
  moveInDate?: string;
  leaseEnd?: string;
  lastCertification?: string;
  nextCertificationDue?: string;
  status: RecertStatus;
  documentsRequested: string[];
  documentsReceived: string[];
  lastContacted?: string;
  contactAttempts: number;
  responseStatus?: "no_response" | "responded" | "in_progress" | "completed";
  notes?: string;
  privateNotes?: string;
  assignedStaff?: string;
  riskLevel?: "low" | "medium" | "high";
  tenantRentPortion?: number;
  subsidyPortion?: number;
  utilityAllowance?: number;
  actualRubs?: number;
  lahdMaxAllowed?: number;
}

export type RecertStatus =
  | "not_started"
  | "initial_drafted"
  | "initial_sent"
  | "waiting_response"
  | "responded"
  | "meeting_scheduled"
  | "docs_requested"
  | "partial_docs"
  | "all_docs"
  | "under_review"
  | "submitted_catherine"
  | "submitted_urban"
  | "approved"
  | "escalation";

export interface OutreachMessage {
  id: string;
  tenantId: string;
  channel: "email" | "sms" | "call_log";
  subject?: string;
  body: string;
  status: "draft" | "logged" | "sent";
  createdAt: string;
  templateKey?: string;
}

export interface PhotoAsset {
  id: string;
  propertyId: string;
  unitId?: string;
  category: string;
  caption?: string;
  qualityScore?: number;
  tags: string[];
  uploadedAt: string;
  url?: string;
}

export interface AmenityProfile {
  id: string;
  propertyId: string;
  amenity: string;
  present: boolean;
  qualityRating?: 0 | 1 | 2 | 3 | 4 | 5;
  marketingValue?: 0 | 1 | 2 | 3 | 4 | 5;
  notes?: string;
}

export interface UtilityAllowance {
  unitType: UnitType;
  studioAllowance?: number;
  oneBRAllowance?: number;
  twoBRAllowance?: number;
  lahdCap: number;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  category:
    | "market_comp"
    | "walkthrough"
    | "pricing"
    | "marketing"
    | "leasing"
    | "tenant_outreach"
    | "recertification"
    | "lahd"
    | "hacla"
    | "urban"
    | "utility"
    | "report"
    | "data_cleanup";
  owner: string;
  priority: 1 | 2 | 3 | 4 | 5;
  dueDate?: string;
  status: "open" | "in_progress" | "done";
  relatedUnitId?: string;
  relatedTenantId?: string;
  relatedCompetitorId?: string;
  notes?: string;
}

export interface MatchingWeights {
  bedrooms: number;
  sqft: number;
  distance: number;
  amenities: number;
  buildingClass: number;
  concessions: number;
  qualitative: number;
}

// ---- Sprint 2 additions ----

export type Role = "Admin" | "Manager" | "Leasing" | "Analyst" | "Viewer";

export interface MockUser {
  id: string;
  name: string;
  role: Role;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  role: Role;
  page: string;
  tenantId?: string;
  fieldType: string;
  action: "view" | "edit" | "redact";
}

export type PartnershipEntityType =
  | "hospital"
  | "performing_arts_school"
  | "film_school"
  | "entertainment_employer"
  | "university"
  | "production_studio"
  | "hospitality_employer"
  | "corporate_housing"
  | "referral_partner"
  | "other";

export type PartnershipIdea =
  | "preferred_employer_discount"
  | "relocation_referral"
  | "corporate_housing"
  | "housing_fair"
  | "flyer_drop"
  | "employee_housing_resource"
  | "student_housing_resource"
  | "other";

export type PartnershipStatus =
  | "not_contacted"
  | "researching"
  | "pitched"
  | "interested"
  | "declined"
  | "partnered";

export interface LocalPartnership {
  id: string;
  entityType: PartnershipEntityType;
  name: string;
  address?: string;
  website?: string;
  sourceUrl?: string;
  contactName?: string;
  contactRole?: string;
  email?: string;
  phone?: string;
  preferredMethod?: "email" | "phone" | "in_person" | "linkedin" | "unknown";
  partnershipIdea: PartnershipIdea;
  leadPotentialScore: number; // 1-5
  confidence: "unverified" | "needs_research" | "verified";
  status: PartnershipStatus;
  outreachDate?: string;
  nextFollowUp?: string;
  notes?: string;
  associatedTaskId?: string;
  createdAt: string;
  updatedAt: string;
}

export type FlagSeverity = "low" | "medium" | "high" | "critical";
export type FlagStatus = "open" | "acknowledged" | "fixed" | "needs_verification";

export interface DataQualityFlag {
  id: string;
  issue: string;
  affectedEntity: string;
  affectedEntityType: "competitor" | "baxter_unit" | "lead" | "tenant" | "marketing";
  severity: FlagSeverity;
  status: FlagStatus;
  notes?: string;
  createdAt: string;
}

// ===== Sprint 3 additions: field-tour ingestion =====

export type ConfidenceLevel = "high" | "medium" | "low" | "unknown";

export interface CompetitorFieldTour {
  id: string;
  competitorId: string;
  competitorName: string;
  tourDate: string;
  collectedBy: string;
  assignedTo: string;
  tourStatus: "planned" | "in_progress" | "completed" | "cancelled";
  sourceLabel: string;
  tourBookingEase?: number;
  responseSpeedHours?: number;
  kindness?: number;
  professionalism?: number;
  cleanliness?: number;
  tourQuality?: number;
  amenityQuality?: number;
  drinksOrSnacksOffered?: boolean;
  actualConcessions?: string;
  hiddenDiscounts?: string;
  parkingDeal?: string;
  feesWaivable?: boolean | null;
  moveInCost?: string;
  pressureLevel?: "low" | "medium" | "high";
  desperationVsConfidence?: number;
  closingStrength?: number;
  followUpPromised?: boolean | null;
  followUpReceived?: boolean | null;
  wouldRenterChooseOverBaxter?: boolean;
  whyOrWhyNot?: string;
  baxterResponseRecommendation?: string;
  compositeExperienceScore?: number;
  fieldConfidence: ConfidenceLevel;
  createdAt: string;
  updatedAt: string;
}

export interface CompetitorUnitObservation {
  id: string;
  competitorId: string;
  competitorName: string;
  fieldTourId: string;
  unitNumber: string;
  unitNumberConfidence: ConfidenceLevel;
  floor?: number;
  bedCount?: number;
  bathCount?: number;
  squareFeet?: number | null;
  askingRent?: number;
  grossRent?: number;
  effectiveRent13m1Free?: number;
  effectiveRent19m2Free?: number;
  effectiveRent13m1FreeLookAndLease?: number;
  effectiveRent19m2FreeLookAndLease?: number;
  lookAndLeaseBonus?: number;
  lookAndLeaseWindowHours?: number;
  leaseMonths?: number;
  freeMonths?: number;
  availabilityStatus?: "available" | "not_ready" | "leased" | "needs_verification" | "unknown";
  parkingIncluded?: boolean;
  valetIncluded?: boolean;
  parkingSpotsIncluded?: number;
  waterIncluded?: boolean;
  powerIncluded?: boolean;
  gasIncluded?: boolean;
  internetIncluded?: boolean;
  inUnitLaundry?: boolean;
  balconyOrPatio?: boolean;
  smartThermostat?: boolean;
  notes?: string;
  sourceLabel: string;
  sourceDate?: string;
  sourceConfidence: ConfidenceLevel;
  needsVerification?: boolean;
  dataQualityFlags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CompetitorAmenityObservation {
  id: string;
  competitorId: string;
  competitorName: string;
  fieldTourId: string;
  amenity: string;
  observed: boolean;
  qualityScore?: number;
  notes?: string;
  photoEvidenceIds?: string[];
  sourceLabel: string;
  sourceDate?: string;
  sourceConfidence: ConfidenceLevel;
  createdAt: string;
  updatedAt: string;
}

export interface PhotoEvidenceRecord {
  id: string;
  competitorId: string;
  competitorName: string;
  fieldTourId: string;
  propertyId?: string;
  collectionId: string;
  photoOrder: number;
  originalFilename: string;
  storagePath?: string;
  publicUrl?: string;
  category: string;
  caption: string;
  relatedUnitNumber?: string;
  relatedAmenity?: string;
  observedStrengths?: string;
  observedWeaknesses?: string;
  marketingUsefulnessScore?: number;
  compEvidenceValueScore?: number;
  dataConfidence: ConfidenceLevel;
  sourceLabel: string;
  sourceDate?: string;
  uploadedBy: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CompetitorSourceVerification {
  id: string;
  competitorId: string;
  sourceType: string;
  sourceUrl: string;
  sourceName: string;
  verifiedAt?: string;
  verifiedBy?: string;
  verificationStatus: "verified" | "partial" | "needs_review" | "needs_verification" | "rejected";
  fieldsVerified: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ===== Sprint 5 — trust layer =====

export type LedgerVerificationStatus =
  | "verified" | "partial" | "needs_review" | "needs_verification" | "unverified" | "stale" | "conflicting_sources";

export type LedgerEntryMethod =
  | "manual_user_entry" | "imported_pdf" | "imported_csv" | "imported_from_seed"
  | "computed_formula" | "public_source_entry" | "field_tour_entry" | "api_sync";

export interface DataSourceLedgerRow {
  id: string;
  entityType: string;
  entityId: string;
  entityName?: string;
  fieldKey: string;
  fieldLabel?: string;
  fieldCategory: string;
  valueType: string;
  valueNumber?: number;
  valueText?: string;
  valueBoolean?: boolean;
  valueJson?: unknown;
  unit?: string;
  displayValue?: string;
  pageRoutes?: string[];
  sourceType: string;
  sourceName?: string;
  sourceUrl?: string;
  sourceNote?: string;
  sourceDate?: string;
  collectedBy?: string;
  lastVerifiedAt?: string;
  verifiedBy?: string;
  verificationStatus: LedgerVerificationStatus;
  confidence: "high" | "medium" | "low" | "unknown";
  entryMethod: LedgerEntryMethod;
  isComputed?: boolean;
  formula?: string;
  dependsOn?: string[];
  staleAfterDays?: number;
  isStale?: boolean;
  requiresManualVerification?: boolean;
  sensitive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ManualCovariateScore {
  id: string;
  entityType: string;
  entityId: string;
  entityName?: string;
  fieldTourId?: string;
  competitorId?: string;
  competitorName?: string;
  unitId?: string;
  unitNumber?: string;
  covariateKey: string;
  covariateLabel?: string;
  covariateCategory: string;
  scoreType: "boolean" | "rating_1_5" | "rating_1_10" | "text" | "enum" | "numeric";
  scoreValueNumber?: number;
  scoreValueBoolean?: boolean;
  scoreValueText?: string;
  scaleMin?: number;
  scaleMax?: number;
  rubricVersion?: string;
  rubricDescription?: string;
  scoredBy?: string;
  scoredAt?: string;
  confidence?: "high" | "medium" | "low" | "unknown";
  notes?: string;
  photoEvidenceIds?: string[];
  sourceLabel?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SourceConflictRow {
  id: string;
  entityType: string;
  entityId: string;
  entityName?: string;
  fieldKey: string;
  conflictType: string;
  sourceALabel?: string; sourceAValue?: string; sourceAUrl?: string; sourceACollectedAt?: string;
  sourceBLabel?: string; sourceBValue?: string; sourceBUrl?: string; sourceBCollectedAt?: string;
  sourceCLabel?: string; sourceCValue?: string; sourceCUrl?: string;
  resolution?: string;
  resolvedValue?: string;
  status: "open" | "resolved" | "accept_a" | "accept_b" | "accept_c" | "needs_live_confirmation";
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ManualVerificationQueueRow {
  id: string;
  entityType: string;
  entityId: string;
  entityName?: string;
  fieldKey: string;
  fieldLabel?: string;
  expectedValue?: string;
  sourceType: string;
  sourceUrl?: string;
  reason?: string;
  status: "pending" | "in_progress" | "confirmed" | "rejected" | "needs_screenshot";
  manualEnteredValue?: string;
  manualScreenshotPath?: string;
  manualNotes?: string;
  enteredBy?: string;
  enteredAt?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ===== Sprint 9 — Recertification Command Center =====

export type RecertCertType = "initial" | "annual" | "move_in" | "correction";

export type RecertCaseStatus =
  | "not_started" | "tenant_request_sent" | "waiting_on_tenant"
  | "documents_uploaded" | "ai_review_needed" | "missing_items"
  | "clarification_needed" | "manager_calculation_review"
  | "ready_to_submit" | "submitted" | "approved"
  | "corrections_needed" | "closed_ineligible";

export type RecertIncomeStatus = "pending" | "eligible" | "over_income" | "needs_review";
export type RecertRentStatus = "pending" | "compliant" | "non_compliant" | "needs_review";
export type RecertSubsidyStatus = "none" | "rfta_pending" | "hacla_determination_pending" | "final_determination_received";
export type RecertRiskLevel = "low" | "medium" | "high" | "critical";

export interface RecertificationCase {
  id: string;
  tenantHouseholdId?: string;
  primaryTenantName: string;
  primaryTenantEmail?: string;
  primaryTenantPhone?: string;
  propertyId: string;
  propertyName: string;
  unitId?: string;
  unitNumber?: string;
  certificationType: RecertCertType;
  caseStatus: RecertCaseStatus;
  dueDate?: string;
  moveInOrRenewalDate?: string;
  householdSize?: number;
  adultCount: number;
  childCount: number;
  bedroomCount?: number;
  restrictedUnitSchedule?: string;
  maxIncomeLimit?: number;
  maxAllowableRent?: number;
  proposedTenantRent?: number;
  subsidyAmount?: number;
  subsidyStatus: RecertSubsidyStatus;
  utilityAllowanceRequired: boolean;
  totalUtilityAllowance?: number;
  calculatedTenantRentLimit?: number;
  incomeStatus: RecertIncomeStatus;
  rentStatus: RecertRentStatus;
  readinessScore: number;
  missingItemsCount: number;
  lastTenantContactAt?: string;
  nextAction?: string;
  riskLevel: RecertRiskLevel;
  submittedAt?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
}

export interface RecertHouseholdMember {
  id: string;
  caseId: string;
  fullName: string;
  email?: string;
  phone?: string;
  isAdult: boolean;
  relationshipToHead?: string;
  ticqCompleted?: boolean;
  ticqSigned?: boolean;
  applicantStatementSigned?: boolean;
  conflictOfInterestSigned?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RecertDocumentType =
  | "ticq" | "pay_stub" | "bank_statement" | "asset_statement"
  | "benefit_letter" | "social_security_award_letter" | "unemployment_document"
  | "self_employment_document" | "voe" | "applicant_statement"
  | "conflict_of_interest" | "asset_certification" | "clarification"
  | "rent_determination" | "utility_allowance_table" | "covenant"
  | "rent_schedule"
  | "tax_return" | "irs_non_filing" | "pension_retirement" | "public_assistance"
  | "child_support" | "alimony" | "recurring_income" | "real_estate"
  | "investment_statement"
  | "other";

export interface RecertDocument {
  id: string;
  caseId: string;
  householdMemberId?: string;
  documentType: RecertDocumentType;
  fileName?: string;
  fileUrl?: string;
  storagePath?: string;
  uploadedBy?: string;
  uploadedAt?: string;
  statementStartDate?: string;
  statementEndDate?: string;
  pageCount?: number;
  expectedPageCount?: number;
  allPagesPresent?: boolean;
  aiClassificationStatus?: string;
  verificationStatus: "pending" | "accepted" | "needs_clarification" | "rejected";
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type RecertRequirementScope =
  | "household" | "adult_member" | "income_source" | "asset_account" | "subsidy" | "utility_allowance";

export type RecertRequirementStatus =
  | "not_started" | "requested" | "uploaded" | "reviewed"
  | "complete" | "missing" | "needs_clarification" | "not_applicable";

export interface RecertRequiredItem {
  id: string;
  caseId: string;
  householdMemberId?: string;
  requirementKey: string;
  requirementLabel: string;
  requirementScope: RecertRequirementScope;
  status: RecertRequirementStatus;
  dueDate?: string;
  sourceReason?: string;
  createdAt: string;
  updatedAt: string;
}

export type RecertIncomeType =
  | "employment" | "self_employment" | "business" | "social_security"
  | "unemployment" | "child_support" | "other_recurring";

export interface RecertIncomeSource {
  id: string;
  caseId: string;
  householdMemberId?: string;
  incomeType: RecertIncomeType;
  employerOrSourceName?: string;
  disclosedOnTicq: boolean;
  documentationReceived: boolean;
  payFrequency?: string;
  hourlyRate?: number;
  hoursPerWeek?: number;
  averagePaycheckGross?: number;
  paychecksPerYear?: number;
  ytdGrossPay?: number;
  ytdPeriodStart?: string;
  ytdPeriodEnd?: string;
  voeYtdGross?: number;
  calculationAveragePaycheck?: number;
  calculationYtdPaystub?: number;
  calculationHourly?: number;
  calculationVoeYtd?: number;
  requiredProjectedIncome?: number;
  selectedMethod?: string;
  managerApproved: boolean;
  managerApprovedBy?: string;
  managerApprovedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecertAssetAccount {
  id: string;
  caseId: string;
  householdMemberId?: string;
  accountType?: string;
  institutionName?: string;
  accountLastFour?: string;
  endingBalance: number;
  negativeBalanceTreatedAsZero: boolean;
  interestRate?: number;
  interestRateKnown: boolean;
  actualAssetIncome?: number;
  imputedAssetIncome?: number;
  incomeUsed?: number;
  statementReceived: boolean;
  allPagesReceived: boolean;
  depositsReviewed: boolean;
  unclearDepositsCount: number;
  recurringDepositsCount: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecertDepositReview {
  id: string;
  caseId: string;
  assetAccountId?: string;
  depositDate?: string;
  depositAmount?: number;
  depositDescription?: string;
  recurring: boolean;
  largeDeposit: boolean;
  suspectedSource?: string;
  disclosedIncomeSourceId?: string;
  documentationStatus: "documented" | "needs_clarification" | "clarified" | "ignored";
  clarificationText?: string;
  tenantResponseReceived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RecertUtilityAllowance {
  id: string;
  caseId: string;
  covenantExecutionDate?: string;
  applies?: boolean;
  appliesReason?: string;
  maxAllowableRent?: number;
  tenantPaysBasicElectricity: boolean;
  tenantPaysTrash: boolean;
  tenantPaysGas: boolean;
  tenantPaysWater: boolean;
  tenantPaysSewer: boolean;
  tenantPaysOther: boolean;
  ownerProvidesRefrigerator: boolean;
  ownerProvidesStove: boolean;
  scepFeeApplies: boolean;
  rsoFeeApplies: boolean;
  allowanceBasicElectricity: number;
  allowanceTrash: number;
  allowanceGas: number;
  allowanceWater: number;
  allowanceSewer: number;
  allowanceScep: number;
  allowanceRso: number;
  totalUtilityAllowance?: number;
  finalTenantRentLimit?: number;
  proposedTenantRent?: number;
  compliant?: boolean;
  needsReview: boolean;
  sourceTableYear?: number;
  sourceStatus?: string;
  createdAt: string;
  updatedAt: string;
}

export type RecertAiReviewStatus = "not_run" | "running" | "ready" | "not_ready" | "error";

export interface RecertAiReviewIssue {
  issue: string;
  why?: string;
  action?: string;
  linked?: string;
}

export interface RecertAiReview {
  id: string;
  caseId: string;
  reviewStatus: RecertAiReviewStatus;
  summary?: string;
  issuesJson: RecertAiReviewIssue[];
  missingItemsJson: unknown[];
  unexplainedDepositsJson: unknown[];
  signatureIssuesJson: unknown[];
  incomeDocumentIssuesJson: unknown[];
  assetIssuesJson: unknown[];
  recommendedNextAction?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecertClarificationRequest {
  id: string;
  caseId: string;
  tenantEmail?: string;
  messageBody?: string;
  issuesJson: unknown[];
  sentAt?: string;
  responseReceivedAt?: string;
  status: "draft" | "sent" | "responded" | "resolved" | "overdue";
  createdAt: string;
  updatedAt: string;
}

export interface RecertAuditEvent {
  id: string;
  caseId: string;
  eventType: string;
  eventSummary?: string;
  actorUserId?: string;
  actorEmail?: string;
  eventPayloadJson?: Record<string, unknown>;
  createdAt: string;
}
