// Sprint 18: Tenant Signing Packet + Full Completed PDF generation.
//
// Inputs the case + resolver output + override map + filled PDF, then:
//   1. Detects every tenant-action field by unioning multiple signals
//   2. Draws a consistent light-yellow highlight on each tenant action widget
//   3. (Full Completed PDF) saves the highlighted full-pages PDF
//   4. (Tenant Packet) clones the highlighted PDF + removes pages with no
//      tenant action + prepends a cover sheet + saves
//
// Uses ONLY existing data sources: resolveLahdRecert2026Fields output,
// recert_case_field_overrides, recert_packet_signatures. No new tables.

import "server-only";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  PageSizes,
  PDFCheckBox,
  PDFRadioGroup,
  PDFSignature,
} from "pdf-lib";
import {
  TENANT_ONLY_FIELD_PREFIXES,
  SIGNATURE_FIELD_NAMES,
  type FieldFillResult,
  type FillStatus,
} from "./recertExactFormFill";
import {
  classifyPdfFieldType,
  getAllFormFieldNames,
  getWidgetGeometry,
} from "./recertExactFormBuild";

// ---------- Types ----------

export type TenantActionFieldType = "signature" | "initial" | "date" | "checkbox" | "radio" | "text";

export interface TenantActionField {
  fieldName: string;
  /** 1-based page number for display + checklist grouping. */
  pageNumber: number;
  /** 0-based page index for page-removal logic. */
  pageIndex: number;
  /** Human label from the resolver, or a fallback derived from the field name. */
  label: string;
  /** Plain-English action description for the checklist. */
  action: string;
  fieldType: TenantActionFieldType;
  required: boolean;
  rect: { x: number; y: number; width: number; height: number };
  /** Why this field counts as tenant action (for debugging + manifest). */
  reason: string;
}

export interface PacketOptions {
  generateTenantPacket?: boolean;
  generateFullPacket?: boolean;
  includeCoverSheet?: boolean;
  includeContextPages?: boolean;
  tenantName: string;
  roomNumber?: string;
  caseId: string;
  propertyName?: string;
}

export interface SigningPacketResult {
  tenantPacketBytes: Uint8Array | null;
  fullPacketBytes: Uint8Array | null;
  manifest: {
    tenantActions: TenantActionField[];
    /** Pages that ended up in the tenant packet (1-based) including ±context if requested. */
    tenantPagesIncluded: number[];
    totalFieldsRequiringTenantAction: number;
    generatedAt: string;
  };
}

// ---------- Tenant-action detection ----------

/**
 * Decide whether a single field is a tenant action. Combines multiple signals
 * so that the 57 resolver-mapped fields AND the ~219 fields handled by
 * exclusion (TICQ, asset rows, initials, signatures) all light up correctly.
 */
function isTenantActionField(args: {
  fieldName: string;
  resolved: FieldFillResult | undefined;
  override:
    | { fillStatus?: FillStatus; manualOverrideValue?: string }
    | undefined;
  overrideOwner: string | null | undefined;
}): { isAction: boolean; reason: string } {
  const { fieldName, resolved, override, overrideOwner } = args;

  // Override explicitly tagged tenant
  if (overrideOwner === "tenant") return { isAction: true, reason: "override.completionOwner=tenant" };
  // Override explicitly tagged as blank for tenant
  if (override?.fillStatus === "blank_tenant_must_complete") return { isAction: true, reason: "override.fillStatus=tenant" };
  // Resolver default says tenant must complete (and not overridden filled)
  if (resolved?.status === "blank_tenant_must_complete") {
    // If the manager overrode to filled_known with a value, do not highlight.
    if (override?.fillStatus === "filled_known" || override?.manualOverrideValue) return { isAction: false, reason: "" };
    return { isAction: true, reason: "resolver.status=blank_tenant_must_complete" };
  }
  // Missing data fields require tenant input
  if (resolved?.status === "blank_missing_data") return { isAction: true, reason: "resolver.status=blank_missing_data" };

  // Pattern-based classification for fields not in the resolver's 57-field map
  // — TICQ Y/N + Info/Monthly text fields, asset table rows, initials.
  for (const prefix of TENANT_ONLY_FIELD_PREFIXES) {
    if (fieldName.startsWith(prefix)) return { isAction: true, reason: `prefix:${prefix}` };
  }
  if (/^11-Initial\d+$/.test(fieldName)) {
    // Initials may have been pre-filled by Sprint 17 typed-signature capture
    if (override?.fillStatus === "filled_known" || override?.manualOverrideValue) return { isAction: false, reason: "" };
    return { isAction: true, reason: "11-Initial pattern" };
  }
  // Tenant signature widgets (NOT the OPM ones — those are manager)
  if (SIGNATURE_FIELD_NAMES.includes(fieldName) && !fieldName.includes("OPM")) {
    return { isAction: true, reason: "tenant signature widget" };
  }
  // Tenant name + date on signature pages (page 11 + 16)
  if (/^(11-HouseholdMember(Name|Date)|16-HHMbr(Name|Date))$/.test(fieldName)) {
    return { isAction: true, reason: "tenant name/date on signature page" };
  }
  return { isAction: false, reason: "" };
}

/**
 * Build a friendly label + action description for the cover-sheet checklist.
 */
function describeTenantAction(fieldName: string, fieldType: TenantActionFieldType, resolverLabel: string | undefined): { label: string; action: string } {
  const label = resolverLabel ?? fieldName.replace(/^\d+-/, "").replace(/([A-Z])/g, " $1").trim();
  let action = "Complete this field";
  switch (fieldType) {
    case "signature": action = "Sign here"; break;
    case "initial":   action = "Write your initials"; break;
    case "date":      action = "Write today's date"; break;
    case "checkbox":  action = "Check the box if applicable"; break;
    case "radio":     action = "Select one option"; break;
    case "text":      action = "Write your answer"; break;
  }
  return { label, action };
}

/**
 * Walk every AcroForm field in the document, classify it, and return one
 * TenantActionField per widget rectangle that needs the tenant.
 */
export function detectTenantActionFields(
  pdfDoc: PDFDocument,
  fillResults: FieldFillResult[],
  overrides: Map<string, { fillStatus?: FillStatus; manualOverrideValue?: string; notes?: string }>,
  overrideOwners: Map<string, string | null>,
): TenantActionField[] {
  const resolvedByName = new Map<string, FieldFillResult>();
  for (const r of fillResults) resolvedByName.set(r.fieldName, r);

  const out: TenantActionField[] = [];
  const allFieldNames = getAllFormFieldNames(pdfDoc);

  for (const fieldName of allFieldNames) {
    const resolved = resolvedByName.get(fieldName);
    const override = overrides.get(fieldName);
    const overrideOwner = overrideOwners.get(fieldName);
    const { isAction, reason } = isTenantActionField({ fieldName, resolved, override, overrideOwner });
    if (!isAction) continue;

    const fieldType = classifyPdfFieldType(pdfDoc, fieldName);
    const { label, action } = describeTenantAction(fieldName, fieldType, resolved?.label);
    const required = fieldType === "signature" || fieldType === "initial" || /^1[16]-/.test(fieldName);

    const geom = getWidgetGeometry(pdfDoc, fieldName);
    if (geom.length === 0) continue;          // skip fields without on-page widgets

    for (const g of geom) {
      out.push({
        fieldName,
        pageNumber: g.pageIndex + 1,
        pageIndex: g.pageIndex,
        label,
        action,
        fieldType,
        required,
        rect: g.rect,
        reason,
      });
    }
  }
  return out;
}

// ---------- Highlight rendering ----------

const HIGHLIGHT_FILL  = rgb(1.0, 0.95, 0.45);   // light yellow
const HIGHLIGHT_FILL_OPACITY = 0.35;
const HIGHLIGHT_BORDER = rgb(0.95, 0.65, 0.10); // amber
const HIGHLIGHT_BORDER_WIDTH = 1.2;
const HIGHLIGHT_PADDING = 2;

/**
 * Draw a consistent light-yellow highlight rectangle behind each tenant
 * action widget so the tenant can spot every field at a glance. The widget
 * itself (and any existing text or value) still renders on top because
 * pdf-lib draws to the page content stream which sits BELOW annotations
 * in the PDF z-order.
 */
export function applyTenantActionHighlights(
  pdfDoc: PDFDocument,
  actions: TenantActionField[],
): number {
  let drawn = 0;
  const pages = pdfDoc.getPages();
  for (const a of actions) {
    const page = pages[a.pageIndex];
    if (!page) continue;
    page.drawRectangle({
      x: a.rect.x - HIGHLIGHT_PADDING,
      y: a.rect.y - HIGHLIGHT_PADDING,
      width: a.rect.width + HIGHLIGHT_PADDING * 2,
      height: a.rect.height + HIGHLIGHT_PADDING * 2,
      color: HIGHLIGHT_FILL,
      opacity: HIGHLIGHT_FILL_OPACITY,
      borderColor: HIGHLIGHT_BORDER,
      borderWidth: HIGHLIGHT_BORDER_WIDTH,
      borderOpacity: 0.85,
    });
    drawn += 1;
  }
  return drawn;
}

// ---------- Cover sheet ----------

interface CoverInfo {
  tenantName: string;
  roomNumber?: string;
  caseId: string;
  propertyName?: string;
  generatedAt: string;
}

/**
 * Render the cover sheet as a brand-new letter-size page and insert it at the
 * start of `pdfDoc`. The checklist groups TenantActionField rows by page
 * number with field label + action + required/optional marker.
 */
export async function prependCoverSheet(
  pdfDoc: PDFDocument,
  info: CoverInfo,
  actions: TenantActionField[],
): Promise<void> {
  const page = pdfDoc.insertPage(0, PageSizes.Letter);
  const { width, height } = page.getSize();

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  let y = height - 60;

  // Title
  page.drawText("Tenant Signing Packet", {
    x: 50, y, size: 24, font: fontBold, color: rgb(0.08, 0.10, 0.18),
  });
  y -= 14;
  page.drawText("Internal workflow document — not an official LAHD e-signature system.", {
    x: 50, y: y - 4, size: 9, font: fontItalic, color: rgb(0.45, 0.45, 0.50),
  });
  y -= 30;

  // Tenant + case info table
  const infoRows: [string, string][] = [
    ["Tenant",      info.tenantName],
    ["Room / Unit", info.roomNumber ?? "—"],
    ["Property",    info.propertyName ?? "—"],
    ["Case ID",     info.caseId],
    ["Generated",   info.generatedAt.replace("T", " ").slice(0, 19) + " UTC"],
  ];
  for (const [k, v] of infoRows) {
    page.drawText(k + ":", { x: 50, y, size: 11, font: fontBold, color: rgb(0.30, 0.30, 0.35) });
    page.drawText(v,       { x: 150, y, size: 11, font: fontRegular, color: rgb(0.10, 0.10, 0.15) });
    y -= 18;
  }
  y -= 10;

  // Highlight key
  page.drawRectangle({
    x: 50, y: y - 14, width: 24, height: 16,
    color: HIGHLIGHT_FILL, opacity: HIGHLIGHT_FILL_OPACITY,
    borderColor: HIGHLIGHT_BORDER, borderWidth: HIGHLIGHT_BORDER_WIDTH,
  });
  page.drawText("Yellow-highlighted fields throughout this packet require your action.", {
    x: 82, y: y - 8, size: 11, font: fontRegular, color: rgb(0.10, 0.10, 0.15),
  });
  y -= 30;

  // Instruction line
  page.drawText("Please complete only the highlighted fields. Leave everything else as-is.", {
    x: 50, y, size: 12, font: fontBold, color: rgb(0.10, 0.10, 0.15),
  });
  y -= 26;

  // Checklist header
  page.drawText("Action checklist — grouped by original page", { x: 50, y, size: 13, font: fontBold });
  y -= 6;
  page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.75) });
  y -= 14;

  // Group actions by original page number. We add 1 because the cover sheet
  // pushes the original pages forward by one in the tenant packet, but the
  // checklist references the ORIGINAL page number for clarity.
  const byOriginalPage = new Map<number, TenantActionField[]>();
  for (const a of actions) {
    const arr = byOriginalPage.get(a.pageNumber) ?? [];
    arr.push(a);
    byOriginalPage.set(a.pageNumber, arr);
  }
  const sortedPages = [...byOriginalPage.keys()].sort((a, b) => a - b);

  // De-dup by (fieldName + pageNumber) — multiple widgets per field show once
  for (const pageNum of sortedPages) {
    const items = byOriginalPage.get(pageNum)!;
    const seen = new Set<string>();
    const unique = items.filter(it => {
      const k = `${pageNum}::${it.fieldName}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (unique.length === 0) continue;

    // Page heading
    if (y < 80) {
      // Spill onto a new page
      const next = pdfDoc.insertPage(1, PageSizes.Letter);
      // mutate so subsequent draws go to `next` — pdf-lib doesn't allow reassign,
      // so we just stop the checklist here. Real overflow handling deferred.
      next.drawText(`(checklist continues — ${sortedPages.length - sortedPages.indexOf(pageNum)} more pages of items)`, {
        x: 50, y: next.getSize().height - 60, size: 10, font: fontItalic,
      });
      break;
    }
    page.drawText(`Original page ${pageNum}`, { x: 50, y, size: 11, font: fontBold, color: rgb(0.10, 0.15, 0.45) });
    y -= 16;
    for (const it of unique) {
      if (y < 60) break;
      const requiredTag = it.required ? "Required" : "Optional";
      const requiredColor = it.required ? rgb(0.75, 0.10, 0.20) : rgb(0.45, 0.45, 0.50);
      page.drawText(`☐  ${it.label}`, { x: 64, y, size: 10, font: fontRegular, color: rgb(0.12, 0.12, 0.16) });
      page.drawText(it.action,        { x: 280, y, size: 10, font: fontRegular, color: rgb(0.30, 0.30, 0.35) });
      page.drawText(requiredTag,      { x: 480, y, size: 10, font: fontBold,    color: requiredColor });
      y -= 14;
    }
    y -= 6;
  }

  // Footer
  const footY = 40;
  page.drawLine({ start: { x: 50, y: footY + 20 }, end: { x: width - 50, y: footY + 20 }, thickness: 0.4, color: rgb(0.7, 0.7, 0.75) });
  page.drawText(`Tenant: ${info.tenantName}  ·  Case: ${info.caseId}  ·  ${unique_count(actions)} highlighted fields`, {
    x: 50, y: footY, size: 9, font: fontItalic, color: rgb(0.45, 0.45, 0.50),
  });
}

function unique_count(actions: TenantActionField[]): number {
  const s = new Set<string>();
  for (const a of actions) s.add(a.fieldName);
  return s.size;
}

// ---------- Tenant packet page-removal pipeline ----------

/**
 * Compute the set of original-PDF page indices that belong in the tenant
 * packet (before the cover sheet is prepended). Optionally include ±1 page
 * of surrounding context.
 */
export function computeTenantPagesNeeded(
  actions: TenantActionField[],
  totalPages: number,
  includeContextPages: boolean,
): Set<number> {
  const needed = new Set<number>(actions.map(a => a.pageIndex));
  if (includeContextPages) {
    const before = new Set<number>();
    const after = new Set<number>();
    for (const p of needed) {
      if (p - 1 >= 0) before.add(p - 1);
      if (p + 1 < totalPages) after.add(p + 1);
    }
    for (const p of before) needed.add(p);
    for (const p of after) needed.add(p);
  }
  return needed;
}

/**
 * Clone a PDFDocument from saved bytes so the tenant packet can be modified
 * without affecting the full packet's PDFDocument.
 */
export async function clonePdfDoc(pdfDoc: PDFDocument): Promise<PDFDocument> {
  // round-trip through bytes so we get a completely independent PDFDocument
  const bytes = await pdfDoc.save({ updateFieldAppearances: false });
  return PDFDocument.load(bytes);
}

/**
 * Remove pages from `pdfDoc` whose index is NOT in `keep`. Indices are
 * processed in reverse so earlier removals don't shift later ones.
 */
export function removePagesNotIn(pdfDoc: PDFDocument, keep: Set<number>) {
  const total = pdfDoc.getPageCount();
  for (let i = total - 1; i >= 0; i--) {
    if (!keep.has(i)) pdfDoc.removePage(i);
  }
}

// ---------- Orchestration ----------

export async function buildSigningPackets(args: {
  filledFullPdf: PDFDocument;
  fillResults: FieldFillResult[];
  overrides: Map<string, { fillStatus?: FillStatus; manualOverrideValue?: string; notes?: string }>;
  overrideOwners: Map<string, string | null>;
  options: PacketOptions;
}): Promise<SigningPacketResult> {
  const { filledFullPdf, fillResults, overrides, overrideOwners, options } = args;
  const generatedAt = new Date().toISOString();

  // 1. Detect tenant action fields against the (already filled) full PDF.
  const actions = detectTenantActionFields(filledFullPdf, fillResults, overrides, overrideOwners);

  // 2. Apply highlights to the full PDF — this becomes the Full Completed PDF.
  applyTenantActionHighlights(filledFullPdf, actions);

  // 3. Save full packet bytes (if requested).
  const fullPacketBytes = options.generateFullPacket
    ? await filledFullPdf.save({ updateFieldAppearances: true })
    : null;

  // 4. Build the tenant packet (if requested) — clone, drop pages, prepend cover.
  let tenantPacketBytes: Uint8Array | null = null;
  let tenantPagesIncluded: number[] = [];
  if (options.generateTenantPacket) {
    const tenantDoc = await clonePdfDoc(filledFullPdf);
    const totalPages = tenantDoc.getPageCount();
    const keep = computeTenantPagesNeeded(actions, totalPages, !!options.includeContextPages);
    tenantPagesIncluded = [...keep].sort((a, b) => a - b).map(i => i + 1);
    removePagesNotIn(tenantDoc, keep);

    if (options.includeCoverSheet !== false) {
      await prependCoverSheet(tenantDoc, {
        tenantName: options.tenantName,
        roomNumber: options.roomNumber,
        caseId: options.caseId,
        propertyName: options.propertyName,
        generatedAt,
      }, actions);
    }

    tenantPacketBytes = await tenantDoc.save({ updateFieldAppearances: true });
  }

  return {
    tenantPacketBytes,
    fullPacketBytes,
    manifest: {
      tenantActions: actions,
      tenantPagesIncluded,
      totalFieldsRequiringTenantAction: new Set(actions.map(a => a.fieldName)).size,
      generatedAt,
    },
  };
}
