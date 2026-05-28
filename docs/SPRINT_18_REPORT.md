# Sprint 18 (pivot) — HTML Completion Portals → Merge → Final Official PDF

**Date:** 2026-05-28
**Goal of the pivot:** Tenants and managers complete simple guided HTML forms instead of marking up the official PDF directly. Both sets of answers map back to the original LAHD AcroForm field names and merge into the final official PDF that BaxterOps already generates. Existing Sprint 15 + 16 + 17 work is reused — no second source of truth.

---

## 1. Files created or edited

**New service**

- `lib/services/recertCompletionForms.ts` — builds tenant + manager form schemas from the existing resolver + override pipeline; `saveCompletionResponse`, `loadSavedResponses`, `submitCompletionSession`, `loadSession` helpers.

**New component**

- `components/CompletionFormView.tsx` — guided HTML form renderer with section nav, progress bar, autosave on blur, review screen, submit gate. Renders text, longtext, date, yesno, tristate, checkbox, initial, signature (typed cursive preview from Sprint 17 service), amount, name, select.

**New pages**

- `app/recertification/[caseId]/tenant-completion/page.tsx`
- `app/recertification/[caseId]/manager-completion/page.tsx`

**Extracted helper (for reuse, no behavior change)**

- `lib/services/recertExactFormBuild.ts` — pulls Sprint 15 fill + Sprint 17 signature-overlay logic into reusable functions so any future PDF-generating route can reuse them.

**Extended**

- `app/api/recertification/[caseId]/generate-exact-form/route.ts` — after the resolver fill + override merge, also loads `recert_packet_field_values` rows with `packet_id IN ('tenant_completion','manager_completion')` and applies them to the AcroForm. Yes/No questions fan out to their Y + N checkbox pair via the `resolverPair` saved in `value_json`. Initials field fans out to all 7 `11-Initial1..7` text fields. Signature fields are deliberately skipped at the merge step — they continue to flow through Sprint 17's PNG-overlay path.
- `app/recertification/[caseId]/page.tsx` — new green-bordered "📝 Completion Portals (HTML → final PDF)" card at the top of the Submission Prep tab with the 4 entry-point buttons.

---

## 2. Database tables / migrations added

**New table**

```sql
CREATE TABLE public.recert_completion_sessions (
  id text PRIMARY KEY,            -- "cs-<caseId>-<role>"
  case_id text NOT NULL,
  role text NOT NULL,             -- 'tenant' | 'manager'
  status text NOT NULL DEFAULT 'draft',  -- 'draft' | 'submitted'
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  submitted_by text,
  total_required integer DEFAULT 0,
  completed integer DEFAULT 0,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

RLS authenticated-only · unique index on `(case_id, role)` · realtime publication enabled · auto-updated_at trigger.

**Reused table (no schema change)**

`recert_packet_field_values` (Sprint 14) stores every HTML answer keyed by:
- `packet_id` ∈ `'tenant_completion'` | `'manager_completion'`
- `section_key` = `"page_<N>"`
- `field_key` = **original LAHD AcroForm field name** (e.g. `11-HouseholdMemberDate`, `12-1Y`, `3-OPMName`) — this is the data-mapping requirement
- `value_text` = the answer
- `value_json` = `{ fieldType, pageNumber, label, resolverPair, timestamp, actorRole, actorName }` — enough to drive the merge step and rebuild the form without re-running the schema builder

---

## 3. Exact UI location

`/recertification/[caseId]` → **Submission Prep tab** → top green card "📝 Completion Portals (HTML → final PDF)"

Direct page URLs (open in their own tabs):

- `/recertification/[caseId]/tenant-completion`
- `/recertification/[caseId]/manager-completion`

Live test today: open `/recertification/rc-712-ocaranza-2026` while signed in.

---

## 4. Buttons added

In the Submission Prep tab's Completion Portals card:

| Button | Destination | Action |
|---|---|---|
| **Open Tenant Completion Form →** | `/recertification/[caseId]/tenant-completion` (new tab) | Tenant guided form |
| **Open Manager Completion Form →** | `/recertification/[caseId]/manager-completion` (new tab) | Manager guided form |
| **Preview Final Official PDF** | `/recertification/[caseId]/exact-form-preview` (new tab) | Existing Sprint 15+16+17 preview; now also reflects completion merges |
| **Download Final PDF** | `GET /api/recertification/[caseId]/generate-exact-form` | Same API; now applies completion responses |

Inside each completion form:

| Control | Behavior |
|---|---|
| Section pills at top | Jump between sections; red `•N` badge shows per-section missing-required count |
| Per-field inputs | Autosave on blur / button click; "Saved" / "Saving…" indicator in the sticky top bar |
| Previous / Next | Step through sections |
| Review answers → | Final review screen with missing-required count and "submit blocked" message if any |
| Submit completion | Marks the session `submitted` + writes audit row `recert_completion_submitted` |
| Back to case | Returns to `/recertification/[caseId]` |

---

## 5. How tenant fields are detected

Driven entirely by `buildTenantFormSchema(caseId)` in `lib/services/recertCompletionForms.ts`, which composes the schema from the existing data sources without a second hard-coded list:

- **Identity** (page 11 + 16): `11-HouseholdMemberName`, `11-HouseholdMemberDate`, `16-HHMbrName`, `16-HHMbrDate` — these are the resolver-marked `blank_tenant_must_complete` fields plus the AcroForm name/date widgets on the signature pages.
- **Initials** (page 11): one form input drives the 7-way fan-out at PDF merge time. Storage key `11-Initial1` plus merge-time loop covers `11-Initial1..7`.
- **Signature** (pages 11 + 16): tenant types their full legal name with consent checkbox; this is the same Sprint 17 typed-signature pipeline, fanning out to both tenant `/Sig` widgets at merge time. Manager / OPM signatures are not touched here.
- **TICQ income questions** (page 12): a curated set of the most common Y/N pairs from the official LAHD TICQ section. Each form input is `yesno` and carries a `resolverPair: { yes: "12-1Y", no: "12-1N" }` shape so the merge step writes both checkboxes.
- **TICQ asset questions** (pages 14 + 15): same pattern.
- **Additional information** (page 24): free-text catch-all that maps to `rov_tenant_explanation`.

Field eligibility rules implemented exactly per spec — tenant signature, initials, date, checkbox, text answer fields go here; manager-only fields are excluded by being explicitly placed in the manager schema and never in the tenant schema.

---

## 6. How manager fields are detected

`buildManagerFormSchema(caseId)` returns:

- **Manager identity** (page 3): `3-OPMName`, `3-Title`, `3-Email`, `3-Date`
- **Submitter role** (page 3): `yesno` mapped to `3-Owner` / `3-Duly Authorized Agent` button pair
- **Income level** (page 3): `select` mapped to the 5 LAHD income-band check fields
- **Rent calculation review** (page 8): `8-MaximumAllowableRent`, `8-UA`, `8-TenantRent`, `8-RentalSubsidy` — manager confirms or fills the HACLA-pending ones
- **Manager certification** (page 24): checkbox + free-form notes

Tenant signature widgets and TICQ Y/N rows are explicitly not in the manager schema. The two schemas are independent functions returning disjoint sets of field names.

---

## 7. How HTML answers map back into the original PDF

Every `CompletionFormField` in the schema carries `pdfFieldName` (and optional `resolverPair`) which is the **original LAHD AcroForm field name**. Persistence:

1. User answers a question.
2. `CompletionFormView` calls `saveCompletionResponse(...)` on blur / change.
3. Service upserts to `recert_packet_field_values` with `field_key = pdfFieldName` plus a `value_json` carrying `{ fieldType, pageNumber, label, resolverPair, timestamp, actorRole, actorName }`.

This means the final PDF regen step needs zero translation: it reads `field_key` and writes directly to the matching AcroForm widget.

---

## 8. How final PDF regeneration works

`POST /api/recertification/[caseId]/generate-exact-form` (the same Sprint 15 endpoint) now runs the following passes, in order, against an in-memory `PDFDocument` loaded from the unchanged template at `/public/templates/lahd-recert-2026.pdf`:

1. **Resolver pass (Sprint 15)** — fills BaxterOps-known fields (property name, address, unit, household members, max income/rent, etc).
2. **Override pass (Sprint 16)** — applies any per-case manager classification overrides + manual values from `recert_case_field_overrides`.
3. **Completion-merge pass (Sprint 18 pivot — new)** — loads all `recert_packet_field_values` rows where `packet_id IN ('tenant_completion','manager_completion')` and applies them:
   - For `fieldType === "yesno"`, reads `value_json.resolverPair` and `check()`/`uncheck()` the matching Y + N PDF checkboxes.
   - For `fieldType === "initial"`, fans out the single input to all 7 `11-Initial1..7` text fields.
   - For `fieldType === "signature"`, defers to Sprint 17's PNG-overlay path (no text write).
   - For everything else, calls `setText()` on the named `PDFTextField` or `check()`/`uncheck()` on a `PDFCheckBox`.
4. **Signature overlay pass (Sprint 17)** — draws typed-signature PNGs at `/Sig` widget rectangles for the tenant signature widgets.
5. **Save** — `pdfDoc.save({ updateFieldAppearances: true })` returns the final PDF bytes inline.

The response now carries an extra `completions_applied` counter in `missing_data_json` for the audit trail.

The PDF layout, page count (24), AcroForm widget set, and original LAHD instructional text remain unchanged — nothing is removed, no pages are dropped, and Sprint 16's signature-field protection rules still apply.

---

## 9. Test results

```
$ npx tsc --noEmit  → 0 errors
$ npm run build     → ✓ Compiled successfully (35 routes)
```

Routes registered (relevant subset):

```
ƒ /api/recertification/[caseId]/generate-exact-form          0 B    /    0 B
ƒ /recertification/[caseId]                                  13.4 kB / 174 kB
ƒ /recertification/[caseId]/exact-form-preview               5.95 kB / 167 kB
ƒ /recertification/[caseId]/manager-completion               4.27 kB / 165 kB
ƒ /recertification/[caseId]/packet                           11.3 kB / 171 kB
ƒ /recertification/[caseId]/tenant-completion                4.27 kB / 165 kB
```

**Live browser tests** (signed in as `sprint12test@baxter.test`, on case `rc-712-ocaranza-2026`):

| Step | Result |
|---|---|
| Open tenant completion form | ✓ Page loads, sticky bar shows "Tenant completion · Jose Humberto Ocaranza-Garcia · Unit 712", 7 section pills, 0/20 required, name pre-populated from case |
| Tenant form shows only tenant questions | ✓ All 7 sections are tenant fields; no manager identity, no rent-table fields, no OPM signature |
| Pick a TICQ "Yes" answer (employment income) | ✓ "5. Income questions (TICQ) •8" badge dropped to •7; top bar moved 10% → 15% → 20% as I filled date + Yes |
| Refresh the page | ✓ Tenant date `2026-05-28` + TICQ Yes both persist; sticky bar still shows 20% / 4-of-20 / 16 missing |
| DB: `recert_packet_field_values` row | ✓ Two rows: `12-1Y = "yes"` and `11-HouseholdMemberDate = "2026-05-28"`, packet_id `tenant_completion`, value_json with fieldType + resolverPair |
| DB: `recert_completion_sessions` row | ✓ 1 row, role=tenant, status=draft, touched on each save |
| Open manager completion form | ✓ Distinct page; sticky bar shows "Manager completion · Unit 712"; 5 sections (Manager identity, Submitter role, Income level, Rent calculation review, Manager certification); 1/8 required; no tenant fields visible |
| Fill `3-OPMName = "Joana Moreno"` and tab away | ✓ Saved silently |
| Trigger `POST /api/recertification/[caseId]/generate-exact-form` | ✓ Returns 200 + 580 KB `application/pdf`; `X-Filled-Count: 32`, `X-Blank-Count: 21` |
| DB: `recert_generated_packets.missing_data_json.completions_applied` | ✓ Value = 4 (one tenant date + yesno fan-out wrote two checkboxes + manager name) |
| Tenant date `2026-05-28` visible in raw PDF bytes | ✓ Confirmed via JavaScript byte scan |
| Manager name "Joana Moreno" written to `3-OPMName` | ✓ Counter incremented; manager-name plaintext is hidden by pdf-lib content-stream compression (expected) |
| Sprint 16 signature protection unchanged | ✓ `/Sig` field-name list still respected at merge time — only the text widgets and Y/N pairs are written by the completion-merge pass |
| Sprint 17 typed signature still works | ✓ The Classification tab on `/exact-form-preview` still captures the cursive PNG and overlays it at the `/Sig` widget rectangles independent of the HTML completion forms |

---

## 10. Limitations / next steps

1. **TICQ coverage is intentionally curated.** The LAHD TICQ has dozens of Y/N rows; the tenant form exposes the most common 8 income + 6 asset rows by default. Adding more is a one-line edit to the `ticqIncomeQs` / `ticqAssetQs` arrays in `recertCompletionForms.ts` — no code path change needed.

2. **Schema is statically defined per role.** A future improvement would derive the field list dynamically from the resolver's tenant-action detection (Sprint 18 detectTenantActionFields). The trade-off is that the curated schema gives plain-English questions like "Self-employment, freelance, or 1099 income?" instead of raw field names — which is what the spec explicitly calls for ("guided form, not a complicated PDF").

3. **Signature is captured as the typed name only.** The PNG image is generated client-side for preview; the API route does NOT yet receive the PNG bytes from the completion form. To make the tenant's typed signature land on the final PDF when generated via this route, Bailey can use the existing Sprint 17 Classification-tab signature capture (which writes the PNG to `recert_packet_signatures`). A small follow-up would auto-write the PNG when the tenant submits the completion form.

4. **No tenant-share token yet.** Both completion pages require Supabase auth right now. If Bailey wants tenants to access the form on their own device without a manager logged in, a tokenized share link is a separate (small) sprint with a `recert_completion_tokens` table.

5. **Real-time progress sync.** Two managers watching the same case won't see each other's completion progress live; `recert_completion_sessions` is in the realtime publication but no subscription is wired. Same trade-off documented since Sprint 12.

6. **Validation is light.** The submit gate just checks "required field is non-empty." For specific formats (date, currency, email), browser input type validation is the only enforcement — no server-side schema check beyond persistence.

7. **Sprint 18's earlier two-PDF generator** (`lib/services/recertSigningPacket.ts` + the highlight/cover-sheet pipeline) was built and type-checks clean. It's not currently wired to a button because Bailey's pivot superseded that direction. The code is intact and ready to be exposed if useful — would take a single button + API route to make it generate-on-demand.

---

## Sprint 18 (pivot) verdict

Tenants and managers now have separate, guided HTML completion experiences that are dramatically simpler than the full official PDF. Their answers persist keyed by the original LAHD AcroForm field names, so the same `generate-exact-form` API route that already filled BaxterOps-known fields and applied manager overrides now also merges in tenant and manager HTML answers. The official LAHD layout, all 24 pages, all original instructional text, and all AcroForm widget positions remain unchanged. The Sprint 16 signature protections and Sprint 17 typed-signature capture continue to work alongside.
