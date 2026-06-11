// Sprint 35: Supporting-document management for recertification cases.
//
// Reuses existing Supabase tables (recert_required_items + recert_documents) — no
// new tables. Storage lives in the private `recert-supporting-docs` bucket under
// `recertification/{caseId}/supporting-docs/{documentId}/{filename}`.
//
// Honesty rules: uploads go to Supabase Storage (never localStorage); a failed
// upload throws (no fake success); unsupported types are surfaced, never silently
// dropped; the editable official LAHD PDF is untouched by anything here.
import { getSupabase } from "@/lib/supabase/client";
import { remove } from "./persistence";
import { TABLES } from "./tables";
import { saveRequiredItem, saveDocument, getRequiredItemsForCase } from "./recertification";
import type { RecertRequiredItem, RecertDocument, RecertDocumentType } from "@/lib/types";

export const SUPPORTING_DOCS_BUCKET = "recert-supporting-docs";

/** Common LAHD-style supporting document types for the "Add Required Document" dropdown.
 *  `key` is the stable requirement key (free text); `docType` maps to the constrained
 *  recert_documents.document_type enum used when a file is attached. */
export interface DocTypeCatalogEntry {
  key: string;
  label: string;
  docType: RecertDocumentType;
}
export const DOC_TYPE_CATALOG: DocTypeCatalogEntry[] = [
  { key: "government_id",          label: "Government ID",                                   docType: "other" },
  { key: "bank_statement",         label: "Bank Statement",                                  docType: "bank_statement" },
  { key: "pay_stub",               label: "Pay Stub",                                        docType: "pay_stub" },
  { key: "employer_verification",  label: "Employer Verification (VOE)",                     docType: "voe" },
  { key: "ssa_award_letter",       label: "Social Security / SSI / SSDI Award Letter",       docType: "social_security_award_letter" },
  { key: "public_assistance",      label: "CalFresh / SNAP / CalWORKs Benefits Letter",      docType: "benefit_letter" },
  { key: "unemployment",           label: "Unemployment Benefits Proof",                     docType: "unemployment_document" },
  { key: "pension_retirement",     label: "Pension / Retirement Statement",                  docType: "benefit_letter" },
  { key: "child_support",          label: "Child Support Proof",                             docType: "other" },
  { key: "w2",                     label: "W-2",                                             docType: "other" },
  { key: "form_1099",              label: "1099",                                            docType: "self_employment_document" },
  { key: "tax_return",             label: "Tax Return",                                      docType: "self_employment_document" },
  { key: "asset_statement",        label: "Asset Statement",                                 docType: "asset_statement" },
  { key: "lease_rent",             label: "Lease / Rent Document",                           docType: "rent_schedule" },
  { key: "utility_allowance",      label: "Utility Allowance Document",                      docType: "utility_allowance_table" },
  { key: "other",                  label: "Other / Custom",                                  docType: "other" },
];
export function catalogEntry(key: string): DocTypeCatalogEntry | undefined {
  return DOC_TYPE_CATALOG.find(e => e.key === key);
}

/** Standard requirement sets (Task 7). Each is a list of catalog keys. */
export const STANDARD_TEMPLATE_SETS: { key: string; label: string; keys: string[] }[] = [
  { key: "basic_identity_income", label: "Basic Identity + Income", keys: ["government_id", "pay_stub", "bank_statement"] },
  { key: "employment_income",     label: "Employment Income",       keys: ["pay_stub", "employer_verification", "w2"] },
  { key: "benefits_assistance",   label: "Benefits / Public Assistance", keys: ["ssa_award_letter", "public_assistance", "unemployment"] },
  { key: "assets_bank",           label: "Assets / Bank Statements", keys: ["bank_statement", "asset_statement"] },
  { key: "zero_income",           label: "No Income / Zero Income",  keys: ["government_id", "bank_statement"] },
];

const nowIso = () => new Date().toISOString();
const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

function sameRequirement(a: { requirementKey: string; requirementLabel: string }, key: string, label: string) {
  return a.requirementKey === key && a.requirementLabel.trim().toLowerCase() === label.trim().toLowerCase();
}

export interface AddRequiredItemInput {
  caseId: string;
  requirementKey: string;
  requirementLabel: string;
  requirementLevel?: RecertRequiredItem["requirementLevel"];
  dueDate?: string;
  instructions?: string;
  householdMemberId?: string;
  createdBy?: string;
}

export interface AddRequiredItemResult {
  ok: boolean;
  item?: RecertRequiredItem;
  duplicate?: RecertRequiredItem;
  error?: string;
}

/** Create a required document item with duplicate detection (same key + label). */
export async function addRequiredItem(input: AddRequiredItemInput, existing?: RecertRequiredItem[]): Promise<AddRequiredItemResult> {
  const label = input.requirementLabel.trim();
  if (!label) return { ok: false, error: "Document label is required." };
  if (!input.requirementKey) return { ok: false, error: "Document type is required." };

  const all = existing ?? (await getRequiredItemsForCase(input.caseId));
  const dup = all.find(r => sameRequirement(r, input.requirementKey, label));
  if (dup) return { ok: false, duplicate: dup, error: "A requirement with this type and label already exists for this case." };

  const ts = nowIso();
  const item: RecertRequiredItem = {
    id: newId("req"),
    caseId: input.caseId,
    householdMemberId: input.householdMemberId,
    requirementKey: input.requirementKey,
    requirementLabel: label,
    requirementScope: "household",
    status: "requested",
    requirementLevel: input.requirementLevel ?? "required",
    instructions: input.instructions?.trim() || undefined,
    dueDate: input.dueDate || undefined,
    createdBy: input.createdBy,
    createdAt: ts,
    updatedAt: ts,
  };
  const saved = await saveRequiredItem(item);
  return { ok: true, item: saved };
}

/** Add a standard set; skips any requirement already present. Returns created items. */
export async function addStandardSet(caseId: string, templateKey: string, createdBy?: string): Promise<{ created: RecertRequiredItem[]; skipped: string[] }> {
  const set = STANDARD_TEMPLATE_SETS.find(s => s.key === templateKey);
  if (!set) return { created: [], skipped: [] };
  const existing = await getRequiredItemsForCase(caseId);
  const created: RecertRequiredItem[] = [];
  const skipped: string[] = [];
  for (const key of set.keys) {
    const entry = catalogEntry(key);
    if (!entry) continue;
    const res = await addRequiredItem({ caseId, requirementKey: key, requirementLabel: entry.label, createdBy }, existing);
    if (res.ok && res.item) { created.push(res.item); existing.push(res.item); }
    else skipped.push(entry.label);
  }
  return { created, skipped };
}

export async function deleteRequiredItem(id: string): Promise<void> {
  return remove(TABLES.recertRequiredItems, id);
}

/** Update requirement level (required/optional/waived/not_applicable) + optional reason. */
export async function setRequirementLevel(item: RecertRequiredItem, level: NonNullable<RecertRequiredItem["requirementLevel"]>, reason?: string): Promise<RecertRequiredItem> {
  return saveRequiredItem({
    ...item,
    requirementLevel: level,
    waiverReason: (level === "waived" || level === "not_applicable") ? (reason?.trim() || item.waiverReason) : item.waiverReason,
    status: level === "not_applicable" ? "not_applicable" : item.status,
    updatedAt: nowIso(),
  });
}

// ---------- Upload ----------

export const SUPPORTED_UPLOAD_EXT = ["pdf", "jpg", "jpeg", "png"];
export const SEPARATE_ONLY_EXT = ["doc", "docx"]; // tracked, but "convert to PDF before bundle"
export const UNSUPPORTED_BUNDLE_EXT = ["heic", "heif"]; // no conversion utility available

export function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec((name || "").trim());
  return m ? m[1].toLowerCase() : "";
}
export type UploadSupportLevel = "supported" | "separate_only" | "unsupported";
export function uploadSupportLevel(name: string): UploadSupportLevel {
  const e = extOf(name);
  if (SUPPORTED_UPLOAD_EXT.includes(e)) return "supported";
  if (SEPARATE_ONLY_EXT.includes(e)) return "separate_only";
  if (UNSUPPORTED_BUNDLE_EXT.includes(e)) return "unsupported";
  return "unsupported";
}

export interface UploadSupportingDocInput {
  caseId: string;
  file: File;
  documentType: RecertDocumentType;
  requiredItemId?: string;
  householdMemberId?: string;
  uploadedBy?: string;
}

/** Upload a file to Supabase Storage and create the recert_documents row.
 *  Throws on any storage/DB failure — never reports a fake success. */
export async function uploadSupportingDoc(input: UploadSupportingDocInput): Promise<RecertDocument> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured — cannot upload.");

  const documentId = newId("doc");
  const safeName = (input.file.name || "file").replace(/[^A-Za-z0-9._-]/g, "_").replace(/_+/g, "_");
  const storagePath = `recertification/${input.caseId}/supporting-docs/${documentId}/${safeName}`;

  const { error: upErr } = await sb.storage.from(SUPPORTING_DOCS_BUCKET).upload(storagePath, input.file, {
    contentType: input.file.type || "application/octet-stream",
    upsert: false,
  });
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

  const ts = nowIso();
  const doc: RecertDocument = {
    id: documentId,
    caseId: input.caseId,
    requiredItemId: input.requiredItemId,
    householdMemberId: input.householdMemberId,
    documentType: input.documentType,
    fileName: input.file.name,
    storagePath,
    uploadedBy: input.uploadedBy,
    uploadedAt: ts,
    verificationStatus: "pending",
    createdAt: ts,
    updatedAt: ts,
  };
  try {
    return await saveDocument(doc);
  } catch (e) {
    // Roll back the orphaned storage object so we don't leave a file with no row.
    try { await sb.storage.from(SUPPORTING_DOCS_BUCKET).remove([storagePath]); } catch { /* best effort */ }
    throw e;
  }
}

/** Short-lived signed URL for opening/downloading a private supporting doc. */
export async function signedUrlForDoc(doc: RecertDocument, seconds = 120): Promise<string | null> {
  if (!doc.storagePath) return null;
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.storage.from(SUPPORTING_DOCS_BUCKET).createSignedUrl(doc.storagePath, seconds);
  return error ? null : (data?.signedUrl ?? null);
}

// ---------- Completeness ----------

/** A required item is satisfied if waived / N/A, or it has an accepted document. */
export function isRequiredItemSatisfied(item: RecertRequiredItem, docs: RecertDocument[]): boolean {
  // Waived / N/A → satisfied. status==='complete' kept for back-compat with items
  // marked done before the accepted-doc flow existed.
  if (item.requirementLevel === "waived" || item.requirementLevel === "not_applicable"
      || item.status === "not_applicable" || item.status === "complete") return true;
  return docs.some(d => d.requiredItemId === item.id && d.verificationStatus === "accepted");
}

export interface DocsReadiness {
  total: number;
  requiredTotal: number;
  satisfied: number;
  missingRequired: RecertRequiredItem[];   // required, no accepted doc, not waived/NA
  needsReview: RecertDocument[];           // uploaded but pending/received/reviewed
  needsClarification: RecertDocument[];    // needs_clarification
  rejected: RecertDocument[];
  unsupported: RecertDocument[];           // attached file is heic/etc
  waivedOrNa: RecertRequiredItem[];
  allRequiredSatisfied: boolean;
}

export function computeDocsReadiness(items: RecertRequiredItem[], docs: RecertDocument[]): DocsReadiness {
  const required = items.filter(i => (i.requirementLevel ?? "required") === "required");
  const missingRequired = required.filter(i => !isRequiredItemSatisfied(i, docs));
  const waivedOrNa = items.filter(i => i.requirementLevel === "waived" || i.requirementLevel === "not_applicable" || i.status === "not_applicable");
  const needsReview = docs.filter(d => ["pending", "received", "reviewed", "pending_review"].includes(d.verificationStatus));
  const needsClarification = docs.filter(d => d.verificationStatus === "needs_clarification");
  const rejected = docs.filter(d => d.verificationStatus === "rejected");
  const unsupported = docs.filter(d => uploadSupportLevel(d.fileName ?? "") === "unsupported" && (d.fileName ?? "") !== "");
  return {
    total: items.length,
    requiredTotal: required.length,
    satisfied: required.length - missingRequired.length,
    missingRequired,
    needsReview,
    needsClarification,
    rejected,
    unsupported,
    waivedOrNa,
    allRequiredSatisfied: missingRequired.length === 0,
  };
}
