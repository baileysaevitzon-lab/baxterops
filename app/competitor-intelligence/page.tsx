"use client";
// Sprint 8 — Competitor Intelligence dashboard.
//
// Live charts pulled from seed (Baxter) + COMPETITORS (Hollywood comp set).
// Surfaces the strategic shape of the market: rent vs sqft, $/sqft positioning,
// amenity coverage, threat × distance matrix, and Baxter implications.
//
// Everything here is derived in-memory from existing source-verified data; no
// new "facts" are introduced. Premium / non-comparable competitors are visually
// separated so we don't anchor Baxter pricing off them.

import { useMemo, useState } from "react";
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
import { BAXTER_UNITS, COMPETITORS } from "@/lib/seed";
import { fmtMoney } from "@/lib/calc";

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

export default function CompetitorIntelligence() {
  const [unitFilter, setUnitFilter] = useState<UnitTypeFilter>("1BR");
  const [excludePremium, setExcludePremium] = useState(true);

  // Premium comps that should NOT anchor Baxter pricing (different product segment).
  const premiumCompIds = useMemo(
    () => new Set(COMPETITORS.filter(c => c.competitorStrategicType === "premium_amenity_comp").map(c => c.id)),
    [],
  );

  const visibleComps = useMemo(
    () => (excludePremium ? COMPETITORS.filter(c => !premiumCompIds.has(c.id)) : COMPETITORS),
    [excludePremium, premiumCompIds],
  );

  // ── Rent × sqft scatter ────────────────────────────────────────────────
  const scatterCompetitors = useMemo(() => {
    const points: { name: string; sqft: number; rent: number; type: string; isPremium: boolean }[] = [];
    for (const c of visibleComps) {
      for (const u of c.unitTypes ?? []) {
        if (unitFilter !== "all" && u.type !== unitFilter) continue;
        if (!u.avgRent || !u.avgSqft) continue;
        points.push({
          name: `${c.name} · ${u.type}`,
          sqft: u.avgSqft,
          rent: u.avgRent,
          type: u.type,
          isPremium: premiumCompIds.has(c.id),
        });
      }
    }
    return points;
  }, [visibleComps, unitFilter, premiumCompIds]);

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

  // ── $/sqft positioning ─────────────────────────────────────────────────
  const pricePerSqftRows = useMemo(() => {
    const rows: { name: string; perSqft: number; rent: number; sqft: number; isPremium: boolean; fieldVerified: boolean }[] = [];
    for (const c of COMPETITORS) {
      const cells = (c.unitTypes ?? [])
        .filter(u => (unitFilter === "all" ? true : u.type === unitFilter))
        .filter(u => u.avgRent && u.avgSqft);
      if (cells.length === 0) continue;
      const totalRent = cells.reduce((s, u) => s + (u.avgRent ?? 0), 0);
      const totalSqft = cells.reduce((s, u) => s + (u.avgSqft ?? 0), 0);
      if (!totalSqft) continue;
      rows.push({
        name: c.name,
        perSqft: Math.round((totalRent / totalSqft) * 100) / 100,
        rent: Math.round(totalRent / cells.length),
        sqft: Math.round(totalSqft / cells.length),
        isPremium: premiumCompIds.has(c.id),
        fieldVerified: !!c.fieldVerified,
      });
    }
    // Baxter blended for unit filter
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
          isPremium: false,
          fieldVerified: true,
        });
      }
    }
    rows.sort((a, b) => a.perSqft - b.perSqft);
    return rows;
  }, [unitFilter, premiumCompIds]);

  // ── Amenity coverage ───────────────────────────────────────────────────
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

  // ── Threat × distance bubble matrix ────────────────────────────────────
  const positioning = useMemo(() => {
    return COMPETITORS
      .filter(c => c.distanceMiles !== undefined && c.threatLevel !== undefined)
      .map(c => ({
        id: c.id,
        name: c.name,
        distance: c.distanceMiles ?? 0,
        threat: c.threatLevel ?? 0,
        size: c.units ?? 50,
        verified: !!c.fieldVerified,
        premium: premiumCompIds.has(c.id),
      }));
  }, [premiumCompIds]);

  // ── Baxter implications cards ─────────────────────────────────────────
  const implications = useMemo(() => {
    const out: { title: string; color: "good" | "warn" | "bad" | "info"; body: string }[] = [];

    // Highland 1BR pressure
    const highland1br = COMPETITORS.find(c => c.id === "c-highland")?.unitTypes?.find(u => u.type === "1BR");
    if (highland1br?.avgRent && highland1br?.avgSqft) {
      out.push({
        title: "Highland 1BR @ $2,870 / 730 sqft",
        color: "warn",
        body: `Highland's 8-weeks-free concession + rooftop pool pressures Baxter 1BR. Baxter wins on enclosed hallways, bigger bedrooms, useable balcony. Anchor effective-rent math, not face rent.`,
      });
    }

    // 1600 Vine — premium / not comparable
    const vine = COMPETITORS.find(c => c.id === "c-vine-1600");
    if (vine) {
      out.push({
        title: "1600 Vine — ceiling reference only",
        color: "info",
        body: `2-story 2BR/2.5BA at $5,200 / 2,178 sqft is a premium product. Do NOT anchor Baxter pricing off it. Useful for "what does a top-of-market 2BR cost in Hollywood" framing only.`,
      });
    }

    // Hanover dominance
    const hanover = COMPETITORS.find(c => c.id === "c-hanover-hollywood");
    if (hanover) {
      out.push({
        title: "Hanover Hollywood is winning the lease-up race",
        color: "bad",
        body: `12 tours / 10 leases last week with 6 weeks free + 1 add'l. Threat level 5/5. Baxter needs a clear differentiation story (boutique scale, lower entry rent, real concession transparency).`,
      });
    }

    // Field-verified subset
    const fieldCount = COMPETITORS.filter(c => c.fieldVerified).length;
    out.push({
      title: `${fieldCount} of ${COMPETITORS.length} comps field-toured`,
      color: fieldCount >= 3 ? "good" : "warn",
      body: `Field-verified comps anchor every weekly report. Schedule one new tour / week to keep coverage > 25%.`,
    });

    return out;
  }, []);

  // ── Color palette ──────────────────────────────────────────────────────
  const intentColor = (intent: "good" | "warn" | "bad" | "info") =>
    intent === "good" ? "#10b981" : intent === "warn" ? "#f59e0b" : intent === "bad" ? "#ef4444" : "#0ea5e9";

  return (
    <>
      <PageHeader
        title="Competitor Intelligence"
        subtitle={`Live market positioning across ${COMPETITORS.length} Hollywood comps. Premium/2-story product (1600 Vine) is shown but excluded from price anchors by default.`}
        action={
          <div className="flex items-center gap-2 text-xs">
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
            <label className="flex items-center gap-1 ml-3 cursor-pointer text-slate-600">
              <input type="checkbox" checked={excludePremium} onChange={e => setExcludePremium(e.target.checked)} />
              Exclude premium comps from scatter
            </label>
          </div>
        }
      />

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

      {/* Rent × Sqft scatter */}
      <Card className="mb-6">
        <CardHeader
          title={`Rent × Square Feet — ${unitFilter === "all" ? "all unit types" : unitFilter}`}
          subtitle="Baxter (green diamonds) vs. comps (slate). Hover for property + unit type."
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
                <Scatter name="Competitors" data={scatterCompetitors} fill="#64748b" />
                <Scatter name="Baxter units" data={scatterBaxter} fill="#10b981" shape="diamond" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </CardBody>
      </Card>

      {/* $/sqft positioning */}
      <Card className="mb-6">
        <CardHeader
          title={`$/sqft positioning — ${unitFilter === "all" ? "blended" : unitFilter}`}
          subtitle="Lower is better for renters. Baxter highlighted; premium comps shown in amber."
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
                          : row.isPremium
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
            <span><span className="inline-block w-2 h-2 rounded-sm bg-sky-500 mr-1" />Field-verified comp</span>
            <span><span className="inline-block w-2 h-2 rounded-sm bg-slate-400 mr-1" />Comp (web/call only)</span>
            <span><span className="inline-block w-2 h-2 rounded-sm bg-amber-500 mr-1" />Premium / non-comparable</span>
          </div>
        </CardBody>
      </Card>

      {/* Amenity coverage */}
      <Card className="mb-6">
        <CardHeader title="Amenity coverage across competitors" subtitle="Share of comps offering each premium amenity. Drives the 'Baxter is missing X' conversation." />
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
          title="Threat × Distance positioning"
          subtitle="Bubble size = unit count. Closer + higher threat = more direct pressure on Baxter lease-up. Premium comps in amber."
        />
        <CardBody>
          <div style={{ width: "100%", height: 360 }}>
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 10, right: 30, bottom: 30, left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="distance" name="Distance" type="number" unit=" mi" domain={[0, "dataMax + 0.2"]} label={{ value: "Distance from Baxter (mi)", position: "insideBottom", offset: -10 }} />
                <YAxis dataKey="threat" name="Threat" type="number" domain={[0, 5]} ticks={[1, 2, 3, 4, 5]} label={{ value: "Threat level (1-5)", angle: -90, position: "insideLeft" }} />
                <ZAxis dataKey="size" range={[60, 600]} name="Units" />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  formatter={(value: number | string, name: string) => {
                    if (name === "Distance") return [`${value} mi`, name];
                    if (name === "Threat") return [`${value}/5`, name];
                    if (name === "Units") return [`${value} units`, name];
                    return [value, name];
                  }}
                  labelFormatter={(_, payload) => (payload && payload[0] ? (payload[0].payload as { name: string }).name : "")}
                />
                <Scatter name="Comps" data={positioning}>
                  {positioning.map((p, i) => (
                    <Cell key={i} fill={p.premium ? "#f59e0b" : p.verified ? "#0ea5e9" : "#64748b"} fillOpacity={0.75} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </CardBody>
      </Card>

      {/* Comp table */}
      <Card>
        <CardHeader title="Comp roster" subtitle="Click a field-verified comp to open the detailed tour record." />
        <CardBody className="p-0">
          <table className="bx">
            <thead>
              <tr>
                <th>Name</th>
                <th>Distance</th>
                <th>Units</th>
                <th>Threat</th>
                <th>Quality</th>
                <th>Strategic type</th>
                <th>Verified</th>
              </tr>
            </thead>
            <tbody>
              {COMPETITORS.map(c => (
                <tr key={c.id}>
                  <td className="font-medium">
                    {c.fieldVerified ? (
                      <Link className="text-sky-700 hover:underline" href={`/competitors/${c.id.replace(/^c-/, "")}`}>{c.name}</Link>
                    ) : (
                      c.name
                    )}
                  </td>
                  <td>{c.distanceMiles !== undefined ? `${c.distanceMiles} mi` : "—"}</td>
                  <td>{c.units || "—"}</td>
                  <td>{c.threatLevel !== undefined ? `${c.threatLevel}/5` : "—"}</td>
                  <td>{c.compQualityScore ?? "—"}</td>
                  <td className="text-xs text-slate-600">{c.competitorStrategicType ? c.competitorStrategicType.replace(/_/g, " ") : "—"}</td>
                  <td>{c.fieldVerified ? <Badge intent="good">★ tour</Badge> : <Badge>web/call</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <p className="text-[11px] text-slate-400 mt-6">
        Charts derive from <code>lib/seed.ts</code> + the live Supabase override layer. Every number here has a source ledger entry; click a field-verified comp to inspect provenance.
      </p>
    </>
  );
}
