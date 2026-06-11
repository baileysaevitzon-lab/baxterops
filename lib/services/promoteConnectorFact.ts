// Sprint 30 (Phase 7) — gated Promote path for connector-staged facts.
//
// SAFETY CONTRACT:
//   - Identity (name) and live-rent facts are BLOCKED here — they need a separate
//     explicit Bailey decision and are never promoted by this helper.
//   - Promotes never touch avgRent/minRent/maxRent. Sqft promotes merge ONLY the
//     sqft keys into the matching unit_types entry, preserving every rent value.
//   - A promote is blocked if it would overwrite a field-verified (field-tour)
//     value; field-tour data always outranks connector data.
//   - Every promote writes a data_source_ledger provenance row and flips the queue
//     row to "confirmed".
import type { CompetitorProperty, CompetitorUnitType, DataSourceLedgerRow, ManualVerificationQueueRow } from "@/lib/types";
import { updateCompetitorFields } from "@/lib/services/competitors";
import { bulkUpsertLedger } from "@/lib/services/sourceLedger";
import { upsertQueueItem } from "@/lib/services/verificationQueue";

export interface PromotePlan {
  ok: boolean;
  blockedReason?: string;
  destination: string; // human-readable column/path
  prev: string;
  next: string;
  patch?: Partial<CompetitorProperty>;
  ledger?: DataSourceLedgerRow;
}

const BLOCKED_RENT = (k: string) => k.endsWith("_rent_live") || k === "avg_rent" || k.includes("rent");
const NOTES_FACTS = new Set([
  "management_company", "unit_mix_3br", "unit_mix_2br_townhome",
  "utilities_included", "pet_policy", "fees", "lease_terms",
]);

function parseRange(v: string): { min: number; max: number; avg: number } | null {
  const m = v.match(/(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)/);
  if (m) {
    const min = Number(m[1].replace(/,/g, ""));
    const max = Number(m[2].replace(/,/g, ""));
    return { min, max, avg: Math.round((min + max) / 2) };
  }
  const single = v.match(/(\d[\d,]*)/);
  if (single) { const n = Number(single[1].replace(/,/g, "")); return { min: n, max: n, avg: n }; }
  return null;
}

function mergeSqft(unitTypes: CompetitorUnitType[], type: string, r: { min: number; max: number; avg: number }): CompetitorUnitType[] {
  return unitTypes.map(u => (u.type === type ? { ...u, minSqft: r.min, maxSqft: r.max, avgSqft: r.avg } : u));
}

function ledgerFor(row: ManualVerificationQueueRow, category: string, valueText: string, editedBy: string): DataSourceLedgerRow {
  return {
    id: `led-promote-${row.id}`,
    entityType: row.entityType,
    entityId: row.entityId,
    entityName: row.entityName,
    fieldKey: row.fieldKey,
    fieldLabel: row.fieldLabel,
    fieldCategory: category,
    valueType: "text",
    valueText,
    displayValue: valueText,
    sourceType: row.sourceType,
    sourceName: `Connector promote (${row.sourceType})`,
    sourceUrl: row.sourceUrl,
    sourceDate: new Date().toISOString().slice(0, 10),
    collectedBy: editedBy,
    verificationStatus: "verified",
    confidence: "high",
    entryMethod: "public_source_entry",
    requiresManualVerification: false,
    staleAfterDays: 60,
    pageRoutes: [`/competitors/${row.entityId.replace(/^c-/, "")}`],
  };
}

/** Compute a dry-run plan: prev -> next, the patch, and the provenance row. No writes. */
export function planConnectorPromote(row: ManualVerificationQueueRow, comp: CompetitorProperty, editedBy = "Bailey"): PromotePlan {
  const k = row.fieldKey;
  const val = row.expectedValue ?? "";

  // --- Hard blocks ---
  if (k === "name") return { ok: false, blockedReason: "Identity/name change is blocked — needs Bailey's physical-building decision.", destination: "competitors.name", prev: comp.name, next: val };
  if (BLOCKED_RENT(k)) return { ok: false, blockedReason: "Rent promotion is blocked in this phase.", destination: "competitors.unit_types[].avgRent", prev: "(unchanged)", next: val };

  // --- Sqft → unit_types sqft keys only (rents preserved) ---
  const sqftType = k === "studio_sqft" ? "studio" : k === "1br_sqft" ? "1BR" : k === "2br_sqft" ? "2BR" : null;
  if (sqftType) {
    if (comp.fieldVerified) return { ok: false, blockedReason: "Blocked — competitor is field-verified; field-tour sqft outranks connector.", destination: `unit_types[${sqftType}].sqft`, prev: "", next: val };
    const r = parseRange(val);
    if (!r) return { ok: false, blockedReason: `Could not parse sqft range "${val}".`, destination: `unit_types[${sqftType}].sqft`, prev: "", next: val };
    const cur = comp.unitTypes.find(u => u.type === sqftType);
    const prev = cur ? `min ${cur.minSqft ?? "—"} / max ${cur.maxSqft ?? "—"} / avg ${cur.avgSqft ?? "—"}` : "(no unit_type)";
    return {
      ok: true,
      destination: `competitors.unit_types[type=${sqftType}].minSqft/maxSqft/avgSqft (rents preserved)`,
      prev,
      next: `min ${r.min} / max ${r.max} / avg ${r.avg}`,
      patch: { unitTypes: mergeSqft(comp.unitTypes, sqftType, r) },
      ledger: ledgerFor(row, "sqft", `${sqftType} sqft ${r.min}-${r.max} (avg ${r.avg})`, editedBy),
    };
  }

  // --- parking_included boolean (+ detail to notes) ---
  if (k === "parking") {
    const note = `[Connector ${new Date().toISOString().slice(0, 10)}] Parking: ${val}.`;
    return {
      ok: true,
      destination: "competitors.parking_included = true (+ detail appended to notes)",
      prev: `parking_included = ${comp.parkingIncluded ?? "null"}`,
      next: `parking_included = true · ${val}`,
      patch: { parkingIncluded: true, notes: appendNote(comp.notes, note) },
      ledger: ledgerFor(row, "parking", val, editedBy),
    };
  }

  // --- amenities array union (additive) ---
  if (k === "amenities_additions") {
    const additions = val.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    const existing = new Set((comp.amenities ?? []).map(a => a.toLowerCase()));
    const toAdd = additions.filter(a => !existing.has(a));
    if (toAdd.length === 0) return { ok: false, blockedReason: "All scraped amenities already present.", destination: "competitors.amenities", prev: (comp.amenities ?? []).join(", "), next: "(no change)" };
    return {
      ok: true,
      destination: "competitors.amenities (additive union)",
      prev: (comp.amenities ?? []).join(", "),
      next: [...(comp.amenities ?? []), ...toAdd].join(", "),
      patch: { amenities: [...(comp.amenities ?? []), ...toAdd] },
      ledger: ledgerFor(row, "amenity", `added: ${toAdd.join(", ")}`, editedBy),
    };
  }

  // --- notes-append facts (additive, never destructive) ---
  if (NOTES_FACTS.has(k)) {
    const note = `[Connector ${new Date().toISOString().slice(0, 10)}] ${row.fieldLabel}: ${val}.`;
    return {
      ok: true,
      destination: "competitors.notes (append)",
      prev: comp.notes ? `${comp.notes.slice(0, 60)}…` : "(empty)",
      next: `…${note}`,
      patch: { notes: appendNote(comp.notes, note) },
      ledger: ledgerFor(row, "status", val, editedBy),
    };
  }

  return { ok: false, blockedReason: `No safe structured destination for "${k}" — left pending.`, destination: "—", prev: "", next: val };
}

function appendNote(existing: string | undefined, note: string): string {
  return [existing?.trim(), note].filter(Boolean).join("\n");
}

/** Execute an approved plan: write the field, ledger provenance, and confirm the queue row. */
export async function commitConnectorPromote(row: ManualVerificationQueueRow, plan: PromotePlan, editedBy = "Bailey"): Promise<void> {
  if (!plan.ok || !plan.patch || !plan.ledger) throw new Error(plan.blockedReason ?? "Promote not allowed.");
  await updateCompetitorFields(row.entityId, plan.patch, {
    editedBy,
    fieldLabel: row.fieldLabel ?? row.fieldKey,
    fieldKey: row.fieldKey,
    displayValue: plan.next,
  });
  await bulkUpsertLedger([plan.ledger]);
  await upsertQueueItem({ ...row, status: "confirmed", reviewedBy: editedBy, reviewedAt: new Date().toISOString() });
}
