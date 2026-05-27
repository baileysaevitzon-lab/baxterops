"use client";
// Sprint 7 — Dashboard Photo Upload.
//
// Drag/drop or file-pick → Supabase Storage upload → photo_evidence row insertion.
// Replaces the manual `sips` + `curl` shell workflow Bailey used for the Zen batch.
//
// One competitor / one field tour per batch upload. Per-file category + caption.

import { useEffect, useMemo, useState } from "react";
import { Card, CardBody, CardHeader, Badge } from "./Card";
import { getSupabase } from "@/lib/supabase/client";
import { COMPETITORS } from "@/lib/seed";
import { loadAllFieldTours } from "@/lib/services/fieldTours";
import { upsertPhotoEvidence, getCompetitorPhotoEvidence } from "@/lib/services/photoEvidence";
import { useRole } from "./RoleProvider";
import { useSourceLedger } from "./SourceLedgerProvider";
import type { CompetitorFieldTour, PhotoEvidenceRecord } from "@/lib/types";

const CATEGORIES = [
  "lobby","exterior","kitchen","living_room","bedroom","bathroom","closet","balcony",
  "hallway","gym","rooftop","pool","theater","lounge","business_area","parking",
  "amenity","listing_screenshot","other",
];

interface PendingFile {
  id: string;
  file: File;
  category: string;
  caption: string;
  status: "pending" | "uploading" | "done" | "error";
  errorMsg?: string;
  publicUrl?: string;
}

export function DashboardPhotoUpload() {
  const { user } = useRole();
  const ledger = useSourceLedger();
  const [competitorId, setCompetitorId] = useState(COMPETITORS.find(c => c.fieldVerified)?.id ?? COMPETITORS[0]?.id);
  const [tours, setTours] = useState<CompetitorFieldTour[]>([]);
  const [tourId, setTourId] = useState<string>("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const [recentCount, setRecentCount] = useState<number>(0);

  useEffect(() => {
    (async () => {
      const all = await loadAllFieldTours();
      const filtered = all.filter(t => t.competitorId === competitorId);
      setTours(filtered);
      if (filtered.length && !filtered.find(t => t.id === tourId)) setTourId(filtered[0].id);
      if (competitorId) {
        const existing = await getCompetitorPhotoEvidence(competitorId);
        setRecentCount(existing.length);
      }
    })();
  }, [competitorId, tourId]);

  function addFiles(picked: FileList | null) {
    if (!picked) return;
    const next: PendingFile[] = [];
    for (let i = 0; i < picked.length; i++) {
      const f = picked[i];
      next.push({
        id: `pf-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        file: f,
        category: guessCategory(f.name),
        caption: "",
        status: "pending",
      });
    }
    setFiles(prev => [...prev, ...next]);
  }

  function updateFile(id: string, patch: Partial<PendingFile>) {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
  }

  function removeFile(id: string) {
    setFiles(prev => prev.filter(f => f.id !== id));
  }

  async function uploadAll() {
    const sb = getSupabase();
    if (!sb) { setMsg("Supabase not configured."); return; }
    if (!competitorId || !tourId) { setMsg("Select a competitor and field tour first."); return; }
    setBusy(true); setMsg(`Uploading ${files.filter(f => f.status !== "done").length} file(s)…`);

    const competitorName = COMPETITORS.find(c => c.id === competitorId)?.name ?? competitorId;
    const compSlug = competitorId.replace(/^c-/, "");
    const tourDateSlug = (tours.find(t => t.id === tourId)?.tourDate ?? new Date().toISOString().slice(0, 10)).replace(/[^0-9-]/g, "");
    const prefix = `competitors/${compSlug}/field-tour-${tourDateSlug}`;

    // Start photoOrder after existing.
    let order = (await getCompetitorPhotoEvidence(competitorId)).length + 1;

    for (const pf of files) {
      if (pf.status === "done") continue;
      updateFile(pf.id, { status: "uploading", errorMsg: undefined });
      try {
        const ext = pf.file.name.split(".").pop()?.toLowerCase() ?? "jpg";
        const storagePath = `${prefix}/${String(order).padStart(2, "0")}-${pf.file.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
        const { error: upErr } = await sb.storage.from("baxter-ops-photos").upload(storagePath, pf.file, {
          contentType: pf.file.type || `image/${ext}`,
          upsert: true,
        });
        if (upErr) throw upErr;
        const { data: pub } = sb.storage.from("baxter-ops-photos").getPublicUrl(storagePath);

        const rec: PhotoEvidenceRecord = {
          id: `ph-${compSlug}-${Date.now()}-${order}`,
          competitorId,
          competitorName,
          fieldTourId: tourId,
          collectionId: `${compSlug}-field-tour-${tourDateSlug}`,
          photoOrder: order,
          originalFilename: pf.file.name,
          storagePath,
          publicUrl: pub.publicUrl,
          category: pf.category,
          caption: pf.caption,
          dataConfidence: "high",
          sourceLabel: `${competitorName} field tour ${tourDateSlug}`,
          sourceDate: tourDateSlug,
          uploadedBy: user.name,
          tags: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await upsertPhotoEvidence(rec);
        updateFile(pf.id, { status: "done", publicUrl: pub.publicUrl });
        order++;
      } catch (e) {
        const m = (e as Error).message ?? "upload failed";
        console.warn("[DashboardPhotoUpload] upload error:", m);
        updateFile(pf.id, { status: "error", errorMsg: m });
      }
    }

    setBusy(false);
    const done = files.filter(f => f.status === "done").length + files.filter(f => f.status === "pending").length;
    setMsg(`Done. ${done} uploaded.`);
    await ledger?.refresh();
    if (competitorId) {
      const after = await getCompetitorPhotoEvidence(competitorId);
      setRecentCount(after.length);
    }
  }

  const totalPending = files.filter(f => f.status !== "done").length;

  return (
    <Card className="border-l-4 border-l-amber-500">
      <CardHeader
        title="Upload Field Tour Photos ★"
        subtitle={`Drag JPG/PNG/HEIC files in. They upload to Supabase Storage and create photo_evidence rows. ${recentCount} photo${recentCount === 1 ? "" : "s"} already on this competitor.`}
      />
      <CardBody>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3 text-sm">
          <div>
            <label className="text-xs text-slate-500">Competitor</label>
            <select value={competitorId} onChange={e => setCompetitorId(e.target.value)} className="w-full border rounded-md px-3 py-2 mt-1">
              {COMPETITORS.map(c => <option key={c.id} value={c.id}>{c.name}{c.fieldVerified ? " ★" : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Field tour</label>
            <select value={tourId} onChange={e => setTourId(e.target.value)} className="w-full border rounded-md px-3 py-2 mt-1">
              {tours.length === 0 ? <option value="">— no field tour for this competitor yet —</option> : null}
              {tours.map(t => <option key={t.id} value={t.id}>{t.tourDate} · {t.collectedBy}</option>)}
            </select>
          </div>
        </div>

        {/* drop zone */}
        <label
          className="block border-2 border-dashed border-amber-300 rounded-lg p-6 text-center text-sm text-amber-900 bg-amber-50 hover:bg-amber-100 cursor-pointer"
          onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
          onDragOver={e => e.preventDefault()}
        >
          <strong>Drag photos here</strong> or click to pick. Multiple files supported.
          <input type="file" multiple accept="image/*,.heic" className="hidden" onChange={e => addFiles(e.target.files)} />
        </label>

        {files.length > 0 && (
          <div className="mt-4 space-y-2">
            {files.map(pf => (
              <div key={pf.id} className="border border-slate-200 rounded-md p-2 grid grid-cols-1 md:grid-cols-12 gap-2 items-center text-xs">
                <div className="md:col-span-3 truncate font-mono">{pf.file.name}</div>
                <select value={pf.category} onChange={e => updateFile(pf.id, { category: e.target.value })} className="md:col-span-2 border rounded px-2 py-1">
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <input value={pf.caption} onChange={e => updateFile(pf.id, { caption: e.target.value })} placeholder="optional caption" className="md:col-span-5 border rounded px-2 py-1" />
                <div className="md:col-span-1">
                  {pf.status === "pending" && <Badge>queued</Badge>}
                  {pf.status === "uploading" && <Badge intent="warn">uploading</Badge>}
                  {pf.status === "done" && <Badge intent="good">done</Badge>}
                  {pf.status === "error" && <Badge intent="bad">{pf.errorMsg ?? "error"}</Badge>}
                </div>
                <div className="md:col-span-1 text-right">
                  <button onClick={() => removeFile(pf.id)} className="text-rose-600 underline" disabled={pf.status === "uploading"}>×</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button
            onClick={uploadAll}
            disabled={busy || totalPending === 0 || !competitorId || !tourId}
            className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm disabled:opacity-40"
          >
            {busy ? "Uploading…" : `Upload ${totalPending} file${totalPending === 1 ? "" : "s"}`}
          </button>
          {competitorId && (
            <a href={`/competitors/${competitorId.replace(/^c-/, "")}`} className="text-xs text-sky-700 underline">
              View photos for {COMPETITORS.find(c => c.id === competitorId)?.name} →
            </a>
          )}
          {msg && <span className="text-xs text-slate-500">{msg}</span>}
        </div>

        <p className="text-[11px] text-slate-400 mt-3">
          Files go to bucket <code>baxter-ops-photos</code> at <code>competitors/&lt;slug&gt;/field-tour-&lt;date&gt;/&lt;order&gt;-&lt;name&gt;</code>.
          .heic files upload as-is but browsers won't render them — convert to .jpg first for inline preview.
        </p>
      </CardBody>
    </Card>
  );
}

// Trivial filename → category guess so the user doesn't have to pick from scratch.
function guessCategory(filename: string): string {
  const f = filename.toLowerCase();
  if (/lobby|entry|entrance/.test(f)) return "lobby";
  if (/kitchen/.test(f)) return "kitchen";
  if (/bath|bath_/.test(f)) return "bathroom";
  if (/bed|bedroom/.test(f)) return "bedroom";
  if (/living|family/.test(f)) return "living_room";
  if (/balcony|patio/.test(f)) return "balcony";
  if (/gym|fitness/.test(f)) return "gym";
  if (/pool/.test(f)) return "pool";
  if (/rooftop|roof/.test(f)) return "rooftop";
  if (/theater|theatre|game/.test(f)) return "theater";
  if (/lounge|bar/.test(f)) return "lounge";
  if (/hall/.test(f)) return "hallway";
  if (/exterior|outside|outdoor/.test(f)) return "exterior";
  if (/parking|garage/.test(f)) return "parking";
  if (/closet/.test(f)) return "closet";
  if (/listing|screen/.test(f)) return "listing_screenshot";
  return "other";
}
