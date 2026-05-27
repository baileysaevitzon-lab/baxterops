"use client";
import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { BAXTER_UNITS, COMPETITORS, DEFAULT_MATCHING_WEIGHTS } from "@/lib/seed";
import { estimateRent, fmtMoney } from "@/lib/calc";
import { getAllObservedUnits } from "@/lib/services/competitorUnits";
import { getAllConflicts } from "@/lib/services/sourceConflicts";
import { SourceBadge } from "@/components/SourceBadge";
import type { CompetitorUnitObservation, SourceConflictRow } from "@/lib/types";

export default function PricingModel() {
  const estimates = BAXTER_UNITS.map(u => ({ unit: u, est: estimateRent(u, COMPETITORS, DEFAULT_MATCHING_WEIGHTS) }));
  const [observed, setObserved] = useState<CompetitorUnitObservation[]>([]);
  const [conflicts, setConflicts] = useState<SourceConflictRow[]>([]);

  useEffect(() => {
    (async () => {
      await new Promise(r => setTimeout(r, 30));
      setObserved(await getAllObservedUnits());
      setConflicts(await getAllConflicts());
    })();
  }, []);

  const openRentConflicts = conflicts.filter(c => (c.fieldKey === "gross_rent" || c.fieldKey === "specials") && c.status !== "resolved" && !c.status.startsWith("accept"));

  const zen522 = observed.find(o => o.unitNumber === "522");
  const zen625 = observed.find(o => o.unitNumber === "625");
  const jardine504 = observed.find(o => o.competitorId === "c-jardine" && o.unitNumber === "504");
  const jardine501 = observed.find(o => o.competitorId === "c-jardine" && o.unitNumber === "501");

  return (
    <>
      <PageHeader
        title="Pricing Model"
        subtitle="Explainable pseudo-regression: matched-comp baseline + covariate adjustments (window, closet, light, floor). This is an operating estimate, not an appraisal."
      />

      {openRentConflicts.length > 0 && (
        <div className="mb-4 rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          ⚠ <strong>{openRentConflicts.length} unresolved comp-rent conflict{openRentConflicts.length === 1 ? "" : "s"}.</strong> Prediction uses conflicting comp inputs — confirm live pricing before final pricing decision. See <a href="/source-conflicts" className="underline">/source-conflicts</a>.
        </div>
      )}

      <Card className="mb-6 border-l-4 border-l-rose-500">
        <CardHeader title="Zen Hollywood Field Tour Takeaway" subtitle="Premium amenity comp — interpret separately from price-only comps" />
        <CardBody>
          <p className="text-sm text-slate-700">
            Zen is a premium amenity comp with strong common areas, included parking/valet, in-unit laundry, water included,
            pool, gym, lounge/bar, game/theater space, business area, and aggressive concessions.
            <strong> Baxter should not use Zen as a simple rent anchor.</strong> Zen validates that renters nearby may pay more for
            stronger amenity packages, but Baxter must discount relative to Zen unless Baxter's unit-specific strengths or
            concessions compensate.
          </p>
          {zen522 && (
            <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
              <div className="bg-slate-50 rounded p-2">
                <div className="text-slate-500">Zen 522 (1BR)</div>
                <div className="font-medium">{fmtMoney(zen522.grossRent)} · 762 sqft</div>
                <div>NER 13m/1free: {fmtMoney(zen522.effectiveRent13m1Free)}</div>
                <div>NER 19m/2free: {fmtMoney(zen522.effectiveRent19m2Free)}</div>
              </div>
              {zen625 && (
                <div className="bg-slate-50 rounded p-2">
                  <div className="text-slate-500">Zen 625 (2BR · not ready)</div>
                  <div className="font-medium">{fmtMoney(zen625.grossRent)} · 1441 sqft</div>
                  <div>NER 13m/1free: {fmtMoney(zen625.effectiveRent13m1Free)}</div>
                  <div>NER 19m/2free: {fmtMoney(zen625.effectiveRent19m2Free)}</div>
                </div>
              )}
              <div className="bg-emerald-50 rounded p-2 col-span-2">
                <div className="text-emerald-700 font-medium">Strategic adjustment</div>
                <div>Zen rents are <em>not</em> blindly propagated into Baxter predicted rent. Treat as ceiling reference + amenity benchmark.</div>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {(jardine504 || jardine501) && (
        <Card className="mb-6 border-l-4 border-l-amber-500">
          <CardHeader
            title="Jardine Field Tour Takeaway"
            subtitle="Premium amenity comp — LUXURY TIER, low vacancy, no specials. Do not use as direct Baxter rent anchor."
          />
          <CardBody>
            <p className="text-sm text-slate-700">
              Jardine is field-tour verified (Bailey 2026-05-27) as materially more luxury than Baxter. Strong amenity stack (rooftop pool, theater, garden room, clubhouse, 24/7 security, scent control, coffee). Prices are subject to daily change and there are no specials due to low vacancy.
              <strong> Use Jardine observed rents as a premium nearby ceiling, NOT a direct Baxter rent target.</strong>
            </p>
            <div className="mt-3 grid grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
              {jardine504 && (
                <div className="bg-slate-50 rounded p-2">
                  <div className="text-slate-500">Jardine 504 (1BR)</div>
                  <div className="font-medium">{fmtMoney(jardine504.grossRent)} · 583 sqft</div>
                  <div className="text-[10px] text-slate-500">no balcony · live-confirm availability</div>
                </div>
              )}
              {jardine501 && (
                <div className="bg-slate-50 rounded p-2">
                  <div className="text-slate-500">Jardine 501 (2BR)</div>
                  <div className="font-medium">{fmtMoney(jardine501.grossRent)} · 1,304 sqft</div>
                  <div className="text-[10px] text-slate-500">no balcony · live-confirm availability</div>
                </div>
              )}
              <div className="bg-amber-50 rounded p-2 col-span-2 lg:col-span-1">
                <div className="text-amber-700 font-medium">Strategic adjustment</div>
                <div>Jardine flagged <code>not_directly_comparable_to_baxter</code>. Excluded from rent anchoring; included in amenity / threat benchmarking only.</div>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {estimates.map(({ unit, est }) => (
          <Card key={unit.id}>
            <CardHeader
              title={`Unit ${unit.unitNumber} · ${unit.type}`}
              subtitle={`${unit.sqft} sqft · floor ${unit.floor} · ${unit.daysVacant ?? 0} days vacant`}
              action={
                <Badge intent={est.flag === "overpriced" ? "bad" : est.flag === "underpriced" ? "good" : "neutral"}>
                  {est.flag} · {est.confidence}% conf
                </Badge>
              }
            />
            <CardBody>
              <div className="grid grid-cols-3 gap-3 text-sm mb-4">
                <div>
                  <div className="text-xs text-slate-500">Asking</div>
                  <div className="text-lg font-semibold">{fmtMoney(unit.askingRent)}</div>
                  <SourceBadge fieldKey="asking_rent" entityType="baxter_unit" entityId={unit.id} compact />
                </div>
                <div>
                  <div className="text-xs text-slate-500">Predicted</div>
                  <div className="text-lg font-semibold">{fmtMoney(est.predictedRent)}</div>
                  <div className="text-[10px] text-slate-500 mt-1">computed · {est.confidence}% conf</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Net effective</div>
                  <div className="text-lg font-semibold">{fmtMoney(est.predictedNetEffective)}</div>
                </div>
              </div>

              <div className="mb-3">
                <div className="text-xs text-slate-500 mb-1">Difference vs predicted</div>
                <div className={`text-base font-semibold ${est.difference > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                  {est.difference > 0 ? "+" : ""}{fmtMoney(est.difference)}
                </div>
              </div>

              {est.topDrivers.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs text-slate-500 mb-1">Covariate adjustments</div>
                  <ul className="text-sm space-y-0.5">
                    {est.topDrivers.map(d => (
                      <li key={d.feature} className="flex justify-between">
                        <span>{d.feature}</span>
                        <span className={d.contribution > 0 ? "text-emerald-700" : "text-rose-700"}>
                          {d.contribution > 0 ? "+" : ""}{d.contribution}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="border-t pt-3 mt-3">
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Suggested action</div>
                <div className="text-sm">{est.suggestedAction}</div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="mt-6 text-xs text-slate-400 italic max-w-2xl">
        This model is an operating estimate, not a formal appraisal. Validate against real leasing outcomes weekly.
        Covariate weights are heuristic — replace with fitted regression coefficients once enough lease-up data accumulates.
      </div>
    </>
  );
}
