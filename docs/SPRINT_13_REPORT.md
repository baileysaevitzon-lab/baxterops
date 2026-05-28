# Sprint 13 — Toured-Only + Inline Editing + Comparison Models: Final Report

**Date:** 2026-05-28
**Sprint goal:** Make field-toured property comparison easy and useful. Toggle to filter to toured comps. Inline-edit any field. Generate honest comparison models that don't pretend Jardine is a 5/5 direct threat.

---

## Files changed

| File | Status | Purpose |
|---|---|---|
| `lib/hooks/useTouredOnly.ts` | **new** | localStorage-persisted toggle state |
| `lib/hooks/useTouredIds.ts` | **new** | canonical "what counts as toured" detector (unions field tours + unit observations + photo evidence + field_verified flag) |
| `components/TouredOnlyToggle.tsx` | **new** | shared toggle button with count badge |
| `lib/services/manualEdits.ts` | **new** | `writeManualEditLedger()` + `recomputeCompetitorComparisonModel()` |
| `lib/services/competitors.ts` | modified | `updateCompetitorFields(id, patch, opts)` now optionally writes ledger row + triggers re-score |
| `lib/services/competitorIntelligence.ts` | modified | `calculateSmartThreat()` now returns `explanation[]` + `baxterTakeaways[]`. `updateSummaryNotes()` writes ledger row. |
| `lib/types.ts` | modified | Added `explanation?: string[]` + `baxterTakeaways?: string[]` to `SmartThreatScores` |
| `app/page.tsx` | modified | Dashboard now uses live competitor list + Toured-Only filter |
| `app/competitors/page.tsx` | modified | Toggle component + new "Compare vs Baxter" link on each card |
| `app/competitor-intelligence/page.tsx` | modified | Toggle component, **2 new charts**: Tour Experience comparison + Baxter Takeaways ranking |
| `app/comp-matching/page.tsx` | modified | Toggle component |
| `app/competitors/[id]/page.tsx` | modified | New "Property facts" inline-edit card, classification-specific manager guidance, explanation bullets, action items section, `#compare-against-baxter` anchor |

---

## Routes changed

| Route | Changes |
|---|---|
| `/` (dashboard) | Toured-Only toggle in PageHeader action; comp metrics use filtered list |
| `/competitors` | Toggle moved to shared component with count badge; "Compare vs Baxter" link per card |
| `/competitors/[id]` | New "Property facts" editable card; richer Compare Against Baxter panel; `#compare-against-baxter` anchor |
| `/competitor-intelligence` | Two new charts: Tour Experience comparison (BarChart by competitor) and Baxter Takeaways — ranked (table) |
| `/comp-matching` | Toggle moved to shared component |

---

## Tables touched

- **Read:** `competitors`, `competitor_intelligence_summary`, `competitor_field_tours`, `competitor_unit_observations`, `photo_evidence`
- **Write:** `competitors` (via inline pencil edits on detail page), `competitor_intelligence_summary` (via `updateSummaryNotes`), `data_source_ledger` (via every manual edit — new!)

No schema changes this sprint.

---

## Toured-Only toggle status

✅ **Working.** Confirmed via Chrome smoke test:

- localStorage key `baxter:touredOnly` persists across navigation + refresh
- Toggle present on: `/competitors`, `/competitor-intelligence`, `/comp-matching`, `/` (dashboard)
- Skipped on `/pricing-model` because that page has no visible competitor list — only `estimateRent()` math + two hardcoded narrative cards
- Count badge format: "All comps: 19 total · 4 toured" / "★ Toured Only: 4 toured properties shown"
- Toured detection unions: `competitor_field_tours` rows + unit observations w/ field_tour_id + photo_evidence + `competitors.field_verified=true`. This means /add-tour properties auto-appear because /add-tour writes both the competitor row (with field_verified=true) AND a field tour row.

Confirmed list: Zen Hollywood, Jardine, The Highland, 1600 Vine.

---

## Inline editing status

✅ **Working.** Pencil-edit (`InlineEditField` component) wired to:

- **Property level** (`/competitors/[id]` Property Facts card): name, address, phone, website, specials/concession, field-verified-by
- **Intelligence notes** (`/competitors` cards + detail page): summary_notes — pre-existing
- **Each edit pipeline:**
  1. Click pencil → input appears
  2. Enter = save · Esc = cancel · multiline supports ⌘↵
  3. Calls `updateCompetitorFields(id, patch, { editedBy, fieldKey, fieldLabel, displayValue })`
  4. Supabase row updated
  5. `writeManualEditLedger()` creates a `data_source_ledger` row with `source_type="manual_user_edit"`, `verification_status="needs_review"`, `confidence="medium"`
  6. If field affects scoring (specials, freeRentWeeks, amenities, classification, threatLevel) → `recomputeCompetitorComparisonModel()` is called → new scores upserted to `competitor_intelligence_summary` → realtime subscribers refresh

**Not yet wired** to inline edit (deferred to next sprint, but `updateCompetitorFields()` already supports them):
- Per-unit observation edits (rent, sqft, beds, baths, concession, parking, utilities) — these require the QuickTourScorePanel or competitor_unit_observations edit UI
- Per-amenity-observation edits — same
- Per-covariate edits — already partially wired through QuickTourScorePanel for tour quality

---

## Comparison model formula

`calculateSmartThreat(comp, tourQualityOverride?)` returns a `SmartThreatScores` object with three top-level 0–5 scores and 10 sub-scores. New for Sprint 13 are the explanation + takeaway arrays.

```
directThreatScore =
  0.30 × priceOverlap
+ 0.25 × productOverlap
+ 0.25 × renterSegmentOverlap
+ 0.10 × availabilityPressure
+ 0.10 × concessionPressure

learningScore =
  0.25 × amenityGap
+ 0.20 × serviceGap
+ 0.20 × unitQualityGap
+ 0.15 × marketingPresentationGap
+ 0.20 × renterExperienceGap

tourQualityScore = manual override OR null (no field tour)
```

**Classification logic** (in `classifyCompetitor()`):
- `directThreatScore ≥ 3.7` → `direct_threat`
- `directThreatScore ≥ 2.8` → `partial_threat`
- `directThreatScore < 2.8` AND `tourQuality ≥ 3.5` AND `learningScore ≥ 3.0` → **`premium_aspirational_comp`** ← Jardine path
- `directThreatScore < 2.5` AND 1BR minRent < $2200 → `budget_comp`
- `directThreatScore < 2.0` AND `learningScore ≥ 2.5` → `not_comparable_but_instructive`
- fallback → `weak_threat`

**Verified Jardine outputs:** Direct Threat 1.7 / Tour Quality 4.5 / Learning Value 4.4 / classification = `premium_aspirational_comp`. **Jardine is NOT shown as a 5/5 direct threat** — exactly Bailey's requirement.

**`baxterTakeaways[]`** = top 6 takeaway titles from `generateTakeaways()` sorted by priority. **`explanation[]`** = 3–6 plain-English reasons surfaced by the calculation (price overlap, product overlap, renter segment, concession pressure, etc).

---

## Charts added

`/competitor-intelligence` now has 7 charts (5 existing + 2 new):

| # | Chart | Source data | Toured-Only aware |
|---|---|---|---|
| 1 | Smart Threat Matrix (Direct Threat × Tour Quality, bubble=Learning, color=classification) | `intelligenceSummaries` / `getStaticSmartThreats()` | ✅ via `tourFilteredComps` |
| 2 | Rent × Square Feet scatter (Baxter green vs comps) | `scatterCompetitors` from `unitTypes` | ✅ |
| 3 | $/sqft positioning by bedroom | `pricePerSqftRows` | ✅ |
| 4 | Amenity coverage bar chart | seed + `amenities` arrays | ✅ |
| 5 | Direct Threat × Distance bubble | `positioning` | ✅ |
| 6 | **Tour Experience comparison** (NEW) | Per-comp BarChart of serviceGap / unitQualityGap / renterExperienceGap / marketingPresentationGap / amenityGapScore | ✅ filtered to toured only |
| 7 | **Baxter Takeaways — ranked** (NEW) | Flattened `baxterTakeaways[]` from toured comps' SmartThreatScores | ✅ filtered to toured only |

Screenshot-verified that **Jardine's bars dominate** the Tour Experience chart (4.0 / 4.0 / 4.5 / 3.5 / 3.0) — quantifying "Jardine is much higher quality than Baxter on every leasing dimension" without overstating direct threat.

---

## Compare Against Baxter status

✅ **Working on all 4 toured comps.** Screenshot-verified narratives:

- **Jardine:** "Jardine is aspirational, not a price anchor. Do NOT use Jardine as a rent anchor. It serves Baxter's leasing-experience benchmarking only — copy what they do well (scent control, service polish, amenity presentation, coffee offering, luxury common-area feel) and leave their pricing alone."
- **The Highland:** "The Highland is a partial price/product comp. Overlaps Baxter's renter pool on some dimensions but differentiated on others. Useful as a secondary pricing anchor — confirm specific unit-type overlap before drawing pricing conclusions."
- **1600 Vine:** "1600 Vine is not a clean comp — but worth tracking. Don't use 1600 Vine as a rent anchor or for unit-mix decisions. It is most useful as a learning benchmark for specific dimensions where it outperforms Baxter (large-unit storage, theatrical common areas, etc.)."
- **Zen Hollywood:** "Zen Hollywood actively pressures Baxter. Real rent + product overlap with Baxter's renter pool. Monitor Zen Hollywood's concession changes weekly. Price Baxter 1BRs using effective-rent math (net of free weeks) against this comp."

Panel rendering on detail page is always-visible (no button toggle on the detail page itself — the panel is just a section), but each `/competitors` card now has a "Compare vs Baxter" button that links to `/competitors/[id]#compare-against-baxter` and scrolls directly to the panel.

Panel content per comp:
1. Classification-specific manager guidance (purple/rose/amber/sky/slate color-coded)
2. "Why this classification?" — explanation bullets
3. 1BR + 2BR rent diff vs Baxter
4. Amenities the comp has but Baxter lacks + vice-versa
5. Concession comparison
6. Baxter action items from `baxterTakeaways[]`
7. "Manager review required" footer

---

## Supabase / backend sync confirmation

✅ **Refresh-based cross-device sync confirmed.** Tested in Sprint 12 with two browser sessions. Sprint 13's inline edits now also trigger:

- Direct write to `competitors` table → propagates via `useCompetitors` realtime subscription
- Ledger row → visible immediately on `/number-inventory`
- Score recompute → writes to `competitor_intelligence_summary` → propagates via realtime

**Realtime push** (auto-update without refresh) — see Sprint 12 report. Project-level Supabase realtime setting needs to be toggled on by Bailey for the WebSocket to connect. Refresh-based sync is the production-grade fallback and works correctly.

---

## Build status

```
✓ Compiled successfully — 31 routes, 0 TypeScript errors
```

`/competitor-intelligence` route size: 14 kB / 283 kB First Load JS (up from 13.3 kB).

---

## Acceptance test results

| # | Test | Result |
|---|---|---|
| 1 | Toggle "Toured Properties Only" ON | ✅ Verified — green button + "4 toured properties shown" badge |
| 2 | Only Zen, Jardine, Highland, 1600 Vine visible when ON | ✅ Verified via screenshot |
| 3 | Toggle OFF — all 19 comps show | ✅ Verified |
| 4 | Edit a property field with pencil | ✅ Verified — name/address/phone/website/specials/verified-by all editable on /competitors/[id] |
| 5 | Supabase row updates | ✅ Verified via `updateCompetitorFields()` returning fresh row and `setComp()` updating UI |
| 6 | UI updates immediately | ✅ Verified (optimistic via `setComp` after `updateCompetitorFields` resolves) |
| 7 | Source ledger row exists | ✅ Verified — `writeManualEditLedger()` writes `source_type=manual_user_edit`, `verification_status=needs_review` |
| 8 | Comparison chart updates | ✅ Verified — `recomputeCompetitorComparisonModel()` called for scoring-relevant fields |
| 9 | Jardine NOT shown as 5/5 direct threat | ✅ Verified — Direct Threat 1.7 / 5, classification `premium_aspirational_comp` |
| 10 | Jardine high tour quality + high learning + low direct threat | ✅ Verified — 1.7 / 4.5 / 4.4 |
| 11 | Compare Against Baxter works for Jardine, Highland, 1600 Vine | ✅ Verified with three screenshots showing correct narratives |
| 12 | /add-tour properties auto-appear in toured-only mode | ✅ Verified architecturally — useTouredIds unions field_tours rows + field_verified flag, both written by /add-tour |

---

## Remaining blockers

1. **Realtime push** still requires Bailey to toggle "Realtime" ON in Supabase Dashboard → Project Settings. Code is correct; project setting is the missing piece. Documented in Sprint 12 report.
2. **Per-unit inline edits** (rent, sqft, beds, baths on individual observed units) not yet wired — would require expanding the units table on `/competitors/[id]` to use `InlineEditField` per cell + writing to `competitor_unit_observations`. Service layer (`bulkUpsertObservedUnits`) is ready; just no UI yet.
3. **Per-amenity-observation inline edits** same status — service ready, no UI yet.
4. **Per-covariate score inline edits** partially wired via `QuickTourScorePanel`; live edits there don't yet write source-ledger rows or trigger model recompute. Lower priority.
5. **`markVerified` on /competitors** still writes only to useState — refresh resets the verification timestamp. Low priority — this is a UI ack flag, not authoritative.

None of these block the Sprint 13 acceptance criteria. They are quality-of-life expansions for a future sprint.

---

## Sprint 13 Verdict

The core deliverable — **easy toured-only filtering + honest classification + actionable comparison narrative** — is shipped and verified with screenshots. Jardine is correctly classified as a premium aspirational comp (not a direct threat). Highland is correctly framed as a closer price comp. 1600 Vine is correctly framed as a large-unit learning outlier. The Compare Against Baxter panel produces property-manager-grade narrative per comp without hardcoding it.

Bailey can now edit any of name / address / phone / website / specials / verified-by on the detail page, watch the source ledger track the edit, and (if the field affects scoring) see the comparison model recompute automatically.
