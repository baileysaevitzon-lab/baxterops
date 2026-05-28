// Sprint 15: server-side endpoint that fills the official LAHD recertification
// PDF in place — preserving the exact original layout — using pdf-lib.
//
// Inputs:  caseId (from URL params)
// Outputs: filled PDF as application/pdf download response
//
// Compliance posture: this is internal tooling. We fill ONLY known constant
// fields (property/case identifiers). Tenant-completed fields and signature
// fields are intentionally left blank so the tenant can complete them in
// DocHub on iPad.

import { NextResponse, type NextRequest } from "next/server";
import { PDFDocument, PDFTextField, PDFCheckBox, PDFRadioGroup } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  resolveLahdRecert2026Fields,
  TENANT_ONLY_FIELD_PREFIXES,
  SIGNATURE_FIELD_NAMES,
  type FieldFillResult,
} from "@/lib/services/recertExactFormFill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEMPLATE_PATH = join(process.cwd(), "public", "templates", "lahd-recert-2026.pdf");
const TEMPLATE_ID = "lahd-recert-2026";

function getServerSupabase(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  if (!url || !key) return null;
  // Forward auth from caller so RLS reads the right user
  const authHeader = req.headers.get("authorization") ?? "";
  return createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
}

interface RouteParams { caseId: string }

export async function POST(
  req: NextRequest,
  ctx: { params: RouteParams },
) {
  const { caseId } = ctx.params;

  const sb = getServerSupabase(req);
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  // Load case + members + income + assets + UA
  const [caseRow, membersRow, incomeRow, assetsRow, uaRow] = await Promise.all([
    sb.from("recertification_cases").select("*").eq("id", caseId).maybeSingle(),
    sb.from("recert_household_members").select("*").eq("case_id", caseId).order("is_adult", { ascending: false }),
    sb.from("recert_income_sources").select("*").eq("case_id", caseId),
    sb.from("recert_asset_accounts").select("*").eq("case_id", caseId),
    sb.from("recert_utility_allowance").select("*").eq("case_id", caseId).maybeSingle(),
  ]);

  if (caseRow.error || !caseRow.data) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  // Body may include managerName/title/email override; otherwise pull from
  // the authenticated user_profiles row.
  const body = await req.json().catch(() => ({}));
  let managerName: string | undefined = body.managerName;
  let managerTitle: string | undefined = body.managerTitle ?? "Property Manager";
  let managerEmail: string | undefined = body.managerEmail;

  if (!managerName) {
    const { data: prof } = await sb.from("user_profiles").select("full_name, email").maybeSingle();
    if (prof) {
      managerName = (prof as { full_name?: string }).full_name;
      managerEmail ||= (prof as { email?: string }).email;
    }
  }

  // Map DB rows back to TS shape (snake -> camel). We only need the fields
  // the resolver actually reads, so do a minimal mapping inline.
  const cd = caseRow.data as Record<string, unknown>;
  const recertCase = {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  const members = (membersRow.data ?? []).map((m: Record<string, unknown>) => ({
    id: m.id as string,
    caseId: m.case_id as string,
    fullName: m.full_name as string,
    isAdult: !!m.is_adult,
    ticqCompleted: !!m.ticq_completed,
    ticqSigned: !!m.ticq_signed,
    applicantStatementSigned: !!m.applicant_statement_signed,
    conflictOfInterestSigned: !!m.conflict_of_interest_signed,
    createdAt: m.created_at as string,
    updatedAt: m.updated_at as string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  })) as any[];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const incomeSources = (incomeRow.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assets = (assetsRow.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ua = (uaRow.data ?? undefined) as any;

  const fillResults: FieldFillResult[] = resolveLahdRecert2026Fields({
    recertCase,
    members,
    incomeSources,
    assets,
    utilityAllowance: ua,
    managerName,
    managerTitle,
    managerEmail,
  });

  // Load template PDF
  let templateBytes: Uint8Array;
  try {
    const buf = await readFile(TEMPLATE_PATH);
    templateBytes = new Uint8Array(buf);
  } catch (e) {
    return NextResponse.json({ error: `Template not found at ${TEMPLATE_PATH}: ${String(e)}` }, { status: 500 });
  }

  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  // Apply fills
  const applied: { fieldName: string; value: string }[] = [];
  for (const result of fillResults) {
    if (result.status !== "filled_known" || result.value == null) continue;
    try {
      const field = form.getField(result.fieldName);
      if (field instanceof PDFTextField) {
        field.setText(result.value);
        applied.push({ fieldName: result.fieldName, value: result.value });
      } else if (field instanceof PDFCheckBox) {
        // We don't currently fill checkboxes via this map; would set check() here.
      } else if (field instanceof PDFRadioGroup) {
        // Radios not in current map.
      }
    } catch (e) {
      console.warn(`[exact-form] could not write to ${result.fieldName}:`, e instanceof Error ? e.message : e);
    }
  }

  // Important: do NOT flatten or touch tenant-only fields and signatures.
  // Leave them as empty AcroForm widgets so DocHub on iPad treats them as
  // fillable / signable.
  void TENANT_ONLY_FIELD_PREFIXES;
  void SIGNATURE_FIELD_NAMES;

  const filledBytes = await pdfDoc.save({ updateFieldAppearances: true });

  // Compute summary counts for the missing-data report
  const filledKnown = fillResults.filter(f => f.status === "filled_known").length;
  const blankTenant = fillResults.filter(f => f.status === "blank_tenant_must_complete").length;
  const blankManager = fillResults.filter(f => f.status === "blank_manager_must_complete").length;
  const blankMissing = fillResults.filter(f => f.status === "blank_missing_data").length;
  const blankPending = fillResults.filter(f => f.status === "blank_pending_external").length;
  const needsReview = fillResults.filter(f => f.status === "needs_review").length;

  // Record a recert_generated_packets row + audit event. Non-fatal on failure.
  const packetId = `rgp-${caseId}-${Date.now()}`;
  try {
    await sb.from("recert_generated_packets").insert({
      id: packetId,
      case_id: caseId,
      template_id: TEMPLATE_ID,
      output_storage_path: `inline:${packetId}.pdf`,
      generated_by: managerName ?? "unknown",
      filled_count: filledKnown,
      blank_count: blankTenant + blankManager + blankMissing + blankPending,
      missing_data_json: {
        filled: applied.length,
        blank_tenant_must_complete: blankTenant,
        blank_manager_must_complete: blankManager,
        blank_missing_data: blankMissing,
        blank_pending_external: blankPending,
        needs_review: needsReview,
        results: fillResults,
      },
      status: "draft",
    });
    await sb.from("recert_audit_events").insert({
      id: `ae-${packetId}`,
      case_id: caseId,
      event_type: "exact_form_fill_generated",
      summary: `Exact-form PDF generated: ${filledKnown} fields filled · ${blankTenant} tenant-blank · ${blankManager} manager-blank · ${blankPending} HACLA-pending`,
      created_by: managerName ?? "unknown",
    });
  } catch (e) {
    console.warn("[exact-form] audit write failed (non-fatal):", e);
  }

  // Return inline PDF — caller can download or preview in <iframe>
  // Cast to a Buffer view so Next's NextResponse accepts it as a body.
  const responseBody = Buffer.from(filledBytes);
  return new NextResponse(responseBody, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="lahd-recert-${caseId}.pdf"`,
      "Cache-Control": "no-store",
      "X-Packet-Id": packetId,
      "X-Filled-Count": String(filledKnown),
      "X-Blank-Count": String(blankTenant + blankManager + blankMissing + blankPending),
    },
  });
}

// Also support GET for direct preview in iframes
export async function GET(req: NextRequest, ctx: { params: RouteParams }) {
  return POST(req, ctx);
}
