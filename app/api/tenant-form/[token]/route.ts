// Sprint 21: Token-gated API route for the public tenant completion form.
// Tenants arrive via /recertification/tenant/[token] — no Supabase auth required.
//
// GET  /api/tenant-form/[token]  → { schema } | { error }
// POST /api/tenant-form/[token]  → action:"save"|"submit"|"clear"
//
// Reads go through the anon SELECT policies added in the sprint21_public_tenant_form
// migration. Writes go through SECURITY DEFINER Postgres functions that validate
// the token at the DB level before writing:
//   tenant_save_field  — upsert to recert_packet_field_values
//   tenant_submit_form — mark session submitted + update roster status
//   tenant_clear_field — delete a field row (orphan cleanup)

import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase/client";
import { buildTenantFormSchema } from "@/lib/services/recertCompletionForms";

// ─────────────────────────────────────────────────────────────────────────────
// GET — validate token, load schema
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(
  _req: Request,
  { params }: { params: { token: string } },
) {
  const { token } = params;
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  // Validate token + resolve case_id using anon SELECT policy.
  const { data: roster, error: rErr } = await sb
    .from("recert_tenant_roster")
    .select("case_id, eligible, status")
    .eq("invitation_token", token)
    .maybeSingle();

  if (rErr || !roster) {
    return NextResponse.json(
      { error: "This invitation link is invalid or has expired. Please contact your property manager." },
      { status: 404 },
    );
  }
  if (!roster.eligible) {
    return NextResponse.json(
      { error: "This tenant is not eligible for recertification." },
      { status: 403 },
    );
  }
  if (!roster.case_id) {
    return NextResponse.json(
      { error: "No recertification case has been started yet. Please contact your property manager." },
      { status: 404 },
    );
  }

  const schema = await buildTenantFormSchema(roster.case_id as string);
  if (!schema) {
    return NextResponse.json({ error: "Case not found." }, { status: 404 });
  }

  return NextResponse.json({ schema });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — save / submit / clear
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(
  req: Request,
  { params }: { params: { token: string } },
) {
  const { token } = params;
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = String(body.action ?? "");

  // ── save ──────────────────────────────────────────────────────────────────
  if (action === "save") {
    const caseId   = String(body.caseId  ?? "");
    const section  = String(body.section ?? "");
    const field    = String(body.field   ?? "");
    const valText  = body.valText != null ? String(body.valText) : null;
    const valJson  = body.valJson ?? {};
    const pageNum  = Number(body.pageNum ?? 0);
    const ftype    = String(body.ftype   ?? "text");

    if (!caseId || !field) {
      return NextResponse.json({ error: "caseId and field are required" }, { status: 400 });
    }

    const { data, error } = await sb.rpc("tenant_save_field", {
      p_token:    token,
      p_case_id:  caseId,
      p_section:  section,
      p_field:    field,
      p_val_text: valText,
      p_val_json: valJson,
      p_page_num: pageNum,
      p_ftype:    ftype,
    });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: data === true });
  }

  // ── submit ────────────────────────────────────────────────────────────────
  if (action === "submit") {
    const caseId      = String(body.caseId      ?? "");
    const submittedBy = String(body.submittedBy ?? "Tenant");
    const totalReq    = Number(body.totalReq    ?? 0);
    const completed   = Number(body.completed   ?? 0);

    if (!caseId) {
      return NextResponse.json({ error: "caseId is required" }, { status: 400 });
    }

    const { data, error } = await sb.rpc("tenant_submit_form", {
      p_token:        token,
      p_case_id:      caseId,
      p_submitted_by: submittedBy,
      p_total_req:    totalReq,
      p_completed:    completed,
    });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: data === true });
  }

  // ── clear (orphan cleanup) ────────────────────────────────────────────────
  if (action === "clear") {
    const caseId = String(body.caseId ?? "");
    const field  = String(body.field  ?? "");

    if (!caseId || !field) {
      return NextResponse.json({ error: "caseId and field are required" }, { status: 400 });
    }

    const { error } = await sb.rpc("tenant_clear_field", {
      p_token:   token,
      p_case_id: caseId,
      p_field:   field,
    });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
