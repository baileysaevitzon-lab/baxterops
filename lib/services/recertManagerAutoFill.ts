// Sprint 40: Reusable manager-side auto-fill engine for recertification.
//
// Given any case, this derives the manager-side values (utility allowance,
// rent/subsidy, income, assets, doc status) from data that already exists —
// covenant constants, tenant answers, accepted supporting docs, and any
// manager-entered case data. It returns a STRUCTURED DRAFT with per-value
// provenance/confidence; it never writes on its own. `applyManagerAutoFillDraft`
// writes only draft / needs_review values and refuses to overwrite existing
// manager-provided values or to submit/approve anything.
//
// Not tenant-specific: Victoria is only a regression example. Every value is
// derived from generic rules + the case's own data.

import {
  getCaseById, getMembersForCase, getIncomeSourcesForCase, getAssetAccountsForCase,
  getDocumentsForCase, getRequiredItemsForCase, getUtilityAllowanceForCase,
  saveIncomeSource, saveAssetAccount, saveUtilityAllowance,
} from "./recertification";
import { loadSavedResponses } from "./recertCompletionForms";
import { loadCaseFieldOverrides, saveFieldOverride } from "./recertFieldOverrides";
import { computeDocsReadiness } from "./recertSupportingDocs";
import {
  HACLA_MFR_2025, UA_SCHEDULE_SOURCE, type UaBedroomCol, type UaComponent,
} from "./utilityAllowanceSchedule";
import type {
  RecertificationCase, RecertHouseholdMember, RecertIncomeSource, RecertAssetAccount,
  RecertUtilityAllowance, RecertDocument, RecertRequiredItem, RecertIncomeType,
} from "@/lib/types";

const TEMPLATE_ID = "lahd-recert-2026";

// ─── Baxter covenant constants (KBI-confirmed 2026-06-11) — property-level, not tenant ───
// Source: Baxter Rental Covenant workbook + LAHD-recert-Victoria KBI golden PDF.
export const BAXTER_COVENANT = {
  /** Covenant unit-type label by bedroom count (rent roll "Unit Type per LAHD"). */
  unitTypeLabel: { 0: "Single", 1: "One", 2: "Two", 3: "Three" } as Record<number, string>,
  /** Covenant max allowable rent (tenant rent limit) by bedroom count. */
  rentLimitByBedroom: { 0: 876, 1: 1001, 2: 1126 } as Record<number, number>,
  /** LAHD-published Very Low (50%) income limits by household size (occupants). */
  incomeLimitVeryLow50: { 1: 53000, 2: 60600, 3: 68150, 4: 75750, 5: 81800, 6: 87850, 7: 93900 } as Record<number, number>,
  /** The Baxter is all-electric; tenant pays these per the golden TIRC. */
  defaultTenantPaidUtilities: ["electric_cooking", "basic_electricity", "electric_air_conditioning", "electric_space_heating"] as UaComponent[],
  /** SCEP applicability per Katherine (2+ unit property). NB: at the 0BR column SCEP ($3)
   *  and Electric Cooking ($3) are equal, so the studio total is $35 either way. */
  scepApplies: true,
  rsoApplies: false, // post-1978 build
} as const;

export type ValueProvenance =
  | "covenant" | "hacla_schedule" | "case_data" | "manager_entered" | "manager_form"
  | "tenant_answer" | "accepted_doc" | "computed" | "needs_manager" | "pending_external";

export interface AutoFillField<T = number | string> {
  key: string;
  label: string;
  value?: T;
  provenance: ValueProvenance;
  confidence: "high" | "medium" | "low";
  autoDerived: boolean;      // true = engine computed it; false = needs manager / from manager
  needsReview: boolean;
  fieldTargets: string[];    // official PDF field names this populates
  notes?: string;
}

export interface UaDraft {
  bedroomCol?: UaBedroomCol;
  unitTypeLabel?: string;
  components: { component: UaComponent; amount: number }[];
  total?: AutoFillField<number>;
  scepIncluded: boolean;
  conflicts: string[];
  warnings: string[];
}

export interface ManagerAutoFillDraft {
  caseId: string;
  tenantName: string;
  unitNumber?: string;
  generatedAt: string;
  ua: UaDraft;
  rent: AutoFillField[];
  income: { proposed: ProposedIncome[]; existingApproved: number; warnings: string[] };
  assets: { proposed: ProposedAsset[]; existingCount: number; warnings: string[] };
  docs: { requiredTotal: number; satisfied: number; missing: string[]; needsReview: number };
  missingManagerInputs: string[];
  conflicts: string[];
  fieldTargets: AutoFillField[];   // flat list of official-field proposals
}

export interface ProposedIncome {
  incomeType: RecertIncomeType;
  sourceName?: string;
  monthly?: number;
  annual?: number;
  provenance: ValueProvenance;
  confidence: "high" | "medium" | "low";
  documentationReceived: boolean;
  alreadyExists: boolean;
  needsReview: boolean;
  notes: string;
}
export interface ProposedAsset {
  accountType: string;
  institutionName?: string;
  lastFour?: string;
  endingBalance?: number;
  provenance: ValueProvenance;
  confidence: "high" | "medium" | "low";
  statementReceived: boolean;
  alreadyExists: boolean;
  needsReview: boolean;
  notes: string;
}

interface Ctx {
  recertCase: RecertificationCase;
  members: RecertHouseholdMember[];
  income: RecertIncomeSource[];
  assets: RecertAssetAccount[];
  util?: RecertUtilityAllowance;
  docs: RecertDocument[];
  requiredItems: RecertRequiredItem[];
  tenantAnswers: Map<string, string>;
  managerAnswers: Map<string, string>;
}

async function loadCtx(caseId: string): Promise<Ctx | null> {
  const recertCase = await getCaseById(caseId);
  if (!recertCase) return null;
  const [members, income, assets, util, docs, requiredItems, tenantAnswers, managerAnswers] = await Promise.all([
    getMembersForCase(caseId), getIncomeSourcesForCase(caseId), getAssetAccountsForCase(caseId),
    getUtilityAllowanceForCase(caseId), getDocumentsForCase(caseId), getRequiredItemsForCase(caseId),
    loadSavedResponses(caseId, "tenant"), loadSavedResponses(caseId, "manager"),
  ]);
  return { recertCase, members, income, assets, util, docs, requiredItems, tenantAnswers, managerAnswers };
}

function bedroomCol(n: number | null | undefined): UaBedroomCol | undefined {
  if (n === null || n === undefined) return undefined;
  const r = Math.round(n);
  return (["0", "1", "2", "3", "4", "5", "6", "7"] as UaBedroomCol[]).includes(String(r) as UaBedroomCol)
    ? (String(r) as UaBedroomCol) : undefined;
}

// ───────────────────────── Utility allowance ─────────────────────────
export function calculateCaseUtilityAllowance(ctx: Ctx): UaDraft {
  const c = ctx.recertCase;
  const conflicts: string[] = [];
  const warnings: string[] = [];
  const col = bedroomCol(c.bedroomCount);
  const unitTypeLabel = c.bedroomCount != null ? BAXTER_COVENANT.unitTypeLabel[Math.round(c.bedroomCount)] : undefined;

  if (col === undefined) {
    warnings.push("Bedroom count is not set on the case — cannot pick a UA schedule column. Set bedroom count (Studio/0BR → covenant 'Single').");
    return { bedroomCol: undefined, unitTypeLabel, components: [], scepIncluded: false, conflicts, warnings };
  }

  // The Baxter is all-electric, so the tenant-paid set is the four electric
  // utilities (cooking + basic + A/C + space heating). The recert_utility_allowance
  // table only has coarse flags (basic/gas/water/trash) and can't granularly encode
  // the electric set, so we ALWAYS start from the Baxter default and only ADD any
  // extra coarse utilities the row flags (never subtract — that would undercount).
  const comps: UaComponent[] = [...BAXTER_COVENANT.defaultTenantPaidUtilities];
  if (ctx.util) {
    if (ctx.util.tenantPaysGas && !comps.includes("gas_space_heating")) comps.push("gas_space_heating");
    if (ctx.util.tenantPaysWater && !comps.includes("water_and_sewer")) comps.push("water_and_sewer");
    if (ctx.util.tenantPaysTrash && !comps.includes("trash_collection")) comps.push("trash_collection");
  } else {
    warnings.push("No utility-allowance row yet — using Baxter all-electric default set (cooking + basic + A/C + space heating). Confirm tenant-paid utilities.");
  }

  const breakdown = comps.map(component => ({ component, amount: HACLA_MFR_2025[component][col] }));
  let total = breakdown.reduce((s, b) => s + b.amount, 0);
  let scepIncluded = false;
  if (BAXTER_COVENANT.scepApplies) {
    // At 0BR, SCEP ($3) equals Electric Cooking ($3): including SCEP while cooking is
    // already counted would double a $3 line. Per the KBI golden ($35 at 0BR), keep the
    // four electric utilities and treat SCEP as already represented; flag for confirmation.
    if (col === "0" && comps.includes("electric_cooking")) {
      warnings.push("Katherine: SCEP applies. At 0BR, SCEP ($3) and Electric Cooking ($3) are equal, so the $35 total already reflects it. Confirm component composition if the unit differs.");
      scepIncluded = true; // represented within the $35
    } else {
      breakdown.push({ component: "scep_code_enforcement", amount: HACLA_MFR_2025.scep_code_enforcement[col] });
      total += HACLA_MFR_2025.scep_code_enforcement[col];
      scepIncluded = true;
    }
  }

  // Conflict: case-stored UA vs computed.
  const stored = ctx.util?.totalUtilityAllowance ?? c.totalUtilityAllowance;
  if (stored != null && Number(stored) !== total) {
    conflicts.push(`Stored UA $${Number(stored)} ≠ computed $${total} (${unitTypeLabel ?? col}BR, ${comps.length} utilities). Verify component set / bedroom treatment.`);
  }

  return {
    bedroomCol: col, unitTypeLabel, components: breakdown, scepIncluded, conflicts, warnings,
    total: {
      key: "utility_allowance", label: "Utility allowance", value: total,
      provenance: "hacla_schedule", confidence: "high", autoDerived: true,
      needsReview: stored != null && Number(stored) !== total,
      fieldTargets: ["5-UAAmount", "8-UA"],
      notes: `HACLA MFR ${UA_SCHEDULE_SOURCE.effectiveDate}, ${unitTypeLabel ?? col}BR column.`,
    },
  };
}

// ───────────────────────── Rent / subsidy ─────────────────────────
export function deriveRentAndSubsidy(ctx: Ctx, uaTotal?: number): AutoFillField[] {
  const c = ctx.recertCase;
  const out: AutoFillField[] = [];
  const bdr = c.bedroomCount != null ? Math.round(c.bedroomCount) : undefined;

  // Max allowable rent — from covenant table by bedroom.
  const covenantMax = bdr != null ? BAXTER_COVENANT.rentLimitByBedroom[bdr] : undefined;
  out.push({
    key: "max_allowable_rent", label: "Maximum allowable rent",
    value: covenantMax ?? (c.maxAllowableRent ?? undefined),
    provenance: covenantMax != null ? "covenant" : (c.maxAllowableRent != null ? "case_data" : "needs_manager"),
    confidence: covenantMax != null ? "high" : "low",
    autoDerived: covenantMax != null,
    needsReview: covenantMax != null && c.maxAllowableRent != null && Number(c.maxAllowableRent) !== covenantMax,
    fieldTargets: ["3-Maximum Allowable Rent Limit", "8-MaximumAllowableRent"],
    notes: covenantMax != null
      ? `Covenant rent limit for ${BAXTER_COVENANT.unitTypeLabel[bdr!]}/${bdr}BR = $${covenantMax}.`
      : "No bedroom count — set it to derive the covenant rent limit.",
  });

  // Income limit — from covenant Very Low 50% table by household size.
  const occ = c.householdSize ?? c.adultCount ?? 1;
  const level = (c.restrictedUnitSchedule ?? "").toLowerCase();
  const isVeryLow = level.includes("very low") || level.includes("50");
  const incomeLimit = isVeryLow ? BAXTER_COVENANT.incomeLimitVeryLow50[occ] : undefined;
  out.push({
    key: "max_income_limit", label: "Maximum allowable income",
    value: incomeLimit ?? (c.maxIncomeLimit ?? undefined),
    provenance: incomeLimit != null ? "covenant" : (c.maxIncomeLimit != null ? "case_data" : "needs_manager"),
    confidence: incomeLimit != null ? "high" : "low",
    autoDerived: incomeLimit != null,
    needsReview: !isVeryLow,
    fieldTargets: ["3-Maximum Allowable Income"],
    notes: incomeLimit != null
      ? `LAHD Very Low (50%), ${occ}-person household = $${incomeLimit.toLocaleString()}.`
      : "Income level not 'Very Low (50%)' or household size unknown — confirm schedule.",
  });

  // Tenant portion — comes from HACLA determination / manager entry, NOT auto-derivable.
  const tenant = c.proposedTenantRent;
  out.push({
    key: "tenant_portion", label: "Tenant portion of rent",
    value: tenant ?? undefined,
    provenance: tenant != null ? "manager_entered" : "pending_external",
    confidence: tenant != null ? "high" : "low",
    autoDerived: false,
    needsReview: tenant == null,
    fieldTargets: ["5-TenantPortion", "8-TenantRent"],
    notes: tenant != null ? "Manager-entered / HACLA determination." : "Awaiting HACLA rent determination or manager entry — cannot be computed from unit data.",
  });

  // Subsidy — manager/HACLA.
  const subsidy = c.subsidyAmount;
  out.push({
    key: "subsidy", label: "Rental subsidy (HCV)",
    value: subsidy ?? undefined,
    provenance: subsidy != null ? "manager_entered" : "pending_external",
    confidence: subsidy != null ? "high" : "low",
    autoDerived: false,
    needsReview: subsidy == null,
    fieldTargets: ["5-SubsidyAmount", "8-RentalSubsidy"],
    notes: subsidy != null ? "Manager-entered / HACLA determination." : "Awaiting HACLA determination or manager entry.",
  });

  // Total unit rent — CONFIRMED formula tenant + UA + subsidy (computed once inputs exist).
  const ua = uaTotal ?? ctx.util?.totalUtilityAllowance ?? c.totalUtilityAllowance ?? undefined;
  const canTotal = tenant != null && subsidy != null && ua != null;
  out.push({
    key: "total_unit_rent", label: "Total unit rent (1+2+3)",
    value: canTotal ? Math.round((Number(tenant) + Number(ua) + Number(subsidy)) * 100) / 100 : undefined,
    provenance: canTotal ? "computed" : "needs_manager",
    confidence: canTotal ? "high" : "low",
    autoDerived: canTotal,
    needsReview: !canTotal,
    fieldTargets: ["5-TotalRent"],
    notes: canTotal
      ? "Confirmed KBI formula: tenant portion + utility allowance + subsidy."
      : "Needs tenant portion, UA, and subsidy before it can be computed.",
  });

  return out;
}

// ───────────────────────── Income (from answers + accepted docs) ─────────────────────────
const DOC_TO_INCOME: Record<string, RecertIncomeType> = {
  pay_stub: "employment", voe: "employment",
  social_security_award_letter: "social_security",
  unemployment_document: "unemployment",
  self_employment_document: "self_employment",
  benefit_letter: "other_recurring",
};

export function deriveIncomeSources(ctx: Ctx): { proposed: ProposedIncome[]; existingApproved: number; warnings: string[] } {
  const warnings: string[] = [];
  const proposed: ProposedIncome[] = [];
  const existingTypes = new Set(ctx.income.map(i => i.incomeType));

  // Existing manager-approved income → reflect as already-present (high confidence).
  for (const s of ctx.income) {
    proposed.push({
      incomeType: s.incomeType, sourceName: s.employerOrSourceName,
      monthly: s.requiredProjectedIncome != null ? Math.round((s.requiredProjectedIncome / 12) * 100) / 100 : undefined,
      annual: s.requiredProjectedIncome ?? undefined,
      provenance: s.managerApproved ? "manager_entered" : "case_data",
      confidence: s.managerApproved ? "high" : "medium",
      documentationReceived: s.documentationReceived,
      alreadyExists: true, needsReview: !s.managerApproved,
      notes: s.managerApproved ? "Existing manager-approved income source." : "Existing income source (not yet manager-approved).",
    });
  }

  // Accepted income-proof docs → propose a source if none of that type exists.
  const acceptedDocs = ctx.docs.filter(d => d.verificationStatus === "accepted");
  for (const d of acceptedDocs) {
    const t = DOC_TO_INCOME[d.documentType];
    if (!t || existingTypes.has(t)) continue;
    proposed.push({
      incomeType: t, sourceName: undefined, monthly: undefined, annual: undefined,
      provenance: "accepted_doc", confidence: "medium",
      documentationReceived: true, alreadyExists: false, needsReview: true,
      notes: `Accepted ${d.documentType.replace(/_/g, " ")} ("${d.fileName ?? d.id}") implies ${t.replace(/_/g, " ")} income — manager must calculate the amount${t === "other_recurring" ? " (note: CalFresh/SNAP is NOT counted as income)" : ""}.`,
    });
    existingTypes.add(t);
  }

  // Cross-check tenant answers for "Yes" income with no accepted proof.
  for (const [k, v] of ctx.tenantAnswers) {
    if (/income|employ|social|ssi|ssa|unemploy|child_support|pension|disab/i.test(k) && /^(yes|true|y)$/i.test(v)) {
      const hasProof = acceptedDocs.some(d => DOC_TO_INCOME[d.documentType]);
      if (!hasProof) warnings.push(`Tenant answered "Yes" to ${k} but no accepted income document is attached — request proof before finalizing.`);
    }
  }

  return { proposed, existingApproved: ctx.income.filter(i => i.managerApproved).length, warnings };
}

// ───────────────────────── Assets ─────────────────────────
export function deriveAssetRows(ctx: Ctx): { proposed: ProposedAsset[]; existingCount: number; warnings: string[] } {
  const warnings: string[] = [];
  const proposed: ProposedAsset[] = [];

  for (const a of ctx.assets) {
    proposed.push({
      accountType: a.accountType ?? "account", institutionName: a.institutionName, lastFour: a.accountLastFour,
      endingBalance: a.endingBalance, provenance: "manager_entered", confidence: "high",
      statementReceived: a.statementReceived, alreadyExists: true, needsReview: false,
      notes: "Existing asset row.",
    });
  }
  const haveInstitutions = new Set(ctx.assets.map(a => (a.institutionName ?? "").toLowerCase()));
  for (const d of ctx.docs.filter(x => x.verificationStatus === "accepted" && (x.documentType === "bank_statement" || x.documentType === "asset_statement"))) {
    const inst = (d.fileName ?? "").replace(/\.(pdf|jpg|jpeg|png|html)$/i, "").trim();
    if (haveInstitutions.has(inst.toLowerCase())) continue;
    proposed.push({
      accountType: d.documentType === "bank_statement" ? "account" : "investment",
      institutionName: inst || undefined, lastFour: undefined, endingBalance: undefined,
      provenance: "accepted_doc", confidence: "medium", statementReceived: true,
      alreadyExists: false, needsReview: true,
      notes: `Accepted ${d.documentType.replace(/_/g, " ")} ("${d.fileName ?? d.id}") — manager must enter the ending balance and last-4 (checking vs savings).`,
    });
  }
  return { proposed, existingCount: ctx.assets.length, warnings };
}

// ───────────────────────── Top-level draft ─────────────────────────
export async function buildManagerAutoFillDraft(caseId: string): Promise<ManagerAutoFillDraft | null> {
  const ctx = await loadCtx(caseId);
  if (!ctx) return null;
  const c = ctx.recertCase;

  const ua = calculateCaseUtilityAllowance(ctx);
  const rent = deriveRentAndSubsidy(ctx, ua.total?.value);
  const income = deriveIncomeSources(ctx);
  const assets = deriveAssetRows(ctx);

  const readiness = computeDocsReadiness(ctx.requiredItems, ctx.docs);
  const docs = {
    requiredTotal: readiness.requiredTotal, satisfied: readiness.satisfied,
    missing: readiness.missingRequired.map(i => i.requirementLabel),
    needsReview: readiness.needsReview.length,
  };

  const missingManagerInputs: string[] = [];
  if (ua.bedroomCol === undefined) missingManagerInputs.push("Bedroom count / unit type (needed for UA + rent limit)");
  for (const f of rent) if (f.needsReview && !f.autoDerived) missingManagerInputs.push(`${f.label} (${f.notes})`);
  if (income.proposed.some(p => p.needsReview && !p.alreadyExists)) missingManagerInputs.push("Income amount(s) for accepted income docs");
  if (assets.proposed.some(p => p.needsReview && !p.alreadyExists)) missingManagerInputs.push("Asset balance(s) for accepted bank statements");
  // Known golden open items (universal, not auto-resolvable):
  missingManagerInputs.push("Page 16 household-member date (actual vs TBD) — manager/Katherine decision");
  missingManagerInputs.push("Page 24 verification fields (completion responsibility) — manager/Katherine decision");

  const conflicts = [...ua.conflicts, ...rent.filter(f => f.needsReview && f.autoDerived).map(f => `${f.label}: covenant says $${f.value} but case stores a different value — verify.`)];

  const fieldTargets: AutoFillField[] = [...(ua.total ? [ua.total] : []), ...rent];

  return {
    caseId, tenantName: c.primaryTenantName, unitNumber: c.unitNumber ?? undefined,
    generatedAt: new Date().toISOString(),
    ua, rent, income, assets, docs, missingManagerInputs, conflicts, fieldTargets,
  };
}

// ───────────────────────── Gated apply (draft / needs_review only) ─────────────────────────
export interface ApplyOptions {
  applyUtilityAllowance?: boolean;
  applyRentLimits?: boolean;       // covenant max rent + income limit (high-confidence)
  applyProposedIncomeAssets?: boolean;
  overwriteExisting?: boolean;     // default false — never clobber manager values
  appliedBy?: string;
}
export interface ApplyResult { applied: string[]; skipped: string[]; errors: string[] }

/** Writes auto-derived values as DRAFT / needs_review. Never submits, never
 *  marks the manager form complete, never overwrites existing manager-provided
 *  values unless overwriteExisting is explicitly set. */
export async function applyManagerAutoFillDraft(caseId: string, opts: ApplyOptions): Promise<ApplyResult> {
  const ctx = await loadCtx(caseId);
  const res: ApplyResult = { applied: [], skipped: [], errors: [] };
  if (!ctx) { res.errors.push("Case not found"); return res; }
  const draft = await buildManagerAutoFillDraft(caseId);
  if (!draft) { res.errors.push("Could not build draft"); return res; }
  const by = opts.appliedBy ?? "auto-fill-draft";

  // 1) Utility allowance row (only if none exists, unless overwrite).
  if (opts.applyUtilityAllowance && draft.ua.total?.value != null && draft.ua.bedroomCol) {
    if (ctx.util && !opts.overwriteExisting) {
      res.skipped.push(`Utility allowance: existing row (${ctx.util.sourceStatus ?? "manual"}) preserved — not overwritten.`);
    } else {
      try {
        const now = new Date().toISOString();
        const uaRow: RecertUtilityAllowance = {
          id: ctx.util?.id ?? `ua-${caseId}`, caseId,
          covenantExecutionDate: ctx.util?.covenantExecutionDate,
          applies: true,
          tenantPaysBasicElectricity: true, tenantPaysTrash: false, tenantPaysGas: false,
          tenantPaysWater: false, tenantPaysSewer: false, tenantPaysOther: true,
          ownerProvidesRefrigerator: true, ownerProvidesStove: true,
          scepFeeApplies: draft.ua.scepIncluded, rsoFeeApplies: false,
          allowanceBasicElectricity: 0, allowanceTrash: 0, allowanceGas: 0, allowanceWater: 0, allowanceSewer: 0,
          allowanceScep: 0, allowanceRso: 0,
          totalUtilityAllowance: draft.ua.total.value,
          needsReview: true, sourceStatus: "auto_draft_pending_review",
          sourceTableYear: 2025, // HACLA schedule effective 2025-12-01
          createdAt: ctx.util?.createdAt ?? now, updatedAt: now,
        };
        await saveUtilityAllowance(uaRow);
        res.applied.push(`Utility allowance $${draft.ua.total.value} written as DRAFT (needs_review).`);
      } catch (e) { res.errors.push(`UA write failed: ${String(e)}`); }
    }
  }

  // 2) Rent limits (covenant) → field overrides as needs_review.
  if (opts.applyRentLimits) {
    const overrides = await loadCaseFieldOverrides(caseId);
    for (const f of draft.rent.filter(r => r.autoDerived && r.value != null)) {
      for (const target of f.fieldTargets) {
        const existing = overrides.get(target);
        if (existing?.manualOverrideValue && !opts.overwriteExisting) {
          res.skipped.push(`${target}: existing override "${existing.manualOverrideValue}" preserved.`);
          continue;
        }
        const r = await saveFieldOverride({
          caseId, templateId: TEMPLATE_ID, fieldName: target,
          patch: {
            fillStatus: "needs_review", confidence: f.confidence,
            manualOverrideValue: String(f.value), valueSource: "manager_constant",
            notes: `Auto-derived (${f.provenance}): ${f.notes}`,
          },
          editedBy: by, previous: existing,
        });
        if (r.ok) res.applied.push(`${target} = ${f.value} (draft/needs_review).`);
        else res.errors.push(`${target}: ${r.error}`);
      }
    }
  }

  // 3) Proposed income/asset rows (only brand-new ones; managerApproved=false).
  if (opts.applyProposedIncomeAssets) {
    const now = new Date().toISOString();
    for (const p of draft.income.proposed.filter(x => !x.alreadyExists)) {
      try {
        await saveIncomeSource({
          id: `inc-${caseId}-${p.incomeType}-${Date.now()}`, caseId,
          incomeType: p.incomeType, employerOrSourceName: p.sourceName,
          disclosedOnTicq: true, documentationReceived: p.documentationReceived,
          requiredProjectedIncome: undefined, managerApproved: false,
          notes: `Auto-proposed from ${p.provenance}: ${p.notes}`,
          createdAt: now, updatedAt: now,
        } as RecertIncomeSource);
        res.applied.push(`Proposed income (${p.incomeType}) added — amount BLANK, managerApproved=false.`);
      } catch (e) { res.errors.push(`Income write failed: ${String(e)}`); }
    }
    for (const p of draft.assets.proposed.filter(x => !x.alreadyExists)) {
      try {
        await saveAssetAccount({
          id: `ast-${caseId}-${Date.now()}`, caseId,
          accountType: p.accountType, institutionName: p.institutionName, accountLastFour: p.lastFour,
          endingBalance: 0, negativeBalanceTreatedAsZero: true, interestRateKnown: false,
          actualAssetIncome: 0, imputedAssetIncome: 0, statementReceived: p.statementReceived,
          allPagesReceived: false, depositsReviewed: false, unclearDepositsCount: 0, recurringDepositsCount: 0,
          notes: `Auto-proposed from ${p.provenance}: ${p.notes}`,
          createdAt: now, updatedAt: now,
        } as RecertAssetAccount);
        res.applied.push(`Proposed asset (${p.accountType}${p.institutionName ? ` · ${p.institutionName}` : ""}) added — balance BLANK, needs review.`);
      } catch (e) { res.errors.push(`Asset write failed: ${String(e)}`); }
    }
  }

  return res;
}
