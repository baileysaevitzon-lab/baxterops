// Sprint 34: "Download Combined Bundle" — a SEPARATE, non-editable submission/review
// packet. It NEVER mutates the editable official LAHD PDF.
//
// Bundle layout:
//   1. Official LAHD PDF pages (copied from the approved exact-form generator)
//   2. A generated "Supporting Documents Index" cover page
//   3. Accepted supporting documents appended after (PDF pages copied; images
//      placed on full pages). Unsupported/omitted docs are LISTED honestly on the
//      index — never silently dropped, never claimed as bundled.
//
// Design notes:
//   - The official PDF is obtained by an INTERNAL fetch of the existing
//     /generate-exact-form endpoint with mode=preview (same merged tenant+manager+
//     signature content as full, but recorded non-final). The approved generator,
//     field mapping, and signature placement are UNCHANGED.
//   - The bundle is returned inline as a downloadable PDF. Metadata is recorded in
//     recert_generated_packets with mode='bundle' (jsonb) — no schema migration.
//   - Case status, roster, and completion sessions are NOT touched.
import { NextResponse, type NextRequest } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// FK-valid template id. The bundle is identified by status='bundle' +
// missing_data_json.mode='bundle', not by a separate template row (recert_generated_packets
// .template_id has an FK to recert_form_templates, where only the official template exists).
const TEMPLATE_ID = "lahd-recert-2026";
// The same bucket the compiler uploads supporting docs to (single source of truth).
const SUPPORTING_DOCS_BUCKET = "recert-supporting-docs";
const PAGE_CAP = 200;
const SIZE_CAP_BYTES = 40 * 1024 * 1024;

interface RouteParams { caseId: string }

function getServerSupabase(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  if (!url || !key) return null;
  const authHeader = req.headers.get("authorization") ?? "";
  return createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
}

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

export async function POST(req: NextRequest, ctx: { params: RouteParams }) {
  const { caseId } = ctx.params;
  const sb = getServerSupabase(req);
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  // 1. Case (for the index header) + accepted supporting docs.
  const [caseRow, docsRow, itemsRow] = await Promise.all([
    sb.from("recertification_cases").select("id, primary_tenant_name, unit_number, property_name").eq("id", caseId).maybeSingle(),
    sb.from("recert_documents").select("id, document_type, file_name, storage_path, verification_status, required_item_id").eq("case_id", caseId),
    sb.from("recert_required_items").select("id, requirement_label, requirement_level, status").eq("case_id", caseId),
  ]);
  if (caseRow.error || !caseRow.data) return NextResponse.json({ error: "Case not found" }, { status: 404 });
  const c = caseRow.data as { primary_tenant_name?: string; unit_number?: string; property_name?: string };
  const allDocs = (docsRow.data ?? []) as Array<{ id: string; document_type: string; file_name: string; storage_path: string | null; verification_status: string; required_item_id: string | null }>;
  const acceptedDocs = allDocs.filter(d => d.verification_status === "accepted");
  const nonAcceptedDocs = allDocs.filter(d => d.verification_status !== "accepted");

  // Required-item context: label-per-doc + an accepted/required summary for the index.
  const reqItems = (itemsRow.data ?? []) as Array<{ id: string; requirement_label: string; requirement_level: string | null; status: string }>;
  const reqLabelById = new Map(reqItems.map(r => [r.id, r.requirement_label]));
  const reqLabelFor = (d: { required_item_id: string | null }) => (d.required_item_id ? reqLabelById.get(d.required_item_id) : undefined);
  const requiredLevelItems = reqItems.filter(r => (r.requirement_level ?? "required") === "required");
  const requiredSatisfied = requiredLevelItems.filter(r =>
    r.status === "complete" || r.status === "not_applicable" ||
    acceptedDocs.some(d => d.required_item_id === r.id)).length;

  // 2. Get the official LAHD PDF bytes via the existing generator (mode=preview =
  //    full merged content, recorded non-final). The official endpoint is untouched.
  const origin = new URL(req.url).origin;
  const auth = req.headers.get("authorization") ?? "";
  let officialBytes: Uint8Array;
  try {
    const res = await fetch(`${origin}/api/recertification/${caseId}/generate-exact-form?mode=preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
      body: JSON.stringify({ mode: "preview" }),
    });
    if (!res.ok) throw new Error(`official generation failed (${res.status})`);
    officialBytes = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    return NextResponse.json({ error: `Could not generate official LAHD PDF for bundle: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }

  // 3. Assemble the bundle.
  const bundle = await PDFDocument.create();
  const official = await PDFDocument.load(officialBytes);
  const officialPages = await bundle.copyPages(official, official.getPageIndices());
  for (const p of officialPages) bundle.addPage(p);
  const officialPageCount = bundle.getPageCount();

  const included: { id: string; file: string; pages: number; req?: string }[] = [];
  const omitted: { id: string; file: string; reason: string }[] = [];
  const unsupported: { id: string; file: string; reason: string }[] = [];

  const font = await bundle.embedFont(StandardFonts.Helvetica);
  const fontBold = await bundle.embedFont(StandardFonts.HelveticaBold);

  // Append each accepted doc. Honest handling per type; cap enforced.
  for (const doc of acceptedDocs) {
    if (bundle.getPageCount() >= PAGE_CAP) { omitted.push({ id: doc.id, file: doc.file_name, reason: `page cap (${PAGE_CAP}) reached` }); continue; }
    const ext = extOf(doc.file_name);
    if (ext === "doc" || ext === "docx") { unsupported.push({ id: doc.id, file: doc.file_name, reason: "DOC/DOCX not bundled — convert to PDF first" }); continue; }
    if (ext === "heic" || ext === "heif") { unsupported.push({ id: doc.id, file: doc.file_name, reason: "HEIC not bundled — convert to PDF/JPG first" }); continue; }
    if (!doc.storage_path) { omitted.push({ id: doc.id, file: doc.file_name, reason: "no storage path" }); continue; }

    let bytes: Uint8Array;
    try {
      const dl = await sb.storage.from(SUPPORTING_DOCS_BUCKET).download(doc.storage_path);
      if (dl.error || !dl.data) throw new Error(dl.error?.message ?? "download failed");
      bytes = new Uint8Array(await dl.data.arrayBuffer());
    } catch (e) {
      omitted.push({ id: doc.id, file: doc.file_name, reason: `could not download (${e instanceof Error ? e.message : "error"})` });
      continue;
    }

    try {
      if (ext === "pdf") {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pgs = await bundle.copyPages(src, src.getPageIndices());
        const room = PAGE_CAP - bundle.getPageCount();
        const toAdd = pgs.slice(0, Math.max(0, room));
        for (const p of toAdd) bundle.addPage(p);
        if (toAdd.length < pgs.length) omitted.push({ id: doc.id, file: doc.file_name, reason: `partially included (${toAdd.length}/${pgs.length}) — page cap` });
        included.push({ id: doc.id, file: doc.file_name, pages: toAdd.length, req: reqLabelFor(doc) });
      } else if (ext === "jpg" || ext === "jpeg" || ext === "png") {
        const img = ext === "png" ? await bundle.embedPng(bytes) : await bundle.embedJpg(bytes);
        const page = bundle.addPage([612, 792]); // US Letter
        const margin = 36;
        const maxW = 612 - margin * 2, maxH = 792 - margin * 2 - 24;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * scale, h = img.height * scale;
        page.drawText(doc.file_name, { x: margin, y: 792 - margin + 4, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
        page.drawImage(img, { x: (612 - w) / 2, y: (792 - h) / 2 - 12, width: w, height: h });
        included.push({ id: doc.id, file: doc.file_name, pages: 1, req: reqLabelFor(doc) });
      } else {
        unsupported.push({ id: doc.id, file: doc.file_name, reason: `unsupported file type ".${ext || "?"}"` });
      }
    } catch (e) {
      omitted.push({ id: doc.id, file: doc.file_name, reason: `unreadable/corrupt (${e instanceof Error ? e.message : "error"})` });
    }
  }

  // 4. Build the Supporting Documents Index page and insert it AFTER the official
  //    pages (so it precedes the appended docs).
  const idx = bundle.insertPage(officialPageCount, [612, 792]);
  let y = 740;
  const line = (text: string, opts?: { bold?: boolean; size?: number; color?: ReturnType<typeof rgb>; indent?: number }) => {
    idx.drawText(text, { x: 50 + (opts?.indent ?? 0), y, size: opts?.size ?? 10, font: opts?.bold ? fontBold : font, color: opts?.color ?? rgb(0.1, 0.1, 0.1) });
    y -= (opts?.size ?? 10) + 6;
  };
  line("Supporting Documents Index", { bold: true, size: 16 });
  y -= 4;
  line(`Tenant: ${c.primary_tenant_name ?? "—"}    Unit: ${c.unit_number ?? "—"}`, { size: 11 });
  line(`Property: ${c.property_name ?? "—"}    Case: ${caseId}`, { size: 10, color: rgb(0.35, 0.35, 0.35) });
  line(`Generated: ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC    Mode: bundle (non-editable)`, { size: 9, color: rgb(0.35, 0.35, 0.35) });
  line(`Required supporting documents: ${requiredSatisfied}/${requiredLevelItems.length} satisfied (accepted / waived / N-A)`, { size: 9, color: requiredLevelItems.length > 0 && requiredSatisfied < requiredLevelItems.length ? rgb(0.7, 0.2, 0.2) : rgb(0.1, 0.45, 0.2) });
  y -= 6;
  idx.drawText("This bundle is NON-EDITABLE. Use the official LAHD PDF separately for DocHub / signing.", { x: 50, y, size: 9, font: fontBold, color: rgb(0.7, 0.2, 0.2) }); y -= 22;

  line(`Included supporting documents (${included.length})`, { bold: true, size: 11, color: rgb(0.1, 0.45, 0.2) });
  if (included.length === 0) line("None included.", { size: 9, color: rgb(0.5, 0.5, 0.5), indent: 10 });
  for (const d of included) line(`• ${d.file} — ${d.pages} page(s)${d.req ? ` [${d.req}]` : ""}`, { size: 9, indent: 10 });
  y -= 8;
  if (unsupported.length) {
    line(`Unsupported (not bundled) (${unsupported.length})`, { bold: true, size: 11, color: rgb(0.7, 0.45, 0.1) });
    for (const d of unsupported) line(`• ${d.file} — ${d.reason}`, { size: 9, indent: 10, color: rgb(0.4, 0.4, 0.4) });
    y -= 8;
  }
  if (omitted.length) {
    line(`Omitted (${omitted.length})`, { bold: true, size: 11, color: rgb(0.7, 0.2, 0.2) });
    for (const d of omitted) line(`• ${d.file} — ${d.reason}`, { size: 9, indent: 10, color: rgb(0.4, 0.4, 0.4) });
    y -= 8;
  }
  if (nonAcceptedDocs.length) {
    line(`Not included (not yet accepted) (${nonAcceptedDocs.length})`, { bold: true, size: 11, color: rgb(0.4, 0.4, 0.4) });
    for (const d of nonAcceptedDocs) line(`• ${d.file_name} — status: ${d.verification_status}`, { size: 9, indent: 10, color: rgb(0.5, 0.5, 0.5) });
  }

  const bundleBytes = await bundle.save();
  if (bundleBytes.length > SIZE_CAP_BYTES) {
    return NextResponse.json({ error: `Bundle exceeds size cap (${Math.round(bundleBytes.length / 1024 / 1024)}MB > 40MB). Reduce accepted docs.` }, { status: 413 });
  }
  const totalPages = bundle.getPageCount();

  // 5. Record bundle metadata (mode='bundle'). Non-fatal. No case/roster/session change.
  const packetId = `rgp-bundle-${caseId}-${Date.now()}`;
  // Best-effort display name. Must be isolated: user_profiles has many rows, so an
  // unfiltered .maybeSingle() throws ("multiple rows") and would otherwise skip the
  // metadata insert entirely. Derive from the JWT, falling back to a single profile.
  let generatedBy = "unknown";
  try {
    const { data: u } = await sb.auth.getUser();
    generatedBy = u?.user?.user_metadata?.full_name ?? u?.user?.email ?? "unknown";
  } catch { /* best-effort */ }
  try {
    const { error: metaErr } = await sb.from("recert_generated_packets").insert({
      id: packetId,
      case_id: caseId,
      template_id: TEMPLATE_ID,
      output_storage_path: `inline:${packetId}.pdf`,
      generated_by: generatedBy,
      filled_count: officialPageCount,
      blank_count: totalPages - officialPageCount,
      status: "bundle",
      missing_data_json: {
        mode: "bundle",
        official_pages: officialPageCount,
        total_pages: totalPages,
        file_size_bytes: bundleBytes.length,
        included_ids: included.map(d => d.id),
        omitted: omitted,
        unsupported: unsupported,
        not_accepted_ids: nonAcceptedDocs.map(d => d.id),
        required_satisfied: requiredSatisfied,
        required_total: requiredLevelItems.length,
      },
    });
    if (metaErr) console.warn("[generate-bundle] metadata insert error (non-fatal):", metaErr.message);
  } catch (e) {
    console.warn("[generate-bundle] metadata write failed (non-fatal):", e);
  }

  const safe = (s: string) => (s || "").replace(/[^A-Za-z0-9._-]/g, "_").replace(/_+/g, "_");
  return new NextResponse(Buffer.from(bundleBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="LAHD-Income-Certification-${safe(c.primary_tenant_name ?? "Tenant")}-Unit-${safe(c.unit_number ?? "0")}-BUNDLE.pdf"`,
      "Cache-Control": "no-store",
      "X-Mode": "bundle",
      "X-Bundle-Pages": String(totalPages),
      "X-Official-Pages": String(officialPageCount),
      "X-Docs-Included": String(included.length),
      "X-Docs-Omitted": String(omitted.length),
      "X-Docs-Unsupported": String(unsupported.length),
      "X-Docs-Not-Accepted": String(nonAcceptedDocs.length),
    },
  });
}
