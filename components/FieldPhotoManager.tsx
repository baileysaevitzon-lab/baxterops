"use client";
// Sprint 26 — Field Photo Manager.
//
// Clean, findable upload + view tool for competitor field-tour photos. Lives on
// /photos-amenities (sidebar-linked), replacing the buried dashboard card as the
// primary path. Fixes vs the old DashboardPhotoUpload:
//   - competitor list from LIVE data (so every DB competitor appears, incl. new ones)
//   - HEIC/HEIF guard: blocked with a clear "convert to JPG first" message
//   - photo_order computed from MAX existing order in the target collection
//   - visible per-file errors, distinguishing storage failure vs DB-row failure
//     (DB failure reports the orphaned storage path)
//   - shows existing photos for the selected competitor, placeholders labeled

import { useCallback, useEffect, useState } from "react";
import { Card, CardBody, CardHeader, Badge } from "./Card";
import { getSupabase } from "@/lib/supabase/client";
import { useAuth } from "./AuthProvider";
import { useCompetitors } from "@/lib/hooks/useCompetitors";
import { loadAllFieldTours } from "@/lib/services/fieldTours";
import { getCompetitorPhotoEvidence, getPhotoCollection, upsertPhotoEvidence } from "@/lib/services/photoEvidence";
import type { CompetitorFieldTour, PhotoEvidenceRecord } from "@/lib/types";

const BUCKET = "baxter-ops-photos";

const CATEGORIES = [
  "lobby", "exterior", "courtyard", "rooftop", "pool", "gym", "common_area",
  "screening_room", "leasing_office", "parking", "amenities",
  "unit", "bedroom", "kitchen", "bathroom", "hallway", "balcony", "closet",
  "listing_screenshot", "other",
];

type FileStatus = "pending" | "uploading" | "done" | "error" | "unsupported";

interface PendingFile {
  id: string;
  file: File;
  category: string;
  caption: string;
  status: FileStatus;
  errorMsg?: string;
  publicUrl?: string;
}

function isHeic(file: File): boolean {
  const n = file.name.toLowerCase();
  return n.endsWith(".heic") || n.endsWith(".heif") || file.type === "image/heic" || file.type === "image/heif";
}

function guessCategory(filename: string): string {
  const f = filename.toLowerCase();
  if (/lobby|entry|entrance/.test(f)) return "lobby";
  if (/kitchen/.test(f)) return "kitchen";
  if (/bath/.test(f)) return "bathroom";
  if (/bed|bedroom/.test(f)) return "bedroom";
  if (/courtyard/.test(f)) return "courtyard";
  if (/gym|fitness/.test(f)) return "gym";
  if (/pool/.test(f)) return "pool";
  if (/roof/.test(f)) return "rooftop";
  if (/lounge|theater|screen.*room/.test(f)) return "screening_room";
  if (/lease|leasing|office/.test(f)) return "leasing_office";
  if (/hall/.test(f)) return "hallway";
  if (/exterior|outside/.test(f)) return "exterior";
  if (/parking|garage/.test(f)) return "parking";
  if (/closet/.test(f)) return "closet";
  return "other";
}

export function FieldPhotoManager() {
  const { profile, authUser } = useAuth();
  const { competitors } = useCompetitors();

  const [competitorId, setCompetitorId] = useState<string>("");
  const [tours, setTours] = useState<CompetitorFieldTour[]>([]);
  const [tourId, setTourId] = useState<string>("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const [existing, setExisting] = useState<PhotoEvidenceRecord[]>([]);
  const [loadingExisting, setLoadingExisting] = useState(false);

  const sortedComps = [...competitors].sort((a, b) => a.name.localeCompare(b.name));

  // Default to first competitor once live list loads.
  useEffect(() => {
    if (!competitorId && sortedComps.length) setCompetitorId(sortedComps[0].id);
  }, [sortedComps, competitorId]);

  const refreshExisting = useCallback(async (cid: string) => {
    if (!cid) { setExisting([]); return; }
    setLoadingExisting(true);
    try { setExisting(await getCompetitorPhotoEvidence(cid)); }
    finally { setLoadingExisting(false); }
  }, []);

  useEffect(() => {
    if (!competitorId) return;
    (async () => {
      const all = await loadAllFieldTours();
      const filtered = all.filter(t => t.competitorId === competitorId);
      setTours(filtered);
      setTourId(filtered[0]?.id ?? "");
      await refreshExisting(competitorId);
    })();
  }, [competitorId, refreshExisting]);

  function addFiles(picked: FileList | null) {
    if (!picked) return;
    const next: PendingFile[] = [];
    for (let i = 0; i < picked.length; i++) {
      const f = picked[i];
      const heic = isHeic(f);
      next.push({
        id: `pf-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        file: f,
        category: guessCategory(f.name),
        caption: "",
        status: heic ? "unsupported" : "pending",
        errorMsg: heic ? "HEIC/HEIF not supported by browsers — convert to JPG first." : undefined,
      });
    }
    setFiles(prev => [...prev, ...next]);
  }

  function updateFile(id: string, patch: Partial<PendingFile>) {
    setFiles(prev => prev.map(f => (f.id === id ? { ...f, ...patch } : f)));
  }
  function removeFile(id: string) {
    setFiles(prev => prev.filter(f => f.id !== id));
  }

  async function uploadAll() {
    const sb = getSupabase();
    if (!sb) { setMsg("Supabase not configured."); return; }
    if (!competitorId || !tourId) { setMsg("Select a competitor and a field tour first."); return; }

    const comp = sortedComps.find(c => c.id === competitorId);
    const competitorName = comp?.name ?? competitorId;
    const compSlug = competitorId.replace(/^c-/, "");
    const tour = tours.find(t => t.id === tourId);
    const tourDateSlug = (tour?.tourDate ?? new Date().toISOString().slice(0, 10)).replace(/[^0-9-]/g, "");
    const collectionId = `${compSlug}-field-tour-${tourDateSlug}`;
    const prefix = `competitors/${compSlug}/field-tour-${tourDateSlug}`;
    const actor = profile?.full_name ?? authUser?.email ?? "Staff";

    const uploadable = files.filter(f => f.status === "pending" || f.status === "error");
    if (uploadable.length === 0) { setMsg("Nothing to upload (HEIC files must be converted first)."); return; }

    setBusy(true);
    setMsg(`Uploading ${uploadable.length} file(s)…`);

    // Robust next photo_order: max existing order in THIS collection + 1.
    const collRows = await getPhotoCollection(collectionId);
    let order = collRows.reduce((mx, r) => Math.max(mx, r.photoOrder ?? 0), 0) + 1;

    let okCount = 0;
    for (const pf of files) {
      if (pf.status === "done" || pf.status === "unsupported") continue;
      updateFile(pf.id, { status: "uploading", errorMsg: undefined });
      const safeName = pf.file.name.replace(/[^A-Za-z0-9._-]/g, "_");
      const storagePath = `${prefix}/${String(order).padStart(2, "0")}-${safeName}`;
      try {
        const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, pf.file, {
          contentType: pf.file.type || "image/jpeg",
          upsert: true,
        });
        if (upErr) { updateFile(pf.id, { status: "error", errorMsg: `Storage upload failed: ${upErr.message}` }); continue; }

        const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(storagePath);
        const now = new Date().toISOString();
        const rec: PhotoEvidenceRecord = {
          id: `ph-${compSlug}-${Date.now()}-${order}`,
          competitorId,
          competitorName,
          fieldTourId: tourId,
          collectionId,
          photoOrder: order,
          originalFilename: pf.file.name,
          storagePath,
          publicUrl: pub.publicUrl,
          category: pf.category,
          caption: pf.caption,
          dataConfidence: "high",
          sourceLabel: `${competitorName} field tour ${tourDateSlug}`,
          sourceDate: tourDateSlug,
          uploadedBy: actor,
          tags: [],
          createdAt: now,
          updatedAt: now,
        };
        try {
          await upsertPhotoEvidence(rec);
        } catch (dbErr) {
          // Storage succeeded but DB row failed — report the orphan path, do not pretend success.
          updateFile(pf.id, {
            status: "error",
            errorMsg: `Stored OK but DB row failed — orphan at ${storagePath}: ${(dbErr as Error).message}`,
          });
          continue;
        }
        updateFile(pf.id, { status: "done", publicUrl: pub.publicUrl });
        okCount++;
        order++;
      } catch (e) {
        updateFile(pf.id, { status: "error", errorMsg: (e as Error).message ?? "upload failed" });
      }
    }

    setBusy(false);
    setMsg(`Done. ${okCount} uploaded, ${uploadable.length - okCount} failed/skipped.`);
    await refreshExisting(competitorId);
  }

  const uploadableCount = files.filter(f => f.status === "pending" || f.status === "error").length;
  const heicCount = files.filter(f => f.status === "unsupported").length;
  const realExisting = existing.filter(p => p.storagePath || p.publicUrl);
  const placeholderExisting = existing.filter(p => !p.storagePath && !p.publicUrl);

  return (
    <Card className="border-l-4 border-l-sky-500 mb-6">
      <CardHeader
        title="Upload field-tour photos"
        subtitle="Pick a competitor and its field tour, drop JPG/PNG files, set category/caption, upload. Files go to Supabase Storage and create photo_evidence rows."
      />
      <CardBody>
        {/* selectors */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3 text-sm">
          <div>
            <label className="text-xs text-slate-500">Competitor</label>
            <select value={competitorId} onChange={e => setCompetitorId(e.target.value)} className="w-full border rounded-md px-3 py-2 mt-1 bg-white">
              {sortedComps.length === 0 && <option value="">— loading competitors… —</option>}
              {sortedComps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Field tour</label>
            <select value={tourId} onChange={e => setTourId(e.target.value)} className="w-full border rounded-md px-3 py-2 mt-1 bg-white">
              {tours.length === 0
                ? <option value="">— no field tour for this competitor —</option>
                : tours.map(t => <option key={t.id} value={t.id}>{t.tourDate} · {t.collectedBy} · {t.id}</option>)}
            </select>
            {tours.length === 0 && competitorId && (
              <p className="text-[11px] text-amber-700 mt-1">This competitor has no field tour yet — create one before uploading photos.</p>
            )}
          </div>
        </div>

        {/* drop zone */}
        <label
          className="block border-2 border-dashed border-sky-300 rounded-lg p-6 text-center text-sm text-sky-900 bg-sky-50 hover:bg-sky-100 cursor-pointer"
          onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
          onDragOver={e => e.preventDefault()}
        >
          <strong>Drag photos here</strong> or click to choose. JPG/PNG upload directly; HEIC is flagged for conversion.
          <input type="file" multiple accept="image/*,.heic,.heif" className="hidden" onChange={e => addFiles(e.target.files)} />
        </label>

        {heicCount > 0 && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            ⚠ {heicCount} HEIC/HEIF file{heicCount === 1 ? "" : "s"} cannot be uploaded — convert to JPG first, then re-add.
          </div>
        )}

        {/* pending files */}
        {files.length > 0 && (
          <div className="mt-4 space-y-2">
            {files.map(pf => (
              <div key={pf.id} className={`border rounded-md p-2 grid grid-cols-1 md:grid-cols-12 gap-2 items-center text-xs ${pf.status === "unsupported" ? "border-amber-300 bg-amber-50/40" : "border-slate-200"}`}>
                <div className="md:col-span-3 truncate font-mono">{pf.file.name}</div>
                <select value={pf.category} disabled={pf.status === "unsupported"} onChange={e => updateFile(pf.id, { category: e.target.value })} className="md:col-span-2 border rounded px-2 py-1 bg-white disabled:opacity-50">
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <input value={pf.caption} disabled={pf.status === "unsupported"} onChange={e => updateFile(pf.id, { caption: e.target.value })} placeholder="caption / description" className="md:col-span-5 border rounded px-2 py-1 disabled:opacity-50" />
                <div className="md:col-span-1">
                  {pf.status === "pending" && <Badge>queued</Badge>}
                  {pf.status === "uploading" && <Badge intent="warn">uploading</Badge>}
                  {pf.status === "done" && <Badge intent="good">✓ done</Badge>}
                  {pf.status === "unsupported" && <Badge intent="warn">convert</Badge>}
                  {pf.status === "error" && <Badge intent="bad">error</Badge>}
                </div>
                <div className="md:col-span-1 text-right">
                  <button onClick={() => removeFile(pf.id)} className="text-rose-600 underline" disabled={pf.status === "uploading"}>×</button>
                </div>
                {pf.status === "error" && pf.errorMsg && <div className="md:col-span-12 text-rose-700">{pf.errorMsg}</div>}
                {pf.status === "unsupported" && <div className="md:col-span-12 text-amber-700">{pf.errorMsg}</div>}
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button
            onClick={uploadAll}
            disabled={busy || uploadableCount === 0 || !competitorId || !tourId}
            className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm disabled:opacity-40"
          >
            {busy ? "Uploading…" : `Upload ${uploadableCount} file${uploadableCount === 1 ? "" : "s"}`}
          </button>
          {competitorId && (
            <a href={`/competitors/${competitorId.replace(/^c-/, "")}`} className="text-xs text-sky-700 underline">View competitor detail →</a>
          )}
          {msg && <span className="text-xs text-slate-500">{msg}</span>}
        </div>

        {/* existing photos for this competitor */}
        <div className="mt-6 border-t border-slate-100 pt-4">
          <div className="text-xs font-semibold text-slate-600 mb-2">
            Existing photos for this competitor: {realExisting.length} real
            {placeholderExisting.length > 0 && <span className="text-amber-700"> · {placeholderExisting.length} placeholder</span>}
            {loadingExisting && <span className="text-slate-400"> · loading…</span>}
          </div>
          {existing.length === 0 ? (
            <p className="text-xs text-slate-400">No photos yet for this competitor. Upload above.</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {existing.map(p => {
                const placeholder = !p.storagePath && !p.publicUrl;
                return (
                  <div key={p.id} className={`border rounded-md overflow-hidden ${placeholder ? "border-amber-300" : "border-slate-200"}`}>
                    <div className="aspect-square bg-slate-100 flex items-center justify-center text-[10px] text-slate-400 text-center px-1 relative">
                      {p.publicUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.publicUrl} alt={p.caption ?? ""} className="w-full h-full object-cover" />
                      ) : (
                        <span>#{p.photoOrder} {placeholder ? "placeholder" : "no image"}</span>
                      )}
                      {placeholder && <span className="absolute top-1 left-1 bg-amber-500 text-white text-[8px] px-1 rounded">PLACEHOLDER</span>}
                    </div>
                    <div className="px-1 py-0.5 text-[10px] text-slate-500 truncate">{p.category}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
