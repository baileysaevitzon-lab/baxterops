"use client";
import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { COMPETITORS as SEED_COMPETITORS, WALKTHROUGH_TOURS } from "@/lib/seed";
import { useCompetitors } from "@/lib/hooks/useCompetitors";
import { compositeBand, compositeScore, deleteTour, loadTours, upsertTour } from "@/lib/storage";
import { loadAllFieldTours, saveFieldTour } from "@/lib/services/fieldTours";
import { QuickTourScorePanel } from "@/components/scoring/QuickTourScorePanel";
import { LiveDataBanner } from "@/components/LiveDataBanner";
import type { CompetitorFieldTour, WalkthroughTourRecord } from "@/lib/types";

const CALL_SCRIPT = `Hi, I'm looking for a 1-bedroom apartment in Hollywood and hoping to move within the next month. I saw your building online and wanted to ask what availability and specials you currently have. Are you offering any free rent, look-and-lease specials, or parking concessions right now? Could I schedule a tour?`;

const IN_PERSON_SCRIPT = `I'm comparing a few buildings in Hollywood and trying to understand the real monthly cost. What's the best deal available right now if I applied this week?`;

const QUESTIONS = [
  "What units are available now?",
  "What is the best price you can do?",
  "Are there any specials not listed online?",
  "How many weeks free?",
  "Is there a look-and-lease bonus?",
  "Can parking be included or discounted?",
  "Are admin/application fees waived?",
  "How many units do you have vacant?",
  "How fast are units leasing?",
  "Are prices negotiable?",
  "What lease terms get the best deal?",
  "Is this price net effective or gross?",
  "What is the exact monthly rent after concession?",
  "What is the move-in cost?",
  "Are utilities billed separately?",
  "What is the average utility cost?",
  "What makes this building better than others nearby?",
];

const blankTour = (compId = SEED_COMPETITORS[0].id): WalkthroughTourRecord => ({
  id: `wt-${Date.now()}`,
  competitorId: compId,
  competitorName: SEED_COMPETITORS.find(c => c.id === compId)?.name ?? "",
  assignedTo: "Bailey",
  tourDateTime: new Date().toISOString().slice(0, 16),
  leasingAgentName: "",
  tourBookingEase: 3,
  responseSpeedHours: undefined,
  kindness: 3,
  professionalism: 3,
  cleanliness: 3,
  tourQuality: 3,
  buildingFirstImpression: "",
  unitFirstImpression: "",
  amenityQuality: 3,
  drinksOrSnacksOffered: false,
  actualConcessions: "",
  hiddenDiscounts: "",
  parkingDeal: "",
  feesWaivable: false,
  moveInCost: "",
  pressureLevel: "medium",
  desperationVsConfidence: 3,
  closingStrength: 3,
  followUpPromised: false,
  followUpReceived: false,
  photoIds: [],
  wouldRenterChooseOverBaxter: false,
  whyOrWhyNot: "",
  baxterResponseRecommendation: "",
  compositeExperienceScore: 3,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

function recomputeComposite(t: WalkthroughTourRecord): WalkthroughTourRecord {
  return {
    ...t,
    compositeExperienceScore: compositeScore([
      t.tourBookingEase,
      t.kindness,
      t.professionalism,
      t.cleanliness,
      t.tourQuality,
      t.amenityQuality,
      t.desperationVsConfidence,
      t.closingStrength,
    ]),
  };
}

export default function Walkthroughs() {
  // Sprint 12: live competitor list from Supabase
  const { competitors: COMPETITORS } = useCompetitors();

  const [showScript, setShowScript] = useState(false);
  const [draft, setDraft] = useState<WalkthroughTourRecord>(blankTour());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tours, setTours] = useState<WalkthroughTourRecord[]>([]);
  const [serviceFieldTours, setServiceFieldTours] = useState<CompetitorFieldTour[]>([]);
  const [gradingTourId, setGradingTourId] = useState<string | null>(null);

  useEffect(() => {
    setTours(loadTours());
    (async () => {
      // small delay to let the Zen bootstrap seed before first read
      await new Promise(r => setTimeout(r, 50));
      const all = await loadAllFieldTours();
      setServiceFieldTours(all);

      // Sprint 12: one-time best-effort backfill — push any locally-stored
      // walkthrough tours up to Supabase so they appear on other devices.
      // Non-fatal: if Supabase is down or RLS blocks the write, silently skip.
      const localTours = loadTours();
      for (const lt of localTours) {
        const alreadyInDb = all.some(s => s.id === lt.id);
        if (alreadyInDb) continue;
        try {
          const compName = COMPETITORS.find(c => c.id === lt.competitorId)?.name ?? lt.competitorName;
          await saveFieldTour({
            id: lt.id,
            competitorId: lt.competitorId,
            competitorName: compName,
            tourDate: (lt.tourDateTime ?? new Date().toISOString()).slice(0, 10),
            collectedBy: lt.assignedTo ?? "Bailey",
            assignedTo: lt.assignedTo ?? "Bailey",
            tourStatus: "completed",
            sourceLabel: `${lt.assignedTo ?? "Bailey"} walkthrough — backfill`,
            tourBookingEase: lt.tourBookingEase ?? 3,
            kindness: lt.kindness ?? 3,
            professionalism: lt.professionalism ?? 3,
            cleanliness: lt.cleanliness ?? 3,
            tourQuality: lt.tourQuality ?? 3,
            amenityQuality: lt.amenityQuality ?? 3,
            pressureLevel: "medium",
            compositeExperienceScore: lt.compositeExperienceScore,
            fieldConfidence: "medium",
            createdAt: lt.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        } catch {
          // not signed in — backfill will retry next visit
        }
      }
      // refresh after backfill
      const refreshed = await loadAllFieldTours();
      setServiceFieldTours(refreshed);
    })();
  }, [COMPETITORS]);

  function patch<K extends keyof WalkthroughTourRecord>(k: K, v: WalkthroughTourRecord[K]) {
    setDraft(d => recomputeComposite({ ...d, [k]: v, updatedAt: new Date().toISOString() }));
  }

  async function save() {
    const compName = COMPETITORS.find(c => c.id === draft.competitorId)?.name ?? draft.competitorName;
    const next = recomputeComposite({ ...draft, competitorName: compName, updatedAt: new Date().toISOString() });

    // 1. Write to localStorage (backward compat — keeps existing cards working)
    setTours(upsertTour(next));

    // 2. Sprint 11: also write to Supabase competitor_field_tours so other devices see it.
    //    Map WalkthroughTourRecord → CompetitorFieldTour.
    try {
      const now = new Date().toISOString();
      const fieldTour: CompetitorFieldTour = {
        id: next.id,
        competitorId: next.competitorId,
        competitorName: next.competitorName,
        tourDate: next.tourDateTime
          ? next.tourDateTime.slice(0, 10)
          : now.slice(0, 10),
        collectedBy: next.assignedTo ?? "Bailey",
        assignedTo: next.assignedTo ?? "Bailey",
        tourStatus: "completed",
        sourceLabel: `${next.assignedTo ?? "Bailey"} walkthrough — ${next.tourDateTime?.slice(0, 10) ?? now.slice(0, 10)}`,
        tourBookingEase: next.tourBookingEase,
        kindness: next.kindness,
        professionalism: next.professionalism,
        cleanliness: next.cleanliness,
        tourQuality: next.tourQuality,
        amenityQuality: next.amenityQuality,
        pressureLevel: next.pressureLevel ?? "medium",
        actualConcessions: next.actualConcessions ?? undefined,
        hiddenDiscounts: next.hiddenDiscounts ?? undefined,
        parkingDeal: next.parkingDeal ?? undefined,
        moveInCost: next.moveInCost ?? undefined,
        whyOrWhyNot: next.whyOrWhyNot ?? undefined,
        baxterResponseRecommendation: next.baxterResponseRecommendation ?? undefined,
        compositeExperienceScore: next.compositeExperienceScore,
        wouldRenterChooseOverBaxter: next.wouldRenterChooseOverBaxter ?? false,
        drinksOrSnacksOffered: next.drinksOrSnacksOffered ?? false,
        feesWaivable: next.feesWaivable ?? false,
        followUpPromised: next.followUpPromised ?? false,
        followUpReceived: next.followUpReceived ?? false,
        desperationVsConfidence: next.desperationVsConfidence ?? undefined,
        closingStrength: next.closingStrength ?? undefined,
        fieldConfidence: "high",
        createdAt: next.createdAt,
        updatedAt: now,
      };
      await saveFieldTour(fieldTour);
      // Refresh service field tours list
      const refreshed = await loadAllFieldTours();
      setServiceFieldTours(refreshed);
    } catch (e) {
      // Non-fatal — localStorage write succeeded. Log and continue.
      console.warn("[walkthrough-campaigns] Supabase write failed (tour still saved locally):", e);
    }

    setDraft(blankTour());
    setEditingId(null);
  }

  function edit(t: WalkthroughTourRecord) {
    setDraft(t);
    setEditingId(t.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function remove(id: string) {
    if (!confirm("Delete this tour record?")) return;
    setTours(deleteTour(id));
    if (editingId === id) { setDraft(blankTour()); setEditingId(null); }
  }

  function cancelEdit() { setDraft(blankTour()); setEditingId(null); }

  // Priority queue with saved-score injection (local + service)
  const tourScoreByCompetitor = new Map<string, number>();
  for (const t of tours) {
    const cur = tourScoreByCompetitor.get(t.competitorId) ?? 0;
    if (t.compositeExperienceScore > cur) tourScoreByCompetitor.set(t.competitorId, t.compositeExperienceScore);
  }
  for (const t of serviceFieldTours) {
    if (!t.compositeExperienceScore) continue;
    const cur = tourScoreByCompetitor.get(t.competitorId) ?? 0;
    if (t.compositeExperienceScore > cur) tourScoreByCompetitor.set(t.competitorId, t.compositeExperienceScore);
  }
  const prioritized = [...COMPETITORS]
    .map(c => {
      const tour = WALKTHROUGH_TOURS.find(t => t.competitorId === c.id);
      const savedScore = tourScoreByCompetitor.get(c.id);
      const score =
        (c.compQualityScore ?? 50) +
        (c.distanceMiles && c.distanceMiles < 0.3 ? 10 : 0) +
        (c.toursLastWeek === undefined ? 5 : 0);
      return { c, tour, score, savedScore };
    })
    .sort((a, b) => b.score - a.score);

  return (
    <>
      <LiveDataBanner />
      <PageHeader
        title="Walkthrough Campaigns"
        subtitle="Tour Plan Generator · post-tour records · Quick Tour Grading. Saved tours and scores survive refresh."
        action={
          <button onClick={() => setShowScript(s => !s)} className="px-3 py-2 text-sm rounded-md bg-slate-900 text-white">
            {showScript ? "Hide" : "Show"} scripts
          </button>
        }
      />

      {showScript && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <Card>
            <CardHeader title="Phone screening script" />
            <CardBody><pre className="whitespace-pre-wrap text-sm bg-slate-50 p-3 rounded-md">{CALL_SCRIPT}</pre></CardBody>
          </Card>
          <Card>
            <CardHeader title="In-person opener" />
            <CardBody><pre className="whitespace-pre-wrap text-sm bg-slate-50 p-3 rounded-md">{IN_PERSON_SCRIPT}</pre></CardBody>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="17-question checklist" />
            <CardBody>
              <ol className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-sm list-decimal pl-5">
                {QUESTIONS.map(q => <li key={q}>{q}</li>)}
              </ol>
            </CardBody>
          </Card>
        </div>
      )}

      <Card className="mb-6">
        <CardHeader title="Tour priority queue" subtitle="Sorted by comp quality + missing-data signal. Saved walkthrough scores merge in." />
        <CardBody className="p-0">
          <table className="bx">
            <thead>
              <tr>
                <th>#</th><th>Property</th><th>Distance</th><th>Comp quality</th>
                <th>Threat</th><th>Saved score</th><th>Persona</th>
              </tr>
            </thead>
            <tbody>
              {prioritized.map(({ c, tour, savedScore }, i) => (
                <tr key={c.id}>
                  <td className="font-medium">{i + 1}</td>
                  <td>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-slate-500">☎ {c.phone ?? "—"}</div>
                  </td>
                  <td>{c.distanceMiles ?? "—"} mi</td>
                  <td><Badge intent={c.compQualityScore && c.compQualityScore >= 80 ? "bad" : "warn"}>{c.compQualityScore ?? "—"}</Badge></td>
                  <td>{c.threatLevel ?? "—"}/5</td>
                  <td>
                    {savedScore ? (
                      <Badge intent={savedScore >= 4 ? "good" : savedScore >= 3 ? "warn" : "bad"}>
                        {savedScore.toFixed(1)} · {compositeBand(savedScore)}
                      </Badge>
                    ) : <span className="text-xs text-slate-400">no tour yet</span>}
                  </td>
                  <td className="text-xs text-slate-500">{tour?.persona ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader
          title={editingId ? "Edit tour record" : "Log a new walkthrough"}
          subtitle={`Composite score: ${draft.compositeExperienceScore.toFixed(1)} · ${compositeBand(draft.compositeExperienceScore)}`}
          action={editingId ? <button onClick={cancelEdit} className="text-xs text-slate-500 underline">cancel edit</button> : undefined}
        />
        <CardBody>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
            <Field label="Competitor">
              <select value={draft.competitorId} onChange={e => patch("competitorId", e.target.value)} className="w-full border rounded-md px-3 py-1.5">
                {COMPETITORS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Assigned to">
              <select value={draft.assignedTo} onChange={e => patch("assignedTo", e.target.value as WalkthroughTourRecord["assignedTo"])} className="w-full border rounded-md px-3 py-1.5">
                <option>Bailey</option><option>Shane</option><option>Other</option>
              </select>
            </Field>
            <Field label="Tour date/time">
              <input type="datetime-local" value={draft.tourDateTime} onChange={e => patch("tourDateTime", e.target.value)} className="w-full border rounded-md px-3 py-1.5" />
            </Field>
            <Field label="Leasing agent">
              <input value={draft.leasingAgentName ?? ""} onChange={e => patch("leasingAgentName", e.target.value)} className="w-full border rounded-md px-3 py-1.5" />
            </Field>
            <Field label="Response speed (hours)">
              <input type="number" value={draft.responseSpeedHours ?? ""} onChange={e => patch("responseSpeedHours", parseInt(e.target.value) || undefined)} className="w-full border rounded-md px-3 py-1.5" />
            </Field>
            <Field label="Pressure level">
              <select value={draft.pressureLevel ?? "medium"} onChange={e => patch("pressureLevel", e.target.value as "low" | "medium" | "high")} className="w-full border rounded-md px-3 py-1.5">
                <option>low</option><option>medium</option><option>high</option>
              </select>
            </Field>
          </div>

          <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Rating label="Booking ease" value={draft.tourBookingEase} onChange={v => patch("tourBookingEase", v)} />
            <Rating label="Kindness" value={draft.kindness} onChange={v => patch("kindness", v)} />
            <Rating label="Professionalism" value={draft.professionalism} onChange={v => patch("professionalism", v)} />
            <Rating label="Cleanliness" value={draft.cleanliness} onChange={v => patch("cleanliness", v)} />
            <Rating label="Tour quality" value={draft.tourQuality} onChange={v => patch("tourQuality", v)} />
            <Rating label="Amenity quality" value={draft.amenityQuality} onChange={v => patch("amenityQuality", v)} />
            <Rating label="Desperation→Confidence" value={draft.desperationVsConfidence ?? 3} onChange={v => patch("desperationVsConfidence", v)} />
            <Rating label="Closing strength" value={draft.closingStrength ?? 3} onChange={v => patch("closingStrength", v)} />
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3 text-sm">
            <Field label="Building first impression">
              <textarea value={draft.buildingFirstImpression} onChange={e => patch("buildingFirstImpression", e.target.value)} className="w-full border rounded-md px-3 py-1.5" rows={2} />
            </Field>
            <Field label="Unit first impression">
              <textarea value={draft.unitFirstImpression} onChange={e => patch("unitFirstImpression", e.target.value)} className="w-full border rounded-md px-3 py-1.5" rows={2} />
            </Field>
            <Field label="Actual concessions offered">
              <input value={draft.actualConcessions ?? ""} onChange={e => patch("actualConcessions", e.target.value)} className="w-full border rounded-md px-3 py-1.5" />
            </Field>
            <Field label="Hidden discounts">
              <input value={draft.hiddenDiscounts ?? ""} onChange={e => patch("hiddenDiscounts", e.target.value)} className="w-full border rounded-md px-3 py-1.5" />
            </Field>
            <Field label="Parking deal">
              <input value={draft.parkingDeal ?? ""} onChange={e => patch("parkingDeal", e.target.value)} className="w-full border rounded-md px-3 py-1.5" />
            </Field>
            <Field label="Move-in cost">
              <input value={draft.moveInCost ?? ""} onChange={e => patch("moveInCost", e.target.value)} className="w-full border rounded-md px-3 py-1.5" />
            </Field>
          </div>

          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.drinksOrSnacksOffered} onChange={e => patch("drinksOrSnacksOffered", e.target.checked)} />
              Drinks / snacks offered
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.feesWaivable ?? false} onChange={e => patch("feesWaivable", e.target.checked)} />
              Fees waivable
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.followUpPromised ?? false} onChange={e => patch("followUpPromised", e.target.checked)} />
              Follow-up promised
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.followUpReceived ?? false} onChange={e => patch("followUpReceived", e.target.checked)} />
              Follow-up received
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.wouldRenterChooseOverBaxter} onChange={e => patch("wouldRenterChooseOverBaxter", e.target.checked)} />
              Would a real renter choose this over Baxter?
            </label>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3 text-sm">
            <Field label="Why or why not?">
              <textarea value={draft.whyOrWhyNot} onChange={e => patch("whyOrWhyNot", e.target.value)} className="w-full border rounded-md px-3 py-1.5" rows={2} />
            </Field>
            <Field label="Baxter response recommendation">
              <textarea value={draft.baxterResponseRecommendation} onChange={e => patch("baxterResponseRecommendation", e.target.value)} className="w-full border rounded-md px-3 py-1.5" rows={2} />
            </Field>
          </div>

          <div className="mt-4 text-xs text-slate-500 italic">
            Photo attachment placeholder — wire to /photos-amenities in v2.
          </div>

          <button onClick={save} className="mt-4 px-4 py-2 bg-slate-900 text-white rounded-md text-sm">
            {editingId ? "Update tour record" : "Save tour record"}
          </button>
        </CardBody>
      </Card>

      {serviceFieldTours.length > 0 && (
        <Card className="mb-6">
          <CardHeader
            title={`Service-layer field tours · ${serviceFieldTours.length}`}
            subtitle="Click Grade / Edit on any row for the 19-covariate scoring panel."
          />
          <CardBody className="p-0">
            <table className="bx">
              <thead>
                <tr><th>Competitor</th><th>Date</th><th>Collected by</th><th>Composite</th><th>Renter choice</th><th>Hidden discounts</th><th></th></tr>
              </thead>
              <tbody>
                {serviceFieldTours.flatMap(t => [(
                    <tr key={t.id}>
                      <td className="font-medium">{t.competitorName}</td>
                      <td className="text-xs">{t.tourDate}</td>
                      <td>{t.collectedBy}</td>
                      <td>
                        <Badge intent={(t.compositeExperienceScore ?? 0) >= 4 ? "good" : "warn"}>
                          {t.compositeExperienceScore?.toFixed(1) ?? "—"} · {compositeBand(t.compositeExperienceScore ?? 0)}
                        </Badge>
                      </td>
                      <td className="text-xs">{t.wouldRenterChooseOverBaxter ? "competitor" : "Baxter"}</td>
                      <td className="text-xs max-w-xs">{t.hiddenDiscounts ?? "—"}</td>
                      <td className="text-right whitespace-nowrap">
                        <button
                          onClick={() => setGradingTourId(gradingTourId === t.id ? null : t.id)}
                          className="text-xs px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-600 text-white font-medium mr-2"
                        >
                          {gradingTourId === t.id ? "Close grading" : "Grade / Edit Tour ★"}
                        </button>
                        {t.competitorId === "c-zen-hollywood" && (
                          <a href="/competitors/zen-hollywood" className="text-xs text-sky-700 underline">open Zen detail →</a>
                        )}
                      </td>
                    </tr>
                  ),
                  gradingTourId === t.id ? (
                    <tr key={t.id + "-grade"}>
                      <td colSpan={7} className="p-4 bg-slate-50 border-t border-amber-200">
                        <QuickTourScorePanel
                          fieldTourId={t.id}
                          competitorId={t.competitorId}
                          competitorName={t.competitorName}
                        />
                      </td>
                    </tr>
                  ) : null,
                ])}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={`Completed tours · ${tours.length}`} subtitle="Persisted in localStorage. Refresh to confirm." />
        <CardBody className="p-0">
          {tours.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No tours saved yet. Fill out the form above and click Save.</p>
          ) : (
            <table className="bx">
              <thead>
                <tr>
                  <th>Competitor</th><th>Date</th><th>Assigned</th><th>Composite</th>
                  <th>Hidden concessions</th><th>Renter choice</th><th>Recommendation</th><th></th>
                </tr>
              </thead>
              <tbody>
                {tours.map(t => (
                  <tr key={t.id}>
                    <td className="font-medium">{t.competitorName}</td>
                    <td className="text-xs">{t.tourDateTime?.replace("T", " ")}</td>
                    <td>{t.assignedTo}</td>
                    <td>
                      <Badge intent={t.compositeExperienceScore >= 4 ? "good" : t.compositeExperienceScore >= 3 ? "warn" : "bad"}>
                        {t.compositeExperienceScore.toFixed(1)} · {compositeBand(t.compositeExperienceScore)}
                      </Badge>
                    </td>
                    <td className="text-xs max-w-xs">{t.hiddenDiscounts ?? "—"}</td>
                    <td className="text-xs">{t.wouldRenterChooseOverBaxter ? "competitor" : "Baxter"}</td>
                    <td className="text-xs max-w-sm">{t.baxterResponseRecommendation}</td>
                    <td className="text-right whitespace-nowrap">
                      <button onClick={() => edit(t)} className="text-xs text-sky-700 underline mr-3">edit</button>
                      <button onClick={() => remove(t.id)} className="text-xs text-rose-700 underline">delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-slate-500">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Rating({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-500">{label}</span>
        <span className="font-medium">{value}/5</span>
      </div>
      <input type="range" min={1} max={5} step={1} value={value} onChange={e => onChange(parseInt(e.target.value))} className="w-full" />
    </div>
  );
}
