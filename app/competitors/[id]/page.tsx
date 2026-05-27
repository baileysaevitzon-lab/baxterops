"use client";
// Generic competitor detail page — works for Jardine, future field-toured comps,
// and any competitor with field-tour evidence. Mirrors the Zen detail layout but is
// competitor-agnostic. The static Zen page at /competitors/zen-hollywood takes
// precedence and still renders the Zen-specific seed (photos collection ID, etc.).

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { SourceBadge } from "@/components/SourceBadge";
import { fmtMoney } from "@/lib/calc";
import { COMPETITORS } from "@/lib/seed";
import { loadCompetitorEvidence, type CompetitorEvidence } from "@/lib/services/competitorEvidence";
import { getConflictsForEntity, getAllConflicts } from "@/lib/services/sourceConflicts";
import { BACKEND_MODE } from "@/lib/services/persistence";
import { QuickTourScorePanel } from "@/components/scoring/QuickTourScorePanel";
import { useAuth } from "@/components/AuthProvider";
import type { PhotoEvidenceRecord, SourceConflictRow } from "@/lib/types";

type Tab = "overview" | "units" | "amenities" | "tour_scores" | "photos" | "sources" | "flags";

export default function CompetitorDetailPage() {
  const params = useParams();
  const rawId = (params?.id ?? "") as string;
  const competitorId = rawId.startsWith("c-") ? rawId : `c-${rawId}`;
  const comp = COMPETITORS.find(c => c.id === competitorId);

  const { signedIn } = useAuth();
  const [evidence, setEvidence] = useState<CompetitorEvidence | null>(null);
  const [conflicts, setConflicts] = useState<SourceConflictRow[]>([]);
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await new Promise(r => setTimeout(r, 30));
      const e = await loadCompetitorEvidence(competitorId);
      const all = await getAllConflicts();
      const obsIds = new Set((e.observedUnits ?? []).map(u => u.id));
      const ours = all.filter(c => c.entityId === competitorId || obsIds.has(c.entityId));
      if (!cancelled) { setEvidence(e); setConflicts(ours); }
    })();
    return () => { cancelled = true; };
  }, [competitorId]);

  if (!comp) {
    return (
      <>
        <PageHeader title="Competitor not found" subtitle={competitorId} action={<Link href="/competitors" className="text-xs underline text-slate-500">← back to comps</Link>} />
      </>
    );
  }

  const ft = evidence?.fieldTours.find(t => t.tourStatus === "completed") ?? evidence?.fieldTours[0];
  const observed = evidence?.observedUnits ?? [];
  const amenities = evidence?.amenityObservations ?? [];
  const photos = evidence?.photoEvidence ?? [];
  const sources = evidence?.sourceVerifications ?? [];
  const flags = evidence?.flags ?? [];
  const openConflicts = conflicts.filter(c => c.status !== "resolved" && !c.status.startsWith("accept"));

  return (
    <>
      <PageHeader
        title={`${comp.name} — Field Tour`}
        subtitle={`${comp.address}${comp.competitorStrategicType ? ` · ${comp.competitorStrategicType.replace(/_/g, " ")}` : ""}${comp.fieldVerifiedAt ? ` · Field verified ${comp.fieldVerifiedAt}` : ""}`}
        action={<Link href="/competitors" className="text-xs underline text-slate-500">← back to comps</Link>}
      />

      {comp.id === "c-jardine" && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          ⚠ <strong>Premium amenity comp — NOT a clean direct rent comp for Baxter.</strong>{" "}
          Jardine is field-tour verified as a luxury / premium-tier competitor with strong amenities, low vacancy, and no specials.
          Use Jardine for amenity benchmarking + competitive threat, <em>not</em> as a rent anchor.
        </div>
      )}

      {openConflicts.length > 0 && (
        <div className="mb-4 rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          ⚠ <strong>{openConflicts.length} unresolved source conflict{openConflicts.length === 1 ? "" : "s"}</strong> on {comp.name}. Verify before owner-facing pricing decisions.
          <ul className="list-disc pl-5 mt-2 text-xs space-y-0.5">
            {openConflicts.slice(0, 6).map(c => (
              <li key={c.id}>{c.entityName} · <strong>{c.fieldKey}</strong> — {c.sourceALabel} ({c.sourceAValue}) vs {c.sourceBLabel} ({c.sourceBValue})</li>
            ))}
          </ul>
          <a href="/source-conflicts" className="underline text-xs mt-2 inline-block">Open Source Conflicts →</a>
        </div>
      )}

      <div className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-xs text-sky-800 flex justify-between items-center">
        <span>Backend mode: <strong>{BACKEND_MODE}</strong></span>
        <span>{observed.length} units · {amenities.length} amenities · {photos.length} photos · {flags.length} flags</span>
      </div>

      {!signedIn && observed.length === 0 && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          🔒 <strong>You are not signed in.</strong> Supabase RLS now restricts field-tour data to authenticated users.
          <a href="/login" className="underline ml-1">Sign in →</a> to see units, amenities, photos, scores.
        </div>
      )}

      <div className="flex gap-1 mb-4 border-b border-slate-200 overflow-x-auto">
        {([
          ["overview","Overview"],
          ["units",`Units Observed (${observed.length})`],
          ["amenities",`Amenities (${amenities.length})`],
          ["tour_scores","Tour Scores ★"],
          ["photos",`Photos (${photos.length})`],
          ["sources",`Source Verification (${sources.length})`],
          ["flags",`Data Quality Flags (${flags.length})`],
        ] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap ${tab === k ? "border-slate-900 text-slate-900 font-medium" : "border-transparent text-slate-500"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader title="Field tour summary" subtitle={ft ? `Collected by ${ft.collectedBy} on ${ft.tourDate}` : "No completed field tour yet"} />
            <CardBody>
              {ft ? (
                <>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <S label="Composite" value={ft.compositeExperienceScore?.toString() ?? "—"} />
                    <S label="Field confidence" value={ft.fieldConfidence} />
                    <S label="Booking ease" value={`${ft.tourBookingEase ?? "—"}/5`} />
                    <S label="Kindness" value={`${ft.kindness ?? "—"}/5`} />
                    <S label="Professionalism" value={`${ft.professionalism ?? "—"}/5`} />
                    <S label="Cleanliness" value={`${ft.cleanliness ?? "—"}/5`} />
                    <S label="Tour quality" value={`${ft.tourQuality ?? "—"}/5`} />
                    <S label="Amenity quality" value={`${ft.amenityQuality ?? "—"}/5`} />
                    <S label="Closing strength" value={`${ft.closingStrength ?? "—"}/5`} />
                    <S label="Pressure level" value={ft.pressureLevel ?? "—"} />
                  </div>
                  <div className="mt-4 text-sm space-y-3">
                    <div><div className="text-xs text-slate-500 mb-1">Concessions observed</div><p>{ft.actualConcessions}</p></div>
                    <div><div className="text-xs text-slate-500 mb-1">Hidden discounts</div><p>{ft.hiddenDiscounts}</p></div>
                    <div><div className="text-xs text-slate-500 mb-1">Parking deal</div><p>{ft.parkingDeal}</p></div>
                    {ft.moveInCost && <div><div className="text-xs text-slate-500 mb-1">Move-in cost</div><p>{ft.moveInCost}</p></div>}
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-500">No field tour recorded for this competitor yet. Add one from <Link href="/walkthrough-campaigns" className="underline">/walkthrough-campaigns</Link>.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Strategic verdict" />
            <CardBody>
              <div className="flex flex-wrap gap-1 mb-3">
                {(comp.competitorTags ?? []).map(t => <Badge key={t}>{t}</Badge>)}
              </div>
              {ft && (
                <div className="text-sm space-y-3">
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Would a real renter choose this over Baxter?</div>
                    <Badge intent={ft.wouldRenterChooseOverBaxter ? "bad" : "good"}>{ft.wouldRenterChooseOverBaxter ? "YES" : "NO"}</Badge>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Why</div>
                    <p>{ft.whyOrWhyNot}</p>
                  </div>
                  <div className="border-t pt-3">
                    <div className="text-xs text-slate-500 mb-1">Baxter response recommendation</div>
                    <p>{ft.baxterResponseRecommendation}</p>
                  </div>
                </div>
              )}
              <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
                <Bar label="Amenity threat" v={comp.amenityThreatLevel ?? 0} />
                <Bar label="Parking threat" v={comp.parkingThreatLevel ?? 0} />
                <Bar label="Concession threat" v={comp.concessionThreatLevel ?? 0} />
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {tab === "units" && (
        <Card>
          <CardHeader title={`${observed.length} observed units`} subtitle="Queryable by comp matching" />
          <CardBody className="p-0">
            <table className="bx">
              <thead>
                <tr>
                  <th>Unit</th><th>Conf</th><th>Type</th><th>Sqft</th><th>Gross</th>
                  <th>Balcony</th><th>Avail</th><th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {observed.map(u => (
                  <tr key={u.id}>
                    <td className="font-medium">{u.unitNumber}</td>
                    <td><Badge intent={u.unitNumberConfidence === "high" ? "good" : "warn"}>{u.unitNumberConfidence}</Badge></td>
                    <td>{u.bedCount !== undefined ? `${u.bedCount}BR/${u.bathCount ?? "?"}BA` : "—"}</td>
                    <td>{u.squareFeet ?? "—"}<div className="mt-1"><SourceBadge fieldKey="square_feet" entityType="competitor_unit" entityId={u.id} compact /></div></td>
                    <td>{u.grossRent ? fmtMoney(u.grossRent) : "—"}<div className="mt-1"><SourceBadge fieldKey="gross_rent" entityType="competitor_unit" entityId={u.id} compact /></div></td>
                    <td>{u.balconyOrPatio === true ? "yes" : u.balconyOrPatio === false ? "no" : "—"}</td>
                    <td>
                      <Badge intent={u.availabilityStatus === "available" ? "good" : "warn"}>{u.availabilityStatus ?? "—"}</Badge>
                    </td>
                    <td className="text-xs text-slate-500 max-w-md">{u.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {tab === "amenities" && (
        <Card>
          <CardHeader title={`${amenities.length} amenity observations`} />
          <CardBody className="p-0">
            <table className="bx">
              <thead><tr><th>Amenity</th><th>Observed</th><th>Quality</th><th>Source</th><th>Notes</th></tr></thead>
              <tbody>
                {amenities.map(a => (
                  <tr key={a.id}>
                    <td className="font-medium">{a.amenity}</td>
                    <td>{a.observed ? <Badge intent="good">yes</Badge> : <Badge intent="bad">no</Badge>}</td>
                    <td>{a.qualityScore ?? "—"}/5</td>
                    <td className="text-xs">{a.sourceLabel}</td>
                    <td className="text-xs text-slate-500 max-w-md">{a.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {tab === "tour_scores" && ft && (
        <QuickTourScorePanel fieldTourId={ft.id} competitorId={competitorId} competitorName={comp.name} />
      )}
      {tab === "tour_scores" && !ft && (
        <p className="p-4 text-sm text-slate-500">No field tour to score yet. Create one from /walkthrough-campaigns.</p>
      )}

      {tab === "photos" && (
        <Card>
          <CardHeader title={`Photo evidence · ${photos.length}`} subtitle="Thumbnails from Supabase Storage when public URL is populated." />
          <CardBody className="p-0">
            {photos.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">No photos yet. Use the dashboard upload widget.</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-5">
                {photos.map(p => <PhotoCard key={p.id} p={p} />)}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {tab === "sources" && (
        <Card>
          <CardHeader title={`${sources.length} source verifications`} />
          <CardBody className="p-0">
            {sources.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">No source verifications yet for this competitor.</p>
            ) : (
              <table className="bx">
                <thead><tr><th>Source</th><th>URL</th><th>Status</th><th>Fields verified</th><th>Notes</th></tr></thead>
                <tbody>
                  {sources.map(s => (
                    <tr key={s.id}>
                      <td className="font-medium">{s.sourceName}</td>
                      <td className="text-xs">{s.sourceUrl ? <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="text-sky-700 underline break-all">{s.sourceUrl}</a> : "—"}</td>
                      <td><Badge intent={s.verificationStatus === "verified" ? "good" : s.verificationStatus === "partial" ? "warn" : "bad"}>{s.verificationStatus}</Badge></td>
                      <td className="text-xs"><ul className="space-y-0.5">{s.fieldsVerified.map(f => <li key={f}>· {f}</li>)}</ul></td>
                      <td className="text-xs text-slate-500 max-w-md">{s.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      )}

      {tab === "flags" && (
        <Card>
          <CardHeader title={`${flags.length} data quality flags`} />
          <CardBody className="p-0">
            <table className="bx">
              <thead><tr><th>Issue</th><th>Severity</th><th>Status</th><th>Affected</th></tr></thead>
              <tbody>
                {flags.map(f => (
                  <tr key={f.id}>
                    <td>{f.issue}</td>
                    <td><Badge intent={f.severity === "high" || f.severity === "critical" ? "bad" : "warn"}>{f.severity}</Badge></td>
                    <td><Badge intent={f.status === "fixed" ? "good" : "warn"}>{f.status}</Badge></td>
                    <td className="text-xs">{f.affectedEntity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </>
  );
}

function S({ label, value }: { label: string; value: string }) {
  return <div className="bg-slate-50 rounded-md p-2"><div className="text-xs text-slate-500">{label}</div><div className="font-medium">{value}</div></div>;
}
function Bar({ label, v }: { label: string; v: number }) {
  return (
    <div>
      <div className="text-slate-500">{label}</div>
      <div className="font-medium text-rose-700">{v}/5</div>
      <div className="h-1.5 bg-slate-200 rounded mt-1"><div className="h-1.5 bg-rose-500 rounded" style={{ width: `${(v / 5) * 100}%` }} /></div>
    </div>
  );
}
function PhotoCard({ p }: { p: PhotoEvidenceRecord }) {
  return (
    <div className="border border-slate-200 rounded-md overflow-hidden">
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
        <div className="flex justify-between items-center"><span className="text-slate-400">#{p.photoOrder}</span><Badge>{p.category}</Badge></div>
        <div className="mt-1 line-clamp-3">{p.caption}</div>
      </div>
    </div>
  );
}
