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
import { PDFDocument, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFSignature } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  resolveLahdRecert2026Fields,
  TENANT_ONLY_FIELD_PREFIXES,
  SIGNATURE_FIELD_NAMES,
  type FieldFillResult,
  type FillStatus,
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

  // Load case + members + income + assets + UA + Sprint 16 per-case overrides
  const [caseRow, membersRow, incomeRow, assetsRow, uaRow, overridesRow] = await Promise.all([
    sb.from("recertification_cases").select("*").eq("id", caseId).maybeSingle(),
    sb.from("recert_household_members").select("*").eq("case_id", caseId).order("is_adult", { ascending: false }),
    sb.from("recert_income_sources").select("*").eq("case_id", caseId),
    sb.from("recert_asset_accounts").select("*").eq("case_id", caseId),
    sb.from("recert_utility_allowance").select("*").eq("case_id", caseId).maybeSingle(),
    sb.from("recert_case_field_overrides").select("*").eq("case_id", caseId).eq("template_id", TEMPLATE_ID),
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

  // Build the Sprint 16 override map for the resolver.
  const overrideRows = (overridesRow.data ?? []) as Array<{
    field_name: string;
    fill_status: string | null;
    manual_override_value: string | null;
    notes: string | null;
  }>;
  const overrides = new Map<string, { fillStatus?: FillStatus; manualOverrideValue?: string; notes?: string }>();
  for (const r of overrideRows) {
    overrides.set(r.field_name, {
      fillStatus: (r.fill_status as FillStatus | null) ?? undefined,
      manualOverrideValue: r.manual_override_value ?? undefined,
      notes: r.notes ?? undefined,
    });
  }

  const fillResults: FieldFillResult[] = resolveLahdRecert2026Fields({
    recertCase,
    members,
    incomeSources,
    assets,
    utilityAllowance: ua,
    managerName,
    managerTitle,
    managerEmail,
    overrides,
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

  // Sprint 18 (pivot): merge tenant + manager HTML completion responses.
  // Each row in recert_packet_field_values with packet_id IN ('tenant_completion','manager_completion')
  // is keyed by the original PDF AcroForm field name. We apply text values
  // directly, expand yesno into Y/N checkbox pairs via the stored
  // resolverPair, and surface a count for the manifest.
  //
  // Sprint 19: each child follow-up row stores its parentFieldName +
  // parentTriggerValue in value_json. Before writing the row we look up the
  // parent's stored answer. If the parent != trigger (e.g. tenant flipped Yes
  // → No), we SKIP the child. This prevents stale answers from leaking onto
  // the final PDF after a Yes-then-No flip — even if our delete-on-flip path
  // in the UI didn't catch every orphan.
  let completionsApplied = 0;
  let orphansSkipped = 0;
  try {
    const { data: completionRows } = await sb
      .from("recert_packet_field_values")
      .select("packet_id, field_key, value_text, value_json, filled_by_role")
      .eq("case_id", caseId)
      .in("packet_id", ["tenant_completion", "manager_completion"]);

    const allRows = (completionRows ?? []) as Array<{
      packet_id: string; field_key: string; value_text: string | null;
      value_json: Record<string, unknown> | null; filled_by_role: string | null;
    }>;

    // Build (packet_id, field_key) → value_text lookup so we can resolve parent
    // answers in O(1). A child and its parent always share the same packet_id.
    const answerByPacket = new Map<string, Map<string, string>>();
    for (const r of allRows) {
      let bucket = answerByPacket.get(r.packet_id);
      if (!bucket) { bucket = new Map(); answerByPacket.set(r.packet_id, bucket); }
      bucket.set(r.field_key, r.value_text ?? "");
    }

    for (const row of allRows) {
      const fieldKey = row.field_key;
      const value = row.value_text;
      if (value == null || value === "") continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meta = row.value_json as any;
      const fieldType = meta?.fieldType as string | undefined;
      const resolverPair = meta?.resolverPair as { yes?: string; no?: string } | undefined;
      const parentFieldName = meta?.parentFieldName as string | undefined;
      const parentTriggerValue = meta?.parentTriggerValue as string | undefined;

      // Sprint 19 orphan guard: skip child whose parent isn't at trigger.
      if (parentFieldName && parentTriggerValue) {
        const parentAnswer = answerByPacket.get(row.packet_id)?.get(parentFieldName) ?? "";
        if (parentAnswer !== parentTriggerValue) {
          orphansSkipped += 1;
          continue;
        }
      }

      try {
        // Compound controls
        if (fieldType === "yesno" && resolverPair) {
          const yesAnswer = value === "yes";
          for (const [answer, fname] of [[true, resolverPair.yes], [false, resolverPair.no]] as const) {
            if (!fname) continue;
            try {
              const f = form.getField(fname);
              if (f instanceof PDFCheckBox) { (answer === yesAnswer) ? f.check() : f.uncheck(); completionsApplied += 1; }
              else if (f instanceof PDFTextField) { if (answer === yesAnswer) { f.setText("X"); completionsApplied += 1; } }
            } catch { /* field absent — skip */ }
          }
          continue;
        }
        // Signature fields: handled by Sprint 17 PNG overlay; skip here.
        if (fieldType === "signature") continue;
        // Initial: fan out single-input to 11-Initial1..7 if this is the canonical initials field
        if (fieldType === "initial" && /^11-Initial[1-9]$/.test(fieldKey)) {
          for (let i = 1; i <= 7; i++) {
            try {
              const f = form.getField(`11-Initial${i}`);
              if (f instanceof PDFTextField) { f.setText(value); completionsApplied += 1; }
            } catch { /* skip */ }
          }
          continue;
        }
        // Generic text-style fields
        const f = form.getField(fieldKey);
        if (f instanceof PDFTextField) { f.setText(value); completionsApplied += 1; }
        else if (f instanceof PDFCheckBox) {
          if (value === "true" || value === "yes" || value === "1") { f.check(); completionsApplied += 1; }
          else { f.uncheck(); }
        }
      } catch (e) {
        console.warn(`[exact-form] could not merge completion response for ${fieldKey}:`, e instanceof Error ? e.message : e);
      }
    }
  } catch (e) {
    console.warn("[exact-form] completion-merge step failed (non-fatal):", e);
  }

  // Sprint 17: overlay typed-signature PNGs at /Sig widget positions.
  // Tenant captured their typed signature via /exact-form-preview Classification
  // tab; PNGs live in recert_packet_signatures keyed by section_key. We look up
  // each tenant /Sig widget's rectangle, embed the PNG, and drawImage at the
  // widget's coords on the corresponding page. The /Sig widget itself stays
  // intact — DocHub still recognizes it for in-person fallback.
  let signatureOverlays = 0;
  try {
    const { data: sigRows } = await sb
      .from("recert_packet_signatures")
      .select("section_key, signer_role, signature_data_url, signed_at")
      .eq("case_id", caseId)
      .eq("packet_id", "exact_form")
      .eq("signer_role", "tenant");

    // section_key → list of /Sig field names that section corresponds to
    const sectionToSigFields: Record<string, string[]> = {
      applicant_statement: ["11-HouseholdMemberSignature"],
      conflict_of_interest: ["16-HHMbrSignature"],
    };

    for (const row of (sigRows ?? []) as Array<{ section_key: string; signature_data_url: string }>) {
      const targetFields = sectionToSigFields[row.section_key] ?? [];
      const dataUrl = row.signature_data_url;
      if (!dataUrl?.startsWith("data:image/png;base64,")) continue;
      const pngBytes = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
      const embeddedImage = await pdfDoc.embedPng(pngBytes);

      for (const fieldName of targetFields) {
        try {
          const field = form.getField(fieldName);
          if (!(field instanceof PDFSignature)) continue;
          // Get the field's widget annotations to find page + rectangle.
          // PDFSignature exposes acroField + widget array via internal API.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const widgets = (field as any).acroField.getWidgets() as Array<{
            getRectangle: () => { x: number; y: number; width: number; height: number };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            P: () => any;
          }>;
          for (const widget of widgets) {
            const rect = widget.getRectangle();
            // Find the page containing this widget annotation.
            const pageRef = widget.P();
            const pages = pdfDoc.getPages();
            const page = pages.find(p => p.ref === pageRef) ?? pages.find(p => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const annots = (p.node as any).Annots?.();
              return annots?.array?.some?.((a: { tag?: number }) => a.tag === pageRef?.tag);
            });
            if (!page) continue;
            // drawImage at the widget rect, leaving a small inset so the image
            // doesn't bleed past the underline below the widget.
            const inset = 2;
            page.drawImage(embeddedImage, {
              x: rect.x + inset,
              y: rect.y + inset,
              width: rect.width - inset * 2,
              height: rect.height - inset * 2,
            });
            signatureOverlays += 1;
          }
        } catch (e) {
          console.warn(`[exact-form] could not overlay signature at ${fieldName}:`, e instanceof Error ? e.message : e);
        }
      }
    }
  } catch (e) {
    console.warn("[exact-form] signature overlay step failed (non-fatal):", e);
  }

  // Important: do NOT flatten or touch the still-blank tenant-only fields.
  // Leave them as empty AcroForm widgets so DocHub on iPad treats them as
  // fillable. Signature widgets stay intact too — the overlaid PNG is drawn
  // on top but the widget metadata is preserved so DocHub still sees them.
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
        signature_overlays: signatureOverlays,
        completions_applied: completionsApplied,
        // Sprint 19: count of child follow-ups whose parent flipped away
        // from the trigger answer, so they were skipped at merge time.
        orphans_skipped: orphansSkipped,
        results: fillResults,
      },
      status: "draft",
    });
    await sb.from("recert_audit_events").insert({
      id: `ae-${packetId}`,
      case_id: caseId,
      event_type: "exact_form_fill_generated",
      event_summary: `Exact-form PDF generated: ${filledKnown} fields filled · ${blankTenant} tenant-blank · ${blankManager} manager-blank · ${blankPending} HACLA-pending`,
      actor_email: managerEmail ?? null,
      event_payload_json: { packetId, templateId: TEMPLATE_ID, filledKnown, blankTenant, blankManager, blankPending, needsReview, completionsApplied, orphansSkipped },
    });

    // Sprint 19: advance the roster lifecycle for this case to "merged" so
    // management sees the final PDF was generated. Best-effort; ignored if
    // no roster entry points to this case.
    try {
      await sb
        .from("recert_tenant_roster")
        .update({
          final_pdf_generated_at: new Date().toISOString(),
          status: "merged",
          updated_at: new Date().toISOString(),
        })
        .eq("case_id", caseId);
    } catch (e) {
      console.warn("[exact-form] roster lifecycle update failed (non-fatal):", e);
    }
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
      "X-Completions-Applied": String(completionsApplied),
      "X-Orphans-Skipped": String(orphansSkipped),
    },
  });
}

// Also support GET for direct preview in iframes
export async function GET(req: NextRequest, ctx: { params: RouteParams }) {
  return POST(req, ctx);
}
