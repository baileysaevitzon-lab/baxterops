"use client";
// Sprint 26/27 — Field Photo Manager.
//
// Clean upload + view tool for competitor field-tour photos (/photos-amenities).
// Sprint 27 adds the photo-size safety rails:
//   - validate dimensions + file size before any upload
//   - HEIC/HEIF blocked with a clear message
//   - JPG/PNG/JPEG auto-resized via canvas to max 2000px longest side @ ~0.85
//   - absurdly large images (> 12000px) blocked with human copy
//   - per-file status: pending / validating / resizing / uploading / done / failed
//   - NO storage upload if validation fails; NO photo_evidence row unless the
//     storage upload succeeds; on DB failure the orphaned storage path is shown.

import { useCallback, useEffect, useState } from "react";
import { Card, CardBody, CardHeader, Badge } from "./Card";
import { getSupabase } from "@/lib/supabase/client";
import { useAuth } from "./AuthProvider";
import { useCompetitors } from "@/lib/hooks/useCompetitors";
import { loadAllFieldTours } from "@/lib/services/fieldTours";
import { getCompetitorPhotoEvidence, getPhotoCollection, upsertPhotoEvidence } from "@/lib/services/photoEvidence";
import { thumbUrl } from "@/lib/storageImage";
import type { CompetitorFieldTour, PhotoEvidenceRecord } from "@/lib/types";

const BUCKET = "baxter-ops-photos";
const TARGET_DIM = 2000;          // longest side after resize
const HARD_DIM = 12000;           // block above this (unprocessable / memory risk)
const COMPRESS_BYTES = 3 * 1024 * 1024; // re-encode even if <=2000px when bigger than this

const CATEGORIES = [
  "lobby", "exterior", "courtyard", "rooftop", "pool", "gym", "common_area",
  "screening_room", "leasing_office", "parking", "amenities",
  "unit", "bedroom", "kitchen", "bathroom", "hallway", "balcony", "closet",
  "listing_screenshot", "other",
];

type FileStatus = "pending" | "validating" | "resizing" | "uploading" | "done" | "failed" | "unsupported";

interface PendingFile {
  id: string;
  file: File;
  category: string;
  caption: string;
  status: FileStatus;
  msg?: string;        // success note or failure reason
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

/** Draw an ImageBitmap to a canvas scaled to maxDim longest side, return a JPEG blob. */
async function drawResized(bitmap: ImageBitmap, maxDim: number, quality: number): Promise<{ blob: Blob; w: number; h: number }> {
  let w = bitmap.width, h = bitmap.height;
  const longest = Math.max(w, h);
  if (longest > maxDim) {
    const s = maxDim / longest;
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not available in this browser");
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error("Image encoding failed"))), "image/jpeg", quality),
  );
  return { blob, w, h };
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
        msg: heic ? "HEIC/HEIF not supported by browsers — convert to JPG first." : undefined,
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

    const uploadable = files.filter(f => f.status === "pending" || f.status === "failed");
    if (uploadable.length === 0) { setMsg("Nothing to upload (HEIC files must be converted first)."); return; }

    setBusy(true);
    setMsg(`Processing ${uploadable.length} file(s)…`);

    const collRows = await getPhotoCollection(collectionId);
    let order = collRows.reduce((mx, r) => Math.max(mx, r.photoOrder ?? 0), 0) + 1;

    let okCount = 0;
    for (const pf of files) {
      if (pf.status === "done" || pf.status === "unsupported") continue;

      // ── 1. Validate dimensions + size; resize if needed ──────────────────────
      updateFile(pf.id, { status: "validating", msg: undefined });
      let uploadBlob: Blob = pf.file;
      let resized = false;
      let note = "";
      let bitmap: ImageBitmap | null = null;
      try {
        bitmap = await createImageBitmap(pf.file);
      } catch (e) {
        updateFile(pf.id, { status: "failed", msg: `Could not read image (corrupt or unsupported): ${(e as Error).message}` });
        continue;
      }
      const longest = Math.max(bitmap.width, bitmap.height);
      if (longest > HARD_DIM) {
        const dims = `${bitmap.width}x${bitmap.height}`;
        bitmap.close?.();
        updateFile(pf.id, { status: "failed", msg: `Image too large (${dims}). Please upload a compressed JPG under 2000px on the longest side.` });
        continue;
      }
      if (longest > TARGET_DIM || pf.file.size > COMPRESS_BYTES) {
        updateFile(pf.id, { status: "resizing" });
        try {
          const r = await drawResized(bitmap, TARGET_DIM, 0.85);
          uploadBlob = r.blob;
          resized = true;
          note = `Auto-resized to ${Math.max(r.w, r.h)}px (${Math.round(r.blob.size / 1024)} KB)`;
        } catch (e) {
          bitmap.close?.();
          updateFile(pf.id, { status: "failed", msg: `Resize failed: ${(e as Error).message}` });
          continue;
        }
      }
      bitmap.close?.();

      // ── 2. Upload bytes (storage first) ──────────────────────────────────────
      updateFile(pf.id, { status: "uploading", msg: note || undefined });
      const safeBase = pf.file.name.replace(/[^A-Za-z0-9._-]/g, "_");
      const finalName = resized ? safeBase.replace(/\.[^.]+$/, "") + ".jpg" : safeBase;
      const storagePath = `${prefix}/${String(order).padStart(2, "0")}-${finalName}`;
      try {
        const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, uploadBlob, {
          contentType: resized ? "image/jpeg" : (pf.file.type || "image/jpeg"),
          upsert: true,
        });
        if (upErr) { updateFile(pf.id, { status: "failed", msg: `Storage upload failed: ${upErr.message}` }); continue; }

        // ── 3. Insert photo_evidence ONLY after storage succeeds ───────────────
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
          updateFile(pf.id, { status: "failed", msg: `Stored OK but DB row failed — orphan at ${storagePath}: ${(dbErr as Error).message}` });
          continue;
        }
        updateFile(pf.id, { status: "done", msg: note || undefined, publicUrl: pub.publicUrl });
        okCount++;
        order++;
      } catch (e) {
        updateFile(pf.id, { status: "failed", msg: (e as Error).message ?? "upload failed" });
      }
    }

    setBusy(false);
    setMsg(`Done. ${okCount} uploaded, ${uploadable.length - okCount} failed/skipped.`);
    await refreshExisting(competitorId);
  }

  const uploadableCount = files.filter(f => f.status === "pending" || f.status === "failed").length;
  const heicCount = files.filter(f => f.status === "unsupported").length;
  const realExisting = existing.filter(p => p.storagePath || p.publicUrl);
  const placeholderExisting = existing.filter(p => !p.storagePath && !p.publicUrl);

  function statusBadge(s: FileStatus, msg?: string) {
    switch (s) {
      case "pending": return <Badge>queued</Badge>;
      case "validating": return <Badge intent="warn">validating</Badge>;
      case "resizing": return <Badge intent="warn">resizing</Badge>;
      case "uploading": return <Badge intent="warn">uploading</Badge>;
      case "done": return <Badge intent="good">✓ done</Badge>;
      case "unsupported": return <Badge intent="warn">convert</Badge>;
      case "failed": return <Badge intent="bad">failed</Badge>;
    }
  }

  return (
    <Card className="border-l-4 border-l-sky-500 mb-6">
      <CardHeader
        title="Upload field-tour photos"
        subtitle="Pick a competitor and its field tour, drop JPG/PNG files, set category/caption, upload. Large photos are auto-resized to 2000px; HEIC must be converted first."
      />
      <CardBody>
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

        <label
          className="block border-2 border-dashed border-sky-300 rounded-lg p-6 text-center text-sm text-sky-900 bg-sky-50 hover:bg-sky-100 cursor-pointer"
          onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
          onDragOver={e => e.preventDefault()}
        >
          <strong>Drag photos here</strong> or click to choose. JPG/PNG upload directly (auto-resized if large); HEIC is flagged for conversion.
          <input type="file" multiple accept="image/*,.heic,.heif" className="hidden" onChange={e => addFiles(e.target.files)} />
        </label>

        {heicCount > 0 && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            ⚠ {heicCount} HEIC/HEIF file{heicCount === 1 ? "" : "s"} cannot be uploaded — convert to JPG first, then re-add.
          </div>
        )}

        {files.length > 0 && (
          <div className="mt-4 space-y-2">
            {files.map(pf => (
              <div key={pf.id} className={`border rounded-md p-2 grid grid-cols-1 md:grid-cols-12 gap-2 items-center text-xs ${pf.status === "unsupported" ? "border-amber-300 bg-amber-50/40" : pf.status === "failed" ? "border-rose-200 bg-rose-50/40" : "border-slate-200"}`}>
                <div className="md:col-span-3 truncate font-mono">{pf.file.name}</div>
                <select value={pf.category} disabled={pf.status === "unsupported"} onChange={e => updateFile(pf.id, { category: e.target.value })} className="md:col-span-2 border rounded px-2 py-1 bg-white disabled:opacity-50">
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <input value={pf.caption} disabled={pf.status === "unsupported"} onChange={e => updateFile(pf.id, { caption: e.target.value })} placeholder="caption / description" className="md:col-span-5 border rounded px-2 py-1 disabled:opacity-50" />
                <div className="md:col-span-1">{statusBadge(pf.status, pf.msg)}</div>
                <div className="md:col-span-1 text-right">
                  <button onClick={() => removeFile(pf.id)} className="text-rose-600 underline" disabled={pf.status === "uploading" || pf.status === "resizing" || pf.status === "validating"}>×</button>
                </div>
                {pf.msg && (pf.status === "failed" || pf.status === "unsupported")
                  ? <div className={`md:col-span-12 ${pf.status === "failed" ? "text-rose-700" : "text-amber-700"}`}>{pf.msg}</div>
                  : pf.msg && pf.status === "done"
                  ? <div className="md:col-span-12 text-emerald-700">{pf.msg}</div>
                  : null}
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
            {busy ? "Working…" : `Upload ${uploadableCount} file${uploadableCount === 1 ? "" : "s"}`}
          </button>
          {competitorId && (
            <a href={`/competitors/${competitorId.replace(/^c-/, "")}`} className="text-xs text-sky-700 underline">View competitor detail →</a>
          )}
          {msg && <span className="text-xs text-slate-500">{msg}</span>}
        </div>

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
                        <img
                          src={thumbUrl(p.publicUrl, 200)}
                          alt={p.caption ?? ""}
                          loading="lazy"
                          className="w-full h-full object-cover"
                          onError={e => { const t = e.currentTarget; if (p.publicUrl && t.src !== p.publicUrl) t.src = p.publicUrl; }}
                        />
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
