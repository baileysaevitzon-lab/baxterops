"use client";
// Generic competitor detail page — Sprint 10 update adds:
//   1. Smart 3-score badge row (Direct Threat / Tour Quality / Learning Value)
//   2. "Compare Against Baxter" panel in Overview tab
//   3. Reframed Jardine banner — premium aspirational, not "biggest direct threat"
//   4. Manual classification override UI for manager use

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { SourceBadge } from "@/components/SourceBadge";
import { fmtMoney } from "@/lib/calc";
import { BAXTER_UNITS, COMPETITORS as SEED_COMPETITORS } from "@/lib/seed";
import { loadCompetitor, updateCompetitorFields } from "@/lib/services/competitors";
import { loadCompetitorEvidence, type CompetitorEvidence } from "@/lib/services/competitorEvidence";
import type { CompetitorProperty } from "@/lib/types";
import { getConflictsForEntity, getAllConflicts } from "@/lib/services/sourceConflicts";
import { BACKEND_MODE } from "@/lib/services/persistence";
import { QuickTourScorePanel } from "@/components/scoring/QuickTourScorePanel";
import { useAuth } from "@/components/AuthProvider";
import { getSupabase } from "@/lib/supabase/client";
import {
  getCompetitorIntelligenceSummary,
  getTakeawaysForCompetitor,
  updateSummaryNotes,
  CLASSIFICATION_LABELS,
  CLASSIFICATION_COLORS,
  CLASSIFICATION_DESCRIPTIONS,
} from "@/lib/services/competitorIntelligence";
import { InlineEditField } from "@/components/InlineEditField";
import { LiveDataBanner } from "@/components/LiveDataBanner";
import type { PhotoEvidenceRecord, SourceConflictRow, CompetitorIntelligenceSummary, CompetitorTakeaway } from "@/lib/types";

type Tab = "overview" | "units" | "amenities" | "tour_scores" | "photos" | "sources" | "flags";

// Baxter reference for the "Compare Against Baxter" panel
const BAXTER_REF = {
  avg1BRRent: Math.round(
    BAXTER_UNITS.filter(u => u.type === "1BR").reduce((s, u) => s + u.askingRent, 0) /
    (BAXTER_UNITS.filter(u => u.type === "1BR").length || 1)
  ),
  avg2BRRent: Math.round(
    BAXTER_UNITS.filter(u => u.type === "2BR").reduce((s, u) => s + u.askingRent, 0) /
    (BAXTER_UNITS.filter(u => u.type === "2BR").length || 1)
  ),
  amenities: ["rooftop", "gym", "lounge"],
  freeRentWeeks: 4, // current 1-month-free concession on select units
  units: 86,
};

export default function CompetitorDetailPage() {
  const params = useParams();
  const rawId = (params?.id ?? "") as string;
  const competitorId = rawId.startsWith("c-") ? rawId : `c-${rawId}`;
  // Sprint 12: seed lookup is now only the initial render fallback —
  // the canonical comp record is loaded from Supabase in the useEffect below.
  const seedComp = SEED_COMPETITORS.find(c => c.id === competitorId);

  const { signedIn } = useAuth();
  const [comp, setComp] = useState<CompetitorProperty | null>(seedComp ?? null);
  const [evidence, setEvidence] = useState<CompetitorEvidence | null>(null);
  const [conflicts, setConflicts] = useState<SourceConflictRow[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [intel, setIntel] = useState<CompetitorIntelligenceSummary | null>(null);
  const [takeaways, setTakeaways] = useState<CompetitorTakeaway[]>([]);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<NonNullable<ReturnType<typeof getSupabase>>["channel"]> | null = null;

    (async () => {
      await new Promise(r => setTimeout(r, 30));
      const [liveComp, e, all, summary, tw] = await Promise.all([
        loadCompetitor(competitorId),
        loadCompetitorEvidence(competitorId),
        getAllConflicts(),
        getCompetitorIntelligenceSummary(competitorId),
        getTakeawaysForCompetitor(competitorId),
      ]);
      const obsIds = new Set((e.observedUnits ?? []).map(u => u.id));
      const ours = all.filter(c => c.entityId === competitorId || obsIds.has(c.entityId));
      if (!cancelled) {
        // Prefer live Supabase comp; fall back to seed which we already set.
        if (liveComp) setComp(liveComp);
        setEvidence(e);
        setConflicts(ours);
        setIntel(summary);
        setTakeaways(tw);
      }

      // Sprint 11: Subscribe to this competitor's intelligence row for live cross-device sync.
      const sb = getSupabase();
      if (sb && !cancelled) {
        channel = sb
          // Sprint 12: unique-per-mount suffix to avoid StrictMode collisions
          .channel(`detail-intel-${competitorId}-${Math.random().toString(36).slice(2)}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "competitor_intelligence_summary",
              filter: `competitor_id=eq.${competitorId}`,
            },
            () => {
              if (!cancelled) {
                getCompetitorIntelligenceSummary(competitorId).then(fresh => {
                  if (!cancelled && fresh) setIntel(fresh);
                });
              }
            },
          )
          .subscribe();
      }
    })();

    return () => {
      cancelled = true;
      if (channel) {
        const sb = getSupabase();
        sb?.removeChannel(channel);
      }
    };
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

  const effectiveClassification = intel?.manualClassification ?? intel?.systemClassification;
  const isAspirational = effectiveClassification === "premium_aspirational_comp";
  const isDirectThreat = effectiveClassification === "direct_threat";

  return (
    <>
      <LiveDataBanner />
      <PageHeader
        title={`${comp.name} — Field Tour`}
        subtitle={`${comp.address}${comp.competitorStrategicType ? ` · ${comp.competitorStrategicType.replace(/_/g, " ")}` : ""}${comp.fieldVerifiedAt ? ` · Field verified ${comp.fieldVerifiedAt}` : ""}`}
        action={<Link href="/competitors" className="text-xs underline text-slate-500">← back to comps</Link>}
      />

      {/* Smart classification banner */}
      {effectiveClassification && (
        <div className={`mb-4 rounded-md border px-4 py-3 text-sm ${classificationBannerStyle(effectiveClassification)}`}>
          <div className="flex items-start gap-3">
            <Badge intent={CLASSIFICATION_COLORS[effectiveClassification]}>
              {CLASSIFICATION_LABELS[effectiveClassification]}
            </Badge>
            <div className="flex-1">
              <p>{CLASSIFICATION_DESCRIPTIONS[effectiveClassification]}</p>
              {isAspirational && (
                <p className="mt-1 font-medium">
                  Do NOT use {comp.name} as a rent anchor. It serves Baxter&apos;s <em>leasing experience benchmarking</em> only.
                </p>
              )}
              {isDirectThreat && (
                <p className="mt-1">
                  Monitor {comp.name}&apos;s concession changes weekly. Price Baxter 1BRs using effective-rent math (net of free weeks) against this comp.
                </p>
              )}
              {intel?.manualClassification && (
                <p className="mt-1 text-xs opacity-75">
                  ✎ Manager override by {intel.manualClassificationSetBy ?? "unknown"}: {intel.manualClassificationReason}
                </p>
              )}
            </div>
          </div>
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

      {/* Sprint 13: editable property facts. Pencil any field → saves to Supabase + writes source ledger row + recomputes comparison model. */}
      <Card className="mb-4">
        <CardHeader title="Property facts" subtitle="✏️ click any field to edit — saves to Supabase, writes source ledger row" />
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs text-slate-500 mb-1">Name</div>
              <InlineEditField
                value={comp.name}
                placeholder="Property name"
                label="Name"
                onSave={async v => {
                  const updated = await updateCompetitorFields(competitorId, { name: v }, {
                    editedBy: "Bailey", fieldKey: "name", fieldLabel: "Property name", displayValue: v,
                  });
                  setComp(updated);
                }}
              />
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1">Address</div>
              <InlineEditField
                value={comp.address}
                placeholder="Street address"
                label="Address"
                onSave={async v => {
                  const updated = await updateCompetitorFields(competitorId, { address: v }, {
                    editedBy: "Bailey", fieldKey: "address", fieldLabel: "Address", displayValue: v,
                  });
                  setComp(updated);
                }}
              />
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1">Phone</div>
              <InlineEditField
                value={comp.phone ?? ""}
                placeholder="(323) 555-1234"
                label="Phone"
                onSave={async v => {
                  const updated = await updateCompetitorFields(competitorId, { phone: v }, {
                    editedBy: "Bailey", fieldKey: "phone", fieldLabel: "Phone", displayValue: v,
                  });
                  setComp(updated);
                }}
              />
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1">Website</div>
              <InlineEditField
                value={comp.website ?? ""}
                placeholder="https://…"
                label="Website"
                onSave={async v => {
                  const updated = await updateCompetitorFields(competitorId, { website: v }, {
                    editedBy: "Bailey", fieldKey: "website", fieldLabel: "Website", displayValue: v,
                  });
                  setComp(updated);
                }}
              />
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1">Specials / concession</div>
              <InlineEditField
                value={comp.specials ?? ""}
                placeholder="e.g. 6 weeks free + $500 LAL"
                label="Specials"
                multiline
                onSave={async v => {
                  const updated = await updateCompetitorFields(competitorId, { specials: v }, {
                    editedBy: "Bailey", fieldKey: "specials", fieldLabel: "Specials", displayValue: v,
                  });
                  setComp(updated);
                }}
              />
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1">Field verified by</div>
              <InlineEditField
                value={comp.fieldVerifiedBy ?? ""}
                placeholder="Bailey / Shane"
                label="Field verified by"
                onSave={async v => {
                  const updated = await updateCompetitorFields(competitorId, { fieldVerifiedBy: v, fieldVerified: !!v }, {
                    editedBy: "Bailey", fieldKey: "field_verified_by", fieldLabel: "Field verified by", displayValue: v,
                  });
                  setComp(updated);
                }}
              />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Smart threat scores */}
      {intel && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <ScoreCard
            label="Direct Threat"
            score={intel.directThreatScore}
            subtext={`Price ${intel.priceOverlapScore}/5 · Product ${intel.productOverlapScore}/5 · Segment ${intel.renterSegmentOverlapScore}/5`}
            color={intel.directThreatScore >= 3.7 ? "red" : intel.directThreatScore >= 2.8 ? "amber" : "slate"}
          />
          <ScoreCard
            label="Tour Quality"
            score={intel.tourQualityScore}
            subtext={intel.tourQualityScore !== null ? "Based on field tour" : "No field tour on record"}
            color={intel.tourQualityScore !== null && intel.tourQualityScore >= 4 ? "purple" : "sky"}
          />
          <ScoreCard
            label="Learning Value"
            score={intel.learningScore}
            subtext={`Amenity gap ${intel.amenityGapScore}/5 · Service ${intel.serviceGapScore}/5 · Experience ${intel.renterExperienceGap}/5`}
            color={intel.learningScore >= 3.5 ? "emerald" : "sky"}
          />
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

              {/* Intelligence notes — inline editable, syncs to Supabase */}
              <div className="mt-4 border-t pt-3">
                <div className="text-xs text-slate-500 mb-1">Intelligence notes</div>
                <div className="text-sm">
                  <InlineEditField
                    value={intel?.summaryNotes ?? comp.notes ?? null}
                    placeholder="Add strategic notes about this competitor…"
                    multiline
                    onSave={async (v) => {
                      const ok = await updateSummaryNotes(competitorId, v);
                      if (!ok) throw new Error("Supabase write failed — are you signed in?");
                      setIntel(prev => prev ? { ...prev, summaryNotes: v } : null);
                    }}
                  />
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Compare Against Baxter panel (linked from /competitors card via #compare-against-baxter anchor) */}
          <div id="compare-against-baxter" className="scroll-mt-4">
            <CompareAgainstBaxterPanel comp={comp} intel={intel} />
          </div>

          {/* Actionable takeaways */}
          {takeaways.length > 0 && (
            <Card className="lg:col-span-2">
              <CardHeader
                title="Actionable Takeaways for Baxter"
                subtitle="Auto-generated from smart threat scores. Manager review required before acting."
              />
              <CardBody className="p-0">
                <table className="bx">
                  <thead><tr><th>Priority</th><th>Category</th><th>Takeaway</th><th>Action for Baxter</th><th>Status</th></tr></thead>
                  <tbody>
                    {takeaways.map(t => (
                      <tr key={t.id}>
                        <td>
                          <span className={`font-bold ${t.priority >= 5 ? "text-red-600" : t.priority >= 4 ? "text-amber-600" : "text-slate-600"}`}>
                            P{t.priority}
                          </span>
                        </td>
                        <td><Badge>{t.category}</Badge></td>
                        <td>
                          <div className="font-medium text-sm">{t.takeawayTitle}</div>
                          {t.takeawayDetail && <div className="text-xs text-slate-500 mt-1">{t.takeawayDetail}</div>}
                        </td>
                        <td className="text-xs text-slate-700 max-w-sm">{t.actionForBaxter ?? "—"}</td>
                        <td><Badge intent={t.status === "implemented" ? "good" : t.status === "in_progress" ? "warn" : "neutral"}>{t.status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          )}
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

// ─── Compare Against Baxter panel ─────────────────────────────────────────────

function CompareAgainstBaxterPanel({
  comp,
  intel,
}: {
  comp: CompetitorProperty;
  intel: CompetitorIntelligenceSummary | null;
}) {
  // Sprint 13: compute explanation + baxterTakeaways + classification fallback
  // on-the-fly. DB summaries from before this sprint don't carry those arrays.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getStaticSmartThreat } = require("@/lib/services/competitorIntelligence") as { getStaticSmartThreat: (id: string) => import("@/lib/types").SmartThreatScores | null };
  const computed = getStaticSmartThreat(comp.id);
  // Manual override > DB system class > computed system class > comp's strategic-type hint
  const classification =
    intel?.manualClassification
    ?? intel?.systemClassification
    ?? computed?.systemClassification
    ?? (comp.competitorStrategicType === "premium_amenity_comp" ? "premium_aspirational_comp" : undefined);
  const isAspirational = classification === "premium_aspirational_comp";
  const explanation = intel?.explanation ?? computed?.explanation ?? [];
  const takeaways = intel?.baxterTakeaways ?? computed?.baxterTakeaways ?? [];

  // Classification-specific manager guidance narrative.
  const guidance: { title: string; body: string; tone: "purple" | "rose" | "amber" | "sky" | "slate" } =
    classification === "premium_aspirational_comp" ? {
      title: `${comp.name} is aspirational, not a price anchor`,
      body: `Do NOT use ${comp.name} as a rent anchor. It serves Baxter's leasing-experience benchmarking only — copy what they do well (scent control, service polish, amenity presentation, coffee offering, luxury common-area feel) and leave their pricing alone.`,
      tone: "purple",
    } : classification === "direct_threat" ? {
      title: `${comp.name} actively pressures Baxter`,
      body: `Real rent + product overlap with Baxter's renter pool. Monitor ${comp.name}'s concession changes weekly. Price Baxter 1BRs using effective-rent math (net of free weeks) against this comp.`,
      tone: "rose",
    } : classification === "partial_threat" ? {
      title: `${comp.name} is a partial price/product comp`,
      body: `Overlaps Baxter's renter pool on some dimensions but differentiated on others. Useful as a secondary pricing anchor — confirm specific unit-type overlap before drawing pricing conclusions.`,
      tone: "amber",
    } : classification === "not_comparable_but_instructive" ? {
      title: `${comp.name} is not a clean comp — but worth tracking`,
      body: `Don't use ${comp.name} as a rent anchor or for unit-mix decisions. It is most useful as a learning benchmark for specific dimensions where it outperforms Baxter (large-unit storage, theatrical common areas, etc.).`,
      tone: "sky",
    } : classification === "budget_comp" ? {
      title: `${comp.name} sits below Baxter's price band`,
      body: `Useful for floor-pricing and "trade up to Baxter" narrative — not for rent anchoring at Baxter's tier. Use this comp to defend Baxter's positioning against renters trading down.`,
      tone: "sky",
    } : {
      title: `${comp.name} has limited direct competitive overlap`,
      body: `Track for occasional market signal but do not anchor pricing or leasing decisions to it.`,
      tone: "slate",
    };
  const toneClass: Record<typeof guidance.tone, string> = {
    purple: "bg-purple-50 border-purple-200 text-purple-900",
    rose: "bg-rose-50 border-rose-200 text-rose-900",
    amber: "bg-amber-50 border-amber-200 text-amber-900",
    sky: "bg-sky-50 border-sky-200 text-sky-900",
    slate: "bg-slate-50 border-slate-200 text-slate-800",
  };

  const comp1BR = comp.unitTypes?.find(u => u.type === "1BR");
  const comp2BR = comp.unitTypes?.find(u => u.type === "2BR");

  const diff1BR = comp1BR?.avgRent && BAXTER_REF.avg1BRRent
    ? comp1BR.avgRent - BAXTER_REF.avg1BRRent
    : null;
  const diff2BR = comp2BR?.avgRent && BAXTER_REF.avg2BRRent
    ? comp2BR.avgRent - BAXTER_REF.avg2BRRent
    : null;

  const baxterAmenities = BAXTER_REF.amenities;
  const compAmenities = comp.amenities ?? [];
  const compOnly = compAmenities.filter(a => !baxterAmenities.includes(a));
  const baxterOnly = baxterAmenities.filter(a => !compAmenities.includes(a));

  return (
    <Card>
      <CardHeader
        title="Compare Against Baxter"
        subtitle={isAspirational ? "Use for benchmarking only — not a rent anchor" : "Direct pricing and product comparison"}
      />
      <CardBody>
        {/* Sprint 13: classification-specific manager guidance */}
        <div className={`mb-4 p-3 border rounded-md text-xs ${toneClass[guidance.tone]}`}>
          <div className="font-semibold mb-1">{guidance.title}</div>
          <div>{guidance.body}</div>
        </div>

        {/* Sprint 13: "Why this classification?" — explanation strings from the comparison model */}
        {explanation.length > 0 && (
          <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-700">
            <div className="font-medium text-slate-600 mb-1">Why this classification?</div>
            <ul className="list-disc pl-4 space-y-0.5">
              {explanation.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 text-sm mb-4">
          <div>
            <div className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">1BR Rent (avg asking)</div>
            <div className="flex items-end gap-2">
              <div>
                <div className="text-xs text-slate-500">Baxter</div>
                <div className="text-xl font-bold text-emerald-700">{fmtMoney(BAXTER_REF.avg1BRRent)}</div>
              </div>
              <div className="text-slate-400 pb-1">vs</div>
              <div>
                <div className="text-xs text-slate-500">{comp.name}</div>
                <div className={`text-xl font-bold ${comp1BR?.avgRent ? "text-slate-900" : "text-slate-400"}`}>
                  {comp1BR?.avgRent ? fmtMoney(comp1BR.avgRent) : "—"}
                </div>
              </div>
              {diff1BR !== null && (
                <div className="pb-1">
                  <span className={`text-sm font-medium ${diff1BR > 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {diff1BR > 0 ? `+${fmtMoney(diff1BR)} Baxter advantage` : `${fmtMoney(Math.abs(diff1BR))} below Baxter`}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">2BR Rent (avg asking)</div>
            <div className="flex items-end gap-2">
              <div>
                <div className="text-xs text-slate-500">Baxter</div>
                <div className="text-xl font-bold text-emerald-700">{fmtMoney(BAXTER_REF.avg2BRRent)}</div>
              </div>
              <div className="text-slate-400 pb-1">vs</div>
              <div>
                <div className="text-xs text-slate-500">{comp.name}</div>
                <div className={`text-xl font-bold ${comp2BR?.avgRent ? "text-slate-900" : "text-slate-400"}`}>
                  {comp2BR?.avgRent ? fmtMoney(comp2BR.avgRent) : "—"}
                </div>
              </div>
              {diff2BR !== null && (
                <div className="pb-1">
                  <span className={`text-sm font-medium ${diff2BR > 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {diff2BR > 0 ? `+${fmtMoney(diff2BR)} Baxter advantage` : `${fmtMoney(Math.abs(diff2BR))} below Baxter`}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border-t pt-4 grid grid-cols-2 gap-4 text-xs">
          <div>
            <div className="font-medium text-slate-700 mb-2">Amenities {comp.name} has but Baxter lacks:</div>
            {compOnly.length > 0 ? (
              <ul className="space-y-1">
                {compOnly.slice(0, 8).map(a => (
                  <li key={a} className="flex items-center gap-1 text-red-700">
                    <span>✗</span> <span>{a.replace(/_/g, " ")}</span>
                  </li>
                ))}
                {compOnly.length > 8 && <li className="text-slate-500">+{compOnly.length - 8} more</li>}
              </ul>
            ) : (
              <span className="text-slate-400">None identified</span>
            )}
          </div>
          <div>
            <div className="font-medium text-slate-700 mb-2">Amenities Baxter has that {comp.name} lacks:</div>
            {baxterOnly.length > 0 ? (
              <ul className="space-y-1">
                {baxterOnly.map(a => (
                  <li key={a} className="flex items-center gap-1 text-emerald-700">
                    <span>✓</span> <span>{a.replace(/_/g, " ")}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-slate-400">None identified</span>
            )}
          </div>
        </div>

        <div className="border-t pt-4 mt-4 text-xs">
          <div className="font-medium text-slate-700 mb-2">Concession comparison</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-emerald-50 rounded p-2">
              <div className="text-emerald-800 font-medium">Baxter</div>
              <div className="text-emerald-700">{BAXTER_REF.freeRentWeeks} weeks free on select units</div>
            </div>
            <div className="bg-slate-50 rounded p-2">
              <div className="text-slate-700 font-medium">{comp.name}</div>
              <div className="text-slate-600">{comp.specials ?? `${comp.freeRentWeeks ?? 0} weeks free`}</div>
            </div>
          </div>
        </div>

        {/* Sprint 13: Baxter action items derived from baxterTakeaways[] */}
        {takeaways.length > 0 && (
          <div className="border-t pt-4 mt-4">
            <div className="text-xs font-medium text-slate-700 mb-2">Baxter action items from this comp</div>
            <ol className="list-decimal pl-5 text-xs text-slate-700 space-y-1">
              {takeaways.map((t, i) => <li key={i}>{t}</li>)}
            </ol>
          </div>
        )}

        <p className="mt-3 text-[11px] text-slate-400 italic">
          Manager review required. Comparison derived from source-verified data as of {comp.lastVerifiedAt ?? "unknown date"}.
          All rents are asking rents — verify net effective before pricing decisions.
        </p>
      </CardBody>
    </Card>
  );
}

// ─── Helper components ─────────────────────────────────────────────────────────

function ScoreCard({ label, score, subtext, color }: {
  label: string;
  score: number | null;
  subtext: string;
  color: "red" | "amber" | "slate" | "purple" | "sky" | "emerald";
}) {
  const pct = score !== null ? (score / 5) * 100 : 0;
  const colorMap: Record<string, string> = {
    red: "bg-red-50 border-red-200 text-red-900",
    amber: "bg-amber-50 border-amber-200 text-amber-900",
    slate: "bg-slate-50 border-slate-200 text-slate-700",
    purple: "bg-purple-50 border-purple-200 text-purple-900",
    sky: "bg-sky-50 border-sky-200 text-sky-900",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-900",
  };
  const barColorMap: Record<string, string> = {
    red: "bg-red-500",
    amber: "bg-amber-500",
    slate: "bg-slate-400",
    purple: "bg-purple-500",
    sky: "bg-sky-500",
    emerald: "bg-emerald-500",
  };
  return (
    <div className={`rounded-lg border p-4 ${colorMap[color]}`}>
      <div className="text-xs font-medium uppercase tracking-wide opacity-70 mb-1">{label}</div>
      <div className="text-3xl font-bold mb-2">{score !== null ? score.toFixed(1) : "—"}<span className="text-sm font-normal opacity-60">/5</span></div>
      <div className="h-1.5 bg-black/10 rounded mb-2">
        <div className={`h-1.5 rounded ${barColorMap[color]}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[11px] opacity-70">{subtext}</div>
    </div>
  );
}

function classificationBannerStyle(cls: string): string {
  switch (cls) {
    case "direct_threat": return "border-red-300 bg-red-50 text-red-900";
    case "partial_threat": return "border-amber-300 bg-amber-50 text-amber-900";
    case "premium_aspirational_comp": return "border-purple-300 bg-purple-50 text-purple-900";
    case "budget_comp": return "border-slate-300 bg-slate-50 text-slate-700";
    case "not_comparable_but_instructive": return "border-sky-300 bg-sky-50 text-sky-900";
    default: return "border-slate-200 bg-slate-50 text-slate-700";
  }
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

