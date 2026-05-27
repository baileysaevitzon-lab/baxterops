"use client";
import { useEffect, useMemo, useState } from "react";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { getAllPhotoEvidence } from "@/lib/services/photoEvidence";
import { getAllAmenityObservations } from "@/lib/services/amenityObservations";
import { BACKEND_MODE } from "@/lib/services/persistence";
import type { PhotoEvidenceRecord, CompetitorAmenityObservation } from "@/lib/types";

const AMENITY_CATEGORIES = [
  "Rooftop","Pool","Gym","Lounge","Coworking","Parking",
  "Package room","Security","Pet area","In-unit laundry",
  "Smart locks","Furnished options",
];

export default function PhotosAmenities() {
  const [photos, setPhotos] = useState<PhotoEvidenceRecord[]>([]);
  const [amenities, setAmenities] = useState<CompetitorAmenityObservation[]>([]);
  const [filterCollection, setFilterCollection] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterCompetitor, setFilterCompetitor] = useState<string>("all");

  useEffect(() => {
    (async () => {
      await new Promise(r => setTimeout(r, 30));
      setPhotos(await getAllPhotoEvidence());
      setAmenities(await getAllAmenityObservations());
    })();
  }, []);

  const collections = useMemo(() => {
    const map = new Map<string, { id: string; competitor: string; count: number }>();
    for (const p of photos) {
      const cur = map.get(p.collectionId);
      if (cur) cur.count++;
      else map.set(p.collectionId, { id: p.collectionId, competitor: p.competitorName, count: 1 });
    }
    return Array.from(map.values());
  }, [photos]);

  const categories = useMemo(() => Array.from(new Set(photos.map(p => p.category))).sort(), [photos]);
  const competitors = useMemo(() => Array.from(new Set(photos.map(p => p.competitorName))).sort(), [photos]);

  const filtered = photos
    .filter(p => filterCollection === "all" || p.collectionId === filterCollection)
    .filter(p => filterCategory === "all" || p.category === filterCategory)
    .filter(p => filterCompetitor === "all" || p.competitorName === filterCompetitor)
    .sort((a, b) => a.photoOrder - b.photoOrder);

  return (
    <>
      <PageHeader
        title="Photos + Amenities"
        subtitle={`${photos.length} photo evidence records · ${amenities.length} amenity observations · backend: ${BACKEND_MODE}`}
      />

      <Card className="mb-6">
        <CardHeader title="Photo collections" subtitle="One row per field-tour or upload batch" />
        <CardBody className="p-0">
          {collections.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">No collections yet. The Zen Hollywood field-tour batch seeds on first load — refresh if not visible.</p>
          ) : (
            <table className="bx">
              <thead><tr><th>Collection</th><th>Competitor</th><th>Photos</th></tr></thead>
              <tbody>
                {collections.map(c => (
                  <tr key={c.id}>
                    <td className="font-medium">{c.id}</td>
                    <td>{c.competitor}</td>
                    <td><Badge intent="info">{c.count}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader
          title={`Photo evidence · ${filtered.length} of ${photos.length}`}
          action={
            <div className="flex gap-2 text-xs">
              <select value={filterCollection} onChange={e => setFilterCollection(e.target.value)} className="border rounded px-2 py-1">
                <option value="all">All collections</option>
                {collections.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
              </select>
              <select value={filterCompetitor} onChange={e => setFilterCompetitor(e.target.value)} className="border rounded px-2 py-1">
                <option value="all">All competitors</option>
                {competitors.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="border rounded px-2 py-1">
                <option value="all">All categories</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          }
        />
        <CardBody>
          <div className="bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2 text-xs text-emerald-800 mb-4">
            <strong>Zen photos are live on Supabase Storage</strong> (bucket <code>baxter-ops-photos</code>, prefix <code>competitors/zen-hollywood/field-tour-2026-05-26/</code>).
            New field-tour batches can be uploaded by running <code>scripts/convert-zen-heic-to-jpg.sh</code> then <code>scripts/upload-zen-photos-to-supabase.sh</code>.
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {filtered.map(p => (
              <div key={p.id} className="border border-slate-200 rounded-md overflow-hidden">
                <div className="aspect-square bg-slate-100 flex items-center justify-center text-xs text-slate-400 text-center px-2">
                  {p.publicUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.publicUrl} alt={p.caption} className="w-full h-full object-cover" />
                  ) : (
                    <div>
                      <div className="text-slate-500 font-medium">#{p.photoOrder}</div>
                      <div className="mt-1">{p.originalFilename}</div>
                      <div className="mt-1 text-[10px] italic">no image attached</div>
                    </div>
                  )}
                </div>
                <div className="p-2 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">#{p.photoOrder}</span>
                    <Badge>{p.category}</Badge>
                  </div>
                  <div className="mt-1 line-clamp-3 text-slate-700">{p.caption}</div>
                  {p.relatedUnitNumber && <div className="text-slate-500 mt-1">unit {p.relatedUnitNumber}</div>}
                  {p.relatedAmenity && <div className="text-slate-500">{p.relatedAmenity}</div>}
                </div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Amenity comparison matrix" subtitle="Baxter vs competitors. Real observations from /competitors when field-tour data exists." />
        <CardBody>
          <table className="bx">
            <thead>
              <tr><th>Amenity</th><th>Baxter</th><th>Zen (field-verified)</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {AMENITY_CATEGORIES.map(a => {
                const slug = a.toLowerCase().replace(/[^a-z]+/g, "_");
                const zen = amenities.find(x => x.amenity === slug || x.amenity.includes(slug.split("_")[0]));
                const baxterHas = ["Rooftop","Lounge","Package room"].includes(a);
                return (
                  <tr key={a}>
                    <td className="font-medium">{a}</td>
                    <td>{baxterHas ? <Badge intent="good">yes</Badge> : <Badge>no</Badge>}</td>
                    <td>
                      {zen ? (
                        <>
                          <Badge intent="good">yes · {zen.qualityScore ?? "—"}/5</Badge>
                        </>
                      ) : <Badge>—</Badge>}
                    </td>
                    <td className="text-xs text-slate-500 max-w-md">{zen?.notes ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </>
  );
}
