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
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  void incomeSources; // surfaced via missing-data report, not auto-filled
  void assets;        // tenant must complete asset rows
  const pendingHacla = c.subsidyStatus === "hacla_determination_pending";

  // Address parsing — split address into street / city / zip if needed.
  // For Baxter the canonical address is "1818 N Cherokee Ave, Los Angeles, CA 90028".
  const addr = c.propertyName.toLowerCase().includes("baxter")
    ? { street: "1818 N Cherokee Ave", city: "Los Angeles", zip: "90028" }
    : { street: undefined, city: undefined, zip: undefined };

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
  push("3-Project Name",          3, "Project Name",          "filled_known", c.propertyName);
  push("3-Street Address",        3, "Street Address",        "filled_known", addr.street);
  push("3-City",                  3, "City",                  "filled_known", addr.city);
  push("3-State CA Zip",          3, "State CA Zip",          "filled_known", addr.zip);
  push("3-Unit Number",           3, "Unit Number",           "filled_known", c.unitNumber);
  push("3-Number of Bedrooms",    3, "Number of Bedrooms",    "filled_known", asInt(c.bedroomCount));
  push("3-Number of Adults over 18",       3, "Number of Adults",  "filled_known", asInt(c.adultCount));
  push("3-Number of Children under 18",    3, "Number of Children","filled_known", asInt(c.childCount));
  push("3-HH1", 3, "Household Member 1", "filled_known", memberAt(members, 0)?.fullName);
  push("3-HH2", 3, "Household Member 2", "filled_known", memberAt(members, 1)?.fullName);
  push("3-HH3", 3, "Household Member 3", "filled_known", memberAt(members, 2)?.fullName);
  push("3-HH4", 3, "Household Member 4", "filled_known", memberAt(members, 3)?.fullName);
  push("3-Maximum Allowable Income",       3, "Max Allowable Income",      "filled_known", money(c.maxIncomeLimit));
  push("3-Maximum Allowable Rent Limit",   3, "Max Allowable Rent Limit",  "filled_known", money(c.maxAllowableRent));
  push("3-Tenant Portion of Rent",         3, "Tenant Portion of Rent",
    pendingHacla ? "blank_pending_external" : "filled_known",
    pendingHacla ? undefined : money(c.proposedTenantRent),
    pendingHacla ? "Blank pending HACLA final rent determination" : undefined);
  push("3-Total Annual Household Income from All Sources", 3, "Total Annual Household Income",
    "needs_review", undefined,
    "Manager confirms total before submission — value depends on tenant-provided income docs");
  // Unit Square Footage — leave blank unless seeded; for Unit 712 we have it
  if (c.unitNumber === "712") {
    push("3-Unit Square Footage", 3, "Unit Square Footage", "filled_known", "792");
  } else {
    push("3-Unit Square Footage", 3, "Unit Square Footage", "blank_manager_must_complete", undefined,
      "Manager fills from unit specs");
  }
  // Date + From — these are who's submitting. Use manager.
  push("3-Date",  3, "Date",  "filled_known", asDate(new Date().toISOString()));
  push("3-From",  3, "From (Manager Name)", managerName ? "filled_known" : "blank_manager_must_complete", managerName);
  push("3-Email", 3, "Manager Email", managerEmail ? "filled_known" : "blank_manager_must_complete", managerEmail);
  push("3-OPMName", 3, "Owner/Property Manager Name", managerName ? "filled_known" : "blank_manager_must_complete", managerName);
  push("3-Title",   3, "Manager Title", managerTitle ? "filled_known" : "blank_manager_must_complete", managerTitle);

  // ─── Page 5 — Tenant Income and Rent Certification (TIRC), Part A + B ─────────
  push("5-ProjectName",  5, "Project Name (TIRC)",   "filled_known", c.propertyName);
  push("5-Address",      5, "Property Address",      "filled_known", addr.street);
  push("5-City",         5, "City",                  "filled_known", addr.city);
  push("5-Zip",          5, "Zip",                   "filled_known", addr.zip);
  push("5-OwnerName",    5, "Owner Name",            managerName ? "filled_known" : "blank_manager_must_complete", managerName);
  push("5-OwnerPhone",   5, "Owner Phone",           c.primaryTenantPhone ? "filled_known" : "blank_manager_must_complete", c.primaryTenantPhone,
       "Property contact phone for the LAHD-facing manager");
  push("5-OwnerAddress", 5, "Owner Address",         "filled_known", addr.street);
  push("5-OwnerEmail",   5, "Owner Email",           managerEmail ? "filled_known" : "blank_manager_must_complete", managerEmail);
  push("5-UnitNumber",   5, "Unit Number",           "filled_known", c.unitNumber);
  push("5-Bedrooms",     5, "Bedrooms",              "filled_known", asInt(c.bedroomCount));
  push("5-EstMoveIn",      5, "Estimated Move-in Date",   c.moveInOrRenewalDate && c.certificationType === "move_in" ? "filled_known" : "not_applicable", asDate(c.moveInOrRenewalDate));
  push("5-OriginalMoveIn", 5, "Original Move-in Date",    c.certificationType !== "move_in" ? "filled_known" : "not_applicable", asDate(c.moveInOrRenewalDate));

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
  push("8-TotalMonthlyRent", 8, "Total Monthly Rent (Tenant + Subsidy)", "needs_review", undefined,
       "Manager confirms after HACLA determination");
  push("8-TotalUnitRent",    8, "Total Unit Rent", "needs_review", undefined,
       "Manager confirms after HACLA determination");

  // ─── Page 11 — Applicant Statement signature page ───────────────────────────
  // OPM (Owner/Property Manager) fields are not the manager's signature; just name.
  push("11-OPMName", 11, "OPM Name",
       managerName ? "filled_known" : "blank_manager_must_complete", managerName);
  // 11-HouseholdMemberName + Date + initials 1-7 are TENANT must complete.
  push("11-HouseholdMemberName", 11, "Household Member Name (Applicant Statement)",
       "blank_tenant_must_complete", undefined, "Tenant prints name");
  push("11-HouseholdMemberDate", 11, "Date (Applicant Statement)",
       "blank_tenant_must_complete", undefined, "Tenant dates upon signing");
  for (let i = 1; i <= 7; i++) {
    push(`11-Initial${i}`, 11, `Applicant Initial ${i}`, "blank_tenant_must_complete", undefined,
         "Tenant initials each statement on iPad");
  }
  // 11-OPMDate — date the manager countersigns. Manager fills on iPad.
  push("11-OPMDate", 11, "Manager Countersign Date", "blank_manager_must_complete", undefined,
       "Manager dates when countersigning");

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
  push("16-OPMDate",   16, "COI — Manager Date",
       "blank_manager_must_complete", undefined, "Manager dates when countersigning");

  // Note: all 12-XX through 15-XX TICQ questions (Y/N buttons and Info/Monthly
  // text fields) are tenant-completed and intentionally OMITTED from this map.
  // Same for 6-XX asset table rows. Same for /Sig signature fields.

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
  "6-",                          // Asset table rows
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
