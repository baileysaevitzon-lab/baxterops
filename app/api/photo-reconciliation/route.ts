import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Sprint 28 (Phase 2) — READ-ONLY storage/photo reconciliation report.
//
// SAFETY CONTRACT (do not violate):
//   - This route performs ONLY .list() (storage) and .select() (DB) calls.
//   - It NEVER calls .remove(), .update(), .insert(), .upsert(), or .delete().
//   - It returns a diagnostic report + advisory "safe to clean?" notes ONLY.
//     No cleanup is performed here or anywhere downstream of this route.
//   - The service-role key is read from a server-only env var and never returned
//     to the client.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "baxter-ops-photos";

function getServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // server-only, no NEXT_PUBLIC_ prefix
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// Recursively list every object path under a storage prefix (read-only).
async function listAllObjects(supabase: SupabaseClient, prefix: string, acc: string[], depth: number) {
  if (depth > 6 || acc.length > 8000) return; // hard backstops
  const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
    limit: 1000,
    sortBy: { column: "name", order: "asc" },
  });
  if (error || !data) return;
  for (const entry of data) {
    const full = prefix ? `${prefix}/${entry.name}` : entry.name;
    // In supabase-js, a "folder" placeholder has no id/metadata; a file has metadata.
    const isFile = !!(entry.id || entry.metadata);
    if (isFile) acc.push(full);
    else await listAllObjects(supabase, full, acc, depth + 1);
  }
}

export async function GET() {
  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Server is missing SUPABASE_SERVICE_ROLE_KEY — reconciliation is unavailable." },
      { status: 503 },
    );
  }

  try {
    // 1. List all storage objects (read-only).
    const storagePaths: string[] = [];
    await listAllObjects(supabase, "", storagePaths, 0);
    const storageSet = new Set(storagePaths);

    // 2. Read photo_evidence rows (read-only select).
    const { data: rows, error: rowsErr } = await supabase
      .from("photo_evidence")
      .select("id, competitor_id, competitor_name, field_tour_id, collection_id, photo_order, storage_path, public_url, original_filename");
    if (rowsErr) throw new Error(`photo_evidence read failed: ${rowsErr.message}`);
    const photoRows = rows ?? [];

    // 3. Read competitor + tour id sets (read-only select).
    const { data: comps } = await supabase.from("competitors").select("id");
    const competitorIds = new Set((comps ?? []).map(c => c.id));
    const { data: tours } = await supabase.from("competitor_field_tours").select("id");
    const tourIds = new Set((tours ?? []).map(t => t.id));

    const dbStoragePaths = new Set(photoRows.filter(r => r.storage_path).map(r => r.storage_path as string));

    // (1) Storage objects with no matching photo_evidence row.
    const orphanStorage = storagePaths.filter(p => !dbStoragePaths.has(p));

    // (2) DB rows whose storage_path is set but the object is not present in storage.
    const missingStorage = photoRows
      .filter(r => r.storage_path && !storageSet.has(r.storage_path as string))
      .map(r => ({ id: r.id, storagePath: r.storage_path, competitorName: r.competitor_name }));

    // (3) Rows with NULL/empty storage_path or public_url.
    const nullPath = photoRows
      .filter(r => !r.storage_path || !r.public_url)
      .map(r => ({
        id: r.id,
        competitorName: r.competitor_name,
        originalFilename: r.original_filename,
        hasStoragePath: !!r.storage_path,
        hasPublicUrl: !!r.public_url,
      }));

    // (4) Duplicate collection_id + photo_order.
    const dupMap = new Map<string, string[]>();
    for (const r of photoRows) {
      const key = `${r.collection_id}__${r.photo_order}`;
      const list = dupMap.get(key) ?? [];
      list.push(r.id);
      dupMap.set(key, list);
    }
    const duplicates = Array.from(dupMap.entries())
      .filter(([, ids]) => ids.length > 1)
      .map(([key, ids]) => {
        const [collectionId, photoOrder] = key.split("__");
        return { collectionId, photoOrder: Number(photoOrder), count: ids.length, ids };
      });

    // (5) Rows attached to a missing competitor or missing tour.
    const missingCompetitor = photoRows
      .filter(r => r.competitor_id && !competitorIds.has(r.competitor_id))
      .map(r => ({ id: r.id, competitorId: r.competitor_id, competitorName: r.competitor_name }));
    // Phase 3 (Task 3): the REAL tour link is field_tour_id (FK → competitor_field_tours.id),
    // NOT collection_id (a human-readable upload-batch label). The earlier version checked
    // collection_id and false-flagged all 127 rows. We now validate field_tour_id.
    const missingTour = photoRows
      .filter(r => r.field_tour_id && tourIds.size > 0 && !tourIds.has(r.field_tour_id))
      .map(r => ({ id: r.id, fieldTourId: r.field_tour_id, collectionId: r.collection_id, competitorName: r.competitor_name }));

    // (6) Counts by competitor and by collection.
    const byCompetitor = new Map<string, number>();
    const byCollection = new Map<string, { collectionId: string; competitorName: string; count: number }>();
    for (const r of photoRows) {
      byCompetitor.set(r.competitor_name, (byCompetitor.get(r.competitor_name) ?? 0) + 1);
      const cur = byCollection.get(r.collection_id);
      if (cur) cur.count++;
      else byCollection.set(r.collection_id, { collectionId: r.collection_id, competitorName: r.competitor_name, count: 1 });
    }

    const safe = (n: number, ok: string, warn: string) => (n === 0 ? ok : warn);

    return NextResponse.json({
      ok: true,
      readOnly: true,
      generatedAt: new Date().toISOString(),
      bucket: BUCKET,
      totals: { storageObjects: storagePaths.length, dbRows: photoRows.length },
      sections: {
        orphanStorageObjects: {
          count: orphanStorage.length,
          items: orphanStorage.slice(0, 200),
          recommendation: safe(
            orphanStorage.length,
            "Nothing to review — every storage object maps to a row.",
            "REVIEW before any cleanup — could be in-progress uploads, misfiled objects, or rows deleted without removing the object. Do NOT auto-delete.",
          ),
        },
        dbRowsMissingStorage: {
          count: missingStorage.length,
          items: missingStorage.slice(0, 200),
          recommendation: safe(
            missingStorage.length,
            "All rows point at an existing object.",
            "REVIEW — these rows reference a storage_path with no object. Likely a failed/partial upload or a moved object. Do NOT auto-delete the rows; verify first.",
          ),
        },
        rowsMissingPathOrUrl: {
          count: nullPath.length,
          items: nullPath.slice(0, 200),
          recommendation: safe(
            nullPath.length,
            "No placeholder rows.",
            "EXPECTED for placeholder rows (no image attached yet). Not necessarily a problem — these render as PLACEHOLDER in the gallery. No cleanup needed.",
          ),
        },
        duplicateCollectionOrder: {
          count: duplicates.length,
          items: duplicates.slice(0, 200),
          recommendation: safe(
            duplicates.length,
            "No duplicate (collection_id, photo_order) keys.",
            "REVIEW — duplicate ordering keys can cause unstable gallery sort. Inspect each group; do NOT auto-delete (one may be the real photo).",
          ),
        },
        rowsMissingCompetitor: {
          count: missingCompetitor.length,
          items: missingCompetitor.slice(0, 200),
          recommendation: safe(
            missingCompetitor.length,
            "Every row links to an existing competitor.",
            "INVESTIGATE — these rows reference a competitor_id that no longer exists (possible after a future merge/rename). Retarget, don't delete.",
          ),
        },
        rowsMissingTour: {
          count: missingTour.length,
          items: missingTour.slice(0, 200),
          note:
            tourIds.size === 0
              ? "No field-tour rows found; tour check skipped."
              : "Checks field_tour_id (the FK to competitor_field_tours). collection_id is just a readable batch label and is intentionally not a tour id.",
          recommendation: safe(
            missingTour.length,
            "Every photo's field_tour_id resolves to a real field tour. (collection_id remains a grouping label by design — not an error.)",
            "INVESTIGATE — these rows have a field_tour_id that does not match any competitor_field_tours row. Retarget to the correct tour; do not delete.",
          ),
        },
        countsByCompetitor: Array.from(byCompetitor.entries())
          .map(([competitorName, count]) => ({ competitorName, count }))
          .sort((a, b) => b.count - a.count),
        countsByCollection: Array.from(byCollection.values()).sort((a, b) => b.count - a.count),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error during reconciliation." },
      { status: 500 },
    );
  }
}
