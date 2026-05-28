// Sprint 9 — Recertification Command Center service layer.
//
// All reads/writes go through the existing persistence adapter (Supabase).
// camelCase ↔ snake_case mapping is handled by the adapter's column mapper.
// Sensitive data (names, income, contact info) is in Supabase only; the
// JS bundle contains only demo seed strings, not real tenant data.

import { list, upsert, upsertMany, where, findById, remove } from "./persistence";
import { TABLES } from "./tables";
import type {
  RecertificationCase,
  RecertHouseholdMember,
  RecertDocument,
  RecertRequiredItem,
  RecertIncomeSource,
  RecertAssetAccount,
  RecertDepositReview,
  RecertUtilityAllowance,
  RecertAiReview,
  RecertClarificationRequest,
  RecertAuditEvent,
} from "@/lib/types";

// ── Cases ────────────────────────────────────────────────────────────────────

export async function getAllCases(): Promise<RecertificationCase[]> {
  return list<RecertificationCase>(TABLES.recertificationCases);
}

export async function getCaseById(id: string): Promise<RecertificationCase | undefined> {
  return findById<RecertificationCase>(TABLES.recertificationCases, id);
}

export async function saveCase(c: RecertificationCase): Promise<RecertificationCase> {
  c.updatedAt = new Date().toISOString();
  return upsert<RecertificationCase>(TABLES.recertificationCases, c);
}

export async function deleteCase(id: string): Promise<void> {
  return remove(TABLES.recertificationCases, id);
}

// ── Household Members ────────────────────────────────────────────────────────

export async function getMembersForCase(caseId: string): Promise<RecertHouseholdMember[]> {
  return where<RecertHouseholdMember>(TABLES.recertHouseholdMembers, m => m.caseId === caseId);
}

export async function saveMember(m: RecertHouseholdMember): Promise<RecertHouseholdMember> {
  m.updatedAt = new Date().toISOString();
  return upsert<RecertHouseholdMember>(TABLES.recertHouseholdMembers, m);
}

export async function deleteMember(id: string): Promise<void> {
  return remove(TABLES.recertHouseholdMembers, id);
}

// ── Documents ────────────────────────────────────────────────────────────────

export async function getDocumentsForCase(caseId: string): Promise<RecertDocument[]> {
  return where<RecertDocument>(TABLES.recertDocuments, d => d.caseId === caseId);
}

export async function saveDocument(d: RecertDocument): Promise<RecertDocument> {
  d.updatedAt = new Date().toISOString();
  return upsert<RecertDocument>(TABLES.recertDocuments, d);
}

export async function deleteDocument(id: string): Promise<void> {
  return remove(TABLES.recertDocuments, id);
}

// ── Required Items ───────────────────────────────────────────────────────────

export async function getRequiredItemsForCase(caseId: string): Promise<RecertRequiredItem[]> {
  return where<RecertRequiredItem>(TABLES.recertRequiredItems, r => r.caseId === caseId);
}

export async function saveRequiredItem(r: RecertRequiredItem): Promise<RecertRequiredItem> {
  r.updatedAt = new Date().toISOString();
  return upsert<RecertRequiredItem>(TABLES.recertRequiredItems, r);
}

export async function bulkSaveRequiredItems(items: RecertRequiredItem[]): Promise<RecertRequiredItem[]> {
  return upsertMany<RecertRequiredItem>(TABLES.recertRequiredItems, items);
}

// ── Income Sources ────────────────────────────────────────────────────────────

export async function getIncomeSourcesForCase(caseId: string): Promise<RecertIncomeSource[]> {
  return where<RecertIncomeSource>(TABLES.recertIncomeSources, s => s.caseId === caseId);
}

export async function saveIncomeSource(s: RecertIncomeSource): Promise<RecertIncomeSource> {
  s.updatedAt = new Date().toISOString();
  return upsert<RecertIncomeSource>(TABLES.recertIncomeSources, s);
}

// ── Asset Accounts ────────────────────────────────────────────────────────────

export async function getAssetAccountsForCase(caseId: string): Promise<RecertAssetAccount[]> {
  return where<RecertAssetAccount>(TABLES.recertAssetAccounts, a => a.caseId === caseId);
}

export async function saveAssetAccount(a: RecertAssetAccount): Promise<RecertAssetAccount> {
  a.updatedAt = new Date().toISOString();
  return upsert<RecertAssetAccount>(TABLES.recertAssetAccounts, a);
}

// ── Deposit Reviews ───────────────────────────────────────────────────────────

export async function getDepositReviewsForCase(caseId: string): Promise<RecertDepositReview[]> {
  return where<RecertDepositReview>(TABLES.recertDepositReviews, d => d.caseId === caseId);
}

export async function saveDepositReview(d: RecertDepositReview): Promise<RecertDepositReview> {
  d.updatedAt = new Date().toISOString();
  return upsert<RecertDepositReview>(TABLES.recertDepositReviews, d);
}

// ── Utility Allowance ──────────────────────────────────────────────────────────

export async function getUtilityAllowanceForCase(caseId: string): Promise<RecertUtilityAllowance | undefined> {
  const rows = await where<RecertUtilityAllowance>(TABLES.recertUtilityAllowance, u => u.caseId === caseId);
  return rows[0];
}

export async function saveUtilityAllowance(u: RecertUtilityAllowance): Promise<RecertUtilityAllowance> {
  u.updatedAt = new Date().toISOString();
  // Strip the generated column before upsert — DB computes it
  const { totalUtilityAllowance: _computed, ...rest } = u;
  void _computed;
  return upsert<RecertUtilityAllowance>(TABLES.recertUtilityAllowance, rest as RecertUtilityAllowance);
}

// ── AI Reviews ────────────────────────────────────────────────────────────────

export async function getAiReviewForCase(caseId: string): Promise<RecertAiReview | undefined> {
  const rows = await where<RecertAiReview>(TABLES.recertAiReviews, r => r.caseId === caseId);
  return rows[0];
}

export async function saveAiReview(r: RecertAiReview): Promise<RecertAiReview> {
  r.updatedAt = new Date().toISOString();
  return upsert<RecertAiReview>(TABLES.recertAiReviews, r);
}

// Run a checklist-based review (no OCR — honest MVP).
// Inspects structured metadata already in the DB; does NOT parse document contents.
export async function runChecklistReview(
  caseId: string,
  members: RecertHouseholdMember[],
  requiredItems: RecertRequiredItem[],
  deposits: RecertDepositReview[],
  incomes: RecertIncomeSource[],
  actorEmail?: string,
): Promise<RecertAiReview> {
  const now = new Date().toISOString();
  const issues: { issue: string; why: string; action: string }[] = [];

  // Signature checks
  for (const m of members.filter(m => m.isAdult)) {
    if (!m.ticqSigned) issues.push({ issue: `${m.fullName} has not signed TICQ`, why: "Required for all adults", action: "Send TICQ for signature" });
    if (!m.applicantStatementSigned) issues.push({ issue: `${m.fullName} Applicant Statement not signed`, why: "Required signature", action: "Request signature" });
    if (!m.conflictOfInterestSigned) issues.push({ issue: `${m.fullName} Conflict of Interest not signed`, why: "Required signature", action: "Request signature" });
  }

  // Missing/unclear required items
  for (const r of requiredItems.filter(r => r.status === "missing" || r.status === "needs_clarification")) {
    issues.push({ issue: `${r.requirementLabel} — ${r.status.replace("_", " ")}`, why: r.sourceReason ?? "Required for package", action: "Collect document" });
  }

  // Unexplained deposits
  for (const d of deposits.filter(d => d.documentationStatus === "needs_clarification")) {
    issues.push({
      issue: `Unexplained deposit $${d.depositAmount} on ${d.depositDate ?? "unknown date"} (${d.depositDescription ?? d.suspectedSource ?? "source unknown"})`,
      why: "May indicate undisclosed income source",
      action: "Request written explanation + supporting statement",
    });
  }

  // Income docs not received
  for (const s of incomes.filter(s => !s.documentationReceived)) {
    issues.push({ issue: `Income documentation missing for ${s.employerOrSourceName ?? s.incomeType}`, why: "Income must be documented", action: "Request pay stubs / benefit letter" });
  }

  // Manager approval pending
  for (const s of incomes.filter(s => !s.managerApproved && s.requiredProjectedIncome)) {
    issues.push({ issue: `Manager approval required for ${s.employerOrSourceName ?? s.incomeType} calculation`, why: "Required before submission", action: "Manager: review and approve income calculation" });
  }

  const status: RecertAiReview["reviewStatus"] = issues.length === 0 ? "ready" : "not_ready";
  const missingItems = requiredItems
    .filter(r => r.status === "missing" || r.status === "needs_clarification")
    .map(r => ({ label: r.requirementLabel, scope: r.requirementScope }));

  const review: RecertAiReview = {
    id: `air-${caseId}`,
    caseId,
    reviewStatus: status,
    summary: issues.length === 0
      ? "Checklist review completed — READY. All required items accounted for. Full OCR parsing not enabled."
      : `Checklist review completed — NOT READY. ${issues.length} issue${issues.length === 1 ? "" : "s"} found. Full OCR parsing not enabled.`,
    issuesJson: issues,
    missingItemsJson: missingItems,
    unexplainedDepositsJson: deposits.filter(d => d.documentationStatus === "needs_clarification")
      .map(d => ({ date: d.depositDate, amount: d.depositAmount, source: d.suspectedSource, status: d.documentationStatus })),
    signatureIssuesJson: members.filter(m => m.isAdult && !m.ticqSigned)
      .map(m => ({ member: m.fullName, form: "TICQ", signed: false })),
    incomeDocumentIssuesJson: incomes.filter(s => !s.documentationReceived)
      .map(s => ({ source: s.employerOrSourceName, type: s.incomeType })),
    assetIssuesJson: [],
    recommendedNextAction: issues.length === 0
      ? "Package appears complete. Generate final packet and submit to cert@ufbahc.com."
      : `Resolve ${issues.length} open issue${issues.length === 1 ? "" : "s"}. Consider generating a clarification request.`,
    reviewedAt: now,
    reviewedBy: actorEmail ?? "system (checklist)",
    createdAt: now,
    updatedAt: now,
  };

  return saveAiReview(review);
}

// ── Clarification Requests ────────────────────────────────────────────────────

export async function getClarificationsForCase(caseId: string): Promise<RecertClarificationRequest[]> {
  return where<RecertClarificationRequest>(TABLES.recertClarificationRequests, c => c.caseId === caseId);
}

export async function saveClarificationRequest(c: RecertClarificationRequest): Promise<RecertClarificationRequest> {
  c.updatedAt = new Date().toISOString();
  return upsert<RecertClarificationRequest>(TABLES.recertClarificationRequests, c);
}

// Build a clarification message from open issues
export function buildClarificationMessage(
  tenantName: string,
  issues: { issue: string }[],
): string {
  const items = issues.map((iss, i) => `${i + 1}. ${iss.issue}`).join("\n");
  return `Hi ${tenantName.split(" ")[0]},\n\nWe reviewed your documents and need a few items before we can complete your certification package:\n\n${items}\n\nPlease complete these items as soon as possible. Certification cannot be finalized until all items are resolved. Missing items delay the review process.\n\nPlease note that you cannot move into your unit until the certification package is complete and approved.\n\nThank you,\nThe Baxter Hollywood Management`;
}

// ── Audit Events ──────────────────────────────────────────────────────────────

export async function getAuditEventsForCase(caseId: string): Promise<RecertAuditEvent[]> {
  const all = await list<RecertAuditEvent>(TABLES.recertAuditEvents);
  return all.filter(e => e.caseId === caseId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function logAuditEvent(
  caseId: string,
  eventType: string,
  eventSummary: string,
  actorEmail?: string,
  payload?: Record<string, unknown>,
): Promise<RecertAuditEvent> {
  const now = new Date().toISOString();
  const event: RecertAuditEvent = {
    id: `evt-${caseId}-${Date.now()}`,
    caseId,
    eventType,
    eventSummary,
    actorEmail,
    eventPayloadJson: payload,
    createdAt: now,
  };
  return upsert<RecertAuditEvent>(TABLES.recertAuditEvents, event);
}

// ── Readiness Score Calculator ─────────────────────────────────────────────────
// Computes 0–100 from structured checklist fields. Does NOT parse doc contents.

export function computeReadinessScore(
  requiredItems: RecertRequiredItem[],
  members: RecertHouseholdMember[],
  incomes: RecertIncomeSource[],
  aiReview: RecertAiReview | undefined,
): number {
  if (requiredItems.length === 0) return 0;

  const weights: { key: string; weight: number; met: boolean }[] = [];

  // Required items (50% of total)
  const itemWeight = requiredItems.length > 0 ? 50 / requiredItems.length : 0;
  for (const r of requiredItems) {
    weights.push({ key: r.requirementKey, weight: itemWeight, met: r.status === "complete" });
  }

  // Signatures (20%)
  const adults = members.filter(m => m.isAdult);
  const sigWeight = adults.length > 0 ? 20 / (adults.length * 3) : 0;
  for (const m of adults) {
    weights.push({ key: `sig-ticq-${m.id}`, weight: sigWeight, met: !!m.ticqSigned });
    weights.push({ key: `sig-app-${m.id}`, weight: sigWeight, met: !!m.applicantStatementSigned });
    weights.push({ key: `sig-coi-${m.id}`, weight: sigWeight, met: !!m.conflictOfInterestSigned });
  }

  // Manager approvals (20%)
  const approvalWeight = incomes.length > 0 ? 20 / incomes.length : 0;
  for (const s of incomes) {
    weights.push({ key: `mgr-${s.id}`, weight: approvalWeight, met: s.managerApproved });
  }

  // AI review clear (10%)
  weights.push({ key: "ai_review", weight: 10, met: aiReview?.reviewStatus === "ready" });

  const earned = weights.reduce((s, w) => s + (w.met ? w.weight : 0), 0);
  const total = weights.reduce((s, w) => s + w.weight, 0);
  return total > 0 ? Math.round((earned / total) * 100) : 0;
}

// ── Utility Allowance Calculator ───────────────────────────────────────────────
// Rule: applies if covenant date >= 2017-04-01.
// Formula: max_tenant_rent = max_allowable_rent - total_utility_allowance
// HUD passbook rate 2026: 0.40%

export const HUD_PASSBOOK_RATE_2026 = 0.004; // 0.40%
export const ASSET_THRESHOLD_2026 = 52787;    // triggers imputed income

export function computeUtilityAllowance(ua: RecertUtilityAllowance): {
  totalAllowance: number;
  maxTenantRent: number;
  compliant: boolean;
  appliesReason: string;
} {
  const covenantDate = ua.covenantExecutionDate ? new Date(ua.covenantExecutionDate) : null;
  const cutoff = new Date("2017-04-01");
  const applies = covenantDate ? covenantDate >= cutoff : false;
  const appliesReason = !covenantDate
    ? "Covenant date unknown — mark needs_review"
    : applies
      ? "Covenant executed on or after April 1, 2017 — utility allowance applies"
      : "Covenant executed before April 1, 2017 — utility allowance does not apply";

  const totalAllowance = applies
    ? (ua.allowanceBasicElectricity ?? 0) +
      (ua.allowanceTrash ?? 0) +
      (ua.allowanceGas ?? 0) +
      (ua.allowanceWater ?? 0) +
      (ua.allowanceSewer ?? 0) +
      (ua.allowanceScep ?? 0) +
      (ua.allowanceRso ?? 0)
    : 0;

  const maxRent = ua.maxAllowableRent ?? 0;
  const maxTenantRent = maxRent - totalAllowance;
  const proposed = ua.proposedTenantRent ?? 0;
  const compliant = proposed > 0 ? proposed <= maxTenantRent : false;

  return { totalAllowance, maxTenantRent, compliant, appliesReason };
}

// ── Income Calculation ──────────────────────────────────────────────────────────

export function computeIncomeMethods(src: RecertIncomeSource): {
  avgPaycheck: number | null;
  ytdPaystub: number | null;
  hourly: number | null;
  voeYtd: number | null;
  highest: number | null;
  highestMethod: string | null;
} {
  // Method 1: average paycheck × paychecks per year
  const avgPaycheck =
    src.averagePaycheckGross && src.paychecksPerYear
      ? src.averagePaycheckGross * src.paychecksPerYear
      : src.calculationAveragePaycheck ?? null;

  // Method 2: annualize YTD paystub
  let ytdPaystub: number | null = null;
  if (src.ytdGrossPay && src.ytdPeriodStart && src.ytdPeriodEnd) {
    const start = new Date(src.ytdPeriodStart);
    const end = new Date(src.ytdPeriodEnd);
    const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    if (days > 0) ytdPaystub = (src.ytdGrossPay / days) * 365;
  } else if (src.calculationYtdPaystub) {
    ytdPaystub = src.calculationYtdPaystub;
  }

  // Method 3: hourly × hours × 52
  const hourly =
    src.hourlyRate && src.hoursPerWeek
      ? src.hourlyRate * src.hoursPerWeek * 52
      : src.calculationHourly ?? null;

  // Method 4: VOE YTD annualized
  let voeYtd: number | null = null;
  if (src.voeYtdGross && src.ytdPeriodStart && src.ytdPeriodEnd) {
    const start = new Date(src.ytdPeriodStart);
    const end = new Date(src.ytdPeriodEnd);
    const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    if (days > 0) voeYtd = (src.voeYtdGross / days) * 365;
  } else if (src.calculationVoeYtd) {
    voeYtd = src.calculationVoeYtd;
  }

  const candidates: { method: string; value: number }[] = [];
  if (avgPaycheck) candidates.push({ method: "average_paycheck", value: avgPaycheck });
  if (ytdPaystub) candidates.push({ method: "ytd_paystub", value: ytdPaystub });
  if (hourly) candidates.push({ method: "hourly", value: hourly });
  if (voeYtd) candidates.push({ method: "voe_ytd", value: voeYtd });

  const top = candidates.sort((a, b) => b.value - a.value)[0] ?? null;

  return {
    avgPaycheck,
    ytdPaystub,
    hourly,
    voeYtd,
    highest: top?.value ?? null,
    highestMethod: top?.method ?? null,
  };
}

// ── Asset Income Calculation ────────────────────────────────────────────────────

export function computeAssetIncome(
  accounts: RecertAssetAccount[],
): {
  totalAssets: number;
  thresholdTriggered: boolean;
  totalActualIncome: number;
  totalImputedIncome: number;
  totalIncomeUsed: number;
} {
  const totalAssets = accounts.reduce(
    (s, a) => s + Math.max(0, a.endingBalance),
    0,
  );
  const thresholdTriggered = totalAssets >= ASSET_THRESHOLD_2026;

  let totalActualIncome = 0;
  let totalImputedIncome = 0;
  let totalIncomeUsed = 0;

  for (const a of accounts) {
    const balance = Math.max(0, a.endingBalance);
    let actual = 0;
    let imputed = 0;

    if (a.interestRateKnown && a.interestRate != null) {
      actual = balance * a.interestRate;
    }
    if (thresholdTriggered && !a.interestRateKnown) {
      imputed = balance * HUD_PASSBOOK_RATE_2026;
    }

    const used = Math.max(actual, imputed);
    totalActualIncome += actual;
    totalImputedIncome += imputed;
    totalIncomeUsed += used;
  }

  return { totalAssets, thresholdTriggered, totalActualIncome, totalImputedIncome, totalIncomeUsed };
}

// ── Submission email draft ──────────────────────────────────────────────────────

export function buildSubmissionEmailDraft(c: RecertificationCase): { subject: string; body: string; to: string } {
  const to = "cert@ufbahc.com";
  const subject = `Income Certification Package — ${c.propertyName} Unit ${c.unitNumber ?? "TBD"} — ${c.primaryTenantName}`;
  const body = `Dear Urban Futures Bond Administration,

Please find attached the income certification package for the following:

Property: ${c.propertyName}
Address: 1818 N Cherokee Ave, Los Angeles, CA 90028
Unit: ${c.unitNumber ?? "TBD"}
Tenant / Household: ${c.primaryTenantName}
Certification Type: ${c.certificationType.replace("_", " ")}
Household Size: ${c.householdSize ?? "—"} (${c.adultCount} adults, ${c.childCount} children)

Attached documents (PDFs):
 - Completed income certification package
 - All required household member forms and signatures
 - Income documentation (pay stubs, VOE, benefit letters as applicable)
 - Bank/asset statements (all pages)
 - Utility allowance worksheet
 - Any clarification statements

Please confirm receipt of this submission and let us know if any additional items are needed.

Thank you,
[Property Manager Name]
The Baxter Hollywood — SGD Property Management
Contact: [Phone / Email]

---
Note: If attachments are too large, we will reply to this email thread with additional files.
Incomplete packages will not be reviewed. If additional items are required, please respond to this thread.
`;

  return { to, subject, body };
}
