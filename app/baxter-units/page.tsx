"use client";
import { useState } from "react";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { BAXTER_UNITS, COMPETITORS, DEFAULT_MATCHING_WEIGHTS } from "@/lib/seed";
import { closestComps, estimateRent, fmtMoney, netEffectiveRent, rentPerSqft } from "@/lib/calc";
import { DATA_QUALITY_FLAGS } from "@/lib/dataQuality";
import { SourceBadge } from "@/components/SourceBadge";
import type { BaxterUnit } from "@/lib/types";

function UnitDrawer({ unit, onClose }: { unit: BaxterUnit; onClose: () => void }) {
  const top = closestComps(unit, COMPETITORS, DEFAULT_MATCHING_WEIGHTS, 5);
  const est = estimateRent(unit, COMPETITORS, DEFAULT_MATCHING_WEIGHTS);
  const leaseMonths = unit.leaseMonths ?? unit.leaseTermMonths ?? 12;
  const netEff = netEffectiveRent(unit.askingRent, unit.freeMonths ?? 0, leaseMonths);
  const flags = (unit.dataQualityFlags ?? [])
    .map(fid => DATA_QUALITY_FLAGS.find(f => f.id === fid))
    .filter((x): x is NonNullable<typeof x> => !!x);

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex justify-end z-50" onClick={onClose}>
      <div className="bg-white w-full max-w-2xl h-full overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-semibold">Unit {unit.unitNumber}</h2>
              <div className="text-sm text-slate-500">{unit.type} · floor {unit.floor} · {unit.sqft} sqft · {unit.program}</div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
          </div>
          <div className="mt-3 flex gap-2 flex-wrap">
            <Badge intent={unit.occupancy === "vacant" ? "bad" : "good"}>{unit.occupancy}</Badge>
            {unit.daysVacant && <Badge intent="warn">{unit.daysVacant} days vacant</Badge>}
            <Badge intent="info">Asking {fmtMoney(unit.askingRent)}</Badge>
            <SourceBadge fieldKey="asking_rent" entityType="baxter_unit" entityId={unit.id} compact />
            {unit.freeMonths ? <Badge intent="good">Net eff. {fmtMoney(netEff)}</Badge> : null}
            {unit.previousAskingRent && unit.previousAskingRent !== unit.askingRent && (
              <Badge intent="neutral">was {fmtMoney(unit.previousAskingRent)}</Badge>
            )}
          </div>
        </div>

        <div className="p-6 space-y-6">
          {flags.length > 0 && (
            <section className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-800">
              <div className="font-medium mb-1">⚠ Data quality flags</div>
              <ul className="space-y-0.5">{flags.map(f => <li key={f.id}>· {f.issue} <span className="text-amber-600">[{f.status}]</span></li>)}</ul>
            </section>
          )}

          {(unit.concessionDescription || unit.concession || unit.freeMonths || unit.leaseMonths) && (
            <section>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Concession + fee schedule</h3>
              <div className="bg-slate-50 rounded-lg p-4 text-sm grid grid-cols-2 gap-2">
                {unit.concessionDescription && <div className="col-span-2 italic">{unit.concessionDescription}</div>}
                {unit.freeMonths !== undefined && <div><span className="text-slate-500">Free months:</span> {unit.freeMonths}</div>}
                {unit.leaseMonths !== undefined && <div><span className="text-slate-500">Lease length:</span> {unit.leaseMonths} mo</div>}
                <div><span className="text-slate-500">Asking:</span> {fmtMoney(unit.askingRent)}</div>
                <div><span className="text-slate-500">Net effective:</span> {fmtMoney(netEff)}</div>
                {unit.deposit !== undefined && <div><span className="text-slate-500">Deposit:</span> {typeof unit.deposit === "number" ? fmtMoney(unit.deposit) : unit.deposit}</div>}
                {unit.lookAndLeaseBonus !== undefined && <div><span className="text-slate-500">Look-and-lease:</span> {fmtMoney(unit.lookAndLeaseBonus)}</div>}
                {unit.parkingIncluded !== undefined && <div><span className="text-slate-500">Parking:</span> {unit.parkingIncluded ? "included" : "extra"}</div>}
              </div>
            </section>
          )}

          {(unit.pricingHistory ?? []).length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Pricing history</h3>
              <ul className="text-xs space-y-1">
                {unit.pricingHistory!.map(h => (
                  <li key={h.changedAt + h.newRent} className="flex justify-between border-b border-slate-100 py-1">
                    <span>{h.changedAt} · {h.changedBy}</span>
                    <span><span className="text-slate-400 line-through">{fmtMoney(h.oldRent)}</span> → <strong>{fmtMoney(h.newRent)}</strong></span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-slate-500 mt-1 italic">{unit.pricingHistory![0].reason}</p>
            </section>
          )}
          <section>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Pricing model output</h3>
            <div className="bg-slate-50 rounded-lg p-4 text-sm space-y-1">
              <div>Predicted rent: <strong>{fmtMoney(est.predictedRent)}</strong> · Net effective {fmtMoney(est.predictedNetEffective)}</div>
              <div>Difference vs asking: <strong className={est.difference > 0 ? "text-rose-600" : "text-emerald-600"}>
                {est.difference > 0 ? "+" : ""}{fmtMoney(est.difference)}
              </strong></div>
              <div>Flag: <Badge intent={est.flag === "overpriced" ? "bad" : est.flag === "underpriced" ? "good" : "neutral"}>{est.flag}</Badge> · confidence {est.confidence}</div>
              <div className="text-slate-600 mt-2 italic">{est.suggestedAction}</div>
              {est.topDrivers.length > 0 && (
                <ul className="mt-2 text-xs text-slate-500">
                  {est.topDrivers.map(d => (
                    <li key={d.feature}>· {d.feature}: {d.contribution > 0 ? "+" : ""}{d.contribution}</li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Covariates</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {Object.entries(unit.covariates).map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-slate-100 pb-1">
                  <span className="text-slate-500">{k}</span>
                  <span className="font-medium">{String(v)}</span>
                </div>
              ))}
            </div>
          </section>

          {unit.strengths.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-emerald-700 mb-2">Strengths</h3>
              <ul className="text-sm space-y-1">{unit.strengths.map(s => <li key={s}>· {s}</li>)}</ul>
            </section>
          )}

          {unit.weaknesses.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-rose-700 mb-2">Weaknesses</h3>
              <ul className="text-sm space-y-1">{unit.weaknesses.map(s => <li key={s}>· {s}</li>)}</ul>
            </section>
          )}

          <section>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Top 5 matched comps</h3>
            <table className="bx">
              <thead><tr><th>Comp</th><th>Similarity</th><th>Avg rent</th><th>Gap</th></tr></thead>
              <tbody>
                {top.map(m => {
                  const c = COMPETITORS.find(x => x.id === m.competitorId);
                  const ct = c?.unitTypes.find(t => t.type === m.competitorUnitType);
                  return (
                    <tr key={m.competitorId}>
                      <td className="font-medium">{c?.name}</td>
                      <td><Badge intent={m.similarity >= 70 ? "good" : "warn"}>{m.similarity}</Badge></td>
                      <td>{fmtMoney(ct?.avgRent)}</td>
                      <td className={m.rentGap < 0 ? "text-emerald-600" : "text-rose-600"}>
                        {m.rentGap > 0 ? "+" : ""}{fmtMoney(m.rentGap)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {unit.notes && (
            <section>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Notes</h3>
              <p className="text-sm text-slate-600">{unit.notes}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BaxterUnits() {
  const [selected, setSelected] = useState<BaxterUnit | null>(null);
  return (
    <>
      <PageHeader
        title="Baxter Units"
        subtitle="Per-unit covariates and pricing recommendations. Click any row for full detail and matched comps."
      />
      <Card>
        <CardHeader title={`${BAXTER_UNITS.length} units tracked`} subtitle={`${BAXTER_UNITS.filter(u => u.occupancy === "vacant").length} vacant`} />
        <CardBody className="p-0">
          <table className="bx">
            <thead>
              <tr>
                <th>Unit</th>
                <th>Type</th>
                <th>Sqft</th>
                <th>Asking</th>
                <th>$/sqft</th>
                <th>Days vacant</th>
                <th>Strength signal</th>
                <th>Weakness signal</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {BAXTER_UNITS.map(u => (
                <tr key={u.id} className="cursor-pointer" onClick={() => setSelected(u)}>
                  <td className="font-medium">{u.unitNumber}</td>
                  <td>{u.type}</td>
                  <td>{u.sqft}</td>
                  <td>
                    {fmtMoney(u.askingRent)}
                    <div className="mt-1"><SourceBadge fieldKey="asking_rent" entityType="baxter_unit" entityId={u.id} compact /></div>
                  </td>
                  <td>
                    ${rentPerSqft(u.askingRent, u.sqft).toFixed(2)}
                    <div className="mt-1"><SourceBadge fieldKey="square_feet" entityType="baxter_unit" entityId={u.id} compact /></div>
                  </td>
                  <td>
                    {u.daysVacant && u.daysVacant > 30 ? (
                      <Badge intent="bad">{u.daysVacant}d</Badge>
                    ) : u.daysVacant ? (
                      <Badge intent="warn">{u.daysVacant}d</Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="text-emerald-700 text-xs">{u.strengths[0] ?? "—"}</td>
                  <td className="text-rose-700 text-xs">{u.weaknesses[0] ?? "—"}</td>
                  <td className="text-slate-600 text-xs max-w-xs">{u.suggestedAction ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
      {selected && <UnitDrawer unit={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
