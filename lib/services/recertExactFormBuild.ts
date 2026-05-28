// Sprint 18: shared PDF-build helpers extracted from /generate-exact-form so
// the new /generate-signing-packet route can reuse them without duplicating
// the Sprint 15 (AcroForm fill) and Sprint 17 (signature PNG overlay) work.
//
// Server-only. Imports node:fs and pdf-lib.

import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFSignature,
  type PDFAcroField,
} from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveLahdRecert2026Fields,
  type FieldFillResult,
  type FillStatus,
} from "./recertExactFormFill";

export const LAHD_TEMPLATE_PATH = join(process.cwd(), "public", "templates", "lahd-recert-2026.pdf");
export const LAHD_TEMPLATE_ID = "lahd-recert-2026";

/**
 * Pull every Supabase row the resolver needs for one case, plus the per-case
 * field-classification overrides and any saved tenant signature PNG rows.
 * Returns a single object passed downstream.
 */
export async function loadRecertCaseContext(sb: SupabaseClient, caseId: string) {
  const [caseRow, membersRow, incomeRow, assetsRow, uaRow, overridesRow, sigRow] = await Promise.all([
    sb.from("recertification_cases").select("*").eq("id", caseId).maybeSingle(),
    sb.from("recert_household_members").select("*").eq("case_id", caseId).order("is_adult", { ascending: false }),
    sb.from("recert_income_sources").select("*").eq("case_id", caseId),
    sb.from("recert_asset_accounts").select("*").eq("case_id", caseId),
    sb.from("recert_utility_allowance").select("*").eq("case_id", caseId).maybeSingle(),
    sb.from("recert_case_field_overrides").select("*").eq("case_id", caseId).eq("template_id", LAHD_TEMPLATE_ID),
    sb.from("recert_packet_signatures").select("*").eq("case_id", caseId).eq("packet_id", "exact_form").eq("signer_role", "tenant"),
  ]);
  return { caseRow, membersRow, incomeRow, assetsRow, uaRow, overridesRow, sigRow };
}

/**
 * Map snake_case DB rows to the resolver's camelCase context object.
 * Returns null when the case wasn't found (callers should 404).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildFillContext(ctx: Awaited<ReturnType<typeof loadRecertCaseContext>>, manager: { managerName?: string; managerTitle?: string; managerEmail?: string }) {
  if (ctx.caseRow.error || !ctx.caseRow.data) return null;
  const cd = ctx.caseRow.data as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recertCase: any = {
    id: cd.id as string,
    primaryTenantName: cd.primary_tenant_name as string,
    primaryTenantPhone: cd.primary_tenant_phone as string | undefined,
    propertyId: cd.property_id as string,
    propertyName: cd.property_name as string,
    unitNumber: cd.unit_number as string | undefined,
    certificationType: cd.certification_type as string,
    caseStatus: cd.case_status as string,
    moveInOrRenewalDate: cd.move_in_or_renewal_date as string | undefined,
    adultCount: (cd.adult_count as number) ?? 0,
    childCount: (cd.child_count as number) ?? 0,
    bedroomCount: cd.bedroom_count as number | undefined,
    maxIncomeLimit: cd.max_income_limit as number | undefined,
    maxAllowableRent: cd.max_allowable_rent as number | undefined,
    proposedTenantRent: cd.proposed_tenant_rent as number | undefined,
    subsidyAmount: cd.subsidy_amount as number | undefined,
    subsidyStatus: cd.subsidy_status as string,
    utilityAllowanceRequired: !!cd.utility_allowance_required,
    totalUtilityAllowance: cd.total_utility_allowance as number | undefined,
    readinessScore: (cd.readiness_score as number) ?? 0,
    missingItemsCount: (cd.missing_items_count as number) ?? 0,
    riskLevel: cd.risk_level as string,
    incomeStatus: cd.income_status as string,
    rentStatus: cd.rent_status as string,
    createdAt: cd.created_at as string,
    updatedAt: cd.updated_at as string,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const members = (ctx.membersRow.data ?? []).map((m: Record<string, unknown>): any => ({
    id: m.id as string, caseId: m.case_id as string, fullName: m.full_name as string, isAdult: !!m.is_adult,
    ticqCompleted: !!m.ticq_completed, ticqSigned: !!m.ticq_signed,
    applicantStatementSigned: !!m.applicant_statement_signed, conflictOfInterestSigned: !!m.conflict_of_interest_signed,
    createdAt: m.created_at as string, updatedAt: m.updated_at as string,
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const incomeSources = (ctx.incomeRow.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assets = (ctx.assetsRow.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const utilityAllowance = (ctx.uaRow.data ?? undefined) as any;

  // Build override map
  const overrideRows = (ctx.overridesRow.data ?? []) as Array<{
    field_name: string; fill_status: string | null; manual_override_value: string | null;
    notes: string | null; completion_owner: string | null;
  }>;
  const overrides = new Map<string, { fillStatus?: FillStatus; manualOverrideValue?: string; notes?: string }>();
  const overrideOwners = new Map<string, string | null>();
  for (const r of overrideRows) {
    overrides.set(r.field_name, {
      fillStatus: (r.fill_status as FillStatus | null) ?? undefined,
      manualOverrideValue: r.manual_override_value ?? undefined,
      notes: r.notes ?? undefined,
    });
    overrideOwners.set(r.field_name, r.completion_owner);
  }

  return { recertCase, members, incomeSources, assets, utilityAllowance, overrides, overrideOwners, manager };
}

/**
 * Sprint 15 + 17 PDF build: load template, fill known fields, overlay tenant
 * signatures at /Sig widget rectangles. Returns the in-memory PDFDocument so
 * downstream code can apply highlights or clone for the tenant packet.
 */
export async function buildFilledRecertPdf(
  fillResults: FieldFillResult[],
  signatureRows: Array<{ section_key: string; signature_data_url: string }>,
): Promise<{ pdfDoc: PDFDocument; applied: { fieldName: string; value: string }[]; signatureOverlays: number }> {
  const templateBytes = new Uint8Array(await readFile(LAHD_TEMPLATE_PATH));
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  // Sprint 15 fill loop
  const applied: { fieldName: string; value: string }[] = [];
  for (const result of fillResults) {
    if (result.status !== "filled_known" || result.value == null) continue;
    try {
      const field = form.getField(result.fieldName);
      if (field instanceof PDFTextField) {
        field.setText(String(result.value));
        applied.push({ fieldName: result.fieldName, value: String(result.value) });
      } else if (field instanceof PDFCheckBox) {
        // checkbox fills not in current map
      } else if (field instanceof PDFRadioGroup) {
        // radios not in current map
      }
    } catch { /* widget missing — non-fatal */ }
  }

  // Sprint 17 signature overlay
  let signatureOverlays = 0;
  const sectionToSigFields: Record<string, string[]> = {
    applicant_statement: ["11-HouseholdMemberSignature"],
    conflict_of_interest: ["16-HHMbrSignature"],
  };
  for (const row of signatureRows) {
    const targetFields = sectionToSigFields[row.section_key] ?? [];
    const dataUrl = row.signature_data_url;
    if (!dataUrl?.startsWith("data:image/png;base64,")) continue;
    const pngBytes = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
    const embeddedImage = await pdfDoc.embedPng(pngBytes);

    for (const fieldName of targetFields) {
      try {
        const field = form.getField(fieldName);
        if (!(field instanceof PDFSignature)) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const widgets = (field as any).acroField.getWidgets() as Array<{
          getRectangle: () => { x: number; y: number; width: number; height: number };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          P: () => any;
        }>;
        for (const widget of widgets) {
          const rect = widget.getRectangle();
          const pageRef = widget.P();
          const page = pdfDoc.getPages().find(p => p.ref === pageRef);
          if (!page) continue;
          const inset = 2;
          page.drawImage(embeddedImage, {
            x: rect.x + inset, y: rect.y + inset,
            width: rect.width - inset * 2, height: rect.height - inset * 2,
          });
          signatureOverlays += 1;
        }
      } catch { /* non-fatal */ }
    }
  }

  return { pdfDoc, applied, signatureOverlays };
}

/**
 * For a given field name, return all widget annotation rectangles + their
 * page index in the document. Used by the signing-packet pipeline to
 * highlight tenant action fields.
 */
export function getWidgetGeometry(
  pdfDoc: PDFDocument,
  fieldName: string,
): Array<{ pageIndex: number; rect: { x: number; y: number; width: number; height: number } }> {
  const form = pdfDoc.getForm();
  let field: PDFAcroField | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    field = (form.getField(fieldName) as any).acroField;
  } catch { return []; }
  if (!field) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const widgets = (field as any).getWidgets() as Array<{
    getRectangle: () => { x: number; y: number; width: number; height: number };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    P: () => any;
  }>;
  const pages = pdfDoc.getPages();
  const out: Array<{ pageIndex: number; rect: { x: number; y: number; width: number; height: number } }> = [];
  for (const widget of widgets) {
    try {
      const rect = widget.getRectangle();
      const pageRef = widget.P();
      const pageIndex = pages.findIndex(p => p.ref === pageRef);
      if (pageIndex >= 0) out.push({ pageIndex, rect });
    } catch { /* skip widget without geometry */ }
  }
  return out;
}

/**
 * Return ALL AcroForm field names in the template (sorted). Used by
 * detectTenantActionFields to enumerate fields beyond the 57 resolver-mapped
 * ones (TICQ, asset rows, initials, etc.).
 */
export function getAllFormFieldNames(pdfDoc: PDFDocument): string[] {
  const form = pdfDoc.getForm();
  return form.getFields().map(f => f.getName()).sort();
}

/**
 * Field-type classifier used by the cover-sheet checklist.
 */
export function classifyPdfFieldType(pdfDoc: PDFDocument, fieldName: string): "signature" | "checkbox" | "radio" | "initial" | "date" | "text" {
  if (/^1[16]-(HouseholdMember|HHMbr|OPM)Signature$/.test(fieldName)) return "signature";
  if (/^11-Initial\d+$/.test(fieldName)) return "initial";
  if (/Date$/i.test(fieldName)) return "date";
  try {
    const f = pdfDoc.getForm().getField(fieldName);
    if (f instanceof PDFCheckBox) return "checkbox";
    if (f instanceof PDFRadioGroup) return "radio";
    if (f instanceof PDFSignature) return "signature";
  } catch { /* fall through */ }
  return "text";
}

// Re-export the fill resolver so callers don't need a second import.
export { resolveLahdRecert2026Fields };
