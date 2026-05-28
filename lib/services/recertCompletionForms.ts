// Sprint 18 (pivot): HTML completion form schema + response store.
//
// Generates a guided-form schema for the tenant and a separate one for the
// manager from the SAME source-of-truth pipeline that powers the PDF preview:
// resolveLahdRecert2026Fields → manager overrides → AcroForm field names.
//
// Responses are persisted in the existing recert_packet_field_values table
// keyed by the original PDF field name (packet_id = "tenant_completion" or
// "manager_completion"). This means the final PDF regen step can merge them
// straight back into the official AcroForm without any field-name translation.
//
// Sessions tracked in recert_completion_sessions (one row per case × role).

import { getSupabase } from "@/lib/supabase/client";
import { loadCaseFieldOverrides } from "./recertFieldOverrides";
import {
  resolveLahdRecert2026Fields,
  SIGNATURE_FIELD_NAMES,
  type FillStatus,
  type FieldFillResult,
} from "./recertExactFormFill";
import {
  getCaseById,
  getMembersForCase,
  getUtilityAllowanceForCase,
} from "./recertification";

export type CompletionRole = "tenant" | "manager";

export type CompletionFieldType =
  | "text"
  | "longtext"
  | "date"
  | "yesno"            // two PDF checkboxes (Y + N) controlled as a single boolean
  | "tristate"         // yes / no / unknown
  | "checkbox"         // single boolean
  | "initial"          // short uppercase string
  | "signature"        // typed-signature image generated client-side
  | "amount"           // numeric currency
  | "name"             // person name
  | "select";          // dropdown choices

export interface CompletionFormField {
  /** Original LAHD AcroForm field name. Persists end-to-end so the PDF
   *  regen can write back without translation. For composite controls
   *  (e.g. yesno = 12-1Y + 12-1N) this is the "logical" name; pairs are
   *  resolved at PDF-merge time via the resolverPair attribute. */
  pdfFieldName: string;
  /** When the logical field controls multiple PDF AcroForm widgets,
   *  list them here. Used by the PDF merge to fan out the response. */
  resolverPair?: { yes?: string; no?: string };
  pageNumber: number;
  label: string;
  context?: string;
  fieldType: CompletionFieldType;
  required: boolean;
  defaultValue?: string;
  /** Read-only fields are shown for context but cannot be edited. */
  readonly?: boolean;
  completionOwner: CompletionRole;
  /** When fieldType=select, options are the human-readable choices. */
  options?: string[];

  // ─── Sprint 19: conditional follow-up fields ───
  /** If set, this field is only shown when the parent field's stored answer
   *  equals parentTriggerValue. The parent must already exist in the schema. */
  parentFieldName?: string;
  /** The string value of the parent that activates this field. For yes/no
   *  parents this is "yes" or "no". */
  parentTriggerValue?: string;
  /** When the parent flips away from parentTriggerValue, also delete the
   *  stored value from recert_packet_field_values. Default: true.
   *  Set to false for read-only context fields that should keep their value. */
  clearsValueWhenHidden?: boolean;
  /** When parent matches trigger and the field is visible, this field is
   *  required. When the parent doesn't match, this field is treated as if
   *  it doesn't exist (not required, not counted). */
  requiredWhenVisible?: boolean;
}

export interface CompletionFormSection {
  key: string;
  title: string;
  description?: string;
  fields: CompletionFormField[];
}

export interface CompletionFormSchema {
  caseId: string;
  templateId: string;
  role: CompletionRole;
  caseSummary: {
    tenantName: string;
    propertyName: string;
    unitNumber?: string;
    bedroomCount?: number;
    moveInDate?: string;
    certificationType?: string;
  };
  sections: CompletionFormSection[];
  totalRequired: number;
  /** Tally of already-saved responses, populated at load time. */
  completed: number;
}

const TEMPLATE_ID = "lahd-recert-2026";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function pickResolverField(fillResults: FieldFillResult[], pdfFieldName: string): FieldFillResult | undefined {
  return fillResults.find(r => r.fieldName === pdfFieldName);
}

function summary(c: Awaited<ReturnType<typeof getCaseById>>): CompletionFormSchema["caseSummary"] {
  return {
    tenantName: c?.primaryTenantName ?? "Unknown tenant",
    propertyName: c?.propertyName ?? "Unknown property",
    unitNumber: c?.unitNumber,
    bedroomCount: c?.bedroomCount,
    moveInDate: c?.moveInOrRenewalDate,
    certificationType: c?.certificationType,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tenant form schema
// ─────────────────────────────────────────────────────────────────────────────

export async function buildTenantFormSchema(caseId: string): Promise<CompletionFormSchema | null> {
  const c = await getCaseById(caseId);
  if (!c) return null;
  const [members, utilityAllowance, overrideMap, savedResponses] = await Promise.all([
    getMembersForCase(caseId),
    getUtilityAllowanceForCase(caseId),
    loadCaseFieldOverrides(caseId),
    loadSavedResponses(caseId, "tenant"),
  ]);

  // Build the FillResult pass once so we can read field statuses + auto-fills.
  const overrides = new Map<string, { fillStatus?: FillStatus; manualOverrideValue?: string; notes?: string }>();
  for (const [k, v] of overrideMap) {
    overrides.set(k, {
      fillStatus: v.fillStatus as FillStatus | undefined,
      manualOverrideValue: v.manualOverrideValue,
      notes: v.notes,
    });
  }
  const fillResults = resolveLahdRecert2026Fields({
    recertCase: c,
    members,
    // resolver only needs these for label generation in this branch
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    incomeSources: [] as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assets: [] as any,
    utilityAllowance,
    overrides,
  });

  const headAdult = members.find(m => m.isAdult);

  const sections: CompletionFormSection[] = [];

  // SECTION 1 — Identity confirmation
  sections.push({
    key: "identity",
    title: "1. Identity confirmation",
    description: "Confirm your information before signing.",
    fields: [
      {
        pdfFieldName: "11-HouseholdMemberName",
        pageNumber: 11,
        label: "Your full legal name",
        context: "Exactly as on government-issued ID. Used to render your typed cursive signature.",
        fieldType: "name",
        required: true,
        completionOwner: "tenant",
        defaultValue: savedResponses.get("11-HouseholdMemberName") ?? headAdult?.fullName ?? "",
      },
      {
        pdfFieldName: "11-HouseholdMemberDate",
        pageNumber: 11,
        label: "Today's date",
        fieldType: "date",
        required: true,
        completionOwner: "tenant",
        defaultValue: savedResponses.get("11-HouseholdMemberDate") ?? "",
      },
    ],
  });

  // SECTION 2 — Initials (single input → fans out to all 7 initial boxes on page 11)
  sections.push({
    key: "initials",
    title: "2. Initials",
    description: "Type your initials once. They will appear next to each statement on page 11 of the LAHD packet.",
    fields: [
      {
        pdfFieldName: "11-Initial1",     // primary; fan-out at merge time covers 2-7
        pageNumber: 11,
        label: "Your initials",
        context: "Auto-applied to all 7 applicant-statement initial boxes.",
        fieldType: "initial",
        required: true,
        completionOwner: "tenant",
        defaultValue: savedResponses.get("11-Initial1") ?? "",
      },
    ],
  });

  // SECTION 3 — Typed signature (image PNG generated client-side, applied to both /Sig widgets)
  sections.push({
    key: "signature",
    title: "3. Signature",
    description: "Your typed name renders as a cursive signature and appears in the Applicant Statement (page 11) and Conflict of Interest (page 16) signature boxes.",
    fields: [
      {
        pdfFieldName: "11-HouseholdMemberSignature",  // primary; fans out to 16-HHMbrSignature
        pageNumber: 11,
        label: "Signature (typed cursive)",
        context: "Renders in cursive. Required before submission.",
        fieldType: "signature",
        required: true,
        completionOwner: "tenant",
        defaultValue: savedResponses.get("11-HouseholdMemberSignature") ?? "",
      },
    ],
  });

  // SECTION 4 — Conflict of Interest acknowledgement (page 16 fields)
  sections.push({
    key: "coi",
    title: "4. Conflict of Interest acknowledgement",
    description: "Confirm your relationship to the owner / property manager.",
    fields: [
      {
        pdfFieldName: "16-HHMbrName",
        pageNumber: 16,
        label: "Your name (Conflict of Interest)",
        fieldType: "name",
        required: true,
        completionOwner: "tenant",
        defaultValue: savedResponses.get("16-HHMbrName") ?? headAdult?.fullName ?? "",
      },
      {
        pdfFieldName: "16-HHMbrDate",
        pageNumber: 16,
        label: "Today's date (Conflict of Interest)",
        fieldType: "date",
        required: true,
        completionOwner: "tenant",
        defaultValue: savedResponses.get("16-HHMbrDate") ?? "",
      },
    ],
  });

  // SECTION 5 — TICQ income questions with conditional follow-ups
  //
  // Each Y/N question on page 12 of the LAHD TICQ has dedicated PDF fields for
  // payer/source info and monthly amount. When the tenant answers Yes, we
  // show those follow-ups inline; when they answer No, the follow-ups are
  // hidden AND their previously-stored values are deleted so they don't leak
  // into the final PDF on a Yes→No flip.
  //
  // Field pattern (12-N where N = 1..8):
  //   <prefix>Y    = "Yes" checkbox    (resolverPair.yes)
  //   <prefix>N    = "No"  checkbox    (resolverPair.no)
  //   <prefix>Info = source / payer / employer name
  //   <prefix>Monthly = monthly amount in USD
  // Some prefixes have multiple slots (e.g. 12-2Info1/Info2/Info3); we only
  // require the primary slot, the rest are optional.
  interface IncomeQ {
    key: string;
    label: string;
    /** Label for the "name of payer / employer / source" follow-up field, or
     *  null if the PDF question has no Info slot. */
    payerLabel: string | null;
    /** Whether this question has a Monthly amount follow-up. */
    hasMonthly: boolean;
    /** Number of additional optional source slots (e.g. self-employment has 3). */
    additionalSlots: number;
  }
  const incomeQs: IncomeQ[] = [
    { key: "12-1", label: "Do you have employment income (wages, salary, hourly)?",       payerLabel: "Employer name",                hasMonthly: true, additionalSlots: 0 },
    { key: "12-2", label: "Self-employment, freelance, or 1099 income?",                  payerLabel: "Nature of self-employment",    hasMonthly: true, additionalSlots: 2 },
    { key: "12-3", label: "Business income or partnership distributions?",                payerLabel: null,                           hasMonthly: true, additionalSlots: 0 },
    { key: "12-4", label: "Social Security or SSI benefits?",                             payerLabel: null,                           hasMonthly: true, additionalSlots: 0 },
    { key: "12-5", label: "Unemployment / EDD payments?",                                 payerLabel: null,                           hasMonthly: true, additionalSlots: 0 },
    { key: "12-6", label: "Child support or alimony received?",                           payerLabel: null,                           hasMonthly: true, additionalSlots: 0 },
    { key: "12-7", label: "Pension or retirement income?",                                payerLabel: null,                           hasMonthly: true, additionalSlots: 0 },
    { key: "12-8", label: "Disability or workers' comp benefits?",                        payerLabel: null,                           hasMonthly: true, additionalSlots: 0 },
  ];
  const incomeFields: CompletionFormField[] = [];
  for (const q of incomeQs) {
    const yesName = `${q.key}Y`;
    incomeFields.push({
      pdfFieldName: yesName,
      resolverPair: { yes: yesName, no: `${q.key}N` },
      pageNumber: 12,
      label: q.label,
      fieldType: "yesno",
      required: true,
      completionOwner: "tenant",
      defaultValue: savedResponses.get(yesName) ?? "",
    });
    // Primary follow-up slot
    if (q.payerLabel) {
      // 12-1Info  vs  12-2Info1 etc — when additionalSlots > 0, the PDF field
      // name is Info1 / Monthly1, otherwise Info / Monthly.
      const suffixIdx = q.additionalSlots > 0 ? "1" : "";
      const payerField = `${q.key}Info${suffixIdx}`;
      incomeFields.push({
        pdfFieldName: payerField,
        pageNumber: 12,
        label: q.payerLabel,
        fieldType: "text",
        required: false,
        requiredWhenVisible: true,
        clearsValueWhenHidden: true,
        completionOwner: "tenant",
        parentFieldName: yesName,
        parentTriggerValue: "yes",
        defaultValue: savedResponses.get(payerField) ?? "",
      });
    }
    if (q.hasMonthly) {
      const suffixIdx = q.additionalSlots > 0 ? "1" : "";
      const monthlyField = `${q.key}Monthly${suffixIdx}`;
      incomeFields.push({
        pdfFieldName: monthlyField,
        pageNumber: 12,
        label: "Monthly gross amount (USD)",
        fieldType: "amount",
        required: false,
        requiredWhenVisible: true,
        clearsValueWhenHidden: true,
        completionOwner: "tenant",
        parentFieldName: yesName,
        parentTriggerValue: "yes",
        defaultValue: savedResponses.get(monthlyField) ?? "",
      });
    }
    // Additional optional slots (e.g. self-employment can have up to 3 sources)
    for (let i = 2; i <= q.additionalSlots + 1; i += 1) {
      if (q.payerLabel) {
        const payerField = `${q.key}Info${i}`;
        incomeFields.push({
          pdfFieldName: payerField,
          pageNumber: 12,
          label: `${q.payerLabel} (additional source ${i - 1}) — optional`,
          fieldType: "text",
          required: false,
          requiredWhenVisible: false,
          clearsValueWhenHidden: true,
          completionOwner: "tenant",
          parentFieldName: yesName,
          parentTriggerValue: "yes",
          defaultValue: savedResponses.get(payerField) ?? "",
        });
      }
      const monthlyField = `${q.key}Monthly${i}`;
      incomeFields.push({
        pdfFieldName: monthlyField,
        pageNumber: 12,
        label: `Monthly gross amount (additional source ${i - 1}) — optional`,
        fieldType: "amount",
        required: false,
        requiredWhenVisible: false,
        clearsValueWhenHidden: true,
        completionOwner: "tenant",
        parentFieldName: yesName,
        parentTriggerValue: "yes",
        defaultValue: savedResponses.get(monthlyField) ?? "",
      });
    }
  }
  sections.push({
    key: "ticq_income",
    title: "5. Income questions (TICQ)",
    description: "Answer Yes if anyone in your household receives the income type listed. If you answer Yes, additional fields appear so you can list the payer and monthly amount.",
    fields: incomeFields,
  });

  // SECTION 6 — TICQ asset questions with conditional follow-ups
  //
  // Asset Y/N questions on pages 14-15 have follow-up PDF fields:
  //   <prefix>Info{n}     = institution / description
  //   <prefix>Value{n}    = balance / market value
  //   <prefix>Interest{n} = interest rate (%)  (not present on 14-21)
  // 14-20 (cash on hand) is special: it has only a single Value, no Info or
  // Interest. We require at least the primary slot per question and expose
  // an optional second slot.
  interface AssetQ {
    key: string;
    pageNum: number;
    label: string;
    /** Label for the institution/description input (null = no Info field). */
    institutionLabel: string | null;
    /** Label for the value/balance input. */
    valueLabel: string;
    /** Whether the PDF has an interest-rate slot for this question. */
    hasInterest: boolean;
    /** Field name pattern: when true, slot suffix is "1" (e.g. Info1); otherwise "" (e.g. Value only). */
    multipleSlots: boolean;
  }
  const assetQs: AssetQ[] = [
    { key: "14-18", pageNum: 14, label: "Do you have any checking accounts?",                                    institutionLabel: "Financial institution",   valueLabel: "Current balance (USD)",   hasInterest: true,  multipleSlots: true  },
    { key: "14-19", pageNum: 14, label: "Do you have any savings accounts?",                                     institutionLabel: "Financial institution",   valueLabel: "Current balance (USD)",   hasInterest: true,  multipleSlots: true  },
    { key: "14-20", pageNum: 14, label: "Cash on hand or money kept at home?",                                   institutionLabel: null,                      valueLabel: "Amount (USD)",            hasInterest: false, multipleSlots: false },
    { key: "14-21", pageNum: 14, label: "Investment accounts (stocks, bonds, CDs, mutual funds)?",               institutionLabel: "Brokerage / institution", valueLabel: "Current value (USD)",     hasInterest: false, multipleSlots: true  },
    { key: "15-25", pageNum: 15, label: "Real estate you own (other than this unit)?",                            institutionLabel: "Property description",    valueLabel: "Current market value (USD)", hasInterest: true, multipleSlots: true  },
    { key: "15-26", pageNum: 15, label: "Trust funds, life insurance with cash value, or other assets?",         institutionLabel: "Description of asset",    valueLabel: "Cash value (USD)",        hasInterest: true,  multipleSlots: true  },
  ];
  const assetFields: CompletionFormField[] = [];
  for (const q of assetQs) {
    const yesName = `${q.key}Y`;
    assetFields.push({
      pdfFieldName: yesName,
      resolverPair: { yes: yesName, no: `${q.key}N` },
      pageNumber: q.pageNum,
      label: q.label,
      fieldType: "yesno",
      required: true,
      completionOwner: "tenant",
      defaultValue: savedResponses.get(yesName) ?? "",
    });
    const suffix = q.multipleSlots ? "1" : "";
    if (q.institutionLabel) {
      const f = `${q.key}Info${suffix}`;
      assetFields.push({
        pdfFieldName: f,
        pageNumber: q.pageNum,
        label: q.institutionLabel,
        fieldType: "text",
        required: false,
        requiredWhenVisible: true,
        clearsValueWhenHidden: true,
        completionOwner: "tenant",
        parentFieldName: yesName,
        parentTriggerValue: "yes",
        defaultValue: savedResponses.get(f) ?? "",
      });
    }
    {
      const f = `${q.key}Value${suffix}`;
      assetFields.push({
        pdfFieldName: f,
        pageNumber: q.pageNum,
        label: q.valueLabel,
        fieldType: "amount",
        required: false,
        requiredWhenVisible: true,
        clearsValueWhenHidden: true,
        completionOwner: "tenant",
        parentFieldName: yesName,
        parentTriggerValue: "yes",
        defaultValue: savedResponses.get(f) ?? "",
      });
    }
    if (q.hasInterest) {
      const f = `${q.key}Interest${suffix}`;
      assetFields.push({
        pdfFieldName: f,
        pageNumber: q.pageNum,
        label: "Interest rate (%) — optional",
        fieldType: "text",
        required: false,
        requiredWhenVisible: false,
        clearsValueWhenHidden: true,
        completionOwner: "tenant",
        parentFieldName: yesName,
        parentTriggerValue: "yes",
        defaultValue: savedResponses.get(f) ?? "",
      });
    }
    // Optional second slot
    if (q.multipleSlots) {
      if (q.institutionLabel) {
        const f = `${q.key}Info2`;
        assetFields.push({
          pdfFieldName: f,
          pageNumber: q.pageNum,
          label: `${q.institutionLabel} (additional account) — optional`,
          fieldType: "text",
          required: false,
          requiredWhenVisible: false,
          clearsValueWhenHidden: true,
          completionOwner: "tenant",
          parentFieldName: yesName,
          parentTriggerValue: "yes",
          defaultValue: savedResponses.get(f) ?? "",
        });
      }
      const fVal2 = `${q.key}Value2`;
      assetFields.push({
        pdfFieldName: fVal2,
        pageNumber: q.pageNum,
        label: `${q.valueLabel.replace(/\s*\(USD\)$/, "")} (additional account, USD) — optional`,
        fieldType: "amount",
        required: false,
        requiredWhenVisible: false,
        clearsValueWhenHidden: true,
        completionOwner: "tenant",
        parentFieldName: yesName,
        parentTriggerValue: "yes",
        defaultValue: savedResponses.get(fVal2) ?? "",
      });
      if (q.hasInterest) {
        const fInt2 = `${q.key}Interest2`;
        assetFields.push({
          pdfFieldName: fInt2,
          pageNumber: q.pageNum,
          label: "Interest rate (%) (additional account) — optional",
          fieldType: "text",
          required: false,
          requiredWhenVisible: false,
          clearsValueWhenHidden: true,
          completionOwner: "tenant",
          parentFieldName: yesName,
          parentTriggerValue: "yes",
          defaultValue: savedResponses.get(fInt2) ?? "",
        });
      }
    }
  }
  sections.push({
    key: "ticq_assets",
    title: "6. Asset questions (TICQ)",
    description: "Answer Yes if you have the asset type. If you answer Yes, fields appear so you can list each account / asset. We will request a recent statement for each Yes answer.",
    fields: assetFields,
  });

  // SECTION 7 — Free-text catch-all
  sections.push({
    key: "additional",
    title: "7. Additional information",
    description: "Anything else BaxterOps or Urban Futures should know. Optional.",
    fields: [
      {
        pdfFieldName: "rov_tenant_explanation",
        pageNumber: 24,
        label: "Tenant notes / clarifications",
        fieldType: "longtext",
        required: false,
        completionOwner: "tenant",
        defaultValue: savedResponses.get("rov_tenant_explanation") ?? "",
      },
    ],
  });

  void fillResults;  // surfaced via resolver in default-value computation paths above

  const totalRequired = sections.flatMap(s => s.fields).filter(f => f.required).length;
  const completed = countCompleted(sections, savedResponses);
  return { caseId, templateId: TEMPLATE_ID, role: "tenant", caseSummary: summary(c), sections, totalRequired, completed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Manager form schema
// ─────────────────────────────────────────────────────────────────────────────

export async function buildManagerFormSchema(caseId: string): Promise<CompletionFormSchema | null> {
  const c = await getCaseById(caseId);
  if (!c) return null;
  const [savedResponses] = await Promise.all([
    loadSavedResponses(caseId, "manager"),
  ]);

  const sections: CompletionFormSection[] = [];

  sections.push({
    key: "manager_identity",
    title: "1. Manager identity",
    description: "Owner / Duly Authorized Agent submitting this packet.",
    fields: [
      { pdfFieldName: "3-OPMName",  pageNumber: 3, label: "Manager full name",      fieldType: "name",  required: true,  completionOwner: "manager", defaultValue: savedResponses.get("3-OPMName") ?? "" },
      { pdfFieldName: "3-Title",    pageNumber: 3, label: "Manager title",          fieldType: "text",  required: true,  completionOwner: "manager", defaultValue: savedResponses.get("3-Title") ?? "" },
      { pdfFieldName: "3-Email",    pageNumber: 3, label: "Manager email",          fieldType: "text",  required: true,  completionOwner: "manager", defaultValue: savedResponses.get("3-Email") ?? "" },
      { pdfFieldName: "3-Date",     pageNumber: 3, label: "Submission date",        fieldType: "date",  required: true,  completionOwner: "manager", defaultValue: savedResponses.get("3-Date") ?? "" },
    ],
  });

  sections.push({
    key: "manager_role",
    title: "2. Submitter role",
    description: "Submitting as Owner or Duly Authorized Agent?",
    fields: [
      {
        pdfFieldName: "3-Owner",
        resolverPair: { yes: "3-Owner", no: "3-Duly Authorized Agent" },
        pageNumber: 3,
        label: "Submitting as the property Owner",
        fieldType: "yesno",
        required: true,
        completionOwner: "manager",
        defaultValue: savedResponses.get("3-Owner") ?? "",
      },
    ],
  });

  sections.push({
    key: "income_level",
    title: "3. Income level for this tenant",
    description: "Pick the LAHD income band that applies to this case.",
    fields: [
      {
        pdfFieldName: "3-Extremely Low",
        pageNumber: 3,
        label: "Tenant income level",
        fieldType: "select",
        options: ["Extremely Low", "Very Low", "Low", "Moderate", "Workforce"],
        required: true,
        completionOwner: "manager",
        defaultValue: savedResponses.get("3-Extremely Low") ?? "",
      },
    ],
  });

  sections.push({
    key: "rent_review",
    title: "4. Rent calculation review",
    description: "Confirm tenant rent + subsidy + utility allowance. Leave blank if HACLA determination is pending.",
    fields: [
      { pdfFieldName: "8-MaximumAllowableRent", pageNumber: 8, label: "Maximum Allowable Rent",  fieldType: "amount", required: true,  completionOwner: "manager", defaultValue: savedResponses.get("8-MaximumAllowableRent") ?? (c.maxAllowableRent != null ? String(c.maxAllowableRent) : "") },
      { pdfFieldName: "8-UA",                    pageNumber: 8, label: "Utility allowance",        fieldType: "amount", required: false, completionOwner: "manager", defaultValue: savedResponses.get("8-UA") ?? (c.totalUtilityAllowance != null ? String(c.totalUtilityAllowance) : "") },
      { pdfFieldName: "8-TenantRent",            pageNumber: 8, label: "Tenant rent portion",      fieldType: "amount", required: false, completionOwner: "manager", defaultValue: savedResponses.get("8-TenantRent") ?? "" },
      { pdfFieldName: "8-RentalSubsidy",         pageNumber: 8, label: "Rental subsidy (HACLA)",   fieldType: "amount", required: false, completionOwner: "manager", defaultValue: savedResponses.get("8-RentalSubsidy") ?? "" },
    ],
  });

  sections.push({
    key: "manager_certification",
    title: "5. Manager certification",
    description: "Confirm you have reviewed all attached documentation.",
    fields: [
      {
        pdfFieldName: "manager_certification_complete",
        pageNumber: 24,
        label: "I have reviewed all documentation and confirm the values above are correct.",
        fieldType: "checkbox",
        required: true,
        completionOwner: "manager",
        defaultValue: savedResponses.get("manager_certification_complete") ?? "",
      },
      {
        pdfFieldName: "manager_notes",
        pageNumber: 24,
        label: "Internal manager notes",
        fieldType: "longtext",
        required: false,
        completionOwner: "manager",
        defaultValue: savedResponses.get("manager_notes") ?? "",
      },
    ],
  });

  const totalRequired = sections.flatMap(s => s.fields).filter(f => f.required).length;
  const completed = countCompleted(sections, savedResponses);
  return { caseId, templateId: TEMPLATE_ID, role: "manager", caseSummary: summary(c), sections, totalRequired, completed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Responses + sessions
// ─────────────────────────────────────────────────────────────────────────────

function packetIdFor(role: CompletionRole): string {
  return role === "tenant" ? "tenant_completion" : "manager_completion";
}

export async function loadSavedResponses(caseId: string, role: CompletionRole): Promise<Map<string, string>> {
  const sb = getSupabase();
  if (!sb) return new Map();
  const { data, error } = await sb
    .from("recert_packet_field_values")
    .select("field_key, value_text")
    .eq("case_id", caseId)
    .eq("packet_id", packetIdFor(role));
  if (error || !data) return new Map();
  const out = new Map<string, string>();
  for (const r of data as Array<{ field_key: string; value_text: string | null }>) {
    if (r.value_text != null) out.set(r.field_key, r.value_text);
  }
  return out;
}

function countCompleted(sections: CompletionFormSection[], responses: Map<string, string>): number {
  let n = 0;
  for (const s of sections) for (const f of s.fields) {
    // Skip follow-up fields whose parent isn't at the trigger value: they
    // don't count toward the completed total because they're not visible.
    if (f.parentFieldName) {
      const parentVal = responses.get(f.parentFieldName);
      if (parentVal !== f.parentTriggerValue) continue;
    }
    const v = responses.get(f.pdfFieldName);
    if (v != null && v !== "") n += 1;
  }
  return n;
}

/**
 * Returns true iff this field should be shown given the current set of
 * responses. Useful both for the renderer and for the API merge step.
 */
export function isFieldVisible(field: CompletionFormField, responses: Map<string, string>): boolean {
  if (!field.parentFieldName) return true;
  return responses.get(field.parentFieldName) === field.parentTriggerValue;
}

/**
 * Required field count after factoring in current parent answers.
 * Visible required fields count; hidden ones don't.
 */
export function computeDynamicRequired(sections: CompletionFormSection[], responses: Map<string, string>): number {
  let n = 0;
  for (const s of sections) for (const f of s.fields) {
    if (!isFieldVisible(f, responses)) continue;
    if (f.required) { n += 1; continue; }
    if (f.requiredWhenVisible) { n += 1; }
  }
  return n;
}

/**
 * For each follow-up field whose parent has flipped away from its trigger,
 * delete its stored value from recert_packet_field_values. Returns the list
 * of field names that were cleared. Caller is responsible for awaiting and
 * for showing a UI hint.
 */
export async function clearOrphanedFollowups(args: {
  caseId: string;
  role: CompletionRole;
  schema: CompletionFormSchema;
  responses: Map<string, string>;
}): Promise<string[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const cleared: string[] = [];
  for (const s of args.schema.sections) {
    for (const f of s.fields) {
      if (!f.parentFieldName) continue;
      const parentVal = args.responses.get(f.parentFieldName);
      if (parentVal === f.parentTriggerValue) continue;          // still visible
      if (f.clearsValueWhenHidden === false) continue;            // explicitly preserved
      const v = args.responses.get(f.pdfFieldName);
      if (v == null || v === "") continue;                        // nothing to clear
      const { error } = await sb
        .from("recert_packet_field_values")
        .delete()
        .eq("case_id", args.caseId)
        .eq("packet_id", packetIdFor(args.role))
        .eq("field_key", f.pdfFieldName);
      if (!error) cleared.push(f.pdfFieldName);
    }
  }
  return cleared;
}

export async function saveCompletionResponse(args: {
  caseId: string;
  role: CompletionRole;
  pdfFieldName: string;
  pageNumber: number;
  fieldType: CompletionFieldType;
  valueText?: string | null;
  valueJson?: Record<string, unknown> | null;
  actorRole?: CompletionRole;
  actorName?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "Supabase not configured" };
  const { error } = await sb.from("recert_packet_field_values").upsert({
    case_id: args.caseId,
    packet_id: packetIdFor(args.role),
    section_key: `page_${args.pageNumber}`,
    field_key: args.pdfFieldName,
    value_text: args.valueText ?? null,
    value_json: args.valueJson ?? { fieldType: args.fieldType, pageNumber: args.pageNumber },
    filled_by_role: args.actorRole ?? args.role,
    filled_by_name: args.actorName ?? null,
    status: "draft",
    updated_at: new Date().toISOString(),
  }, { onConflict: "case_id,packet_id,section_key,field_key" });
  if (error) return { ok: false, error: error.message };
  await touchSession(args.caseId, args.role);
  return { ok: true };
}

async function touchSession(caseId: string, role: CompletionRole) {
  const sb = getSupabase();
  if (!sb) return;
  const id = `cs-${caseId}-${role}`;
  await sb.from("recert_completion_sessions").upsert({
    id, case_id: caseId, role, status: "draft", updated_at: new Date().toISOString(),
  }, { onConflict: "case_id,role" });
}

export async function submitCompletionSession(args: {
  caseId: string;
  role: CompletionRole;
  submittedBy: string;
  totalRequired: number;
  completed: number;
}): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "Supabase not configured" };
  const id = `cs-${args.caseId}-${args.role}`;
  const { error } = await sb.from("recert_completion_sessions").upsert({
    id,
    case_id: args.caseId,
    role: args.role,
    status: "submitted",
    submitted_at: new Date().toISOString(),
    submitted_by: args.submittedBy,
    total_required: args.totalRequired,
    completed: args.completed,
  }, { onConflict: "case_id,role" });
  if (error) return { ok: false, error: error.message };
  try {
    await sb.from("recert_audit_events").insert({
      id: `ae-cs-${id}-${Date.now()}`,
      case_id: args.caseId,
      event_type: "recert_completion_submitted",
      event_summary: `${args.role} completion submitted by ${args.submittedBy} — ${args.completed}/${args.totalRequired} required fields complete.`,
      actor_email: args.submittedBy,
      event_payload_json: { role: args.role, totalRequired: args.totalRequired, completed: args.completed },
    });
  } catch { /* non-fatal */ }
  return { ok: true };
}

export async function loadSession(caseId: string, role: CompletionRole) {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from("recert_completion_sessions")
    .select("*")
    .eq("case_id", caseId)
    .eq("role", role)
    .maybeSingle();
  return data;
}
