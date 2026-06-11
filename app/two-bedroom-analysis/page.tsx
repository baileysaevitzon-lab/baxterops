"use client";
// Sprint 37: Owner-facing 2BR Competitive Analysis — June 9, 2026 research build.
//
// Reads LIVE from Supabase: competitor_unit_observations (June 9 staged rows),
// source_conflicts, manual_verification_queue, competitors. Read-only — no writes,
// no schema changes, no recert/PDF logic touched.
//
// The key reframe: Baxter has TWO 2BR products (market-rate 2x2 A ~$4,350 and
// restricted Unit 105 $2,499). They are never blended; Unit 105 carries a
// restricted badge and is excluded from head-to-head market comparisons.

import { useEffect, useMemo, useState } from "react";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { getObservedUnitsByBedCount } from "@/lib/services/competitorUnits";
import { getAllConflicts } from "@/lib/services/sourceConflicts";
import { getAllQueueItems } from "@/lib/services/verificationQueue";
import { BAXTER_UNITS } from "@/lib/seed";
import { deriveBaxter2br } from "@/lib/twoBedroomAnalysis";
import { fmtMoney } from "@/lib/calc";
import {
  BAXTER_MARKET_2BR, BAXTER_RESTRICTED_2BR, JUNE9, JUNE9_COMP_ANALYSIS,
  effectiveRentWeeks, concessionValue, OWNER_ACTION_PLAN, MARKETING_IDEAS,
  MEETING_NOTES_SUMMARY, type June9CompAnalysis,
} from "@/lib/twoBedroomJune9";
import type { CompetitorUnitObservation, SourceConflictRow, ManualVerificationQueueRow } from "@/lib/types";

const money = (n?: number | null) => (n === undefined || n === null ? "unknown" : fmtMoney(Number(n)));
const psf = (rent?: number | null, sqft?: number | null) =>
  rent && sqft ? `$${(Number(rent) / Number(sqft)).toFixed(2)}` : "unknown";

function ConfBadge({ c }: { c: string }) {
  const intent = c === "high" ? "good" : c === "medium" ? "info" : "warn";
  return <Badge intent={intent as "good" | "info" | "warn"}>{c} conf.</Badge>;
}

export default function TwoBedroomAnalysisPage() {
  const [obs, setObs] = useState<CompetitorUnitObservation[]>([]);
  const [conflicts, setConflicts] = useState<SourceConflictRow[]>([]);
  const [vqItems, setVqItems] = useState<ManualVerificationQueueRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { setObs(await getObservedUnitsByBedCount(2)); } catch { /* non-fatal */ }
      try { setConflicts(await getAllConflicts()); } catch { /* non-fatal */ }
      try { setVqItems(await getAllQueueItems()); } catch { /* non-fatal */ }
      setLoading(false);
    })();
  }, []);

  // June 9 staged observations (needs_verification=true; never overwrite field rows).
  const june9Obs = useMemo(
    () => new Map(obs.filter(o => (o.sourceDate ?? "").startsWith(JUNE9)).map(o => [o.competitorId, o])),
    [obs],
  );
  const twoBrConflicts = useMemo(
    () => conflicts.filter(c => c.id.includes("20260609") && c.status !== "resolved"),
    [conflicts],
  );
  const twoBrVq = useMemo(
    () => vqItems.filter(v => v.id.includes("20260609") && v.status === "pending"),
    [vqItems],
  );

  // Unit 105 live numbers come from the existing Baxter seed (internal data).
  const unit105 = useMemo(() => deriveBaxter2br(BAXTER_UNITS), []);
  const restrictedAsk = unit105?.askingRent ?? BAXTER_RESTRICTED_2BR.askingRent;
  const restrictedSqft = unit105?.sqft ?? BAXTER_RESTRICTED_2BR.sqft;

  const marketEff = effectiveRentWeeks(BAXTER_MARKET_2BR.askingRent, BAXTER_MARKET_2BR.freeWeeks);
  const restrictedEff = effectiveRentWeeks(restrictedAsk, BAXTER_RESTRICTED_2BR.freeWeeks, 13);

  return (
    <div className="space-y-6 pb-16">
      <PageHeader
        title="2BR Competitive Analysis"
        subtitle="Two Baxter 2BR products, the live June 9 2026 competitor band, and the owner action plan."
      />

      {/* Source legend */}
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge intent="info">Baxter internal</Badge>
        <Badge intent="good">field-verified (Bailey tours)</Badge>
        <Badge intent="warn">June 9 live-listing research (staged, needs verification)</Badge>
        <Badge intent="bad">conflict — verify before pricing</Badge>
        <span className="text-slate-400 self-center">Effective rents are estimates from advertised specials — call/tour-confirm before final decisions.</span>
      </div>

      {/* ── 1. Executive summary ───────────────────────────── */}
      <Card>
        <CardHeader title="Executive summary" subtitle="June 9, 2026 — owner view" />
        <CardBody>
          <div className="grid md:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
              <div className="text-xs font-semibold text-slate-500">Baxter 2BR position</div>
              <div className="text-sm font-bold mt-1">Two products — judge separately</div>
              <div className="text-xs text-slate-600 mt-1">Market 2x2 (~{money(BAXTER_MARKET_2BR.askingRent)}) is top-of-band on <em>effective</em> rent. Unit 105 ({money(restrictedAsk)}) is likely restricted — different game.</div>
            </div>
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
              <div className="text-xs font-semibold text-rose-700">Biggest threat</div>
              <div className="text-sm font-bold mt-1">Jefferson / 1724 Highland</div>
              <div className="text-xs text-slate-600 mt-1">$2,795 entry + ~6 wks free + 2 bundled parking spots. El Centro's 2-months-free distorts the whole band through 6/30.</div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="text-xs font-semibold text-amber-700">Concession gap</div>
              <div className="text-sm font-bold mt-1">~4 wks vs rivals&apos; 4–8</div>
              <div className="text-xs text-slate-600 mt-1">Rivals advertise 4–8 wks (El Centro 2 mo). Our ~1 mo is the weakest in the band → effective rent looks high.</div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div className="text-xs font-semibold text-emerald-700">Most urgent owner decision</div>
              <div className="text-sm font-bold mt-1">Concession test, not rent cut</div>
              <div className="text-xs text-slate-600 mt-1">Approve a 6–8-week concession test on the market 2x2; hold the headline price.</div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs font-semibold text-slate-500">Most important data gap</div>
              <div className="text-sm font-bold mt-1">Which 2BR is vacant?</div>
              <div className="text-xs text-slate-600 mt-1">And is Unit 105 income-restricted? Everything downstream (price vs pipeline) depends on it. Still no lead→tour→app funnel data.</div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ── 2. Baxter: market vs restricted ────────────────── */}
      <div className="grid lg:grid-cols-2 gap-4">
        {[{ p: BAXTER_MARKET_2BR, ask: BAXTER_MARKET_2BR.askingRent, sqft: BAXTER_MARKET_2BR.sqft, eff: marketEff },
          { p: BAXTER_RESTRICTED_2BR, ask: restrictedAsk, sqft: restrictedSqft, eff: restrictedEff }].map(({ p, ask, sqft, eff }) => (
          <Card key={p.key}>
            <CardHeader
              title={`${p.label} (${p.plan})`}
              subtitle={p.key === "market" ? "Competes with Hanover / Modera / Highland / Jefferson / El Centro / Avenue" : "Income-qualified product — do NOT compare head-to-head with luxury market-rate comps"}
            />
            <CardBody className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-1">
                {p.badges.map(b => (
                  <Badge key={b} intent={b.startsWith("Market") ? "good" : b.startsWith("Restricted") ? "warn" : "bad"}>{b}</Badge>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded border border-slate-200 p-2"><div className="text-xs text-slate-500">Asking</div><div className="font-bold">{money(ask)}</div></div>
                <div className="rounded border border-slate-200 p-2"><div className="text-xs text-slate-500">~Effective</div><div className="font-bold">{money(eff)}</div></div>
                <div className="rounded border border-slate-200 p-2"><div className="text-xs text-slate-500">Sqft</div><div className="font-bold">{sqft}</div></div>
              </div>
              <div className="text-xs text-slate-600"><strong>Parking:</strong> {p.parking}</div>
              <div className="text-xs text-slate-600"><strong>Source:</strong> {p.source}</div>
              <div className="rounded-md bg-slate-50 border border-slate-200 p-2">
                <div className="text-xs font-semibold text-slate-500 mb-1">Strategy lever</div>
                <ul className="text-xs list-disc pl-4 space-y-0.5">{p.strategyLever.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
              <p className="text-xs text-slate-500 italic">{p.notes}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* ── 3. Competitor table ────────────────────────────── */}
      <Card>
        <CardHeader
          title="2BR competitor table — live June 9, 2026"
          subtitle={`Numeric facts from staged Supabase observations (source_date ${JUNE9}, needs verification). Effective rents are estimates. Unknowns shown as unknown.`}
        />
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs text-slate-500 text-left">
                <th className="px-3 py-2">Property</th><th className="px-3 py-2">Unit / plan</th>
                <th className="px-3 py-2">Asking</th><th className="px-3 py-2">Concession</th>
                <th className="px-3 py-2">~Eff. rent</th><th className="px-3 py-2">Sqft</th>
                <th className="px-3 py-2">$/sqft</th><th className="px-3 py-2">Parking</th>
                <th className="px-3 py-2">Advantage over Baxter</th><th className="px-3 py-2">Weakness</th>
                <th className="px-3 py-2">Threat</th><th className="px-3 py-2">Confidence</th><th className="px-3 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {/* Baxter market 2x2 */}
              <tr className="border-b border-slate-100 bg-emerald-50/60 font-semibold">
                <td className="px-3 py-2">Baxter <Badge intent="good">Market-rate</Badge></td>
                <td className="px-3 py-2">2x2 A</td>
                <td className="px-3 py-2">{money(BAXTER_MARKET_2BR.askingRent)}</td>
                <td className="px-3 py-2 text-xs">~1 mo (verify)</td>
                <td className="px-3 py-2">{money(marketEff)}</td>
                <td className="px-3 py-2">{BAXTER_MARKET_2BR.sqft}</td>
                <td className="px-3 py-2">{psf(BAXTER_MARKET_2BR.askingRent, BAXTER_MARKET_2BR.sqft)}</td>
                <td className="px-3 py-2 text-xs">Garage (cost unconfirmed)</td>
                <td className="px-3 py-2 text-xs text-slate-500" colSpan={2}>— subject —</td>
                <td className="px-3 py-2">—</td>
                <td className="px-3 py-2"><ConfBadge c="medium" /></td>
                <td className="px-3 py-2"><Badge intent="warn">official site · verify</Badge></td>
              </tr>
              {/* Baxter Unit 105 */}
              <tr className="border-b border-slate-100 bg-amber-50/60 font-semibold">
                <td className="px-3 py-2">Baxter <Badge intent="warn">Restricted (likely)</Badge></td>
                <td className="px-3 py-2">Unit 105</td>
                <td className="px-3 py-2">{money(restrictedAsk)}</td>
                <td className="px-3 py-2 text-xs">1 mo free / 13 mo</td>
                <td className="px-3 py-2">{money(restrictedEff)}</td>
                <td className="px-3 py-2">{restrictedSqft}</td>
                <td className="px-3 py-2">{psf(restrictedAsk, restrictedSqft)}</td>
                <td className="px-3 py-2 text-xs">Paid garage</td>
                <td className="px-3 py-2 text-xs" colSpan={2}>⚠ Income-qualified — not a head-to-head market comp. Patio + side yard + den.</td>
                <td className="px-3 py-2">—</td>
                <td className="px-3 py-2"><ConfBadge c="medium" /></td>
                <td className="px-3 py-2"><Badge intent="bad">confirm restriction</Badge></td>
              </tr>
              {/* June 9 competitors */}
              {JUNE9_COMP_ANALYSIS.map(c => {
                const o = june9Obs.get(c.competitorId);
                const ask = o?.askingRent ? Number(o.askingRent) : undefined;
                const eff = ask ? effectiveRentWeeks(ask, c.freeWeeks) : undefined;
                return (
                  <tr key={c.competitorId} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium">{c.displayName}</td>
                    <td className="px-3 py-2 text-xs">{o?.unitNumber ?? "unknown"}</td>
                    <td className="px-3 py-2">{ask ? <span>{money(ask)}<span className="text-xs text-slate-400 block">{c.rentRange}</span></span> : "unknown"}</td>
                    <td className="px-3 py-2 text-xs">{c.freeWeeksLabel}</td>
                    <td className="px-3 py-2">{eff ? <span>{money(eff)}<span className="text-[10px] text-slate-400 block">est.</span></span> : "unknown"}</td>
                    <td className="px-3 py-2">{o?.squareFeet ?? "unknown"}</td>
                    <td className="px-3 py-2">{psf(ask, o?.squareFeet)}</td>
                    <td className="px-3 py-2 text-xs">{c.parkingLabel}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{c.advantage}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{c.weakness}</td>
                    <td className="px-3 py-2">{c.threat}/5</td>
                    <td className="px-3 py-2"><ConfBadge c={c.confidence} /></td>
                    <td className="px-3 py-2"><Badge intent="warn">{o ? "staged · needs verify" : "not staged"}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {/* ── 4. Effective rent calculator ───────────────────── */}
      <EffectiveRentCalculator marketAsk={BAXTER_MARKET_2BR.askingRent} marketEff={marketEff} />

      {/* ── 5 & 6. Why them / why Baxter ───────────────────── */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Why renters pick competitors" subtitle="June 9 research + inference — each with a counter and owner action" />
          <CardBody className="space-y-2 max-h-[28rem] overflow-y-auto">
            {JUNE9_COMP_ANALYSIS.map(c => <CompCard key={c.competitorId} c={c} />)}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Why renters pick Baxter" subtitle="Advantages to lead with — sources labeled" />
          <CardBody className="space-y-2 text-sm">
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
              <div className="font-semibold text-emerald-900 text-sm">Market-rate 2x2 A</div>
              <ul className="text-xs text-slate-700 list-disc pl-4 mt-1 space-y-1">
                <li><strong>Bigger than rivals&apos; entry 2BRs</strong> — 1,122 sqft vs Modera 843–1,023 and Hanover Plan P 1,035 <span className="text-slate-400">[June 9 listings]</span>.</li>
                <li><strong>Full amenity stack</strong> — rooftop sun deck + fireplace, gym, social lounge, coffee bar, outdoor kitchen, EV charging, controlled-access garage, bike storage, in-unit full-size W/D, Nest, smart appliances <span className="text-slate-400">[official site — verify list current]</span>. The &quot;amenity-light&quot; assumption was wrong.</li>
                <li><strong>Beats Avenue on effective rent</strong> the moment we run any concession (they offer none).</li>
              </ul>
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <div className="font-semibold text-amber-900 text-sm">Restricted Unit 105 <span className="font-normal text-xs">(for income-qualified applicants)</span></div>
              <ul className="text-xs text-slate-700 list-disc pl-4 mt-1 space-y-1">
                <li><strong>Exceptional value for eligible renters</strong> — {money(restrictedAsk)} / {restrictedSqft} sqft with the same building amenities <span className="text-slate-400">[internal]</span>.</li>
                <li><strong>Private patio + side yard + den</strong>, ground-floor private entry — outdoor space no price-band comp clearly matches <span className="text-slate-400">[internal]</span>.</li>
                <li>Winning here = faster eligible-applicant pipeline + LAHD paperwork readiness, not price.</li>
              </ul>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* ── 7. Owner action plan ───────────────────────────── */}
      <Card>
        <CardHeader title="Owner action plan" subtitle="Ranked by ROI / urgency — recommendations, not commitments" />
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100 text-xs text-slate-500 text-left">
              <th className="px-3 py-2">#</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Problem it solves</th>
              <th className="px-3 py-2">Impact</th><th className="px-3 py-2">Cost</th><th className="px-3 py-2">Urgency</th>
              <th className="px-3 py-2">Confidence</th><th className="px-3 py-2">Owner decision needed</th>
            </tr></thead>
            <tbody>
              {OWNER_ACTION_PLAN.map((a, i) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                  <td className="px-3 py-2 font-medium">{a.action}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{a.problem}</td>
                  <td className="px-3 py-2"><Badge intent={a.impact === "High" ? "good" : "info"}>{a.impact}</Badge></td>
                  <td className="px-3 py-2 text-xs">{a.cost}</td>
                  <td className="px-3 py-2"><Badge intent={a.urgency === "Now" ? "bad" : a.urgency === "Soon" ? "warn" : "neutral"}>{a.urgency}</Badge></td>
                  <td className="px-3 py-2 text-xs">{a.confidence}</td>
                  <td className="px-3 py-2 text-xs font-medium text-sky-700">{a.decision}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {/* ── 8. Marketing / conversion ideas ────────────────── */}
      <Card>
        <CardHeader title="How Baxter can use this — marketing & conversion playbook" subtitle="Practical ideas for ownership + leasing staff (recommendations)" />
        <CardBody className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {MARKETING_IDEAS.map(g => (
            <div key={g.title} className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs font-semibold text-slate-500 mb-1">{g.title}</div>
              <ul className="text-xs text-slate-700 list-disc pl-4 space-y-1">{g.items.map((it, i) => <li key={i}>{it}</li>)}</ul>
            </div>
          ))}
        </CardBody>
      </Card>

      {/* ── 9. Conflicts + verification queue ──────────────── */}
      <Card>
        <CardHeader
          title={`Open conflicts & verification items (${twoBrConflicts.length + twoBrVq.length})`}
          subtitle="These MUST be resolved before final pricing decisions. Old values were preserved — nothing was overwritten."
        />
        <CardBody className="space-y-2">
          {loading && <div className="text-xs text-slate-400">Loading from Supabase…</div>}
          {!loading && twoBrConflicts.length === 0 && twoBrVq.length === 0 && (
            <div className="text-xs text-slate-400">No open June 9 conflicts or verification items found.</div>
          )}
          {twoBrConflicts.map(c => (
            <div key={c.id} className="rounded-md border border-rose-200 bg-rose-50/50 p-3 text-xs">
              <div className="font-semibold text-rose-800">⚑ {c.entityName ?? c.entityId} — {c.fieldKey}</div>
              <div className="grid md:grid-cols-2 gap-2 mt-1">
                <div className="rounded bg-white border border-slate-200 p-2"><span className="text-slate-400">A · {c.sourceALabel}:</span> {c.sourceAValue}</div>
                <div className="rounded bg-white border border-slate-200 p-2"><span className="text-slate-400">B · {c.sourceBLabel}:</span> {c.sourceBValue}</div>
              </div>
              {c.notes && <p className="text-slate-600 mt-1">{c.notes}</p>}
            </div>
          ))}
          {twoBrVq.map(v => (
            <div key={v.id} className="rounded-md border border-amber-200 bg-amber-50/50 p-3 text-xs">
              <div className="font-semibold text-amber-800">⏳ {v.entityName ?? v.entityId} — {v.fieldLabel ?? v.fieldKey} <Badge intent="warn">{v.status}</Badge></div>
              {v.expectedValue && <div className="text-slate-600 mt-0.5"><strong>Expected:</strong> {v.expectedValue}</div>}
              {v.reason && <p className="text-slate-600 mt-0.5">{v.reason}</p>}
            </div>
          ))}
        </CardBody>
      </Card>

      {/* ── 10. Meeting notes / research card ──────────────── */}
      <Card>
        <CardHeader title={MEETING_NOTES_SUMMARY.title} subtitle={`Source: June 9, 2026 live-listing research · file: ${MEETING_NOTES_SUMMARY.file}`} />
        <CardBody className="space-y-2 text-sm">
          <ul className="text-xs text-slate-700 list-disc pl-4 space-y-1">
            {MEETING_NOTES_SUMMARY.keyFindings.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
          <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            ⚠ {MEETING_NOTES_SUMMARY.warning}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function CompCard({ c }: { c: June9CompAnalysis }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
        {c.displayName} <span className="text-xs text-slate-400">threat {c.threat}/5</span> <ConfBadge c={c.confidence} />
      </div>
      <p className="text-xs text-slate-600 mt-1"><strong>Why they win:</strong> {c.whyTheyWin}</p>
      <p className="text-xs text-slate-600 mt-1"><strong>Counter:</strong> {c.howToCounter}</p>
      <p className="text-xs text-sky-700 mt-1"><strong>Owner action:</strong> {c.ownerAction}</p>
      <p className="text-[10px] text-slate-400 mt-1">Source: June 9 2026 live-listing research (staged, needs verification)</p>
    </div>
  );
}

function EffectiveRentCalculator({ marketAsk, marketEff }: { marketAsk: number; marketEff: number }) {
  const [ask, setAsk] = useState(marketAsk);
  const [freeWeeks, setFreeWeeks] = useState(6);
  const [lease, setLease] = useState(12);
  const [parkingCost, setParkingCost] = useState(0);

  const eff = effectiveRentWeeks(ask, freeWeeks, lease);
  const allIn = eff + (parkingCost > 0 ? parkingCost : 0);
  const value = concessionValue(ask, freeWeeks);
  const deltaVsBaxter = eff - marketEff;

  return (
    <Card>
      <CardHeader
        title="Effective rent / concession calculator"
        subtitle="effective = asking × ((lease mo × 4.345 − free weeks) ÷ (lease mo × 4.345)) — estimates only"
      />
      <CardBody className="grid md:grid-cols-2 gap-4 text-sm">
        <div className="space-y-2">
          <label className="block text-xs">Asking rent $<input type="number" value={ask} onChange={e => setAsk(+e.target.value)} className="ml-1 w-28 border rounded px-1 py-0.5" /></label>
          <label className="block text-xs">Free weeks <input type="number" value={freeWeeks} step={0.5} onChange={e => setFreeWeeks(+e.target.value)} className="ml-1 w-20 border rounded px-1 py-0.5" /></label>
          <label className="block text-xs">Lease months <input type="number" value={lease} onChange={e => setLease(+e.target.value)} className="ml-1 w-20 border rounded px-1 py-0.5" /></label>
          <label className="block text-xs">Parking $/mo (if known) <input type="number" value={parkingCost} onChange={e => setParkingCost(+e.target.value)} className="ml-1 w-20 border rounded px-1 py-0.5" /></label>
        </div>
        <div className="space-y-2">
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
            <div className="text-xs text-slate-500">Effective monthly rent</div>
            <div className="text-xl font-bold text-sky-800">{fmtMoney(eff)}{parkingCost > 0 && <span className="text-sm font-normal text-slate-500"> · {fmtMoney(allIn)} all-in w/ parking</span>}</div>
            <div className="text-xs text-slate-500 mt-1">Concession value ≈ {fmtMoney(value)} over the lease.</div>
          </div>
          <div className={`rounded-lg border p-3 ${deltaVsBaxter < 0 ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
            <div className="text-xs text-slate-500">vs Baxter market 2x2 (~{fmtMoney(marketEff)} effective)</div>
            <div className="text-lg font-bold">{deltaVsBaxter === 0 ? "even" : `${deltaVsBaxter > 0 ? "+" : ""}${fmtMoney(deltaVsBaxter)}/mo`}</div>
            <div className="text-xs text-slate-500">{deltaVsBaxter < 0 ? "This scenario undercuts our market 2x2 — concession response may be needed." : "Our market 2x2 effective rent beats this scenario."}</div>
          </div>
          <p className="text-[11px] text-amber-700">⚠ Estimates from advertised specials. Call/tour-confirm a competitor&apos;s real quote before final pricing changes.</p>
        </div>
      </CardBody>
    </Card>
  );
}
