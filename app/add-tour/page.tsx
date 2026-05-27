"use client";
// Sprint 8 — Generic Add Tour form.
//
// Replaces the "hand-code a seed sprint per new property" workflow. Bailey enters
// a brand-new competitor inline, fills tour metadata + scores, adds 1+ observed
// units and amenities, and one submit writes everything via the existing services:
//   - competitor_field_tours (CompetitorFieldTour)
//   - competitor_unit_observations (CompetitorUnitObservation)
//   - competitor_amenity_observations (CompetitorAmenityObservation)
//   - data_source_ledger (one row per recorded number, via bulkUpsertLedger)
//
// IMPORTANT: this form does NOT mutate the in-bundle COMPETITORS array. Newly
// added properties show up in Supabase-backed views (Field Tour Database,
// Competitor Intelligence) but the legacy /competitors marketing cards still
// pull from seed.ts. That's intentional — seed.ts stays the canonical
// "snapshot at sprint time," and live tours layer on top.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { saveFieldTour } from "@/lib/services/fieldTours";
import { bulkUpsertObservedUnits } from "@/lib/services/competitorUnits";
import { bulkUpsertAmenityObservations } from "@/lib/services/amenityObservations";
import { bulkUpsertLedger } from "@/lib/services/sourceLedger";
import { useRole } from "@/components/RoleProvider";
import type {
  CompetitorAmenityObservation,
  CompetitorFieldTour,
  CompetitorUnitObservation,
  DataSourceLedgerRow,
} from "@/lib/types";

type DraftUnit = {
  unitNumber: string;
  unitNumberConfidence: "high" | "medium" | "low" | "unknown";
  floor: string;
  bedCount: string;
  bathCount: string;
  squareFeet: string;
  askingRent: string;
  freeWeeks: string;
  leaseMonths: string;
  parkingIncluded: boolean;
  utilitiesIncluded: boolean;
  inUnitLaundry: boolean;
  balcony: boolean;
  notes: string;
};

const blankUnit = (): DraftUnit => ({
  unitNumber: "",
  unitNumberConfidence: "high",
  floor: "",
  bedCount: "",
  bathCount: "",
  squareFeet: "",
  askingRent: "",
  freeWeeks: "",
  leaseMonths: "12",
  parkingIncluded: false,
  utilitiesIncluded: false,
  inUnitLaundry: false,
  balcony: false,
  notes: "",
});

const AMENITY_OPTIONS = [
  "rooftop", "pool", "rooftop_pool", "gym", "concierge", "lounge", "coworking",
  "courtyard", "parking", "spa", "in_unit_laundry", "package_room", "doorman",
  "ev_charging", "pet_spa", "maintenance_24_7", "office_spaces",
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export default function AddTour() {
  const router = useRouter();
  const { user } = useRole();

  // Property identity
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [website, setWebsite] = useState("");
  const [strategicType, setStrategicType] = useState<"balanced_comp" | "premium_amenity_comp" | "budget_comp" | "non_comparable" | "">("");

  // Tour metadata
  const today = new Date().toISOString().slice(0, 10);
  const [tourDate, setTourDate] = useState(today);
  const [collectedBy, setCollectedBy] = useState(user.name);
  const [sourceLabel, setSourceLabel] = useState("");

  // Scores
  const [bookingEase, setBookingEase] = useState(3);
  const [kindness, setKindness] = useState(3);
  const [professionalism, setProfessionalism] = useState(3);
  const [cleanliness, setCleanliness] = useState(3);
  const [tourQuality, setTourQuality] = useState(3);
  const [amenityQuality, setAmenityQuality] = useState(3);
  const [pressureLevel, setPressureLevel] = useState<"low" | "medium" | "high">("medium");
  const [actualConcessions, setActualConcessions] = useState("");
  const [parkingDeal, setParkingDeal] = useState("");
  const [moveInCost, setMoveInCost] = useState("");
  const [whyOrWhyNot, setWhyOrWhyNot] = useState("");
  const [baxterRec, setBaxterRec] = useState("");

  // Units + amenities
  const [units, setUnits] = useState<DraftUnit[]>([blankUnit()]);
  const [amenities, setAmenities] = useState<{ amenity: string; quality: number; notes: string }[]>([]);

  // Submit state
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const competitorId = useMemo(() => (name ? `c-${slugify(name)}` : ""), [name]);
  const composite = useMemo(() => {
    const xs = [bookingEase, kindness, professionalism, cleanliness, tourQuality, amenityQuality];
    return Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10;
  }, [bookingEase, kindness, professionalism, cleanliness, tourQuality, amenityQuality]);

  function updateUnit(i: number, patch: Partial<DraftUnit>) {
    setUnits(prev => prev.map((u, idx) => (idx === i ? { ...u, ...patch } : u)));
  }
  function removeUnit(i: number) {
    setUnits(prev => prev.filter((_, idx) => idx !== i));
  }
  function addUnit() {
    setUnits(prev => [...prev, blankUnit()]);
  }
  function toggleAmenity(am: string) {
    setAmenities(prev =>
      prev.some(a => a.amenity === am)
        ? prev.filter(a => a.amenity !== am)
        : [...prev, { amenity: am, quality: 3, notes: "" }],
    );
  }
  function updateAmenityQuality(am: string, q: number) {
    setAmenities(prev => prev.map(a => (a.amenity === am ? { ...a, quality: q } : a)));
  }
  function updateAmenityNotes(am: string, n: string) {
    setAmenities(prev => prev.map(a => (a.amenity === am ? { ...a, notes: n } : a)));
  }

  async function submit() {
    setError(null);
    if (!name.trim()) { setError("Property name is required."); return; }
    if (!address.trim()) { setError("Address is required (mark unknown if you don't have it yet)."); return; }
    if (!collectedBy.trim()) { setError("Collected-by (tourer) is required."); return; }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const tourId = `ft-${slugify(name)}-${tourDate}`;
      const label = sourceLabel.trim() || `${collectedBy} ${name} in-person tour — ${tourDate}`;

      const tour: CompetitorFieldTour = {
        id: tourId,
        competitorId,
        competitorName: name.trim(),
        tourDate,
        collectedBy,
        assignedTo: collectedBy,
        tourStatus: "completed",
        sourceLabel: label,
        tourBookingEase: bookingEase,
        kindness,
        professionalism,
        cleanliness,
        tourQuality,
        amenityQuality,
        pressureLevel,
        actualConcessions: actualConcessions || undefined,
        parkingDeal: parkingDeal || undefined,
        moveInCost: moveInCost || undefined,
        whyOrWhyNot: whyOrWhyNot || undefined,
        baxterResponseRecommendation: baxterRec || undefined,
        compositeExperienceScore: composite,
        fieldConfidence: "high",
        createdAt: now,
        updatedAt: now,
      };

      // Build unit observations
      const observedUnits: CompetitorUnitObservation[] = units
        .filter(u => u.unitNumber.trim() || u.askingRent.trim() || u.squareFeet.trim())
        .map((u, i) => {
          const unitNumber = u.unitNumber.trim() || `unknown-${i + 1}`;
          return {
            id: `obs-${slugify(name)}-${slugify(unitNumber)}`,
            competitorId,
            competitorName: name.trim(),
            fieldTourId: tourId,
            unitNumber,
            unitNumberConfidence: u.unitNumberConfidence,
            floor: u.floor ? Number(u.floor) : undefined,
            bedCount: u.bedCount ? Number(u.bedCount) : undefined,
            bathCount: u.bathCount ? Number(u.bathCount) : undefined,
            squareFeet: u.squareFeet ? Number(u.squareFeet) : undefined,
            askingRent: u.askingRent ? Number(u.askingRent) : undefined,
            grossRent: u.askingRent ? Number(u.askingRent) : undefined,
            leaseMonths: u.leaseMonths ? Number(u.leaseMonths) : 12,
            freeMonths: u.freeWeeks ? Math.round(Number(u.freeWeeks) / 4) : undefined,
            parkingIncluded: u.parkingIncluded,
            waterIncluded: u.utilitiesIncluded,
            powerIncluded: u.utilitiesIncluded,
            gasIncluded: u.utilitiesIncluded,
            inUnitLaundry: u.inUnitLaundry,
            balconyOrPatio: u.balcony,
            notes: u.notes || undefined,
            sourceLabel: label,
            sourceDate: tourDate,
            sourceConfidence: "high",
            needsVerification: u.unitNumberConfidence !== "high",
            createdAt: now,
            updatedAt: now,
          };
        });

      // Amenity observations
      const observedAmenities: CompetitorAmenityObservation[] = amenities.map(a => ({
        id: `amn-${slugify(name)}-${a.amenity}`,
        competitorId,
        competitorName: name.trim(),
        fieldTourId: tourId,
        amenity: a.amenity,
        observed: true,
        qualityScore: a.quality,
        notes: a.notes || undefined,
        sourceLabel: label,
        sourceDate: tourDate,
        sourceConfidence: "high",
        createdAt: now,
        updatedAt: now,
      }));

      // Ledger rows — one per numeric field on each observed unit
      const ledgerRows: DataSourceLedgerRow[] = [];
      for (const u of observedUnits) {
        const base = {
          entityType: "unit_observation",
          entityId: u.id,
          entityName: `${name.trim()} ${u.unitNumber}`,
          pageRoutes: [`/competitors/${competitorId.replace(/^c-/, "")}`, "/competitor-intelligence", "/walkthrough-campaigns"],
          sourceType: "field_tour",
          sourceName: label,
          sourceDate: tourDate,
          collectedBy,
          lastVerifiedAt: now,
          verifiedBy: collectedBy,
          verificationStatus: "verified" as const,
          confidence: "high" as const,
          entryMethod: "manual_user_entry" as const,
          requiresManualVerification: false,
          staleAfterDays: 90,
          updatedAt: now,
        };
        if (u.askingRent !== undefined) {
          ledgerRows.push({
            ...base,
            id: `led-${u.id}-rent`,
            fieldKey: "asking_rent",
            fieldLabel: "Asking rent",
            fieldCategory: "rent",
            valueType: "score",
            valueNumber: u.askingRent,
            unit: "USD",
            displayValue: `$${u.askingRent.toLocaleString()}`,
          });
        }
        if (u.squareFeet) {
          ledgerRows.push({
            ...base,
            id: `led-${u.id}-sqft`,
            fieldKey: "square_feet",
            fieldLabel: "Square feet",
            fieldCategory: "unit_spec",
            valueType: "score",
            valueNumber: u.squareFeet,
            unit: "sqft",
            displayValue: `${u.squareFeet.toLocaleString()} sqft`,
          });
        }
        if (u.bedCount !== undefined) {
          ledgerRows.push({
            ...base,
            id: `led-${u.id}-beds`,
            fieldKey: "bed_count",
            fieldLabel: "Bedrooms",
            fieldCategory: "unit_spec",
            valueType: "score",
            valueNumber: u.bedCount,
            unit: "beds",
            displayValue: `${u.bedCount}`,
          });
        }
      }
      // Ledger rows for amenities
      for (const a of observedAmenities) {
        ledgerRows.push({
          id: `led-${a.id}`,
          entityType: "competitor",
          entityId: competitorId,
          entityName: name.trim(),
          fieldKey: `amenity_${a.amenity}`,
          fieldLabel: a.amenity.replace(/_/g, " "),
          fieldCategory: "amenity",
          valueType: "boolean",
          valueBoolean: true,
          displayValue: "Yes",
          pageRoutes: [`/competitors/${competitorId.replace(/^c-/, "")}`, "/competitor-intelligence"],
          sourceType: "field_tour",
          sourceName: label,
          sourceDate: tourDate,
          collectedBy,
          lastVerifiedAt: now,
          verifiedBy: collectedBy,
          verificationStatus: "verified",
          confidence: "high",
          entryMethod: "manual_user_entry",
          requiresManualVerification: false,
          staleAfterDays: 365,
          updatedAt: now,
        });
      }

      // Write everything
      await saveFieldTour(tour);
      if (observedUnits.length > 0) await bulkUpsertObservedUnits(observedUnits);
      if (observedAmenities.length > 0) await bulkUpsertAmenityObservations(observedAmenities);
      if (ledgerRows.length > 0) await bulkUpsertLedger(ledgerRows);

      setSavedId(tourId);
    } catch (e) {
      console.error("[AddTour] failed:", e);
      setError(e instanceof Error ? e.message : "Save failed — check console.");
    } finally {
      setSaving(false);
    }
  }

  if (savedId) {
    return (
      <>
        <PageHeader title="Tour saved" subtitle={`Field tour ${savedId} written to Supabase.`} />
        <Card>
          <CardBody>
            <p className="text-sm text-slate-700 mb-4">
              <strong>{name}</strong> is now in the field-tour database. Next steps:
            </p>
            <ul className="text-sm text-slate-700 space-y-2 mb-4 list-disc pl-5">
              <li>Open <button onClick={() => router.push(`/competitors/${competitorId.replace(/^c-/, "")}`)} className="text-sky-700 underline">/competitors/{competitorId.replace(/^c-/, "")}</button> to see the tour record and grade covariates.</li>
              <li>Upload tour photos from the dashboard or the competitor detail page.</li>
              <li>Add a manual seed entry in <code>lib/seed.ts</code> only if you want this competitor to appear in the marketing-cards view on /competitors. Optional.</li>
            </ul>
            <div className="flex gap-2 text-sm">
              <button onClick={() => { setSavedId(null); setName(""); setUnits([blankUnit()]); setAmenities([]); }} className="px-3 py-2 rounded-md bg-slate-900 text-white">Log another tour</button>
              <button onClick={() => router.push("/competitor-intelligence")} className="px-3 py-2 rounded-md border border-slate-200">Go to Competitor Intelligence</button>
            </div>
          </CardBody>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Add Tour — new property"
        subtitle="Generic field-tour intake. Writes to Supabase (field tour + unit observations + amenities + source ledger) so future properties don't need a hand-coded seed sprint."
      />

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <Card className="mb-6">
        <CardHeader title="1 — Property identity" subtitle="What property did you tour? Address can be 'needs verification' if you don't have it yet." />
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Labeled label="Property name *">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="The Highland" className="w-full border rounded-md px-3 py-2" />
            </Labeled>
            <Labeled label="Generated competitor ID">
              <input value={competitorId} disabled className="w-full border rounded-md px-3 py-2 bg-slate-50 text-slate-500" />
            </Labeled>
            <Labeled label="Address *">
              <input value={address} onChange={e => setAddress(e.target.value)} placeholder="1411 N Highland Ave, Hollywood, CA 90028" className="w-full border rounded-md px-3 py-2" />
            </Labeled>
            <Labeled label="Official website (optional)">
              <input value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://..." className="w-full border rounded-md px-3 py-2" />
            </Labeled>
            <Labeled label="Strategic comp type">
              <select value={strategicType} onChange={e => setStrategicType(e.target.value as typeof strategicType)} className="w-full border rounded-md px-3 py-2">
                <option value="">— pick one —</option>
                <option value="balanced_comp">balanced comp</option>
                <option value="premium_amenity_comp">premium amenity comp (ceiling reference)</option>
                <option value="budget_comp">budget comp</option>
                <option value="non_comparable">not comparable to Baxter</option>
              </select>
            </Labeled>
          </div>
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader title="2 — Tour metadata + scores" subtitle={`Composite from 6 scored fields: ${composite.toFixed(1)} / 5`} />
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <Labeled label="Tour date">
              <input type="date" value={tourDate} onChange={e => setTourDate(e.target.value)} className="w-full border rounded-md px-3 py-2" />
            </Labeled>
            <Labeled label="Collected by *">
              <input value={collectedBy} onChange={e => setCollectedBy(e.target.value)} className="w-full border rounded-md px-3 py-2" />
            </Labeled>
            <Labeled label="Source label (optional override)">
              <input value={sourceLabel} onChange={e => setSourceLabel(e.target.value)} placeholder="auto-generated if blank" className="w-full border rounded-md px-3 py-2" />
            </Labeled>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Rating label="Booking ease" value={bookingEase} onChange={setBookingEase} />
            <Rating label="Kindness" value={kindness} onChange={setKindness} />
            <Rating label="Professionalism" value={professionalism} onChange={setProfessionalism} />
            <Rating label="Cleanliness" value={cleanliness} onChange={setCleanliness} />
            <Rating label="Tour quality" value={tourQuality} onChange={setTourQuality} />
            <Rating label="Amenity quality" value={amenityQuality} onChange={setAmenityQuality} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
            <Labeled label="Pressure level">
              <select value={pressureLevel} onChange={e => setPressureLevel(e.target.value as "low" | "medium" | "high")} className="w-full border rounded-md px-3 py-2">
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </Labeled>
            <Labeled label="Actual concessions">
              <input value={actualConcessions} onChange={e => setActualConcessions(e.target.value)} className="w-full border rounded-md px-3 py-2" />
            </Labeled>
            <Labeled label="Parking deal">
              <input value={parkingDeal} onChange={e => setParkingDeal(e.target.value)} className="w-full border rounded-md px-3 py-2" />
            </Labeled>
            <Labeled label="Move-in cost">
              <input value={moveInCost} onChange={e => setMoveInCost(e.target.value)} className="w-full border rounded-md px-3 py-2" />
            </Labeled>
            <Labeled label="Why / why not Baxter">
              <textarea value={whyOrWhyNot} onChange={e => setWhyOrWhyNot(e.target.value)} rows={2} className="w-full border rounded-md px-3 py-2" />
            </Labeled>
            <Labeled label="Baxter response recommendation">
              <textarea value={baxterRec} onChange={e => setBaxterRec(e.target.value)} rows={2} className="w-full border rounded-md px-3 py-2" />
            </Labeled>
          </div>
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader
          title="3 — Observed units"
          subtitle={`${units.length} unit${units.length === 1 ? "" : "s"} drafted. Skip a unit by leaving it blank.`}
          action={<button onClick={addUnit} className="text-xs px-2 py-1 border border-slate-200 rounded-md hover:bg-slate-50">+ add unit</button>}
        />
        <CardBody>
          {units.map((u, i) => (
            <div key={i} className="border border-slate-200 rounded-md p-3 mb-3">
              <div className="flex justify-between items-center mb-2">
                <strong className="text-sm text-slate-700">Unit #{i + 1}</strong>
                {units.length > 1 && (
                  <button onClick={() => removeUnit(i)} className="text-xs text-red-700 underline">remove</button>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Labeled label="Unit number"><input value={u.unitNumber} onChange={e => updateUnit(i, { unitNumber: e.target.value })} placeholder="601 or unknown-floor-5" className="w-full border rounded-md px-2 py-1.5" /></Labeled>
                <Labeled label="Unit # confidence">
                  <select value={u.unitNumberConfidence} onChange={e => updateUnit(i, { unitNumberConfidence: e.target.value as DraftUnit["unitNumberConfidence"] })} className="w-full border rounded-md px-2 py-1.5">
                    <option value="high">high</option><option value="medium">medium</option><option value="low">low</option><option value="unknown">unknown</option>
                  </select>
                </Labeled>
                <Labeled label="Floor"><input type="number" value={u.floor} onChange={e => updateUnit(i, { floor: e.target.value })} className="w-full border rounded-md px-2 py-1.5" /></Labeled>
                <Labeled label="Beds"><input type="number" step="0.5" value={u.bedCount} onChange={e => updateUnit(i, { bedCount: e.target.value })} className="w-full border rounded-md px-2 py-1.5" /></Labeled>
                <Labeled label="Baths"><input type="number" step="0.5" value={u.bathCount} onChange={e => updateUnit(i, { bathCount: e.target.value })} className="w-full border rounded-md px-2 py-1.5" /></Labeled>
                <Labeled label="Sqft"><input type="number" value={u.squareFeet} onChange={e => updateUnit(i, { squareFeet: e.target.value })} className="w-full border rounded-md px-2 py-1.5" /></Labeled>
                <Labeled label="Asking rent ($)"><input type="number" value={u.askingRent} onChange={e => updateUnit(i, { askingRent: e.target.value })} className="w-full border rounded-md px-2 py-1.5" /></Labeled>
                <Labeled label="Free weeks"><input type="number" value={u.freeWeeks} onChange={e => updateUnit(i, { freeWeeks: e.target.value })} className="w-full border rounded-md px-2 py-1.5" /></Labeled>
              </div>
              <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-600">
                <label className="flex items-center gap-1"><input type="checkbox" checked={u.parkingIncluded} onChange={e => updateUnit(i, { parkingIncluded: e.target.checked })} />parking included</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={u.utilitiesIncluded} onChange={e => updateUnit(i, { utilitiesIncluded: e.target.checked })} />utilities included</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={u.inUnitLaundry} onChange={e => updateUnit(i, { inUnitLaundry: e.target.checked })} />in-unit W/D</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={u.balcony} onChange={e => updateUnit(i, { balcony: e.target.checked })} />balcony / patio</label>
              </div>
              <textarea value={u.notes} onChange={e => updateUnit(i, { notes: e.target.value })} rows={1} placeholder="Notes (layout, finishes, etc.)" className="w-full border rounded-md px-2 py-1.5 mt-2 text-sm" />
            </div>
          ))}
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader title="4 — Amenities observed" subtitle="Tap an amenity to log it. Quality 1-5 captures how strong it is (not just existence)." />
        <CardBody>
          <div className="flex flex-wrap gap-2 mb-3">
            {AMENITY_OPTIONS.map(am => {
              const active = amenities.some(a => a.amenity === am);
              return (
                <button
                  key={am}
                  onClick={() => toggleAmenity(am)}
                  className={`text-xs px-2.5 py-1 rounded-md border ${active ? "bg-emerald-600 text-white border-emerald-600" : "bg-white border-slate-200 text-slate-600"}`}
                >
                  {am.replace(/_/g, " ")}
                </button>
              );
            })}
          </div>
          {amenities.length > 0 && (
            <div className="space-y-2">
              {amenities.map(a => (
                <div key={a.amenity} className="flex items-center gap-3 text-sm">
                  <Badge intent="good">{a.amenity.replace(/_/g, " ")}</Badge>
                  <span className="text-xs text-slate-500">quality:</span>
                  {[1, 2, 3, 4, 5].map(q => (
                    <button key={q} onClick={() => updateAmenityQuality(a.amenity, q)} className={`text-xs w-7 h-7 rounded ${q <= a.quality ? "bg-amber-400 text-slate-900" : "bg-slate-100 text-slate-400"}`}>{q}</button>
                  ))}
                  <input value={a.notes} onChange={e => updateAmenityNotes(a.amenity, e.target.value)} placeholder="optional note" className="flex-1 border rounded-md px-2 py-1 text-xs" />
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <div className="flex items-center gap-3 mb-12">
        <button
          onClick={submit}
          disabled={saving || !name.trim() || !address.trim()}
          className="px-5 py-2.5 rounded-md bg-emerald-700 text-white disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Save tour to Supabase"}
        </button>
        <span className="text-xs text-slate-500">Writes field tour + {units.filter(u => u.unitNumber || u.askingRent).length} units + {amenities.length} amenities + ledger rows.</span>
      </div>
    </>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-slate-600">
      <div className="mb-1">{label}</div>
      {children}
    </label>
  );
}

function Rating({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="text-xs text-slate-600">
      <div className="mb-1">{label}</div>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={`w-9 h-9 rounded-md border ${n <= value ? "bg-amber-400 text-slate-900 border-amber-500" : "bg-white text-slate-400 border-slate-200"}`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
