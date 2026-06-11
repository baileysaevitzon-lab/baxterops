// Sprint 15: Exact-form fill mapping for the LAHD Land Use Restricted Rental
// Unit Income Certification Package (2026 revision).
//
// The official PDF Bailey provided has 632 AcroForm fields with a stable
// naming convention: "<page>-<label>". This file maps the subset of fields
// BaxterOps can confidently pre-fill (project/property/case identifiers)
// to data paths on the recertification case context object. Tenant-completed
// fields (TICQ Y/N, asset balances, signatures) are explicitly left blank.
//
// Output: a structured config + a runtime resolver that returns a value for
// each field based on the case data. Fields with no known data are returned
// as `{ status: "blank_..." }` and surface in the missing-data report.
//
// This is the technical metadata layer ONLY — no LAHD form text is
// reproduced here. The actual official form text is rendered by pdf-lib
// from the unchanged template PDF in /public/templates/.

import type {
  RecertificationCase,
  RecertHouseholdMember,
  RecertIncomeSource,
  RecertAssetAccount,
  RecertUtilityAllowance,
} from "@/lib/types";

// ─── Sprint 38: Baxter universal defaults (KBI golden standard, 2026-06-11) ───
// Source of truth: "LAHD-recert-Victoria_Ibrahim-unit-511- edited by KBI.pdf",
// reviewed/corrected by Katherine Ingersoll. These are OWNER/AGENT/PROJECT
// constants that apply to every Baxter packet — never tenant data.
// See docs/recert-golden-standard.md.
export const BAXTER_RECERT_DEFAULTS = {
  projectName: "1818 North Cherokee Avenue",
  street: "1818 N Cherokee Ave",
  city: "Los Angeles",
  zip: "90028",
  ownerName: "FWP Baxter, LLC",
  ownerPhone: "858-945-1190",
  ownerAddress: "PO Box 7132 Rancho Santa Fe, CA 92067",
  ownerAgentEmail: "katherine@faulknercapitalpartners.com",
  agentName: "Katherine Ingersoll",
  agentTitle: "Director",
  /** The Baxter is an all-electric building — utilities paid by tenant
   *  per the golden standard (TIRC "Utilities Paid by Tenant" section). */
  electricUtilities: ["5-ElectricCooking", "5-BasicElectricity", "5-AirConditioning", "5-ElectricSpaceHeating"] as const,
} as const;

/** Checkbox fields are filled with this sentinel; the generate route calls
 *  PDFCheckBox.check() when it sees a filled_known value on a checkbox. */
export const CHECKBOX_ON = "X";

export type FillStatus =
  | "filled_known"
  | "blank_missing_data"
  | "blank_tenant_must_complete"
  | "blank_manager_must_complete"
  | "blank_pending_external"     // e.g. HACLA rent determination
  | "not_applicable"
  | "needs_review";

export interface FieldFillResult {
  fieldName: string;
  pageNumber: number;
  label: string;
  fillRule: FillStatus;
  /** Final value to write to the PDF field, if any. */
  value?: string;
  /** Status assigned at runtime (may differ from default fillRule). */
  status: FillStatus;
  confidence?: "high" | "medium" | "low";
  notes?: string;
}

export interface FillContext {
  recertCase: RecertificationCase;
  members: RecertHouseholdMember[];
  incomeSources: RecertIncomeSource[];
  assets: RecertAssetAccount[];
  utilityAllowance?: RecertUtilityAllowance;
  /** Manager preparing the packet (auth.user). Used for OPM-name fields only. */
  managerName?: string;
  managerTitle?: string;
  managerEmail?: string;
  /**
   * Sprint 16: per-case classification overrides keyed by PDF field name.
   * If an override exists for a field, its fillStatus + manualOverrideValue
   * supersede the in-code defaults.
   */
  overrides?: Map<string, {
    fillStatus?: FillStatus;
    manualOverrideValue?: string;
    notes?: string;
  }>;
}

// ---------- Helpers ----------

function money(n: number | undefined | null): string | undefined {
  if (n === null || n === undefined) return undefined;
  // Golden-standard style (KBI): whole-dollar amounts have no cents ("867",
  // "53,000"); fractional amounts keep cents ("179.72", "2,007.11").
  const hasCents = Math.abs(n - Math.round(n)) > 0.004;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
}
/** LAHD Rental Covenant unit-type names (per the Baxter rent roll's
 *  "Unit Type per LAHD (Rental Covenant)" column, KBI-confirmed 2026-06-11):
 *  Studio/0BR → "Single", 1BD → "One", 2BD → "Two". */
function bedroomsLabel(n: number | undefined | null): string | undefined {
  if (n === null || n === undefined) return undefined;
  const names: Record<number, string> = { 0: "Single", 1: "One", 2: "Two", 3: "Three" };
  return names[Math.round(n)] ?? String(Math.round(n));
}
function asInt(n: number | undefined | null): string | undefined {
  if (n === null || n === undefined) return undefined;
  return String(Math.round(n));
}
function asDate(d: string | undefined | null): string | undefined {
  if (!d) return undefined;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return undefined;
  // LAHD form expects MM/DD/YYYY
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${m}/${day}/${dt.getUTCFullYear()}`;
}

function adultAt(members: RecertHouseholdMember[], index: number): RecertHouseholdMember | undefined {
  return members.filter(m => m.isAdult)[index];
}
function memberAt(members: RecertHouseholdMember[], index: number): RecertHouseholdMember | undefined {
  return members[index];
}

// ---------- Resolver ----------

/**
 * Resolve every field on the LAHD 2026 packet against the case context.
 * Returns one FieldFillResult per known field; tenant-completed and
 * signature fields are intentionally OMITTED so we never accidentally
 * write to them.
 */
export function resolveLahdRecert2026Fields(ctx: FillContext): FieldFillResult[] {
  const { recertCase: c, members, incomeSources, assets, utilityAllowance: ua, managerName, managerTitle, managerEmail } = ctx;
  const pendingHacla = c.subsidyStatus === "hacla_determination_pending";

  // Address parsing — split address into street / city / zip if needed.
  // For Baxter the canonical address is "1818 N Cherokee Ave, Los Angeles, CA 90028".
  const isBaxter = c.propertyName.toLowerCase().includes("baxter") || c.propertyId === "baxter";
  const D = BAXTER_RECERT_DEFAULTS;
  const addr = isBaxter
    ? { street: D.street, city: D.city, zip: D.zip }
    : { street: undefined, city: undefined, zip: undefined };
  // Golden standard: LAHD packets name the project by its address, not the
  // marketing name ("1818 North Cherokee Avenue", not "The Baxter Hollywood").
  const projectName = isBaxter ? D.projectName : c.propertyName;

  // Owner/agent identity (KBI golden standard). Explicit ctx values (from the
  // request body) still win; the Baxter constants replace the old broken
  // user_profiles fallback and any "BMS"-era placeholder values.
  const agentName  = managerName  || (isBaxter ? D.agentName : undefined);
  const agentTitle = (managerTitle && managerTitle !== "Property Manager" ? managerTitle : undefined) || (isBaxter ? D.agentTitle : managerTitle);
  const agentEmail = managerEmail || (isBaxter ? D.ownerAgentEmail : undefined);

  // Manager-verified income/assets (page 5 Part C + page 6 Part D). Only
  // manager-approved income rows are ever written to the certification.
  const approvedIncome = incomeSources.filter(s => s.managerApproved && s.requiredProjectedIncome != null);
  const incomeRow1 = approvedIncome[0];
  const totalAnnualIncome = approvedIncome.length
    ? approvedIncome.reduce((sum, s) => sum + (s.requiredProjectedIncome ?? 0), 0)
    : undefined;
  const incomeTypeLabel = (t: string | undefined): string | undefined => {
    if (!t) return undefined;
    const map: Record<string, string> = {
      social_security: "Social Security", ssi: "SSI", employment: "Job",
      self_employment: "Self-Employment", pension: "Pension", unemployment: "Unemployment",
      child_support: "Child Support", public_assistance: "Welfare",
    };
    return map[t] ?? t.replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
  };

  // Rent math (TIRC instructions p.8): Total Monthly Rent = tenant portion +
  // utility allowance; Total Unit Rent = tenant portion + UA + rental subsidy.
  const uaTotal = ua?.totalUtilityAllowance ?? c.totalUtilityAllowance ?? undefined;
  const tenantRent = pendingHacla ? undefined : c.proposedTenantRent ?? undefined;
  const subsidy = pendingHacla ? undefined : c.subsidyAmount ?? undefined;
  const totalMonthlyRent = tenantRent != null && uaTotal != null ? tenantRent + uaTotal : undefined;
  const totalUnitRent = tenantRent != null && uaTotal != null && subsidy != null
    ? tenantRent + uaTotal + subsidy : undefined;

  // Income level → checkbox, driven by the case's restricted-unit schedule
  // (e.g. "50% - Very Low"). Only the 50%/Very-Low field names are verified
  // against the golden PDF ("3-Very Low", "5-50"); other levels go through
  // per-case overrides until their field names are confirmed.
  const sched = (c.restrictedUnitSchedule ?? "").toLowerCase();
  const incomeLevelChecks: { p3: string; p5: string } | undefined =
    sched.includes("50") || sched.includes("very low") ? { p3: "3-Very Low", p5: "5-50" } : undefined;

  // Head-of-household name. The primary tenant is, by definition, household
  // member 1 — so when the structured roster (recert_household_members) is empty
  // (e.g. tenant completed the form but the roster was never separately populated),
  // fall back to the case's primaryTenantName so the certification still NAMES the
  // household on pages 3 and 5. This is a name only — never an income/rent amount.
  const hohName = memberAt(members, 0)?.fullName ?? c.primaryTenantName;

  const out: FieldFillResult[] = [];
  const push = (
    fieldName: string,
    pageNumber: number,
    label: string,
    rule: FillStatus,
    value: string | undefined,
    notes?: string,
  ) => {
    const status: FillStatus =
      rule === "filled_known" ? (value ? "filled_known" : "blank_missing_data") :
      rule === "blank_pending_external" ? "blank_pending_external" :
      rule;
    out.push({
      fieldName, pageNumber, label, fillRule: rule, value: status === "filled_known" ? value : undefined,
      status, confidence: status === "filled_known" ? "high" : "medium",
      notes,
    });
  };

  // ─── Page 3 — Request for Income Certification ───────────────────────────────
  push("3-Project Name",          3, "Project Name",          "filled_known", projectName);
  push("3-Street Address",        3, "Street Address",        "filled_known", addr.street);
  push("3-City",                  3, "City",                  "filled_known", addr.city);
  push("3-State CA Zip",          3, "State CA Zip",          "filled_known", addr.zip);
  push("3-Unit Number",           3, "Unit Number",           "filled_known", c.unitNumber);
  push("3-Number of Bedrooms",    3, "Number of Bedrooms",    "filled_known", bedroomsLabel(c.bedroomCount));
  push("3-Number of Adults over 18",       3, "Number of Adults",  "filled_known", asInt(c.adultCount));
  push("3-Number of Children under 18",    3, "Number of Children","filled_known", asInt(c.childCount));
  push("3-HH1", 3, "Household Member 1", "filled_known", hohName);
  push("3-HH2", 3, "Household Member 2", "filled_known", memberAt(members, 1)?.fullName);
  push("3-HH3", 3, "Household Member 3", "filled_known", memberAt(members, 2)?.fullName);
  push("3-HH4", 3, "Household Member 4", "filled_known", memberAt(members, 3)?.fullName);
  push("3-Maximum Allowable Income",       3, "Max Allowable Income",      "filled_known", money(c.maxIncomeLimit));
  push("3-Maximum Allowable Rent Limit",   3, "Max Allowable Rent Limit",  "filled_known", money(c.maxAllowableRent));
  push("3-Tenant Portion of Rent",         3, "Tenant Portion of Rent",
    pendingHacla ? "blank_pending_external" : "filled_known",
    // Golden standard p.3: tenant portion INCLUDING utility allowance (214.72 = 179.72 + 35).
    pendingHacla ? undefined : money(totalMonthlyRent ?? tenantRent),
    pendingHacla ? "Blank pending HACLA final rent determination" : undefined);
  push("3-Total Annual Household Income from All Sources", 3, "Total Annual Household Income",
    totalAnnualIncome != null ? "filled_known" : "needs_review",
    totalAnnualIncome != null ? money(totalAnnualIncome) : undefined,
    totalAnnualIncome != null ? "Sum of manager-approved projected income sources"
      : "Manager confirms total before submission — value depends on tenant-provided income docs");
  // Unit Square Footage — per-case data via recert_case_field_overrides
  // (rc-511 → 597, rc-712 → 792); no hardcoded unit numbers in code.
  push("3-Unit Square Footage", 3, "Unit Square Footage", "blank_manager_must_complete", undefined,
    "Manager fills from unit specs (per-case override)");
  // Date + From — who's submitting: the duly authorized agent (KBI golden).
  push("3-Date",  3, "Date",  "filled_known", asDate(new Date().toISOString()));
  push("3-From",  3, "From (Duly Authorized Agent)", agentName ? "filled_known" : "blank_manager_must_complete", agentName);
  push("3-Duly Authorized Agent", 3, "From: Duly Authorized Agent ☑", "filled_known", isBaxter ? CHECKBOX_ON : undefined,
    "Baxter packets are submitted by the duly authorized agent, not the owner directly");
  push("3-Email", 3, "Agent Email", agentEmail ? "filled_known" : "blank_manager_must_complete", agentEmail);
  push("3-OPMName", 3, "Owner/Property Manager Name", agentName ? "filled_known" : "blank_manager_must_complete", agentName);
  push("3-Title",   3, "Preparer Title", agentTitle ? "filled_known" : "blank_manager_must_complete", agentTitle);
  push("3-Agent",   3, "Preparer: Duly Authorized Agent ☑", "filled_known", isBaxter ? CHECKBOX_ON : undefined);
  if (incomeLevelChecks) {
    push(incomeLevelChecks.p3, 3, "Income level ☑ (from restricted-unit schedule)", "filled_known", CHECKBOX_ON);
  }

  // ─── Page 5 — Tenant Income and Rent Certification (TIRC), Part A + B ─────────
  push("5-ProjectName",  5, "Project Name (TIRC)",   "filled_known", projectName);
  push("5-Address",      5, "Property Address",      "filled_known", addr.street);
  push("5-City",         5, "City",                  "filled_known", addr.city);
  push("5-Zip",          5, "Zip",                   "filled_known", addr.zip);
  // Owner identity = the OWNER ENTITY (KBI golden), never the manager or tenant.
  push("5-OwnerName",    5, "Owner Name",    "filled_known", isBaxter ? D.ownerName : undefined,
       "Owner entity per golden standard (was: manager name)");
  push("5-OwnerPhone",   5, "Owner Phone",   "filled_known", isBaxter ? D.ownerPhone : undefined,
       "Owner phone per golden standard (was: tenant phone — mapping bug)");
  push("5-OwnerAddress", 5, "Owner Address", "filled_known", isBaxter ? D.ownerAddress : undefined,
       "Owner mailing address per golden standard (was: property street)");
  push("5-OwnerEmail",   5, "Owner Email",   "filled_known", isBaxter ? D.ownerAgentEmail : (managerEmail || undefined));
  push("5-UnitNumber",   5, "Unit Number",           "filled_known", c.unitNumber);
  push("5-Bedrooms",     5, "Bedrooms",              "filled_known", bedroomsLabel(c.bedroomCount));
  push("5-EstMoveIn",      5, "Estimated Move-in Date", "filled_known",
       c.certificationType === "move_in" ? asDate(c.moveInOrRenewalDate) : "N/A",
       c.certificationType === "move_in" ? undefined : "Golden standard writes literal N/A for existing tenants");
  push("5-OriginalMoveIn", 5, "Original Move-in Date",    c.certificationType !== "move_in" ? "filled_known" : "not_applicable", asDate(c.moveInOrRenewalDate));

  // Utilities Paid by Tenant — The Baxter is all-electric (golden standard).
  if (isBaxter) {
    for (const f of D.electricUtilities) {
      push(f, 5, `Utilities Paid by Tenant ☑ (${f.slice(2)})`, "filled_known", CHECKBOX_ON,
        "Baxter all-electric building default (KBI golden standard)");
    }
  }
  if (incomeLevelChecks) {
    push(incomeLevelChecks.p5, 5, "Income level ☑ (from restricted-unit schedule)", "filled_known", CHECKBOX_ON);
  }

  // Rent / UA / subsidy block (TIRC Part B). Golden: tenant portion 179.72,
  // UA 35, HCV ☑, subsidy 2,007.11, Total Unit Rent = 1+2+3.
  push("5-TenantPortion", 5, "Tenant Portion of Rent",
       pendingHacla ? "blank_pending_external" : "filled_known", money(tenantRent),
       pendingHacla ? "Blank pending HACLA final rent determination" : undefined);
  push("5-UAAmount", 5, "Utility Allowance",
       c.utilityAllowanceRequired ? (uaTotal != null ? "filled_known" : "blank_manager_must_complete") : "not_applicable",
       money(uaTotal));
  push("5-HCV", 5, "Housing Choice Voucher ☑",
       "filled_known", subsidy != null && subsidy > 0 ? CHECKBOX_ON : undefined,
       "Checked when the case carries a HACLA Housing Choice Voucher subsidy");
  push("5-SubsidyAmount", 5, "Rental Subsidy Amount",
       pendingHacla ? "blank_pending_external" : "filled_known", money(subsidy),
       pendingHacla ? "Blank pending HACLA final rent determination" : undefined);
  push("5-TotalRent", 5, "Total Unit Rent (1+2+3)",
       totalUnitRent != null ? "filled_known" : "needs_review", money(totalUnitRent),
       "Computed: tenant portion + utility allowance + rental subsidy");

  // Part C income table — row 1 is the Head of Household. Name from roster/case;
  // income amounts ONLY from manager-approved income sources (never tenant-typed).
  push("5-Name1", 5, "Head of Household Name (TIRC Part C row 1)", "filled_known", hohName);
  push("5-Age1",  5, "HoH Age", "blank_manager_must_complete", undefined,
       "No DOB/age in the data model — set via per-case override");
  push("5-Post MoveIn Cert", 5, "Certification type: Post Move-In ☑", "blank_manager_must_complete", undefined,
       "Certification-type checkbox — per-case decision (override). KBI checked this for rc-511");
  push("5-Type1",    5, "HoH Income Type",    incomeRow1 ? "filled_known" : "blank_manager_must_complete",
       incomeRow1 ? incomeTypeLabel(incomeRow1.incomeType) : undefined);
  push("5-Monthly1", 5, "HoH Monthly Gross",  incomeRow1 ? "filled_known" : "blank_manager_must_complete",
       incomeRow1?.requiredProjectedIncome != null ? money(Math.round((incomeRow1.requiredProjectedIncome / 12) * 100) / 100) : undefined);
  push("5-Annual1",  5, "HoH Projected Annual", incomeRow1 ? "filled_known" : "blank_manager_must_complete",
       money(incomeRow1?.requiredProjectedIncome));
  push("5-DocY1",    5, "HoH Documentation on File ☑", "filled_known",
       incomeRow1?.documentationReceived ? CHECKBOX_ON : undefined);
  // Unused household-member relationship rows: golden writes literal "N/A".
  for (let i = 2; i <= 6; i++) {
    if (!memberAt(members, i - 1)) {
      push(`5-Relationship${i}`, 5, `Relationship row ${i} (unused)`, "filled_known", "N/A");
    }
  }
  push("5-HoHPhone", 5, "Head of Household Phone", "filled_known", c.primaryTenantPhone);
  push("5-HoHEmail", 5, "Head of Household Email", "filled_known", c.primaryTenantEmail);
  push("5-TotalHouseholdIncome", 5, "(A) Total Projected Household Income",
       totalAnnualIncome != null ? "filled_known" : "needs_review", money(totalAnnualIncome),
       totalAnnualIncome != null ? "Sum of manager-approved projected income sources" : undefined);

  // ─── Page 6 — TIRC Part D (Income from Assets) + owner/agent certification ───
  // Manager-compiled from verified recert_asset_accounts (NOT tenant-typed; the
  // tenant's own asset declarations live on pages 14 + 18–19 via completion merge).
  const assetRows = assets.filter(a => a.endingBalance != null);
  const assetLabel = (a: RecertAssetAccount): string => {
    const typeMap: Record<string, string> = { checking: "Checking Account", savings: "Savings Account" };
    const raw = a.accountType ?? "account";
    const type = typeMap[raw] ?? raw.replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
    return a.institutionName ? `${type} (${a.institutionName})` : type;
  };
  assetRows.slice(0, 3).forEach((a, idx) => {
    const i = idx + 1;
    push(`6-HHMbr${i}`,        6, `Asset row ${i}: HH member #`,      "filled_known", "1",
      "Single-adult households: HoH is member 1; multi-member mapping needs the member link");
    push(`6-AssetType${i}`,    6, `Asset row ${i}: type`,             "filled_known", assetLabel(a));
    push(`6-Last4${i}`,        6, `Asset row ${i}: last 4`,           "filled_known", a.accountLastFour);
    push(`6-CashValue${i}`,    6, `Asset row ${i}: cash value`,       "filled_known", money(a.endingBalance));
    push(`6-ActualIncome${i}`, 6, `Asset row ${i}: actual income`,    "filled_known", money(a.actualAssetIncome ?? 0));
    push(`6-Imputed${i}`,      6, `Asset row ${i}: imputed income`,   "filled_known", money(a.imputedAssetIncome ?? 0));
  });
  if (assetRows.length) {
    const cashTotal = assetRows.reduce((s, a) => s + (a.endingBalance ?? 0), 0);
    const actualTotal = assetRows.reduce((s, a) => s + (a.actualAssetIncome ?? 0), 0);
    const imputedTotal = assetRows.reduce((s, a) => s + (a.imputedAssetIncome ?? 0), 0);
    push("6-CashValueTotal",    6, "Assets: cash value total",    "filled_known", money(cashTotal));
    push("6-ActualIncomeTotal", 6, "Assets: actual income total", "filled_known", money(actualTotal));
    push("6-ImputedTotal",      6, "Assets: imputed income total","filled_known", money(imputedTotal));
    push("6-TotalAssetIncome",  6, "(H) Total income from assets","filled_known", money(actualTotal + imputedTotal));
    push("6-TotalHouseholdIncome", 6, "(I) Total annual household income (C.A + D.H)",
      totalAnnualIncome != null ? "filled_known" : "needs_review",
      totalAnnualIncome != null ? money(totalAnnualIncome + actualTotal + imputedTotal) : undefined);
    push("6-DocY", 6, "Part D documentation on file ☑", "filled_known",
      assetRows.every(a => a.statementReceived) ? CHECKBOX_ON : undefined);
  }
  push("6-OPMName", 6, "Owner/Agent certification name", agentName ? "filled_known" : "blank_manager_must_complete", agentName);
  push("6-Agent",   6, "Owner/Agent: Duly Authorized Agent ☑", "filled_known", isBaxter ? CHECKBOX_ON : undefined);
  push("6-OPMDate", 6, "Owner/Agent certification date", "filled_known", "TBD",
    "Golden standard: TBD until the agent countersigns the final packet");

  // ─── Page 8 — Rent / Subsidy / Utility table ────────────────────────────────
  push("8-MaximumAllowableRent", 8, "Maximum Allowable Rent", "filled_known", money(c.maxAllowableRent));
  push("8-UA",  8, "Utility Allowance", c.utilityAllowanceRequired ? (ua?.totalUtilityAllowance != null ? "filled_known" : "blank_manager_must_complete") : "not_applicable",
       ua?.totalUtilityAllowance != null ? money(ua?.totalUtilityAllowance) : c.totalUtilityAllowance != null ? money(c.totalUtilityAllowance) : undefined);
  push("8-TenantRent",     8, "Tenant Rent Portion",
       pendingHacla ? "blank_pending_external" : "filled_known",
       pendingHacla ? undefined : money(c.proposedTenantRent),
       pendingHacla ? "Blank pending HACLA final rent determination" : undefined);
  push("8-RentalSubsidy",  8, "Rental Subsidy",
       pendingHacla ? "blank_pending_external" : "filled_known",
       pendingHacla ? undefined : money(c.subsidyAmount),
       pendingHacla ? "Blank pending HACLA final rent determination" : undefined);
  push("8-TotalMonthlyRent", 8, "Total Monthly Rent (Tenant + UA)",
       totalMonthlyRent != null ? "filled_known" : "needs_review", money(totalMonthlyRent),
       totalMonthlyRent != null ? "Computed: tenant portion + utility allowance (TIRC p.8 table)"
         : "Manager confirms after HACLA determination");
  push("8-TotalUnitRent",    8, "Total Unit Rent (1+2+3)",
       totalUnitRent != null ? "filled_known" : "needs_review", money(totalUnitRent),
       totalUnitRent != null ? "Computed: tenant portion + UA + rental subsidy"
         : "Manager confirms after HACLA determination");

  // ─── Page 11 — Applicant Statement signature page ───────────────────────────
  // OPM (Owner/Property Manager) fields are not the manager's signature; just name.
  push("11-OPMName", 11, "OPM Name",
       agentName ? "filled_known" : "blank_manager_must_complete", agentName);
  // 11-HouseholdMemberName + Date + initials 1-7 are TENANT must complete.
  push("11-HouseholdMemberName", 11, "Household Member Name (Applicant Statement)",
       "blank_tenant_must_complete", undefined, "Tenant prints name");
  push("11-HouseholdMemberDate", 11, "Date (Applicant Statement)",
       "blank_tenant_must_complete", undefined, "Tenant dates upon signing");
  for (let i = 1; i <= 7; i++) {
    push(`11-Initial${i}`, 11, `Applicant Initial ${i}`, "blank_tenant_must_complete", undefined,
         "Tenant initials each statement on iPad");
  }
  // 11-OPMDate — golden standard writes "TBD" until the agent countersigns.
  push("11-OPMDate", 11, "Manager Countersign Date", "filled_known", "TBD",
       "Golden standard: TBD until the agent countersigns the final packet");

  // ─── Page 12 — TICQ header (Name/Phone/Unit + certification type) ────────────
  push("12-Name",  12, "TICQ — Tenant Name",  "filled_known", c.primaryTenantName);
  push("12-Phone", 12, "TICQ — Tenant Phone", "filled_known", c.primaryTenantPhone);
  push("12-Unit",  12, "TICQ — Unit",         "filled_known", c.unitNumber);

  // ─── Page 16 — Conflict of Interest signature page ──────────────────────────
  // 16-HHMbrName, HHMbrDate, OPMDate — tenant/manager fill on iPad.
  push("16-HHMbrName", 16, "COI — Household Member Name",
       "blank_tenant_must_complete", undefined, "Tenant prints name");
  push("16-HHMbrDate", 16, "COI — Date",
       "blank_tenant_must_complete", undefined, "Tenant dates upon signing");
  push("16-OPMDate",   16, "TIC-Q — Manager Date", "filled_known", "TBD",
       "Golden standard: TBD until the agent countersigns");

  // ─── Page 17 — Conflict of Interest owner/agent block ────────────────────────
  // Tenant initials (17a1/17b1/17c1) + tenant signature come from the tenant
  // completion merge; the agent name/date are manager-side (KBI golden).
  push("17OPMName", 17, "COI — Owner/Agent Name",
       agentName ? "filled_known" : "blank_manager_must_complete", agentName);
  push("17OPMDate", 17, "COI — Owner/Agent Date", "filled_known", "TBD",
       "Golden standard: TBD until the agent countersigns");

  // Note: all 12-XX through 15-XX TICQ questions (Y/N buttons and Info/Monthly
  // text fields) are tenant-completed and intentionally OMITTED from this map.
  // Page 6 Part D is manager-compiled above (Sprint 38); tenant asset
  // declarations (pages 14, 18–19) remain tenant-only. /Sig fields stay blank.

  // Sprint 16: apply per-case overrides. Bailey edits these via the Field
  // Classification tab on /exact-form-preview; they supersede the defaults.
  if (ctx.overrides && ctx.overrides.size > 0) {
    for (const result of out) {
      const ov = ctx.overrides.get(result.fieldName);
      if (!ov) continue;
      if (ov.fillStatus) {
        result.status = ov.fillStatus;
        // If override moves field away from filled_known, clear any auto-filled value.
        if (ov.fillStatus !== "filled_known") {
          result.value = undefined;
        }
      }
      // Manual override value wins when present.
      if (ov.manualOverrideValue !== undefined && ov.manualOverrideValue !== "") {
        result.value = ov.manualOverrideValue;
        // If the override carries a value but no fillStatus, treat it as filled_known.
        if (!ov.fillStatus) result.status = "filled_known";
      }
      if (ov.notes) result.notes = ov.notes;
      if (result.status === "filled_known" && result.value) {
        result.confidence = "medium";   // manual overrides are medium-confidence
      }
    }
  }

  return out;
}

/**
 * Field-name list of every Y/N button or text field BaxterOps must NEVER
 * write to. Used for the missing-data report's "blank_tenant_must_complete"
 * counts. We keep it as a prefix-match list to avoid enumerating ~300 fields.
 */
export const TENANT_ONLY_FIELD_PREFIXES = [
  "12-", "13-", "14-", "15-",  // TICQ questions
  // Sprint 38: "6-" removed — page 6 (TIRC Part D) is MANAGER-compiled from
  // verified recert_asset_accounts per the KBI golden standard. The tenant's
  // own asset declarations live on pages 14 + 18–19.
];

/**
 * Signature fields (PDF /Sig type) — always blank. Each row is the exact
 * field name. DocHub picks these up as signable on iPad.
 */
export const SIGNATURE_FIELD_NAMES = [
  "11-HouseholdMemberSignature",
  "11-OPMSignature",
  "16-HHMbrSignature",
  "16-OPMSignature",
];
