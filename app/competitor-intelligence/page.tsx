"use client";
// Sprint 10 — Competitor Intelligence dashboard: Smart Threat Matrix + 3-score system.
//
// New in Sprint 10:
//   • Smart Threat Matrix (X = directThreat, Y = tourQuality, bubble = learningScore)
//   • Classification filter to isolate direct threats vs aspirational comps
//   • Pricing model explicitly excludes premium_aspirational_comp + not_comparable_but_instructive
//   • Implication cards updated with new classification logic

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { BAXTER_UNITS } from "@/lib/seed";
import { useCompetitors } from "@/lib/hooks/useCompetitors";
import { fmtMoney } from "@/lib/calc";
import {
  getAllIntelligenceSummaries,
  CLASSIFICATION_LABELS,
  CLASSIFICATION_COLORS,
  CLASSIFICATION_DESCRIPTIONS,
  getStaticSmartThreats,
} from "@/lib/services/competitorIntelligence";
import { useTouredIds } from "@/lib/hooks/useTouredIds";
import { useTouredOnly } from "@/lib/hooks/useTouredOnly";
import { TouredOnlyToggle } from "@/components/TouredOnlyToggle";
import { getSupabase } from "@/lib/supabase/client";
import { LiveDataBanner } from "@/components/LiveDataBanner";
import type { CompetitorIntelligenceSummary, CompetitorClassification } from "@/lib/types";

type UnitTypeFilter = "all" | "studio" | "1BR" | "2BR" | "3BR";

const UNIT_TYPES: UnitTypeFilter[] = ["all", "studio", "1BR", "2BR", "3BR"];

const PREMIUM_AMENITIES = [
  "rooftop",
  "rooftop_pool",
  "pool",
  "gym",
  "concierge",
  "lounge",
  "coworking",
  "courtyard",
  "parking",
] as const;

const PREMIUM_LABEL: Record<string, string> = {
  rooftop: "Rooftop",
  rooftop_pool: "Rooftop pool",
  pool: "Pool",
  gym: "Gym",
  concierge: "Concierge",
  lounge: "Lounge",
  coworking: "Coworking",
  courtyard: "Courtyard",
  parking: "Parking",
};

// Classification families for exclusion from rent pricing
const PRICING_EXCLUDED_CLASSIFICATIONS: Set<CompetitorClassification> = new Set([
  "premium_aspirational_comp",
  "not_comparable_but_instructive",
]);

const QUADRANT_LABELS = [
  { x: 4.2, y: 4.5, text: "Copy + Defend", sub: "Direct threat, high quality" },
  { x: 0.8, y: 4.5, text: "Learn & Aspire", sub: "Premium aspirational" },
  { x: 4.2, y: 1.0, text: "Price Compete", sub: "Direct threat, lower quality" },
  { x: 0.8, y: 1.0, text: "Monitor Only", sub: "Weak/not comparable" },
];

export default function CompetitorIntelligence() {
  // Sprint 12: source of truth for the competitor list is Supabase (with seed fallback)
  const { competitors: COMPETITORS } = useCompetitors();

  const [unitFilter, setUnitFilter] = useState<UnitTypeFilter>("1BR");
  const [classificationFilter, setClassificationFilter] = useState<CompetitorClassification | "all">("all");
  // Sprint 13: shared toured-only state (localStorage-persisted) + canonical detector.
  const { touredIds, touredCount } = useTouredIds();
  const [touredOnly, setTouredOnly] = useTouredOnly();
  const [intelligenceSummaries, setIntelligenceSummaries] = useState<Map<string, CompetitorIntelligenceSummary>>(new Map());

  useEffect(() => {
    let channel: ReturnType<NonNullable<ReturnType<typeof getSupabase>>["channel"]> | null = null;

    (async () => {
      const summaries = await getAllIntelligenceSummaries();
      setIntelligenceSummaries(summaries);

      // Sprint 11: realtime subscription — intelligence matrix updates live across devices
      const sb = getSupabase();
      if (sb) {
        channel = sb
          // Sprint 12: unique-per-mount channel name to avoid StrictMode collisions
          .channel(`intel-page-summaries-${Math.random().toString(36).slice(2)}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "competitor_intelligence_summary" },
            () => {
              getAllIntelligenceSummaries().then(setIntelligenceSummaries);
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
  }, []);

  // For rent-anchor exclusion: use classification from DB when available, else fall back to strategic type
  const pricingExcludedIds = useMemo(() => {
    return new Set(
      COMPETITORS.filter(c => {
        const intel = intelligenceSummaries.get(c.id);
        const cls = intel?.manualClassification ?? intel?.systemClassification;
        if (cls) return PRICING_EXCLUDED_CLASSIFICATIONS.has(cls);
        // Legacy fallback when not signed in / DB empty: exclude all premium_amenity_comps
        // and the specific field-verified non-comparable properties
        return (
          c.competitorStrategicType === "premium_amenity_comp" ||
          c.id === "c-vine-1600" || // 5,200 2BR — not a rent anchor
          c.id === "c-arrive-hollywood" // luxury 1BR at $4,000 — not a rent anchor
        );
      }).map(c => c.id),
    );
  }, [intelligenceSummaries]);

  // Base list: optionally filtered to toured-only comps
  const tourFilteredComps = useMemo(() => {
    if (!touredOnly) return COMPETITORS;
    return COMPETITORS.filter(c => touredIds.has(c.id));
  }, [touredOnly, touredIds, COMPETITORS]);

  // Also filter by classification if a filter is set
  const visibleComps = useMemo(() => {
    if (classificationFilter === "all") {
      return tourFilteredComps.filter(c => !pricingExcludedIds.has(c.id));
    }
    return tourFilteredComps.filter(c => {
      const intel = intelligenceSummaries.get(c.id);
      const cls = intel?.manualClassification ?? intel?.systemClassification;
      return cls === classificationFilter;
    });
  }, [classificationFilter, pricingExcludedIds, intelligenceSummaries, tourFilteredComps]);

  // ── Smart Threat Matrix (directThreat × tourQuality, bubble = learningScore) ──
  const matrixData = useMemo(() => {
    return tourFilteredComps.map(c => {
      const intel = intelligenceSummaries.get(c.id);
      if (!intel) return null;
      const cls = intel.manualClassification ?? intel.systemClassification;
      return {
        id: c.id,
        name: c.name,
        directThreat: intel.directThreatScore,
        tourQuality: intel.tourQualityScore ?? 2.5, // default for not-toured
        learningScore: intel.learningScore,
        hasFieldTour: intel.tourQualityScore !== null,
        classification: cls,
        size: Math.round(intel.learningScore * 20) + 30, // bubble: 30–130
      };
    }).filter((x): x is NonNullable<typeof x> => x !== null);
  }, [intelligenceSummaries]);

  const matrixColor = (cls: CompetitorClassification | undefined): string => {
    switch (cls) {
      case "direct_threat": return "#ef4444";
      case "partial_threat": return "#f59e0b";
      case "premium_aspirational_comp": return "#8b5cf6";
      case "budget_comp": return "#94a3b8";
      case "not_comparable_but_instructive": return "#0ea5e9";
      default: return "#64748b";
    }
  };

  // ── Rent × sqft scatter (pricing-relevant comps only) ─────────────────────
  const scatterCompetitors = useMemo(() => {
    const points: { name: string; sqft: number; rent: number; type: string; isExcluded: boolean }[] = [];
    for (const c of COMPETITORS) {
      for (const u of c.unitTypes ?? []) {
        if (unitFilter !== "all" && u.type !== unitFilter) continue;
        if (!u.avgRent || !u.avgSqft) continue;
        points.push({
          name: `${c.name} · ${u.type}`,
          sqft: u.avgSqft,
          rent: u.avgRent,
          type: u.type,
          isExcluded: pricingExcludedIds.has(c.id),
        });
      }
    }
    return points;
  }, [unitFilter, pricingExcludedIds]);

  const scatterBaxter = useMemo(() => {
    return BAXTER_UNITS
      .filter(u => unitFilter === "all" || u.type === unitFilter)
      .filter(u => u.askingRent && u.sqft)
      .map(u => ({
        name: `Baxter #${u.unitNumber} · ${u.type}`,
        sqft: u.sqft as number,
        rent: u.askingRent as number,
        type: u.type,
      }));
  }, [unitFilter]);

  // ── $/sqft positioning ─────────────────────────────────────────────────────
  const pricePerSqftRows = useMemo(() => {
    const rows: { name: string; perSqft: number; rent: number; sqft: number; isExcluded: boolean; fieldVerified: boolean; classification?: CompetitorClassification }[] = [];
    for (const c of COMPETITORS) {
      const cells = (c.unitTypes ?? [])
        .filter(u => (unitFilter === "all" ? true : u.type === unitFilter))
        .filter(u => u.avgRent && u.avgSqft);
      if (cells.length === 0) continue;
      const totalRent = cells.reduce((s, u) => s + (u.avgRent ?? 0), 0);
      const totalSqft = cells.reduce((s, u) => s + (u.avgSqft ?? 0), 0);
      if (!totalSqft) continue;
      const intel = intelligenceSummaries.get(c.id);
      rows.push({
        name: c.name,
        perSqft: Math.round((totalRent / totalSqft) * 100) / 100,
        rent: Math.round(totalRent / cells.length),
        sqft: Math.round(totalSqft / cells.length),
        isExcluded: pricingExcludedIds.has(c.id),
        fieldVerified: !!c.fieldVerified,
        classification: intel?.manualClassification ?? intel?.systemClassification,
      });
    }
    // Baxter blended
    const baxterCells = BAXTER_UNITS.filter(u => (unitFilter === "all" ? true : u.type === unitFilter))
      .filter(u => u.askingRent && u.sqft);
    if (baxterCells.length > 0) {
      const tr = baxterCells.reduce((s, u) => s + (u.askingRent ?? 0), 0);
      const ts = baxterCells.reduce((s, u) => s + (u.sqft ?? 0), 0);
      if (ts > 0) {
        rows.push({
          name: "Baxter (asking)",
          perSqft: Math.round((tr / ts) * 100) / 100,
          rent: Math.round(tr / baxterCells.length),
          sqft: Math.round(ts / baxterCells.length),
          isExcluded: false,
          fieldVerified: true,
        });
      }
    }
    rows.sort((a, b) => a.perSqft - b.perSqft);
    return rows;
  }, [unitFilter, pricingExcludedIds, intelligenceSummaries]);

  // ── Amenity coverage ───────────────────────────────────────────────────────
  const amenityCoverage = useMemo(() => {
    return PREMIUM_AMENITIES.map(am => {
      const hits = COMPETITORS.filter(c => (c.amenities ?? []).some(a => a === am || a.includes(am)));
      return {
        amenity: PREMIUM_LABEL[am] ?? am,
        count: hits.length,
        share: Math.round((hits.length / COMPETITORS.length) * 100),
        examples: hits.slice(0, 4).map(h => h.name),
      };
    }).sort((a, b) => b.count - a.count);
  }, []);

  // ── Sprint 13: Tour Experience comparison data ─────────────────────────────
  // Per-toured-comp bar chart of the 5 leasing/quality sub-scores (gap vs Baxter, 0-5).
  // Higher = the comp does it better than Baxter.
  const tourExperienceData = useMemo(() => {
    const staticScores = getStaticSmartThreats();
    return tourFilteredComps
      .filter(c => c.fieldVerified || touredIds.has(c.id))
      .map(c => {
        const intel = intelligenceSummaries.get(c.id);
        const fallback = staticScores.get(c.id);
        if (!intel && !fallback) return null;
        return {
          name: c.name.length > 18 ? c.name.slice(0, 16) + "…" : c.name,
          service: intel?.serviceGapScore ?? fallback?.serviceGapScore ?? 0,
          unitQuality: intel?.unitQualityGap ?? fallback?.unitQualityGap ?? 0,
          renterExp: intel?.renterExperienceGap ?? fallback?.renterExperienceGap ?? 0,
          marketing: intel?.marketingPresentationGap ?? fallback?.marketingPresentationGap ?? 0,
          amenity: intel?.amenityGapScore ?? fallback?.amenityGapScore ?? 0,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [tourFilteredComps, touredIds, intelligenceSummaries]);

  // ── Sprint 13: Baxter Takeaways ranking ──────────────────────────────────
  // For each toured comp, pull the top-N takeaway titles (from the computed
  // baxterTakeaways[] arrays) and display as a ranked list with source.
  const takeawaysRanking = useMemo(() => {
    const staticScores = getStaticSmartThreats();
    type Row = { competitor: string; takeaway: string };
    const out: Row[] = [];
    for (const c of tourFilteredComps) {
      if (!touredIds.has(c.id) && !c.fieldVerified) continue;
      const scores = staticScores.get(c.id);
      const items = scores?.baxterTakeaways ?? [];
      for (const t of items.slice(0, 3)) {
        out.push({ competitor: c.name, takeaway: t });
      }
    }
    return out.slice(0, 12);
  }, [tourFilteredComps, touredIds]);

  // ── Threat × distance bubble matrix (legacy single-score) ─────────────────
  const positioning = useMemo(() => {
    return COMPETITORS
      .filter(c => c.distanceMiles !== undefined)
      .map(c => {
        const intel = intelligenceSummaries.get(c.id);
        return {
          id: c.id,
          name: c.name,
          distance: c.distanceMiles ?? 0,
          threat: intel?.directThreatScore ?? (c.threatLevel ?? 0),
          size: c.units ?? 50,
          verified: !!c.fieldVerified,
          excluded: pricingExcludedIds.has(c.id),
        };
      });
  }, [pricingExcludedIds, intelligenceSummaries]);

  // ── Baxter implications ───────────────────────────────────────────────────
  const implications = useMemo(() => {
    const out: { title: string; color: "good" | "warn" | "bad" | "info"; body: string }[] = [];

    // Hanover: winning the lease-up race
    const hanover = intelligenceSummaries.get("c-hanover-hollywood");
    if (hanover) {
      out.push({
        title: `Hanover: directThreat ${hanover.directThreatScore}/5 — lease-up leader`,
        color: "bad",
        body: "12 tours / 10 leases last week with 7 weeks free. Highest concession+conversion pressure in the market. Baxter must anchor pitch on effective-rent math, not free weeks.",
      });
    }

    // Zen: adjacent direct threat
    const zen = intelligenceSummaries.get("c-zen-hollywood");
    if (zen) {
      out.push({
        title: `Zen Hollywood: directThreat ${zen.directThreatScore}/5, tourQuality ${zen.tourQualityScore}/5`,
        color: "bad",
        body: "Right next door. Premium amenity stack (valet, pool, bar, theater, in-unit laundry). 1BR overlaps Baxter's price range. Differentiate on boutique scale, rooftop access, and effective rent.",
      });
    }

    // Jardine: aspirational learning comp
    const jardine = intelligenceSummaries.get("c-jardine");
    if (jardine) {
      out.push({
        title: `Jardine: Premium Aspirational — tourQuality ${jardine.tourQualityScore}/5, learning ${jardine.learningScore}/5`,
        color: "info",
        body: "NOT a rent anchor (1BR $3,155 is 12% above Baxter top). Use for leasing experience and presentation benchmarking only. Copy: coffee offering, scent management, rooftop pool staging, scripted tour choreography.",
      });
    }

    // Field coverage
    const fieldCount = COMPETITORS.filter(c => c.fieldVerified).length;
    const excludedCount = pricingExcludedIds.size;
    out.push({
      title: `${fieldCount} field-toured · ${excludedCount} excluded from rent pricing`,
      color: fieldCount >= 3 ? "good" : "warn",
      body: `Rent anchors use ${COMPETITORS.length - excludedCount} comps. Premium aspirational and non-comparable comps are excluded from the pricing scatter and $/sqft chart. Schedule one new field tour/week.`,
    });

    return out;
  }, [intelligenceSummaries, pricingExcludedIds]);

  const allClassifications: CompetitorClassification[] = [
    "direct_threat", "partial_threat", "premium_aspirational_comp",
    "budget_comp", "weak_threat", "not_comparable_but_instructive",
  ];

  return (
    <>
      <LiveDataBanner />
      <PageHeader
        title="Competitor Intelligence"
        subtitle={`Smart threat classification across ${COMPETITORS.length} Hollywood comps. Pricing anchors exclude ${pricingExcludedIds.size} premium/non-comparable properties.`}
        action={
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className="text-slate-500">Unit type:</span>
            {UNIT_TYPES.map(t => (
              <button
                key={t}
                onClick={() => setUnitFilter(t)}
                className={`px-2.5 py-1 rounded-md border ${unitFilter === t ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 text-slate-600"}`}
              >
                {t}
              </button>
            ))}
          </div>
        }
      />

      {/* Toured Only + Classification filter bar */}
      <div className="mb-4 flex flex-wrap gap-2 items-center text-xs">
        <TouredOnlyToggle
          on={touredOnly}
          onToggle={setTouredOnly}
          touredCount={touredCount}
          totalCount={COMPETITORS.length}
        />
        <span className="text-slate-300">|</span>
        <span className="text-slate-500 font-medium">Classification:</span>
        <button
          onClick={() => setClassificationFilter("all")}
          className={`px-2.5 py-1 rounded-md border ${classificationFilter === "all" ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 text-slate-600"}`}
        >
          All (pricing comps)
        </button>
        {allClassifications.map(cls => (
          <button
            key={cls}
            onClick={() => setClassificationFilter(cls)}
            className={`px-2.5 py-1 rounded-md border ${classificationFilter === cls ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 text-slate-600"}`}
          >
            {CLASSIFICATION_LABELS[cls]}
          </button>
        ))}
      </div>

      {/* Implications row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        {implications.map(imp => (
          <Card key={imp.title}>
            <CardBody>
              <div className="flex items-start gap-3">
                <Badge intent={imp.color}>{imp.color === "good" ? "Strength" : imp.color === "warn" ? "Pressure" : imp.color === "bad" ? "Threat" : "Context"}</Badge>
                <div className="flex-1">
                  <div className="font-medium text-slate-900">{imp.title}</div>
                  <div className="text-xs text-slate-600 mt-1">{imp.body}</div>
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Smart Threat Matrix — NEW */}
      {matrixData.length > 0 && (
        <Card className="mb-6">
          <CardHeader
            title="Smart Threat Matrix"
            subtitle="X = Direct Threat Score (0–5) · Y = Tour Quality Score (0–5) · Bubble size = Learning Value. Comps without a field tour shown at Y=2.5 (dashed line)."
          />
          <CardBody>
            <div className="mb-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              {QUADRANT_LABELS.map(q => (
                <div key={q.text} className="bg-slate-50 rounded p-2">
                  <div className="font-medium text-slate-800">{q.text}</div>
                  <div className="text-slate-500">{q.sub}</div>
                </div>
              ))}
            </div>
            <div style={{ width: "100%", height: 380 }}>
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 20, right: 40, bottom: 30, left: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  {/* Quadrant dividers */}
                  <XAxis
                    dataKey="directThreat"
                    name="Direct Threat"
                    type="number"
                    domain={[0, 5]}
                    ticks={[0, 1, 2, 3, 4, 5]}
                    label={{ value: "Direct Threat Score →", position: "insideBottom", offset: -10, fontSize: 12 }}
                  />
                  <YAxis
                    dataKey="tourQuality"
                    name="Tour Quality"
                    type="number"
                    domain={[0, 5]}
                    ticks={[0, 1, 2, 3, 4, 5]}
                    label={{ value: "Tour Quality →", angle: -90, position: "insideLeft", fontSize: 12 }}
                  />
                  <ZAxis dataKey="size" range={[50, 400]} name="Learning Value" />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    content={({ payload }) => {
                      if (!payload?.length) return null;
                      const p = payload[0].payload as typeof matrixData[number];
                      const cls = p.classification;
                      return (
                        <div className="bg-white border border-slate-200 rounded-lg shadow-md p-3 text-xs max-w-xs">
                          <div className="font-bold text-sm mb-1">{p.name}</div>
                          <div className="space-y-0.5">
                            <div>Direct Threat: <strong>{p.directThreat.toFixed(1)}/5</strong></div>
                            <div>Tour Quality: <strong>{p.hasFieldTour ? `${p.tourQuality.toFixed(1)}/5` : "not toured"}</strong></div>
                            <div>Learning Value: <strong>{p.learningScore.toFixed(1)}/5</strong></div>
                            {cls && <div className="mt-1"><Badge intent={CLASSIFICATION_COLORS[cls]}>{CLASSIFICATION_LABELS[cls]}</Badge></div>}
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Scatter name="Competitors" data={matrixData}>
                    {matrixData.map((p, i) => (
                      <Cell
                        key={i}
                        fill={matrixColor(p.classification)}
                        fillOpacity={p.hasFieldTour ? 0.85 : 0.45}
                        stroke={matrixColor(p.classification)}
                        strokeWidth={p.hasFieldTour ? 2 : 1}
                        strokeDasharray={p.hasFieldTour ? "0" : "4 2"}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-3 text-[11px] text-slate-500 mt-2">
              <span><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1" />Direct Threat</span>
              <span><span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1" />Partial Threat</span>
              <span><span className="inline-block w-2 h-2 rounded-full bg-violet-500 mr-1" />Premium Aspirational</span>
              <span><span className="inline-block w-2 h-2 rounded-full bg-sky-500 mr-1" />Not Comparable</span>
              <span><span className="inline-block w-2 h-2 rounded-full bg-slate-400 mr-1" />Weak/Budget</span>
              <span className="ml-2 text-slate-400">· Faded = no field tour (Y estimated at 2.5)</span>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Rent × Sqft scatter */}
      <Card className="mb-6">
        <CardHeader
          title={`Rent × Square Feet — ${unitFilter === "all" ? "all unit types" : unitFilter}`}
          subtitle={`Baxter (green) vs pricing-relevant comps (slate). ${pricingExcludedIds.size} premium/non-comparable comps excluded from rent anchor logic.`}
        />
        <CardBody>
          <div style={{ width: "100%", height: 360 }}>
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 10, right: 30, bottom: 30, left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="sqft" name="Sqft" type="number" unit=" sqft" label={{ value: "Square feet", position: "insideBottom", offset: -10 }} />
                <YAxis dataKey="rent" name="Rent" type="number" unit="" tickFormatter={v => `$${(v / 1000).toFixed(1)}k`} label={{ value: "Avg rent", angle: -90, position: "insideLeft" }} />
                <ZAxis range={[80, 80]} />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  formatter={(value: number | string, name: string) => {
                    if (name === "Rent") return [fmtMoney(Number(value)), name];
                    return [value, name];
                  }}
                  labelFormatter={(_, payload) => (payload && payload[0] ? (payload[0].payload as { name: string }).name : "")}
                />
                <Legend />
                <Scatter name="Pricing comps" data={scatterCompetitors.filter(p => !p.isExcluded)} fill="#64748b" />
                <Scatter name="Excl. (premium/non-comp)" data={scatterCompetitors.filter(p => p.isExcluded)} fill="#c4b5fd" shape="triangle" />
                <Scatter name="Baxter units" data={scatterBaxter} fill="#10b981" shape="diamond" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            ⚠ Excluded comps (purple triangles) are shown for context only — do not anchor Baxter rents off them.
            Classifications: {Array.from(PRICING_EXCLUDED_CLASSIFICATIONS).map(c => CLASSIFICATION_LABELS[c]).join(", ")}.
          </p>
        </CardBody>
      </Card>

      {/* $/sqft positioning */}
      <Card className="mb-6">
        <CardHeader
          title={`$/sqft positioning — ${unitFilter === "all" ? "blended" : unitFilter}`}
          subtitle="Pricing comps only. Premium aspirational + non-comparable comps shown in purple (excluded from rent anchor math)."
        />
        <CardBody>
          <div style={{ width: "100%", height: Math.max(260, pricePerSqftRows.length * 32) }}>
            <ResponsiveContainer>
              <BarChart layout="vertical" data={pricePerSqftRows} margin={{ left: 60, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" tickFormatter={v => `$${v.toFixed(2)}`} />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value: number) => [`$${value.toFixed(2)}/sqft`, "$/sqft"]}
                  labelFormatter={(label: string) => label}
                />
                <Bar dataKey="perSqft" name="$ / sqft">
                  {pricePerSqftRows.map((row, i) => (
                    <Cell
                      key={i}
                      fill={
                        row.name === "Baxter (asking)"
                          ? "#10b981"
                          : row.isExcluded
                            ? "#c4b5fd"
                            : row.classification === "direct_threat"
                              ? "#ef4444"
                              : row.classification === "partial_threat"
                                ? "#f59e0b"
                                : row.fieldVerified
                                  ? "#0ea5e9"
                                  : "#94a3b8"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] text-slate-500 mt-2">
            <span><span className="inline-block w-2 h-2 rounded-sm bg-emerald-500 mr-1" />Baxter</span>
            <span><span className="inline-block w-2 h-2 rounded-sm bg-red-500 mr-1" />Direct Threat</span>
            <span><span className="inline-block w-2 h-2 rounded-sm bg-amber-500 mr-1" />Partial Threat</span>
            <span><span className="inline-block w-2 h-2 rounded-sm bg-sky-500 mr-1" />Field-verified</span>
            <span><span className="inline-block w-2 h-2 rounded-sm bg-slate-400 mr-1" />Other comp</span>
            <span><span className="inline-block w-2 h-2 rounded-sm bg-violet-300 mr-1" />Excluded (premium/non-comp)</span>
          </div>
        </CardBody>
      </Card>

      {/* Amenity coverage */}
      <Card className="mb-6">
        <CardHeader title="Amenity coverage across competitors" subtitle="Share of all 17 comps offering each amenity. Drives the 'Baxter is missing X' conversation." />
        <CardBody>
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={amenityCoverage}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="amenity" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={v => `${v}%`} />
                <Tooltip
                  formatter={(value: number, _name: string, props: { payload?: { count: number; examples: string[] } }) => {
                    const p = props?.payload;
                    return [`${value}% (${p?.count ?? 0} comps) · e.g., ${(p?.examples ?? []).join(", ")}`, "Coverage"];
                  }}
                />
                <Bar dataKey="share" name="% of comps" fill="#8b5cf6" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardBody>
      </Card>

      {/* Threat × distance positioning */}
      <Card className="mb-6">
        <CardHeader
          title="Direct Threat × Distance positioning"
          subtitle="Bubble size = unit count. Closer + higher direct threat = more pressure on Baxter. Using smart directThreatScore where available."
        />
        <CardBody>
          <div style={{ width: "100%", height: 360 }}>
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 10, right: 30, bottom: 30, left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="distance" name="Distance" type="number" unit=" mi" domain={[0, "dataMax + 0.2"]} label={{ value: "Distance from Baxter (mi)", position: "insideBottom", offset: -10 }} />
                <YAxis dataKey="threat" name="Direct Threat" type="number" domain={[0, 5]} ticks={[1, 2, 3, 4, 5]} label={{ value: "Direct Threat (1–5)", angle: -90, position: "insideLeft" }} />
                <ZAxis dataKey="size" range={[60, 600]} name="Units" />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  formatter={(value: number | string, name: string) => {
                    if (name === "Distance") return [`${value} mi`, name];
                    if (name === "Direct Threat") return [`${value}/5`, name];
                    if (name === "Units") return [`${value} units`, name];
                    return [value, name];
                  }}
                  labelFormatter={(_, payload) => (payload && payload[0] ? (payload[0].payload as { name: string }).name : "")}
                />
                <Scatter name="Comps" data={positioning}>
                  {positioning.map((p, i) => (
                    <Cell key={i} fill={p.excluded ? "#c4b5fd" : p.verified ? "#0ea5e9" : "#64748b"} fillOpacity={0.75} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </CardBody>
      </Card>

      {/* Sprint 13 — Tour Experience comparison (toured comps only) */}
      {tourExperienceData.length > 0 && (
        <Card className="mb-6">
          <CardHeader
            title="Tour Experience comparison"
            subtitle="Each bar = gap vs Baxter (0–5, higher = comp does it better). Service polish, unit quality, renter experience, marketing, amenity."
          />
          <CardBody>
            <div style={{ width: "100%", height: 320 }}>
              <ResponsiveContainer>
                <BarChart data={tourExperienceData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 5]} ticks={[0, 1, 2, 3, 4, 5]} label={{ value: "Gap vs Baxter (0–5)", angle: -90, position: "insideLeft" }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="service" name="Service polish" fill="#0ea5e9" />
                  <Bar dataKey="unitQuality" name="Unit quality" fill="#10b981" />
                  <Bar dataKey="renterExp" name="Renter experience" fill="#8b5cf6" />
                  <Bar dataKey="marketing" name="Marketing/presentation" fill="#f59e0b" />
                  <Bar dataKey="amenity" name="Amenity stack" fill="#ec4899" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="text-[11px] text-slate-500 mt-2">
              5 = comp is meaningfully ahead of Baxter on this dimension. 0 = Baxter is equal or ahead. Use this to prioritize what to copy next.
            </div>
          </CardBody>
        </Card>
      )}

      {/* Sprint 13 — Baxter Takeaways ranking (auto-generated) */}
      {takeawaysRanking.length > 0 && (
        <Card className="mb-6">
          <CardHeader
            title="Baxter takeaways — ranked"
            subtitle="Auto-derived from the toured comps' SmartThreatScores. Each line = something Baxter should copy, fix, or market better. Source = which tour surfaced it."
          />
          <CardBody className="p-0">
            <table className="bx text-xs">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>#</th>
                  <th>Action item</th>
                  <th style={{ width: 220 }}>Surfaced by tour of</th>
                </tr>
              </thead>
              <tbody>
                {takeawaysRanking.map((row, i) => (
                  <tr key={i}>
                    <td className="text-slate-400 font-mono">{i + 1}</td>
                    <td className="text-slate-800">{row.takeaway}</td>
                    <td className="text-slate-500">{row.competitor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {/* Comp roster with smart classifications */}
      <Card>
        <CardHeader title="Comp roster" subtitle="Click a field-verified comp to open the detailed tour record. Smart classifications from DB where available." />
        <CardBody className="p-0">
          <table className="bx">
            <thead>
              <tr>
                <th>Name</th>
                <th>Dist</th>
                <th>Units</th>
                <th>Direct Threat</th>
                <th>Tour Quality</th>
                <th>Learning</th>
                <th>Classification</th>
                <th>Pricing</th>
              </tr>
            </thead>
            <tbody>
              {COMPETITORS.map(c => {
                const intel = intelligenceSummaries.get(c.id);
                const cls = intel?.manualClassification ?? intel?.systemClassification;
                const excluded = pricingExcludedIds.has(c.id);
                return (
                  <tr key={c.id}>
                    <td className="font-medium">
                      {c.fieldVerified ? (
                        <Link className="text-sky-700 hover:underline" href={`/competitors/${c.id.replace(/^c-/, "")}`}>{c.name}</Link>
                      ) : (
                        c.name
                      )}
                    </td>
                    <td>{c.distanceMiles !== undefined ? `${c.distanceMiles}mi` : "—"}</td>
                    <td>{c.units || "—"}</td>
                    <td>
                      {intel ? (
                        <span className={`font-medium ${intel.directThreatScore >= 3.7 ? "text-red-700" : intel.directThreatScore >= 2.8 ? "text-amber-700" : "text-slate-600"}`}>
                          {intel.directThreatScore.toFixed(1)}
                        </span>
                      ) : "—"}
                    </td>
                    <td>
                      {intel?.tourQualityScore !== null && intel?.tourQualityScore !== undefined
                        ? <span className="font-medium text-purple-700">{intel.tourQualityScore.toFixed(1)}</span>
                        : <span className="text-slate-400 text-xs">not toured</span>}
                    </td>
                    <td>
                      {intel ? (
                        <span className={`font-medium ${intel.learningScore >= 3.5 ? "text-emerald-700" : "text-slate-600"}`}>
                          {intel.learningScore.toFixed(1)}
                        </span>
                      ) : "—"}
                    </td>
                    <td>
                      {cls ? <Badge intent={CLASSIFICATION_COLORS[cls]}>{CLASSIFICATION_LABELS[cls]}</Badge> : "—"}
                    </td>
                    <td>
                      {excluded ? (
                        <Badge intent="neutral">excluded</Badge>
                      ) : (
                        <Badge intent="good">anchor</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <p className="text-[11px] text-slate-400 mt-6">
        Smart threat scores computed by <code>lib/services/competitorIntelligence.ts</code> and stored in <code>competitor_intelligence_summary</code>.
        Classifications are DB-driven with optional manager overrides. Pricing exclusions protect Baxter rent anchors from premium/non-comparable comps.
        Manager review required before owner-facing pricing decisions.
      </p>
    </>
  );
}
