// Sprint 14: Recertification HTML packet generator.
//
// Builds a structured packet model from a recertification case + its child
// rows (members, income, assets, utility allowance, deposit reviews, etc.).
// The packet renders as HTML on /recertification/[caseId]/packet for iPad
// signing — NOT as a PDF. PDF is an optional browser-print output.
//
// Compliance posture: this is an INTERNAL workflow tool. It is not an
// official LAHD/Urban Futures e-signature system. Manager review is always
// required before submission. Field labels map loosely to the LAHD packet
// structure based on the official PDF table of contents; no specific form
// version is reproduced verbatim until Bailey provides authoritative field
// mappings.

import { getSupabase } from "@/lib/supabase/client";
import {
  getCaseById,
  getMembersForCase,
  getIncomeSourcesForCase,
  getAssetAccountsForCase,
  getDepositReviewsForCase,
  getUtilityAllowanceForCase,
  getRequiredItemsForCase,
} from "./recertification";
import type {
  RecertificationCase,
  RecertHouseholdMember,
  RecertIncomeSource,
  RecertAssetAccount,
  RecertUtilityAllowance,
} from "@/lib/types";

// ---------- Packet model types ----------

export type PacketFieldStatus =
  | "prefilled"        // BaxterOps filled this from case data
  | "missing"          // Required but blank — tenant/manager must complete
  | "needs_review"     // Manager should double-check
  | "not_applicable"   // Field doesn't apply to this case
  | "pending";         // Awaiting external data (e.g. HACLA rent determination)

export type PacketFilledBy =
  | "baxterops"
  | "tenant"
  | "manager"
  | "owner"
  | "unknown";

export type PacketFieldType =
  | "text"
  | "number"
  | "money"
  | "date"
  | "yesno"
  | "tristate"      // yes / no / unknown
  | "checkbox"
  | "longtext"
  | "initial";      // small box for initials

export interface PacketField {
  key: string;
  label: string;
  /** Internal-label-only — do NOT claim this is the exact official LAHD field name unless mapping provided. */
  officialLabelHint?: string;
  type: PacketFieldType;
  value: string | number | boolean | null;
  required: boolean;
  status: PacketFieldStatus;
  filledBy: PacketFilledBy;
  /** Free-text source/notes shown beneath the field. */
  source?: string;
  /** Specific household member this field belongs to, if any. */
  householdMemberId?: string;
}

export interface PacketSignatureSlot {
  key: string;
  label: string;
  signerRole: "tenant" | "manager" | "owner";
  /** Which adult should sign this slot, if applicable. */
  householdMemberId?: string;
  signerName?: string;
  signed: boolean;
  /** Data URL of the saved signature image, if any. */
  signatureDataUrl?: string;
  signedAt?: string;
}

export interface PacketSection {
  sectionKey: string;
  title: string;
  description?: string;
  fields: PacketField[];
  signatures: PacketSignatureSlot[];
}

export interface PacketReadiness {
  totalRequired: number;
  completedRequired: number;
  totalSignatures: number;
  completedSignatures: number;
  /** 0-100 */
  percent: number;
  blockers: string[];
}

export interface PacketModel {
  caseId: string;
  packetId: string;
  generatedAt: string;
  caseSummary: {
    primaryTenantName: string;
    propertyName: string;
    propertyAddress?: string;
    unitNumber?: string;
    unitSquareFeet?: number;
    bedroomCount?: number;
    moveInDate?: string;
    certificationType?: string;
    maxIncomeLimit?: number;
    maxAllowableRent?: number;
    proposedTenantRent?: number;
    subsidyAmount?: number;
    subsidyStatus?: string;
    utilityAllowanceRequired?: boolean;
    totalUtilityAllowance?: number;
    totalHouseholdIncome?: number;
    adultCount: number;
    childCount: number;
  };
  sections: PacketSection[];
  readiness: PacketReadiness;
  /**
   * Compliance footnote — every consumer should display this verbatim so we
   * don't mistakenly claim this is an official LAHD e-signature system.
   */
  complianceNote: string;
}

// ---------- Helpers ----------

function classifyField(value: unknown, required: boolean, pending = false): { value: string | number | boolean | null; status: PacketFieldStatus; filledBy: PacketFilledBy } {
  if (pending) return { value: null, status: "pending", filledBy: "unknown" };
  if (value === null || value === undefined || value === "") {
    return { value: null, status: required ? "missing" : "not_applicable", filledBy: required ? "unknown" : "unknown" };
  }
  return { value: value as string | number | boolean, status: "prefilled", filledBy: "baxterops" };
}

function pacField(
  key: string,
  label: string,
  type: PacketFieldType,
  rawValue: unknown,
  opts: { required?: boolean; officialLabelHint?: string; householdMemberId?: string; pending?: boolean; source?: string } = {},
): PacketField {
  const required = opts.required ?? false;
  const { value, status, filledBy } = classifyField(rawValue, required, opts.pending);
  return {
    key,
    label,
    type,
    value,
    required,
    status,
    filledBy,
    officialLabelHint: opts.officialLabelHint,
    householdMemberId: opts.householdMemberId,
    source: opts.source,
  };
}

// ---------- Section builders ----------

function buildCoverSection(c: RecertificationCase, members: RecertHouseholdMember[], totalIncome: number | null): PacketSection {
  const adults = members.filter(m => m.isAdult);
  const fields: PacketField[] = [
    pacField("project_name", "Project / Property Name", "text", c.propertyName, { required: true, officialLabelHint: "Project Name", source: "Recert case" }),
    pacField("property_address", "Property Address", "text", null /* derive in UI from property table if needed */, { required: true }),
    pacField("unit_number", "Unit Number", "text", c.unitNumber, { required: true }),
    pacField("unit_sqft", "Unit Square Footage", "number", null, { required: false, source: "Manager-provided if known" }),
    pacField("bedroom_count", "Number of Bedrooms", "number", c.bedroomCount, { required: true }),
    pacField("move_in_date", "Move-in / Renewal Date", "date", c.moveInOrRenewalDate, { required: true }),
    pacField("certification_type", "Certification Type", "text", c.certificationType, { required: true }),
    pacField("adult_count", "Number of Adults (over 18)", "number", c.adultCount, { required: true }),
    pacField("child_count", "Number of Children (under 18)", "number", c.childCount, { required: true }),
    pacField("max_income_limit", "Maximum Allowable Income", "money", c.maxIncomeLimit, { required: true }),
    pacField("max_allowable_rent", "Maximum Allowable Rent", "money", c.maxAllowableRent, { required: true }),
    pacField("total_annual_household_income", "Total Annual Household Income", "money", totalIncome ?? null, { required: true, source: "Sum of recert_income_sources" }),
    pacField("utility_allowance_required", "Utility Allowance Required?", "yesno", c.utilityAllowanceRequired, { required: true }),
    pacField("total_utility_allowance", "Total Utility Allowance", "money", c.totalUtilityAllowance, { required: c.utilityAllowanceRequired }),
    pacField("tenant_portion_of_rent", "Tenant Portion of Rent", "money", c.proposedTenantRent, {
      required: true,
      pending: c.subsidyStatus === "hacla_determination_pending",
      source: c.subsidyStatus === "hacla_determination_pending" ? "Pending HACLA final determination" : undefined,
    }),
    pacField("subsidy_amount", "Subsidy Amount (HACLA / HCV)", "money", c.subsidyAmount, {
      required: false,
      pending: c.subsidyStatus === "hacla_determination_pending",
    }),
    pacField("subsidy_status", "Subsidy Status", "text", c.subsidyStatus, { required: false }),
  ];

  // Adult name fields for cover summary
  for (let i = 0; i < Math.max(adults.length, 1); i++) {
    const m = adults[i];
    fields.push(
      pacField(`hh_member_${i + 1}_name`, `Household Member #${i + 1}`, "text", m?.fullName ?? null, {
        required: i === 0,
        householdMemberId: m?.id,
      }),
    );
  }

  return {
    sectionKey: "cover",
    title: "Package Cover / Case Summary",
    description: "Request for Income Certification — top-level case identification. Pre-filled from BaxterOps case record.",
    fields,
    signatures: [
      {
        key: "owner_request_signature",
        label: "Owner / Duly Authorized Agent Signature",
        signerRole: "manager",
        signed: false,
      },
    ],
  };
}

function buildTicqSectionForAdult(adult: RecertHouseholdMember, incomeSources: RecertIncomeSource[], assets: RecertAssetAccount[]): PacketSection {
  const myIncome = incomeSources.filter(s => s.householdMemberId === adult.id);
  const myAssets = assets.filter(a => a.householdMemberId === adult.id);

  // The official TICQ asks a series of yes/no questions about income + asset
  // sources. We mirror the conceptual structure. Pre-fill "yes" if we already
  // have a corresponding income source / asset on record; leave others blank.
  const hasIncome = (kw: string) =>
    myIncome.some(s => (s.incomeType ?? "").toLowerCase().includes(kw) || (s.notes ?? "").toLowerCase().includes(kw)) ? true : null;
  const hasAsset = (kw: string) =>
    myAssets.some(a => (a.accountType ?? "").toLowerCase().includes(kw) || (a.institutionName ?? "").toLowerCase().includes(kw)) ? true : null;

  const fields: PacketField[] = [
    pacField("ticq_name", "Adult Household Member Name", "text", adult.fullName, { required: true, householdMemberId: adult.id }),
    // Income questions
    pacField("ticq_employment", "Do you have employment income?", "tristate", hasIncome("employ") || hasIncome("wage") || hasIncome("salary"), { required: true, householdMemberId: adult.id }),
    pacField("ticq_self_employment", "Self-employment / 1099 income?", "tristate", hasIncome("self") || hasIncome("1099"), { required: true, householdMemberId: adult.id }),
    pacField("ticq_business", "Business income?", "tristate", hasIncome("business"), { required: true, householdMemberId: adult.id }),
    pacField("ticq_social_security", "Social Security / SSI / SSDI?", "tristate", hasIncome("social") || hasIncome("ssi") || hasIncome("ssdi"), { required: true, householdMemberId: adult.id }),
    pacField("ticq_unemployment", "Unemployment / EDD?", "tristate", hasIncome("unemploy"), { required: true, householdMemberId: adult.id }),
    pacField("ticq_child_support", "Child support / alimony received?", "tristate", hasIncome("child") || hasIncome("alimony"), { required: true, householdMemberId: adult.id }),
    pacField("ticq_recurring_deposits", "Recurring deposits not yet documented?", "tristate", null, { required: true, householdMemberId: adult.id, source: "Tenant must declare" }),
    // Asset questions
    pacField("ticq_checking_savings", "Checking / savings accounts?", "tristate", hasAsset("check") || hasAsset("saving") || hasAsset("bank"), { required: true, householdMemberId: adult.id }),
    pacField("ticq_paypal_venmo_cashapp_zelle", "PayPal / Venmo / CashApp / Zelle balances?", "tristate", hasAsset("paypal") || hasAsset("venmo") || hasAsset("cash") || hasAsset("zelle"), { required: true, householdMemberId: adult.id }),
    pacField("ticq_other_assets", "Other assets / investments (stocks, CDs, real estate)?", "tristate", hasAsset("invest") || hasAsset("stock") || hasAsset("cd") || hasAsset("real"), { required: true, householdMemberId: adult.id }),
    pacField("ticq_other_income", "Any other source of income not listed above?", "longtext", null, { required: true, householdMemberId: adult.id, source: "Tenant must declare" }),
    pacField("ticq_date_signed", "Date Signed", "date", null, { required: true, householdMemberId: adult.id }),
  ];

  return {
    sectionKey: `ticq_${adult.id}`,
    title: `TICQ — ${adult.fullName}`,
    description: `Tenant Income Certification Questionnaire for ${adult.fullName}. Each adult household member must complete and sign their own TICQ.`,
    fields,
    signatures: [
      {
        key: `ticq_signature_${adult.id}`,
        label: `${adult.fullName} — Tenant Signature`,
        signerRole: "tenant",
        householdMemberId: adult.id,
        signerName: adult.fullName,
        signed: !!adult.ticqSigned,
      },
    ],
  };
}

function buildTircSection(c: RecertificationCase, members: RecertHouseholdMember[], incomeSources: RecertIncomeSource[], assets: RecertAssetAccount[], totalIncome: number | null): PacketSection {
  const adults = members.filter(m => m.isAdult);
  const haclaPending = c.subsidyStatus === "hacla_determination_pending";

  const fields: PacketField[] = [
    pacField("tirc_property_name", "Project Name", "text", c.propertyName, { required: true }),
    pacField("tirc_unit_number", "Unit Number", "text", c.unitNumber, { required: true }),
    pacField("tirc_household_size", "Household Size", "number", c.householdSize ?? adults.length + c.childCount, { required: true }),
    pacField("tirc_total_household_income", "Total Annual Household Income (sum)", "money", totalIncome ?? null, { required: true }),
    pacField("tirc_total_asset_balance", "Total Asset Balance", "money", assets.reduce((s, a) => s + (a.endingBalance ?? 0), 0) || null, { required: false }),
    pacField("tirc_max_allowable_rent", "Maximum Allowable Rent (MAR)", "money", c.maxAllowableRent, { required: true }),
    pacField("tirc_utility_allowance", "Required Utility Allowance", "money", c.totalUtilityAllowance, { required: c.utilityAllowanceRequired }),
    pacField("tirc_tenant_portion", "Tenant Portion of Rent", "money", c.proposedTenantRent, {
      required: true,
      pending: haclaPending,
      source: haclaPending ? "Blank while HACLA final rent determination is pending. Upload determination when received." : undefined,
    }),
    pacField("tirc_subsidy_amount", "Subsidy Amount", "money", c.subsidyAmount, {
      required: false,
      pending: haclaPending,
    }),
    pacField("tirc_manager_calc_reviewed", "Manager Income Calculation Reviewed", "yesno", null, { required: true, source: "Manager confirms calculation in BaxterOps before submission" }),
  ];

  // List household members (read-only summary)
  for (const m of members) {
    fields.push(
      pacField(`tirc_member_${m.id}_name`, `Household Member — ${m.isAdult ? "Adult" : "Minor"}`, "text", m.fullName, {
        required: true,
        householdMemberId: m.id,
      }),
    );
  }

  // Per-adult income summary
  for (const a of adults) {
    const myTotal = incomeSources.filter(s => s.householdMemberId === a.id).reduce((s, x) => s + (x.requiredProjectedIncome ?? 0), 0);
    fields.push(
      pacField(`tirc_income_${a.id}`, `${a.fullName} — annual income (sum)`, "money", myTotal || null, {
        required: true,
        householdMemberId: a.id,
      }),
    );
  }

  return {
    sectionKey: "tirc",
    title: "Tenant Income and Rent Certification (TIRC)",
    description: "Household income + rent eligibility summary. Each adult and the owner/duly authorized agent must sign.",
    fields,
    signatures: [
      ...adults.map<PacketSignatureSlot>(a => ({
        key: `tirc_signature_${a.id}`,
        label: `${a.fullName} — Tenant Signature`,
        signerRole: "tenant",
        householdMemberId: a.id,
        signerName: a.fullName,
        signed: false,
      })),
      {
        key: "tirc_signature_owner",
        label: "Owner / Duly Authorized Agent Signature",
        signerRole: "manager",
        signed: false,
      },
    ],
  };
}

function buildApplicantStatementSection(adults: RecertHouseholdMember[]): PacketSection {
  // Each adult initials a few statements + signs. We surface the structure
  // without copying the official statement language — Bailey can paste the
  // official language into the UI later, or we leave the labels generic.
  const fields: PacketField[] = [];
  for (const a of adults) {
    fields.push(
      pacField(`as_${a.id}_initials_1`, `${a.fullName} — Initials: Income / asset accuracy`, "initial", null, { required: true, householdMemberId: a.id }),
      pacField(`as_${a.id}_initials_2`, `${a.fullName} — Initials: Penalty of perjury acknowledgement`, "initial", null, { required: true, householdMemberId: a.id }),
      pacField(`as_${a.id}_initials_3`, `${a.fullName} — Initials: Authorization to verify`, "initial", null, { required: true, householdMemberId: a.id }),
      pacField(`as_${a.id}_date`, `${a.fullName} — Date`, "date", null, { required: true, householdMemberId: a.id }),
    );
  }
  return {
    sectionKey: "applicant_statement",
    title: "Applicant and Owner / Duly Authorized Agent Statement",
    description: "Each adult initials each statement and signs. Owner/manager countersigns.",
    fields,
    signatures: [
      ...adults.map<PacketSignatureSlot>(a => ({
        key: `as_signature_${a.id}`,
        label: `${a.fullName} — Applicant Signature`,
        signerRole: "tenant",
        householdMemberId: a.id,
        signerName: a.fullName,
        signed: !!a.applicantStatementSigned,
      })),
      {
        key: "as_signature_owner",
        label: "Owner / Manager Signature",
        signerRole: "manager",
        signed: false,
      },
    ],
  };
}

function buildConflictOfInterestSection(adults: RecertHouseholdMember[]): PacketSection {
  const fields: PacketField[] = [];
  for (const a of adults) {
    fields.push(
      pacField(`coi_${a.id}_initials_1`, `${a.fullName} — Initials: Not related to owner`, "initial", null, { required: true, householdMemberId: a.id }),
      pacField(`coi_${a.id}_initials_2`, `${a.fullName} — Initials: No undisclosed business relationship`, "initial", null, { required: true, householdMemberId: a.id }),
      pacField(`coi_${a.id}_initials_3`, `${a.fullName} — Initials: Penalty of perjury`, "initial", null, { required: true, householdMemberId: a.id }),
      pacField(`coi_${a.id}_date`, `${a.fullName} — Date`, "date", null, { required: true, householdMemberId: a.id }),
    );
  }
  return {
    sectionKey: "conflict_of_interest",
    title: "Conflict of Interest Statement",
    description: "Each adult initials the three statements, signs, and dates. Owner/manager countersigns.",
    fields,
    signatures: [
      ...adults.map<PacketSignatureSlot>(a => ({
        key: `coi_signature_${a.id}`,
        label: `${a.fullName} — Tenant Signature`,
        signerRole: "tenant",
        householdMemberId: a.id,
        signerName: a.fullName,
        signed: !!a.conflictOfInterestSigned,
      })),
      {
        key: "coi_signature_owner",
        label: "Owner / Manager Signature",
        signerRole: "manager",
        signed: false,
      },
    ],
  };
}

function buildAssetCertificationSection(adults: RecertHouseholdMember[], assets: RecertAssetAccount[]): PacketSection {
  const fields: PacketField[] = [];
  const totalAssets = assets.reduce((s, a) => s + (a.endingBalance ?? 0), 0);
  fields.push(
    pacField("asset_total_balance", "Total Asset Balance (all accounts)", "money", totalAssets || null, { required: true, source: "Sum of recert_asset_accounts.ending_balance" }),
    pacField("asset_threshold_triggered", "$5,000 imputed-asset-income threshold triggered?", "yesno", totalAssets >= 5000 ? true : totalAssets > 0 ? false : null, { required: true, source: "Triggered when total assets ≥ $5,000" }),
    pacField("asset_hud_passbook_rate_pct", "HUD passbook rate (%)", "number", 0.06, { required: true, source: "HUD-published rate" }),
    pacField("asset_total_actual_income", "Total actual income from assets", "money", assets.reduce((s, a) => s + (a.actualAssetIncome ?? 0), 0) || null, { required: false }),
    pacField("asset_total_imputed_income", "Total imputed income from assets", "money", assets.reduce((s, a) => s + (a.imputedAssetIncome ?? 0), 0) || null, { required: false }),
    pacField("asset_income_used", "Asset income used in TIRC", "money", null, { required: true, source: "Greater of actual or imputed when threshold triggered" }),
  );
  for (const acct of assets) {
    const member = adults.find(a => a.id === acct.householdMemberId);
    fields.push(
      pacField(`asset_${acct.id}_member`, `Account — household member`, "text", member?.fullName ?? null, { required: true, householdMemberId: acct.householdMemberId }),
      pacField(`asset_${acct.id}_institution`, `Account — institution`, "text", acct.institutionName, { required: true, householdMemberId: acct.householdMemberId }),
      pacField(`asset_${acct.id}_type`, `Account — type`, "text", acct.accountType, { required: true, householdMemberId: acct.householdMemberId }),
      pacField(`asset_${acct.id}_last4`, `Account — last 4 digits`, "text", acct.accountLastFour, { required: false, householdMemberId: acct.householdMemberId }),
      pacField(`asset_${acct.id}_balance`, `Account — ending balance`, "money", acct.endingBalance, { required: true, householdMemberId: acct.householdMemberId }),
    );
  }
  return {
    sectionKey: "asset_certification",
    title: "Asset Certification",
    description: "Per-account asset summary + total. Required for every adult household member with bank, investment, or similar accounts.",
    fields,
    signatures: adults.map<PacketSignatureSlot>(a => ({
      key: `asset_signature_${a.id}`,
      label: `${a.fullName} — Tenant Signature`,
      signerRole: "tenant",
      householdMemberId: a.id,
      signerName: a.fullName,
      signed: false,
    })),
  };
}

function buildVoeSection(adults: RecertHouseholdMember[], incomeSources: RecertIncomeSource[]): PacketSection | null {
  const employmentSources = incomeSources.filter(s => (s.incomeType ?? "").toLowerCase().includes("employ") || (s.incomeType ?? "").toLowerCase().includes("wage"));
  if (employmentSources.length === 0) return null;
  const fields: PacketField[] = [];
  for (const src of employmentSources) {
    const member = adults.find(a => a.id === src.householdMemberId);
    fields.push(
      pacField(`voe_${src.id}_employee`, "Employee / Tenant Name", "text", member?.fullName ?? null, { required: true, householdMemberId: src.householdMemberId }),
      pacField(`voe_${src.id}_employer`, "Employer / Source Name", "text", src.employerOrSourceName, { required: true, householdMemberId: src.householdMemberId }),
      pacField(`voe_${src.id}_date_sent`, "Date Sent to Employer", "date", null, { required: false, householdMemberId: src.householdMemberId, source: "Filled when VOE is mailed/emailed" }),
      pacField(`voe_${src.id}_status`, "VOE Status", "text", null, { required: true, householdMemberId: src.householdMemberId, source: "not_started / sent_to_employer / returned / complete" }),
    );
  }
  return {
    sectionKey: "voe",
    title: "Verification of Employment (Part 1)",
    description: "Owner/tenant complete Part 1; employer completes the rest and returns directly to property manager.",
    fields,
    signatures: [
      ...adults.map<PacketSignatureSlot>(a => ({
        key: `voe_signature_tenant_${a.id}`,
        label: `${a.fullName} — Authorization to Release`,
        signerRole: "tenant",
        householdMemberId: a.id,
        signerName: a.fullName,
        signed: false,
      })),
      {
        key: "voe_signature_owner",
        label: "Owner / Manager Signature",
        signerRole: "manager",
        signed: false,
      },
    ],
  };
}

function buildRecordOfVerificationSection(): PacketSection {
  // This section is a flexible journal of clarifications. Pre-fill nothing —
  // it's expected to be completed during tenant review.
  return {
    sectionKey: "record_of_verification",
    title: "Record of Verification / Clarification",
    description: "Use this section to document unclear deposits, large transactions, recurring payments, seasonal work, overtime, sporadic payments, bank-statement clarifications, and any other reviewer questions.",
    fields: [
      pacField("rov_issue_description", "Issue / question being clarified", "longtext", null, { required: false }),
      pacField("rov_tenant_explanation", "Tenant's written explanation", "longtext", null, { required: false }),
      pacField("rov_supporting_doc_needed", "Supporting document needed?", "yesno", null, { required: false }),
      pacField("rov_date", "Date", "date", null, { required: false }),
    ],
    signatures: [
      {
        key: "rov_signature_tenant",
        label: "Tenant Signature",
        signerRole: "tenant",
        signed: false,
      },
    ],
  };
}

function buildUtilityAllowanceSection(c: RecertificationCase, ua: RecertUtilityAllowance | undefined): PacketSection {
  const maxRent = c.maxAllowableRent ?? null;
  const total = ua?.totalUtilityAllowance ?? c.totalUtilityAllowance ?? null;
  const tenantLimit = maxRent !== null && total !== null ? maxRent - total : null;
  return {
    sectionKey: "utility_allowance",
    title: "Utility Allowance Worksheet",
    description: "Maximum allowable tenant rent = MAR − utility allowance. Use the LAHD-approved utility-allowance schedule effective on the covenant execution date.",
    fields: [
      pacField("ua_covenant_execution_date", "Covenant execution date", "date", ua?.covenantExecutionDate ?? null, { required: true }),
      pacField("ua_applies", "Utility allowance applies?", "yesno", c.utilityAllowanceRequired, { required: true }),
      pacField("ua_bedrooms", "Bedroom count", "number", c.bedroomCount, { required: true }),
      pacField("ua_max_allowable_rent", "Maximum allowable rent (MAR)", "money", maxRent, { required: true }),
      pacField("ua_tenant_paid_utilities", "Tenant-paid utilities (list)", "longtext", null, { required: false, source: "From RecertUtilityAllowance individual line items if present" }),
      pacField("ua_total_allowance", "Total utility allowance", "money", total, { required: c.utilityAllowanceRequired }),
      pacField("ua_final_tenant_rent_limit", "Final tenant rent limit (MAR − UA)", "money", tenantLimit, { required: true, source: "Auto-calculated" }),
    ],
    signatures: [
      {
        key: "ua_signature_manager",
        label: "Manager Verified",
        signerRole: "manager",
        signed: false,
      },
    ],
  };
}

function buildFinalChecklistSection(c: RecertificationCase, members: RecertHouseholdMember[], packetSections: PacketSection[]): PacketSection {
  const adults = members.filter(m => m.isAdult);
  const ticqSections = packetSections.filter(s => s.sectionKey.startsWith("ticq_"));
  const allAdultsHaveTicq = adults.length > 0 && adults.every(a => ticqSections.some(s => s.sectionKey === `ticq_${a.id}`));
  return {
    sectionKey: "final_checklist",
    title: "Final Submission Checklist",
    description: "Manager review required. All items must be ✓ before submitting to Urban Futures.",
    fields: [
      pacField("checklist_all_adults_ticq", "All adults have completed TICQ", "yesno", allAdultsHaveTicq, { required: true }),
      pacField("checklist_all_signatures", "All required signatures captured", "yesno", null, { required: true, source: "Computed from signature slots" }),
      pacField("checklist_income_docs_attached", "Income documents attached (pay stubs, tax returns, etc.)", "yesno", null, { required: true }),
      pacField("checklist_bank_statements_all_pages", "Bank statements all pages present", "yesno", null, { required: true }),
      pacField("checklist_asset_accounts_reviewed", "Asset accounts reviewed", "yesno", null, { required: true }),
      pacField("checklist_unexplained_deposits_clarified", "Unexplained deposits clarified", "yesno", null, { required: true }),
      pacField("checklist_income_calculated", "Income calculated", "yesno", null, { required: true }),
      pacField("checklist_manager_approved_calc", "Manager approved calculation", "yesno", null, { required: true }),
      pacField("checklist_utility_allowance_checked", "Utility allowance checked", "yesno", null, { required: true }),
      pacField("checklist_rent_compliant", "Rent compliant with limits", "yesno", null, { required: true }),
      pacField("checklist_subsidy_status_handled", "Subsidy status handled", "yesno", null, { required: true }),
      pacField("checklist_packet_ready", "Packet ready for Urban Futures submission", "yesno", null, { required: true, source: "Manager final acknowledgement" }),
    ],
    signatures: [
      {
        key: "final_signature_manager",
        label: "Manager Approval",
        signerRole: "manager",
        signed: false,
      },
    ],
  };
}

// ---------- Persisted overrides ----------

interface PersistedFieldValue {
  case_id: string;
  packet_id: string;
  section_key: string;
  field_key: string;
  value_text: string | null;
  value_json: Record<string, unknown> | null;
  filled_by_role: string | null;
  filled_by_name: string | null;
  status: string | null;
}
interface PersistedSignature {
  case_id: string;
  packet_id: string;
  section_key: string;
  household_member_id: string | null;
  signer_name: string | null;
  signer_role: string;
  signature_data_url: string;
  signed_at: string;
}

async function loadPersistedFieldValues(caseId: string, packetId: string): Promise<PersistedFieldValue[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.from("recert_packet_field_values")
    .select("*")
    .eq("case_id", caseId)
    .eq("packet_id", packetId);
  if (error) return [];
  return (data ?? []) as PersistedFieldValue[];
}

async function loadPersistedSignatures(caseId: string, packetId: string): Promise<PersistedSignature[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.from("recert_packet_signatures")
    .select("*")
    .eq("case_id", caseId)
    .eq("packet_id", packetId);
  if (error) return [];
  return (data ?? []) as PersistedSignature[];
}

// ---------- Public API ----------

/**
 * Build the complete iPad packet model for one recertification case.
 * Use this from /recertification/[caseId]/packet.
 */
export async function generateRecertPacketModel(caseId: string, packetId = "primary"): Promise<PacketModel | null> {
  const c = await getCaseById(caseId);
  if (!c) return null;

  const [members, incomeSources, assets, depositReviews, utilityAllowance, requiredItems, persisted, signatures] = await Promise.all([
    getMembersForCase(caseId),
    getIncomeSourcesForCase(caseId),
    getAssetAccountsForCase(caseId),
    getDepositReviewsForCase(caseId),
    getUtilityAllowanceForCase(caseId),
    getRequiredItemsForCase(caseId),
    loadPersistedFieldValues(caseId, packetId),
    loadPersistedSignatures(caseId, packetId),
  ]);
  void depositReviews; // surfaced via record_of_verification UI (manager-edited)
  void requiredItems;  // exposed via the existing /recertification/[caseId] Checklist tab

  const totalIncome =
    incomeSources.reduce((s, x) => s + (x.requiredProjectedIncome ?? 0), 0) || null;

  const adults = members.filter(m => m.isAdult);

  // Build sections
  const sections: PacketSection[] = [];
  sections.push(buildCoverSection(c, members, totalIncome));
  for (const a of adults) sections.push(buildTicqSectionForAdult(a, incomeSources, assets));
  sections.push(buildTircSection(c, members, incomeSources, assets, totalIncome));
  sections.push(buildApplicantStatementSection(adults));
  sections.push(buildConflictOfInterestSection(adults));
  sections.push(buildAssetCertificationSection(adults, assets));
  const voe = buildVoeSection(adults, incomeSources);
  if (voe) sections.push(voe);
  sections.push(buildRecordOfVerificationSection());
  sections.push(buildUtilityAllowanceSection(c, utilityAllowance));
  sections.push(buildFinalChecklistSection(c, members, sections));

  // Overlay persisted field values + signatures on top of the model.
  const persistedByKey = new Map<string, PersistedFieldValue>();
  for (const p of persisted) {
    persistedByKey.set(`${p.section_key}::${p.field_key}`, p);
  }
  const sigsByKey = new Map<string, PersistedSignature>();
  for (const s of signatures) {
    // unique slot key = section + role + member ('__none__' sentinel maps to "")
    const memberId = s.household_member_id === "__none__" ? "" : (s.household_member_id ?? "");
    const slotKey = `${s.section_key}::${s.signer_role}::${memberId}`;
    sigsByKey.set(slotKey, s);
  }

  for (const sec of sections) {
    for (const f of sec.fields) {
      const p = persistedByKey.get(`${sec.sectionKey}::${f.key}`);
      if (p) {
        // Persisted value wins. Mark status based on filledBy.
        const v = p.value_text ?? (p.value_json ? JSON.stringify(p.value_json) : null);
        f.value = v;
        f.status = (p.status as PacketFieldStatus) ?? (v ? "prefilled" : f.status);
        if (p.filled_by_role === "tenant") f.filledBy = "tenant";
        else if (p.filled_by_role === "manager") f.filledBy = "manager";
        else if (p.filled_by_role === "owner") f.filledBy = "owner";
      }
    }
    for (const sig of sec.signatures) {
      const slotKey = `${sec.sectionKey}::${sig.signerRole}::${sig.householdMemberId ?? ""}`;
      const persistedSig = sigsByKey.get(slotKey);
      if (persistedSig) {
        sig.signed = true;
        sig.signatureDataUrl = persistedSig.signature_data_url;
        sig.signedAt = persistedSig.signed_at;
        if (!sig.signerName && persistedSig.signer_name) sig.signerName = persistedSig.signer_name;
      }
    }
  }

  // Compute readiness.
  let totalRequired = 0;
  let completedRequired = 0;
  let totalSignatures = 0;
  let completedSignatures = 0;
  const blockers: string[] = [];
  for (const sec of sections) {
    for (const f of sec.fields) {
      if (f.required) {
        totalRequired += 1;
        if (f.status === "prefilled" && f.value !== null && f.value !== "") completedRequired += 1;
        else if (f.value !== null && f.value !== "" && f.value !== false) completedRequired += 1;
        else if (f.status === "pending") blockers.push(`Pending external data: ${f.label}`);
      }
    }
    for (const sig of sec.signatures) {
      totalSignatures += 1;
      if (sig.signed) completedSignatures += 1;
    }
  }
  const denom = totalRequired + totalSignatures;
  const numer = completedRequired + completedSignatures;
  const percent = denom === 0 ? 0 : Math.round((numer / denom) * 100);

  return {
    caseId,
    packetId,
    generatedAt: new Date().toISOString(),
    caseSummary: {
      primaryTenantName: c.primaryTenantName,
      propertyName: c.propertyName,
      unitNumber: c.unitNumber,
      bedroomCount: c.bedroomCount,
      moveInDate: c.moveInOrRenewalDate,
      certificationType: c.certificationType,
      maxIncomeLimit: c.maxIncomeLimit,
      maxAllowableRent: c.maxAllowableRent,
      proposedTenantRent: c.proposedTenantRent,
      subsidyAmount: c.subsidyAmount,
      subsidyStatus: c.subsidyStatus,
      utilityAllowanceRequired: c.utilityAllowanceRequired,
      totalUtilityAllowance: c.totalUtilityAllowance,
      totalHouseholdIncome: totalIncome ?? undefined,
      adultCount: c.adultCount,
      childCount: c.childCount,
    },
    sections,
    readiness: {
      totalRequired,
      completedRequired,
      totalSignatures,
      completedSignatures,
      percent,
      blockers,
    },
    complianceNote:
      "INTERNAL WORKFLOW TOOL — not an official LAHD or Urban Futures e-signature system. " +
      "Manager review is required before submission. Field labels are internal approximations " +
      "of the LAHD certification package structure; exact official-form field mappings must be " +
      "supplied by the property manager before submission.",
  };
}

/**
 * Persist a single field value (autosave path).
 */
export async function saveRecertPacketField(args: {
  caseId: string;
  packetId?: string;
  sectionKey: string;
  fieldKey: string;
  valueText?: string | null;
  valueJson?: Record<string, unknown> | null;
  filledByRole?: "tenant" | "manager" | "owner" | "baxterops";
  filledByName?: string;
  status?: PacketFieldStatus;
}): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const packetId = args.packetId ?? "primary";
  const { error } = await sb.from("recert_packet_field_values")
    .upsert({
      case_id: args.caseId,
      packet_id: packetId,
      section_key: args.sectionKey,
      field_key: args.fieldKey,
      value_text: args.valueText ?? null,
      value_json: args.valueJson ?? null,
      filled_by_role: args.filledByRole ?? null,
      filled_by_name: args.filledByName ?? null,
      status: args.status ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "case_id,packet_id,section_key,field_key" });
  if (error) {
    console.warn("[saveRecertPacketField]", error.message);
    return false;
  }
  return true;
}

/**
 * Persist a single signature (canvas data URL).
 */
export async function saveRecertPacketSignature(args: {
  caseId: string;
  packetId?: string;
  sectionKey: string;
  householdMemberId?: string | null;
  signerRole: "tenant" | "manager" | "owner";
  signerName?: string | null;
  signatureDataUrl: string;
}): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const packetId = args.packetId ?? "primary";
  const { error } = await sb.from("recert_packet_signatures")
    .upsert({
      case_id: args.caseId,
      packet_id: packetId,
      section_key: args.sectionKey,
      household_member_id: args.householdMemberId ?? "__none__",
      signer_name: args.signerName ?? null,
      signer_role: args.signerRole,
      signature_data_url: args.signatureDataUrl,
      signed_at: new Date().toISOString(),
    }, { onConflict: "case_id,packet_id,section_key,signer_role,household_member_id" })
    .select();
  if (error) {
    console.warn("[saveRecertPacketSignature]", error.message);
    return false;
  }
  return true;
}

/**
 * Clear a signature (for re-signing).
 */
export async function clearRecertPacketSignature(args: {
  caseId: string;
  packetId?: string;
  sectionKey: string;
  householdMemberId?: string | null;
  signerRole: "tenant" | "manager" | "owner";
}): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const packetId = args.packetId ?? "primary";
  const memberCol = args.householdMemberId ?? "__none__";
  const { error } = await sb.from("recert_packet_signatures").delete()
    .eq("case_id", args.caseId)
    .eq("packet_id", packetId)
    .eq("section_key", args.sectionKey)
    .eq("signer_role", args.signerRole)
    .eq("household_member_id", memberCol);
  return !error;
}
