"use client";
import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { BAXTER_UNITS, DEFAULT_MATCHING_WEIGHTS } from "@/lib/seed";
import { useCompetitors } from "@/lib/hooks/useCompetitors";
import { closestComps, fmtMoney } from "@/lib/calc";
import { getAllObservedUnits } from "@/lib/services/competitorUnits";
import { getAllConflicts } from "@/lib/services/sourceConflicts";
import { useTouredIds } from "@/lib/hooks/useTouredIds";
import { useTouredOnly } from "@/lib/hooks/useTouredOnly";
import { TouredOnlyToggle } from "@/components/TouredOnlyToggle";
import { SourceBadge } from "@/components/SourceBadge";
import { LiveDataBanner } from "@/components/LiveDataBanner";
import type { CompetitorUnitObservation, MatchingWeights, SourceConflictRow } from "@/lib/types";

export default function CompMatching() {
  // Sprint 12: live competitor list from Supabase
  const { competitors: COMPETITORS } = useCompetitors();

  // Sprint 13: shared toured-only state + canonical detector
  const { touredIds, touredCount } = useTouredIds();
  const [touredOnly, setTouredOnly] = useTouredOnly();

  const [unitId, setUnitId] = useState(BAXTER_UNITS[1].id);
  const [weights, setWeights] = useState<MatchingWeights>(DEFAULT_MATCHING_WEIGHTS);
  const [mode, setMode] = useState<"averages" | "observed" | "both">("both");
  const [observed, setObserved] = useState<CompetitorUnitObservation[]>([]);
  const [conflicts, setConflicts] = useState<SourceConflictRow[]>([]);

  useEffect(() => {
    (async () => {
      await new Promise(r => setTimeout(r, 30));
      const [obs, conflictsAll] = await Promise.all([
        getAllObservedUnits(),
        getAllConflicts(),
      ]);
      setObserved(obs);
      setConflicts(conflictsAll);
    })();
  }, []);

  const hasUnitConflict = (unitId: string) => conflicts.some(c => c.entityId === unitId && c.status !== "resolved" && c.status !== "accept_a" && c.status !== "accept_b" && c.status !== "accept_c");

  const unit = BAXTER_UNITS.find(u => u.id === unitId)!;
  const visibleComps = touredOnly
    ? COMPETITORS.filter(c => touredIds.has(c.id))
    : COMPETITORS;
  const matches = closestComps(unit, visibleComps, weights, 10);

  // Filter observed units to the same bedroom count as the selected Baxter unit
  const matchingObserved = observed.filter(o => o.bedCount === unit.bedrooms);

  // Specific Zen 522 narrative
  const zen522 = observed.find(o => o.unitNumber === "522");
  const u308Narrative = unit.unitNumber === "308" && zen522
    ? `Zen 522 is more expensive (${fmtMoney(zen522.grossRent)}, 762 sqft) but has a real bedroom window, stronger amenities, included parking/valet, water included, and in-unit laundry. Baxter 308 has the no-bedroom-window weakness, so it should remain materially cheaper or receive stronger concession support.`
    : null;
  const u301Narrative = unit.unitNumber === "301" && zen522
    ? `Zen 522 is more expensive and more amenity-rich; Baxter 301 can still be positioned as a value/premium-closet unit if its NER is clearly below Zen and its walk-in closet/patio are emphasized.`
    : null;

  function setWeight(k: keyof MatchingWeights, v: number) {
    setWeights(w => ({ ...w, [k]: v }));
  }

  return (
    <>
      <LiveDataBanner />
      <PageHeader
        title="Comp Matching Engine"
        subtitle="Weighted-distance matcher: pick a Baxter unit, see closest comparable competitors. Toggle between property averages, field-observed units, or both."
        action={
          <div className="flex gap-2 items-center">
            <TouredOnlyToggle
              on={touredOnly}
              onToggle={setTouredOnly}
              touredCount={touredCount}
              totalCount={COMPETITORS.length}
            />
            <div className="flex bg-slate-100 rounded-md p-1 text-xs">
              {(["averages","observed","both"] as const).map(m => (
                <button key={m} onClick={() => setMode(m)} className={`px-3 py-1 rounded ${mode === m ? "bg-white shadow font-medium" : "text-slate-500"}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card className="lg:col-span-1">
          <CardHeader title="Unit picker" />
          <CardBody>
            <select
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
              value={unitId}
              onChange={e => setUnitId(e.target.value)}
            >
              {BAXTER_UNITS.map(u => (
                <option key={u.id} value={u.id}>{u.unitNumber} · {u.type} · {fmtMoney(u.askingRent)}</option>
              ))}
            </select>
            <div className="mt-4 text-sm space-y-1">
              <div><span className="text-slate-500">Sqft:</span> {unit.sqft}</div>
              <div><span className="text-slate-500">Floor:</span> {unit.floor}</div>
              <div><span className="text-slate-500">Asking:</span> {fmtMoney(unit.askingRent)}</div>
              <div><span className="text-slate-500">Days vacant:</span> {unit.daysVacant ?? "—"}</div>
              {unit.weaknesses.length > 0 && (
                <div className="text-rose-700 text-xs mt-2">⚠ {unit.weaknesses.join(", ")}</div>
              )}
            </div>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Matching weights" subtitle="Defaults: 20/20/15/15/15/10/5 — drag to retune" />
          <CardBody>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {(Object.keys(weights) as (keyof MatchingWeights)[]).map(k => (
                <div key={k}>
                  <div className="flex justify-between mb-1">
                    <span className="text-slate-600">{k}</span>
                    <span className="font-medium">{(weights[k] * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={weights[k]}
                    onChange={e => setWeight(k, parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-3 italic">
              Total weight does not need to sum to 1 — the absolute scale just affects similarity magnitude.
            </p>
          </CardBody>
        </Card>
      </div>

      {(mode === "observed" || mode === "both") && matchingObserved.length > 0 && (
        <Card className="mb-6">
          <CardHeader
            title={`${matchingObserved.length} field-observed competitor units · same bed count`}
            subtitle="Real unit-level rents from in-person tours. Premium-amenity comps are not pure price anchors — interpret accordingly."
          />
          <CardBody className="p-0">
            <table className="bx">
              <thead>
                <tr>
                  <th>Competitor</th><th>Unit</th><th>Sqft</th><th>Gross</th>
                  <th>NER 13m/1free</th><th>NER 19m/2free</th>
                  <th>Parking</th><th>Water</th><th>Laundry</th>
                  <th>Avail</th><th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {matchingObserved.map(o => (
                  <tr key={o.id}>
                    <td>
                      <div className="font-medium">{o.competitorName}</div>
                      <div className="text-xs"><Badge intent="bad">premium amenity comp</Badge></div>
                      {o.competitorId === "c-jardine" && (
                        <div className="text-[10px] text-amber-700 mt-1">
                          ⚠ Premium / luxury tier — use for threat + amenity benchmarking, NOT price anchoring.
                        </div>
                      )}
                    </td>
                    <td className="font-medium">{o.unitNumber}</td>
                    <td>{o.squareFeet ?? "—"}</td>
                    <td>
                      {o.grossRent ? fmtMoney(o.grossRent) : "—"}
                      <div className="mt-1"><SourceBadge fieldKey="gross_rent" entityType="competitor_unit" entityId={o.id} compact /></div>
                      {hasUnitConflict(o.id) && <div className="mt-1"><Badge intent="bad">⚠ verify before owner-facing</Badge></div>}
                    </td>
                    <td>{o.effectiveRent13m1Free ? fmtMoney(o.effectiveRent13m1Free) : "—"}</td>
                    <td>{o.effectiveRent19m2Free ? fmtMoney(o.effectiveRent19m2Free) : "—"}</td>
                    <td className="text-xs">
                      {o.parkingIncluded ? `incl. (${o.parkingSpotsIncluded ?? "?"}sp)` : "—"}
                      {o.valetIncluded ? " + valet" : ""}
                    </td>
                    <td>{o.waterIncluded ? <Badge intent="good">incl.</Badge> : <Badge>—</Badge>}</td>
                    <td>{o.inUnitLaundry ? <Badge intent="good">yes</Badge> : <Badge>—</Badge>}</td>
                    <td>
                      <Badge intent={o.availabilityStatus === "available" ? "good" : "warn"}>
                        {o.availabilityStatus ?? "—"}
                      </Badge>
                    </td>
                    <td><Badge intent={o.sourceConfidence === "high" ? "good" : "warn"}>{o.sourceConfidence}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {u308Narrative && (
              <div className="px-4 py-3 text-xs text-slate-700 border-t bg-amber-50">
                <strong>Baxter {unit.unitNumber} narrative:</strong> {u308Narrative}
              </div>
            )}
            {u301Narrative && (
              <div className="px-4 py-3 text-xs text-slate-700 border-t bg-sky-50">
                <strong>Baxter {unit.unitNumber} narrative:</strong> {u301Narrative}
              </div>
            )}
            {unit.bedrooms === 2 && (
              <div className="px-4 py-3 text-xs text-slate-700 border-t bg-amber-50">
                <strong>2BR note:</strong> Zen 625 / probable 630 / 2nd-floor double are premium amenity comps, not simple price anchors for Baxter {unit.unitNumber}.
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {(mode === "averages" || mode === "both") && (
      <Card>
        <CardHeader
          title={`Top 10 matches for unit ${unit.unitNumber} — property averages${touredOnly ? " (toured only)" : ""}`}
          subtitle="Sorted by weighted similarity score"
        />
        <CardBody className="p-0">
          <table className="bx">
            <thead>
              <tr>
                <th>Comp</th>
                <th>Similarity</th>
                <th>Comp unit type</th>
                <th>Comp avg rent</th>
                <th>Gap vs Baxter</th>
                <th>Driver notes</th>
              </tr>
            </thead>
            <tbody>
              {matches.map(m => {
                const c = COMPETITORS.find(x => x.id === m.competitorId)!;
                const ct = c.unitTypes.find(t => t.type === m.competitorUnitType);
                return (
                  <tr key={m.competitorId}>
                    <td>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-slate-500">{c.address}</div>
                    </td>
                    <td>
                      <Badge intent={m.similarity >= 70 ? "good" : m.similarity >= 50 ? "warn" : "neutral"}>
                        {m.similarity}
                      </Badge>
                    </td>
                    <td>{m.competitorUnitType}</td>
                    <td className="font-medium">{fmtMoney(ct?.avgRent)}</td>
                    <td className={m.rentGap < 0 ? "text-emerald-700" : "text-rose-700"}>
                      {m.rentGap > 0 ? "+" : ""}{fmtMoney(m.rentGap)} ({(m.percentRentGap * 100).toFixed(1)}%)
                    </td>
                    <td className="text-xs text-slate-600">
                      {m.driverNotes.length === 0 ? "—" : (
                        <ul className="space-y-1">{m.driverNotes.map(n => <li key={n}>· {n}</li>)}</ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardBody>
      </Card>
      )}
    </>
  );
}
