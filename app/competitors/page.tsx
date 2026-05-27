"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { COMPETITORS } from "@/lib/seed";
import { fmtMoney } from "@/lib/calc";
import { DATA_QUALITY_FLAGS } from "@/lib/dataQuality";
import { getAllPhotoEvidence } from "@/lib/services/photoEvidence";
import { SourceBadge } from "@/components/SourceBadge";
import type { CompetitorProperty, DataConfidence } from "@/lib/types";

const CONFIDENCE_COLOR: Record<DataConfidence, "good" | "warn" | "bad" | "neutral"> = {
  high: "good",
  medium: "warn",
  low: "bad",
  unknown: "neutral",
};

const SOURCE_LABEL: Record<NonNullable<CompetitorProperty["sourceType"]>, string> = {
  uploaded_market_comp_report: "Comp report",
  call_around: "Call-around",
  official_property_website: "Official site",
  apartments_com: "Apartments.com",
  zillow: "Zillow",
  zumper: "Zumper",
  google_business: "Google Business",
  other_listing: "Other listing",
  field_tour: "Field tour",
  unverified: "Unverified",
};

export default function Competitors() {
  const [sortBy, setSortBy] = useState<"name" | "quality" | "distance" | "threat" | "verify">("quality");
  const [verifiedAt, setVerifiedAt] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"all" | "queue">("all");
  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      const all = await getAllPhotoEvidence();
      const counts: Record<string, number> = {};
      for (const p of all) counts[p.competitorId] = (counts[p.competitorId] ?? 0) + 1;
      setPhotoCounts(counts);
    })();
  }, []);

  function markVerified(id: string) {
    const ts = new Date().toISOString().slice(0, 10);
    setVerifiedAt(v => ({ ...v, [id]: ts }));
  }

  const augmented = COMPETITORS.map(c => ({
    ...c,
    lastVerifiedAt: verifiedAt[c.id] ?? c.lastVerifiedAt,
  }));

  const sorted = useMemo(() => {
    const arr = [...augmented];
    if (sortBy === "name") arr.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === "distance") arr.sort((a, b) => (a.distanceMiles ?? 99) - (b.distanceMiles ?? 99));
    else if (sortBy === "threat") arr.sort((a, b) => (b.threatLevel ?? 0) - (a.threatLevel ?? 0));
    else if (sortBy === "verify") arr.sort((a, b) => verifyPriority(b) - verifyPriority(a));
    else arr.sort((a, b) => (b.compQualityScore ?? 0) - (a.compQualityScore ?? 0));
    return arr;
  }, [augmented, sortBy]);

  const queue = useMemo(() => [...augmented].sort((a, b) => verifyPriority(b) - verifyPriority(a)), [augmented]);

  return (
    <>
      <PageHeader
        title="Competitor Database"
        subtitle="17 Hollywood properties · source-verified weekly. Open the Verification Queue tab to see what to confirm first."
        action={
          <div className="flex gap-2 text-xs">
            <button onClick={() => setTab("all")} className={`px-3 py-1.5 rounded-md border ${tab === "all" ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200"}`}>All comps</button>
            <button onClick={() => setTab("queue")} className={`px-3 py-1.5 rounded-md border ${tab === "queue" ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200"}`}>Verification queue</button>
          </div>
        }
      />

      {tab === "queue" ? (
        <Card>
          <CardHeader title="Verification queue" subtitle="Ordered by unknown confidence → old verification → data flags → high threat" />
          <CardBody className="p-0">
            <table className="bx">
              <thead>
                <tr><th>Property</th><th>Confidence</th><th>Last verified</th><th>Flags</th><th>Threat</th><th>Quality</th><th></th></tr>
              </thead>
              <tbody>
                {queue.map(c => (
                  <tr key={c.id}>
                    <td className="font-medium">{c.name}</td>
                    <td><Badge intent={CONFIDENCE_COLOR[c.dataConfidence ?? "unknown"]}>{c.dataConfidence}</Badge></td>
                    <td className="text-xs">{c.lastVerifiedAt ?? "—"}</td>
                    <td className="text-xs">{(c.dataQualityFlags ?? []).length}</td>
                    <td>{c.threatLevel ?? "—"}/5</td>
                    <td>{c.compQualityScore ?? "—"}</td>
                    <td className="text-right">
                      <button onClick={() => markVerified(c.id)} className="text-xs px-2 py-1 bg-slate-900 text-white rounded">Mark verified now</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="mb-4 flex gap-2 text-xs justify-end">
            {(["quality", "distance", "threat", "verify", "name"] as const).map(k => (
              <button
                key={k}
                onClick={() => setSortBy(k)}
                className={`px-3 py-1.5 rounded-md border ${sortBy === k ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"}`}
              >
                sort by {k === "verify" ? "needs verify" : k}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {sorted.map(c => {
              const flags = (c.dataQualityFlags ?? [])
                .map(fid => DATA_QUALITY_FLAGS.find(f => f.id === fid))
                .filter((x): x is NonNullable<typeof x> => !!x);
              return (
                <Card key={c.id}>
                  <CardHeader
                    title={c.name}
                    subtitle={`${c.address} · ${c.units} units${c.distanceMiles !== undefined ? ` · ${c.distanceMiles}mi` : ""}`}
                    action={
                      <div className="flex flex-col items-end gap-1">
                        {c.fieldVerified && (
                          <Link href={`/competitors/${c.id.replace("c-", "")}`} className="inline-block">
                            <Badge intent="good">★ Field Tour Verified</Badge>
                          </Link>
                        )}
                        {c.compQualityScore !== undefined && (
                          <Badge intent={c.compQualityScore >= 80 ? "bad" : c.compQualityScore >= 70 ? "warn" : "neutral"}>
                            comp quality {c.compQualityScore}
                          </Badge>
                        )}
                        {c.threatLevel && <Badge intent={c.threatLevel >= 4 ? "bad" : "warn"}>threat {c.threatLevel}/5</Badge>}
                      </div>
                    }
                  />
                  <CardBody>
                    <div className="flex flex-wrap gap-1 mb-3 items-center">
                      <Badge intent="info">{SOURCE_LABEL[c.sourceType ?? "unverified"]}</Badge>
                      <Badge intent={CONFIDENCE_COLOR[c.dataConfidence ?? "unknown"]}>
                        confidence: {c.dataConfidence}
                      </Badge>
                      <span className="text-xs text-slate-500">verified {c.lastVerifiedAt ?? "never"} {c.verifiedBy ? `by ${c.verifiedBy}` : ""}</span>
                      <button onClick={() => markVerified(c.id)} className="ml-auto text-xs px-2 py-1 border rounded text-slate-700 hover:bg-slate-50">Mark verified now</button>
                    </div>

                    {flags.length > 0 && (
                      <div className="mb-3 bg-amber-50 border border-amber-200 rounded-md p-2 text-xs text-amber-800">
                        <div className="font-medium mb-1">⚠ Data quality flags</div>
                        <ul className="space-y-0.5">{flags.map(f => <li key={f.id}>· {f.issue}</li>)}</ul>
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-4 text-sm mb-3">
                      <div>
                        <div className="text-xs text-slate-500">Occupancy</div>
                        <div className="font-medium">{c.occupancyPct ?? "—"}%</div>
                        <SourceBadge fieldKey="occupancy_pct" entityType="competitor" entityId={c.id} compact />
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">Leased</div>
                        <div className="font-medium">{c.leasedPct ?? "—"}%</div>
                        <SourceBadge fieldKey="leased_pct" entityType="competitor" entityId={c.id} compact />
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">Last week</div>
                        <div className="font-medium">{c.toursLastWeek ?? "—"}t / {c.leasesLastWeek ?? "—"}L</div>
                        <SourceBadge fieldKey="tours_last_week" entityType="competitor" entityId={c.id} compact />
                      </div>
                    </div>

                    <table className="bx">
                      <thead><tr><th>Type</th><th>Avg rent</th><th>Range</th><th>Avg sqft</th></tr></thead>
                      <tbody>
                        {c.unitTypes.map(t => (
                          <tr key={t.type}>
                            <td>{t.type}</td>
                            <td className="font-medium">{fmtMoney(t.avgRent)}</td>
                            <td className="text-slate-500 text-xs">{t.minRent && t.maxRent ? `${fmtMoney(t.minRent)} – ${fmtMoney(t.maxRent)}` : "—"}</td>
                            <td>{t.avgSqft ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="mt-3 text-sm">
                      <div className="text-xs text-slate-500 flex items-center gap-2">
                        Specials <SourceBadge fieldKey="specials" entityType="competitor" entityId={c.id} compact />
                      </div>
                      <div className="font-medium text-slate-800">{c.specials ?? "—"}</div>
                    </div>

                    {c.amenities.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {c.amenities.map(a => <Badge key={a}>{a}</Badge>)}
                      </div>
                    )}

                    {/* Verification links */}
                    <div className="mt-3 pt-3 border-t flex flex-wrap gap-2 text-xs">
                      {urlButton("Official Site", c.officialWebsiteUrl)}
                      {urlButton("Apartments.com", c.apartmentsUrl)}
                      {urlButton("Zillow", c.zillowUrl)}
                      {urlButton("Zumper", c.zumperUrl)}
                      {urlButton("Google", c.googleBusinessUrl)}
                    </div>

                    {c.alternateAddress && (
                      <div className="mt-3 text-xs text-amber-700">
                        ⚠ Alternate address on file: {c.alternateAddress}
                      </div>
                    )}

                    {c.fieldVerified && (
                      <div className="mt-3 pt-3 border-t bg-emerald-50 -mx-5 px-5 py-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="text-xs font-medium text-emerald-800">
                              ★ Field tour verified {c.fieldVerifiedAt} by {c.fieldVerifiedBy}
                            </div>
                            <div className="text-xs text-emerald-700 mt-1">
                              {c.competitorStrategicType && <span>Strategic type: <strong>{c.competitorStrategicType.replace(/_/g, " ")}</strong> · </span>}
                              {photoCounts[c.id] ?? 0} photos · amenity threat {c.amenityThreatLevel ?? "—"}/5 · parking {c.parkingThreatLevel ?? "—"}/5 · concession {c.concessionThreatLevel ?? "—"}/5
                            </div>
                          </div>
                          <Link href={`/competitors/${c.id.replace("c-", "")}`} className="text-xs px-2 py-1 bg-emerald-700 text-white rounded">
                            Open detail →
                          </Link>
                        </div>
                      </div>
                    )}

                    {c.notes && <p className="text-xs text-slate-500 mt-3 italic">{c.notes}</p>}
                    {c.phone && <div className="text-xs text-slate-500 mt-3">☎ {c.phone}</div>}
                  </CardBody>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function verifyPriority(c: CompetitorProperty): number {
  let s = 0;
  if (c.dataConfidence === "unknown") s += 50;
  if (c.dataConfidence === "low") s += 30;
  if (!c.lastVerifiedAt) s += 20;
  s += (c.dataQualityFlags?.length ?? 0) * 8;
  s += (c.threatLevel ?? 0) * 3;
  s += (c.compQualityScore ?? 0) / 10;
  return s;
}

function urlButton(label: string, url?: string) {
  if (url) {
    return (
      <a key={label} href={url} target="_blank" rel="noreferrer" className="px-2 py-1 border border-sky-300 text-sky-700 rounded hover:bg-sky-50">
        {label}
      </a>
    );
  }
  return (
    <span key={label} className="px-2 py-1 border border-slate-200 text-slate-500 rounded">
      {label}: Add URL
    </span>
  );
}
