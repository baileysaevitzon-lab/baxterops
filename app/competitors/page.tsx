"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { useCompetitors } from "@/lib/hooks/useCompetitors";
import { useTouredIds } from "@/lib/hooks/useTouredIds";
import { useTouredOnly } from "@/lib/hooks/useTouredOnly";
import { TouredOnlyToggle } from "@/components/TouredOnlyToggle";
import { fmtMoney } from "@/lib/calc";
import { DATA_QUALITY_FLAGS } from "@/lib/dataQuality";
import { getAllPhotoEvidence } from "@/lib/services/photoEvidence";
import { getAllIntelligenceSummaries, CLASSIFICATION_LABELS, CLASSIFICATION_COLORS, updateSummaryNotes } from "@/lib/services/competitorIntelligence";
import { getSupabase } from "@/lib/supabase/client";
import { SourceBadge } from "@/components/SourceBadge";
import { LiveDataBanner } from "@/components/LiveDataBanner";
import { InlineEditField } from "@/components/InlineEditField";
import type { CompetitorProperty, DataConfidence, CompetitorIntelligenceSummary } from "@/lib/types";

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
  // Sprint 12: read competitors from Supabase (with seed fallback when unauthenticated).
  // This is what makes /add-tour properties appear here.
  const { competitors, isLive } = useCompetitors();
  // Sprint 13: shared toured-only state + canonical "what counts as toured" detector.
  const { touredIds, touredCount } = useTouredIds();
  const [touredOnly, setTouredOnly] = useTouredOnly();

  const [sortBy, setSortBy] = useState<"name" | "quality" | "distance" | "threat" | "verify">("quality");
  const [verifiedAt, setVerifiedAt] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"all" | "queue">("all");
  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>({});
  const [intelligenceSummaries, setIntelligenceSummaries] = useState<Map<string, CompetitorIntelligenceSummary>>(new Map());

  useEffect(() => {
    let channel: ReturnType<NonNullable<ReturnType<typeof getSupabase>>["channel"]> | null = null;

    (async () => {
      const [photoAll, summaries] = await Promise.all([
        getAllPhotoEvidence(),
        getAllIntelligenceSummaries(),
      ]);
      const counts: Record<string, number> = {};
      for (const p of photoAll) counts[p.competitorId] = (counts[p.competitorId] ?? 0) + 1;
      setPhotoCounts(counts);
      setIntelligenceSummaries(summaries);

      // Sprint 11: Subscribe to intelligence summary changes for live cross-device sync.
      // When Bailey edits notes on computer A, Shane sees it on computer B within ~1s.
      const sb = getSupabase();
      if (sb) {
        channel = sb
          // Sprint 12: unique-per-mount channel name to avoid StrictMode collisions
          .channel(`competitors-page-intel-${Math.random().toString(36).slice(2)}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "competitor_intelligence_summary" },
            (payload) => {
              const row = payload.new as Record<string, unknown>;
              if (!row || !row.competitor_id) return;
              const id = row.competitor_id as string;
              // Re-fetch just this competitor's summary
              getAllIntelligenceSummaries().then(fresh => {
                setIntelligenceSummaries(fresh);
              });
            },
          )
          .subscribe();
      }
    })();

    return () => {
      if (channel) {
        const sb = getSupabase();
        sb?.removeChannel(channel);
      }
    };
    // Re-run when competitors list changes (e.g. a new comp inserted via /add-tour
    // on another device fires the useCompetitors realtime channel).
  }, [competitors]);

  function markVerified(id: string) {
    const ts = new Date().toISOString().slice(0, 10);
    setVerifiedAt(v => ({ ...v, [id]: ts }));
  }

  const augmented = competitors.map(c => ({
    ...c,
    lastVerifiedAt: verifiedAt[c.id] ?? c.lastVerifiedAt,
  }));

  // "Toured Only" filters to comps with a Supabase field tour or fieldVerified=true in seed
  const baseList = touredOnly ? augmented.filter(c => touredIds.has(c.id)) : augmented;

  const sorted = useMemo(() => {
    const arr = [...baseList];
    if (sortBy === "name") arr.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === "distance") arr.sort((a, b) => (a.distanceMiles ?? 99) - (b.distanceMiles ?? 99));
    else if (sortBy === "threat") {
      arr.sort((a, b) => {
        const sa = intelligenceSummaries.get(a.id)?.directThreatScore ?? (a.threatLevel ?? 0);
        const sb = intelligenceSummaries.get(b.id)?.directThreatScore ?? (b.threatLevel ?? 0);
        return sb - sa;
      });
    }
    else if (sortBy === "verify") arr.sort((a, b) => verifyPriority(b) - verifyPriority(a));
    else arr.sort((a, b) => (b.compQualityScore ?? 0) - (a.compQualityScore ?? 0));
    return arr;
  }, [baseList, sortBy, intelligenceSummaries]);

  const queue = useMemo(() => [...augmented].sort((a, b) => verifyPriority(b) - verifyPriority(a)), [augmented]);

  return (
    <>
      <LiveDataBanner />
      <PageHeader
        title="Competitor Database"
        subtitle="17 Hollywood properties · smart threat classification powered by 3-score system. Open the Verification Queue tab to see what to confirm first."
        action={
          <div className="flex gap-2 text-xs flex-wrap items-center">
            <TouredOnlyToggle
              on={touredOnly}
              onToggle={setTouredOnly}
              touredCount={touredCount}
              totalCount={competitors.length}
            />
            <button onClick={() => setTab("all")} className={`px-3 py-1.5 rounded-md border ${tab === "all" ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200"}`}>Cards</button>
            <button onClick={() => setTab("queue")} className={`px-3 py-1.5 rounded-md border ${tab === "queue" ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200"}`}>Verify queue</button>
          </div>
        }
      />

      {tab === "queue" ? (
        <Card>
          <CardHeader title="Verification queue" subtitle="Ordered by unknown confidence → old verification → data flags → high threat" />
          <CardBody className="p-0">
            <table className="bx">
              <thead>
                <tr><th>Property</th><th>Confidence</th><th>Last verified</th><th>Flags</th><th>Direct Threat</th><th>Classification</th><th></th></tr>
              </thead>
              <tbody>
                {queue.map(c => {
                  const intel = intelligenceSummaries.get(c.id);
                  const cls = intel?.manualClassification ?? intel?.systemClassification;
                  return (
                    <tr key={c.id}>
                      <td className="font-medium">{c.name}</td>
                      <td><Badge intent={CONFIDENCE_COLOR[c.dataConfidence ?? "unknown"]}>{c.dataConfidence}</Badge></td>
                      <td className="text-xs">{c.lastVerifiedAt ?? "—"}</td>
                      <td className="text-xs">{(c.dataQualityFlags ?? []).length}</td>
                      <td>{intel ? `${intel.directThreatScore}/5` : `${c.threatLevel ?? "—"}/5`}</td>
                      <td>{cls ? <Badge intent={CLASSIFICATION_COLORS[cls]}>{CLASSIFICATION_LABELS[cls]}</Badge> : "—"}</td>
                      <td className="text-right">
                        <button onClick={() => markVerified(c.id)} className="text-xs px-2 py-1 bg-slate-900 text-white rounded">Mark verified now</button>
                      </td>
                    </tr>
                  );
                })}
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
              const intel = intelligenceSummaries.get(c.id);
              const effectiveClassification = intel?.manualClassification ?? intel?.systemClassification;

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
                            quality {c.compQualityScore}
                          </Badge>
                        )}
                        {effectiveClassification && (
                          <Badge intent={CLASSIFICATION_COLORS[effectiveClassification]}>
                            {CLASSIFICATION_LABELS[effectiveClassification]}
                          </Badge>
                        )}
                      </div>
                    }
                  />
                  <CardBody>
                    {/* Smart threat 3-badge row */}
                    {intel && (
                      <SmartThreatBadgeRow intel={intel} />
                    )}

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
                          <div className="flex gap-2">
                            <Link href={`/competitors/${c.id.replace("c-", "")}#compare-against-baxter`} className="text-xs px-2 py-1 bg-sky-700 text-white rounded hover:bg-sky-800">
                              Compare vs Baxter
                            </Link>
                            <Link href={`/competitors/${c.id.replace("c-", "")}`} className="text-xs px-2 py-1 bg-emerald-700 text-white rounded">
                              Open detail →
                            </Link>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Intelligence notes — inline editable, writes to Supabase */}
                    <div className="mt-3 text-xs text-slate-500">
                      <InlineEditField
                        value={intel?.summaryNotes ?? c.notes ?? null}
                        placeholder="Add intelligence notes…"
                        multiline
                        className="italic"
                        onSave={async (v) => {
                          const ok = await updateSummaryNotes(c.id, v);
                          if (!ok) throw new Error("Supabase write failed — sign in and retry");
                          // Optimistically update local state
                          setIntelligenceSummaries(prev => {
                            const next = new Map(prev);
                            const existing = next.get(c.id);
                            if (existing) {
                              next.set(c.id, { ...existing, summaryNotes: v });
                            }
                            return next;
                          });
                        }}
                      />
                    </div>
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

/** 3-score badge row — Direct Threat / Tour Quality / Learning Value */
function SmartThreatBadgeRow({ intel }: { intel: CompetitorIntelligenceSummary }) {
  return (
    <div className="mb-3 flex flex-wrap gap-2 text-xs">
      <ThreatMeter label="Direct Threat" score={intel.directThreatScore} colorFn={directThreatColor} />
      {intel.tourQualityScore !== null ? (
        <ThreatMeter label="Tour Quality" score={intel.tourQualityScore} colorFn={tourQualityColor} />
      ) : (
        <span className="px-2 py-1 bg-slate-100 text-slate-400 rounded-md">Tour Quality: not toured</span>
      )}
      <ThreatMeter label="Learning Value" score={intel.learningScore} colorFn={learningColor} />
    </div>
  );
}

function ThreatMeter({ label, score, colorFn }: { label: string; score: number; colorFn: (s: number) => string }) {
  const pct = (score / 5) * 100;
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md border ${colorFn(score)}`}>
      <span className="font-medium">{label}:</span>
      <span className="font-bold">{score.toFixed(1)}</span>
      <div className="w-12 h-1.5 bg-white/50 rounded">
        <div className="h-1.5 rounded" style={{ width: `${pct}%`, background: "currentColor", opacity: 0.7 }} />
      </div>
    </div>
  );
}

function directThreatColor(s: number): string {
  if (s >= 3.7) return "bg-red-50 border-red-300 text-red-800";
  if (s >= 2.8) return "bg-amber-50 border-amber-300 text-amber-800";
  return "bg-slate-50 border-slate-200 text-slate-600";
}
function tourQualityColor(s: number): string {
  if (s >= 4.0) return "bg-purple-50 border-purple-300 text-purple-800";
  if (s >= 3.0) return "bg-sky-50 border-sky-300 text-sky-800";
  return "bg-slate-50 border-slate-200 text-slate-600";
}
function learningColor(s: number): string {
  if (s >= 3.5) return "bg-emerald-50 border-emerald-300 text-emerald-800";
  if (s >= 2.5) return "bg-sky-50 border-sky-300 text-sky-800";
  return "bg-slate-50 border-slate-200 text-slate-600";
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
