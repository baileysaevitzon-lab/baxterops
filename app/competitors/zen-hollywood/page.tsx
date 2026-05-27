"use client";
// Zen Hollywood — field-tour detail page.
// Tabs: Overview · Units Observed · Amenities · Photos · Source Verification · Data Quality Flags.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { SourceBadge } from "@/components/SourceBadge";
import { fmtMoney } from "@/lib/calc";
import { COMPETITORS } from "@/lib/seed";
import { loadCompetitorEvidence, type CompetitorEvidence } from "@/lib/services/competitorEvidence";
import { getConflictsForEntity, getAllConflicts } from "@/lib/services/sourceConflicts";
import type { SourceConflictRow } from "@/lib/types";
import { ZEN_COMPETITOR_ID, ZEN_COLLECTION_ID, ZEN_PHOTO_COUNT_EXPECTED, ZEN_FIELD_TOUR_ID, ZEN_COMPETITOR_NAME } from "@/lib/zen";
import { QuickTourScorePanel } from "@/components/scoring/QuickTourScorePanel";
import { BACKEND_MODE } from "@/lib/services/persistence";
import type { PhotoEvidenceRecord } from "@/lib/types";

type Tab = "overview" | "units" | "amenities" | "photos" | "sources" | "flags" | "tour_scores";

export default function ZenDetailPage() {
  const [evidence, setEvidence] = useState<CompetitorEvidence | null>(null);
  const [conflicts, setConflicts] = useState<SourceConflictRow[]>([]);
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await new Promise(r => setTimeout(r, 30));
      const e = await loadCompetitorEvidence(ZEN_COMPETITOR_ID);
      const allConflicts = await getAllConflicts();
      // include conflicts on the competitor itself + any of its observed units
      const obsIds = new Set((e.observedUnits ?? []).map(u => u.id));
      const ours = allConflicts.filter(c => c.entityId === ZEN_COMPETITOR_ID || obsIds.has(c.entityId));
      if (!cancelled) { setEvidence(e); setConflicts(ours); }
    })();
    return () => { cancelled = true; };
  }, []);

  const openConflicts = conflicts.filter(c => c.status !== "resolved" && !c.status.startsWith("accept"));

  const comp = COMPETITORS.find(c => c.id === ZEN_COMPETITOR_ID);
  const ft = evidence?.fieldTours.find(t => t.tourStatus === "completed") ?? evidence?.fieldTours[0];
  const photos = evidence?.photoEvidence ?? [];
  const observed = evidence?.observedUnits ?? [];
  const amenities = evidence?.amenityObservations ?? [];
  const sources = evidence?.sourceVerifications ?? [];
  const flags = evidence?.flags ?? [];

  return (
    <>
      <PageHeader
        title="Zen Hollywood — Field Tour"
        subtitle={`${comp?.address ?? ""} · Premium amenity comp · Field verified ${ft?.tourDate ?? "—"}`}
        action={<Link href="/competitors" className="text-xs underline text-slate-500">← back to comps</Link>}
      />

      {openConflicts.length > 0 && (
        <div className="mb-4 rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          ⚠ <strong>{openConflicts.length} unresolved source conflict{openConflicts.length === 1 ? "" : "s"}</strong> on Zen Hollywood. Verify before owner-facing pricing decisions.
          <ul className="list-disc pl-5 mt-2 text-xs space-y-0.5">
            {openConflicts.slice(0, 6).map(c => (
              <li key={c.id}>{c.entityName} · <strong>{c.fieldKey}</strong> — {c.sourceALabel} ({c.sourceAValue}) vs {c.sourceBLabel} ({c.sourceBValue}){c.sourceCLabel ? ` vs ${c.sourceCLabel} (${c.sourceCValue})` : ""}</li>
            ))}
          </ul>
          <a href="/source-conflicts" className="underline text-xs mt-2 inline-block">Open Source Conflicts →</a>
        </div>
      )}

      {/* Backend mode banner */}
      <div className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-xs text-sky-800 flex justify-between items-center">
        <span>
          Backend mode: <strong>{BACKEND_MODE}</strong>
          {BACKEND_MODE === "localStorage" && " — Supabase env vars not set; data persists per-browser only."}
        </span>
        <span>Photos expected: {ZEN_PHOTO_COUNT_EXPECTED} · ingested: {photos.length}</span>
      </div>

      {/* tabs */}
      <div className="flex gap-1 mb-4 border-b border-slate-200">
        {([
          ["overview","Overview"],["units","Units Observed"],["amenities","Amenities"],
          ["photos",`Photos (${photos.length})`],["tour_scores","Tour Scores ★"],
          ["sources","Source Verification"],["flags",`Data Quality Flags (${flags.length})`],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-2 text-sm border-b-2 -mb-px ${tab === k ? "border-slate-900 text-slate-900 font-medium" : "border-transparent text-slate-500"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader title="Field tour summary" subtitle={`Collected by ${ft?.collectedBy ?? "—"} on ${ft?.tourDate ?? "—"}`} />
            <CardBody>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Stat label="Composite score" value={ft?.compositeExperienceScore?.toString() ?? "—"} />
                <Stat label="Field confidence" value={ft?.fieldConfidence ?? "—"} />
                <Stat label="Booking ease" value={`${ft?.tourBookingEase ?? "—"}/5`} />
                <Stat label="Kindness" value={`${ft?.kindness ?? "—"}/5`} />
                <Stat label="Professionalism" value={`${ft?.professionalism ?? "—"}/5`} />
                <Stat label="Cleanliness" value={`${ft?.cleanliness ?? "—"}/5`} />
                <Stat label="Tour quality" value={`${ft?.tourQuality ?? "—"}/5`} />
                <Stat label="Amenity quality" value={`${ft?.amenityQuality ?? "—"}/5`} />
                <Stat label="Closing strength" value={`${ft?.closingStrength ?? "—"}/5`} />
                <Stat label="Pressure level" value={ft?.pressureLevel ?? "—"} />
              </div>
              <div className="mt-4 text-sm">
                <div className="text-xs text-slate-500 mb-1">Concessions observed</div>
                <p>{ft?.actualConcessions}</p>
                <div className="text-xs text-slate-500 mt-3 mb-1">Hidden discounts</div>
                <p>{ft?.hiddenDiscounts}</p>
                <div className="text-xs text-slate-500 mt-3 mb-1">Parking deal</div>
                <p>{ft?.parkingDeal}</p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Strategic verdict" />
            <CardBody>
              <div className="flex flex-wrap gap-1 mb-3">
                {(comp?.competitorTags ?? []).map(t => <Badge key={t}>{t}</Badge>)}
              </div>
              <div className="text-sm">
                <div className="text-xs text-slate-500 mb-1">Would a real renter choose Zen over Baxter?</div>
                <Badge intent="bad">YES</Badge>
              </div>
              <div className="text-sm mt-3">
                <div className="text-xs text-slate-500 mb-1">Why</div>
                <p>{ft?.whyOrWhyNot}</p>
              </div>
              <div className="text-sm mt-3 border-t pt-3">
                <div className="text-xs text-slate-500 mb-1">Baxter response recommendation</div>
                <p>{ft?.baxterResponseRecommendation}</p>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
                <ThreatBar label="Amenity threat" v={comp?.amenityThreatLevel ?? 0} />
                <ThreatBar label="Parking threat" v={comp?.parkingThreatLevel ?? 0} />
                <ThreatBar label="Concession threat" v={comp?.concessionThreatLevel ?? 0} />
              </div>
            </CardBody>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader title="Utility + parking inclusion" subtitle="Apples-to-apples vs Baxter" />
            <CardBody>
              <table className="bx max-w-2xl">
                <tbody>
                  <tr><td>Water</td><td><Badge intent="good">included</Badge></td></tr>
                  <tr><td>Power / electricity</td><td><Badge intent="bad">NOT included</Badge></td></tr>
                  <tr><td>Gas</td><td><Badge intent="bad">NOT included</Badge></td></tr>
                  <tr><td>Internet</td><td><Badge intent="bad">NOT included</Badge></td></tr>
                  <tr><td>Parking</td><td><Badge intent="good">included · 1 spot per bedroom</Badge></td></tr>
                  <tr><td>Valet</td><td><Badge intent="good">included</Badge></td></tr>
                  <tr><td>In-unit laundry</td><td><Badge intent="good">yes</Badge></td></tr>
                </tbody>
              </table>
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
                  <th>NER 13m/1free</th><th>NER 19m/2free</th><th>Avail</th><th>Parking</th><th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {observed.map(u => (
                  <tr key={u.id}>
                    <td className="font-medium">{u.unitNumber}</td>
                    <td><Badge intent={u.unitNumberConfidence === "high" ? "good" : u.unitNumberConfidence === "medium" ? "warn" : "bad"}>{u.unitNumberConfidence}</Badge></td>
                    <td>{u.bedCount !== undefined ? `${u.bedCount}BR/${u.bathCount ?? "?"}BA` : "—"}</td>
                    <td>
                      {u.squareFeet ?? "—"}
                      <div className="mt-1"><SourceBadge fieldKey="square_feet" entityType="competitor_unit" entityId={u.id} compact /></div>
                    </td>
                    <td>
                      {u.grossRent ? fmtMoney(u.grossRent) : "—"}
                      <div className="mt-1"><SourceBadge fieldKey="gross_rent" entityType="competitor_unit" entityId={u.id} compact /></div>
                    </td>
                    <td>{u.effectiveRent13m1Free ? fmtMoney(u.effectiveRent13m1Free) : "—"}</td>
                    <td>{u.effectiveRent19m2Free ? fmtMoney(u.effectiveRent19m2Free) : "—"}</td>
                    <td>
                      <Badge intent={u.availabilityStatus === "available" ? "good" : u.availabilityStatus === "needs_verification" ? "bad" : "warn"}>
                        {u.availabilityStatus ?? "—"}
                      </Badge>
                    </td>
                    <td className="text-xs">
                      {u.parkingIncluded ? `incl. (${u.parkingSpotsIncluded ?? "?"}sp)` : "—"}
                      {u.valetIncluded ? " · valet" : ""}
                    </td>
                    <td className="text-xs text-slate-500 max-w-sm">{u.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-4 py-3 text-xs text-slate-500 italic border-t">
              NER columns are speculative until concession applicability is confirmed for each specific unit.
              See the 19-month-special data quality flag.
            </p>
          </CardBody>
        </Card>
      )}

      {tab === "amenities" && (
        <Card>
          <CardHeader title={`${amenities.length} amenity observations`} />
          <CardBody className="p-0">
            <table className="bx">
              <thead><tr><th>Amenity</th><th>Observed</th><th>Quality</th><th>Source</th><th>Confidence</th><th>Notes</th></tr></thead>
              <tbody>
                {amenities.map(a => (
                  <tr key={a.id}>
                    <td className="font-medium">{a.amenity}</td>
                    <td>{a.observed ? <Badge intent="good">yes</Badge> : <Badge intent="bad">no</Badge>}</td>
                    <td>{a.qualityScore ?? "—"}/5</td>
                    <td className="text-xs">{a.sourceLabel}</td>
                    <td><Badge intent={a.sourceConfidence === "high" ? "good" : a.sourceConfidence === "medium" ? "warn" : "bad"}>{a.sourceConfidence}</Badge></td>
                    <td className="text-xs text-slate-500 max-w-md">{a.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {tab === "photos" && (
        <Card>
          <CardHeader
            title={`Photo evidence · ${photos.length} of ${ZEN_PHOTO_COUNT_EXPECTED} expected`}
            subtitle="Order preserved by IMG filename ascending. Thumbnails load from Supabase Storage bucket baxter-ops-photos."
          />
          <CardBody className="p-0">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-5">
              {photos.map(p => <PhotoCard key={p.id} p={p} />)}
            </div>
          </CardBody>
        </Card>
      )}

      {tab === "sources" && (
        <Card>
          <CardHeader title={`${sources.length} source verifications`} subtitle="Real URLs only — Claude did not visit them" />
          <CardBody className="p-0">
            <table className="bx">
              <thead><tr><th>Source</th><th>URL</th><th>Status</th><th>Fields verified</th><th>Notes</th></tr></thead>
              <tbody>
                {sources.map(s => (
                  <tr key={s.id}>
                    <td className="font-medium">{s.sourceName}</td>
                    <td className="text-xs">
                      {s.sourceUrl ? (
                        <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="text-sky-700 underline break-all">{s.sourceUrl}</a>
                      ) : "—"}
                    </td>
                    <td>
                      <Badge intent={s.verificationStatus === "verified" ? "good" : s.verificationStatus === "partial" ? "warn" : "bad"}>
                        {s.verificationStatus}
                      </Badge>
                    </td>
                    <td className="text-xs">
                      <ul className="space-y-0.5">{s.fieldsVerified.map(f => <li key={f}>· {f}</li>)}</ul>
                    </td>
                    <td className="text-xs text-slate-500 max-w-md">{s.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {tab === "tour_scores" && (
        <QuickTourScorePanel
          fieldTourId={ZEN_FIELD_TOUR_ID}
          competitorId={ZEN_COMPETITOR_ID}
          competitorName={ZEN_COMPETITOR_NAME}
        />
      )}

      {tab === "flags" && (
        <Card>
          <CardHeader title={`${flags.length} data quality flags`} subtitle="Open / needs verification / fixed" />
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-md p-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function ThreatBar({ label, v }: { label: string; v: number }) {
  return (
    <div>
      <div className="text-slate-500">{label}</div>
      <div className="font-medium text-rose-700">{v}/5</div>
      <div className="h-1.5 bg-slate-200 rounded mt-1">
        <div className="h-1.5 bg-rose-500 rounded" style={{ width: `${(v / 5) * 100}%` }} />
      </div>
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
            <div className="mt-1 text-[10px] italic">image not yet attached to record</div>
          </div>
        )}
      </div>
      <div className="p-2 text-xs">
        <div className="flex justify-between items-center">
          <span className="text-slate-400">#{p.photoOrder}</span>
          <Badge>{p.category}</Badge>
        </div>
        <div className="mt-1 line-clamp-3">{p.caption}</div>
        {p.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {p.tags.slice(0, 4).map(t => <span key={t} className="text-[10px] text-slate-500">#{t}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}
