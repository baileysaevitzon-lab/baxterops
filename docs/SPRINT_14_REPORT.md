# Sprint 14 — Recertification HTML / iPad Signing Packet: Final Report

**Date:** 2026-05-28
**Sprint goal:** Replace the "generate a PDF" workflow with a clean HTML certification packet that opens on an iPad, pre-fills known fields, leaves missing fields blank, and accepts tenant + manager signatures via touch/stylus. PDF generation is optional via browser print — HTML/iPad signing is the primary output.

**Test case:** Unit 712 — Jose Humberto Ocaranza-Garcia (move-in 10/23/2024), data extracted from `/Users/shane/Desktop/Baxter Data/712. Jose Ocaranza-Garcia (10.23.2024)/`.

---

## 1. What changed

- New `lib/services/recertPacket.ts` builds a structured packet model from existing recert case + members + income + assets + utility allowance.
- New `components/SignaturePad.tsx` provides a canvas-based signature pad optimized for iPad touch + stylus.
- New route `/recertification/[caseId]/packet` renders the iPad-friendly HTML packet.
- New Supabase tables `recert_packet_field_values` and `recert_packet_signatures` store autosaved field values and signature data URLs per case.
- The Submission Prep tab on `/recertification/[caseId]` now has a green "Open iPad signing packet" CTA at the top.
- One real case seeded for Jose Humberto Ocaranza-Garcia (Unit 712) using data from the Baxter Data folder + the UFBA "Final Missing Items" letter dated 3/3/2026.
- **No PDF generation.** Print/Save-as-PDF is the browser print fallback.

---

## 2. Routes added / modified

| Route | Status | Purpose |
|---|---|---|
| `/recertification/[caseId]/packet` | **new** | iPad-friendly HTML packet, autosaves to Supabase, signature canvas pads |
| `/recertification/[caseId]` | modified | Submission Prep tab now has "Open iPad signing packet" + "Preview prefilled packet" buttons |

Build output:
```
├ ƒ /recertification/[caseId]            12.5 kB         173 kB
├ ƒ /recertification/[caseId]/packet     11.3 kB         171 kB
```

---

## 3. Tables added / modified

**New tables (Sprint 14):**

```sql
CREATE TABLE recert_packet_field_values (
  id uuid PK, case_id text, packet_id text DEFAULT 'primary',
  section_key text, field_key text,
  value_text text, value_json jsonb,
  filled_by_role text, filled_by_name text, status text,
  created_at timestamptz, updated_at timestamptz
);
-- UNIQUE INDEX (case_id, packet_id, section_key, field_key)

CREATE TABLE recert_packet_signatures (
  id uuid PK, case_id text, packet_id text DEFAULT 'primary',
  section_key text, household_member_id text DEFAULT '__none__',
  signer_name text, signer_role text,
  signature_data_url text,  -- PNG data URL, ~28 KB per signature
  signed_at timestamptz, signed_by_user_id uuid,
  created_at timestamptz
);
-- UNIQUE INDEX (case_id, packet_id, section_key, signer_role, household_member_id)
```

RLS: both tables authenticated-only (SELECT/INSERT/UPDATE/DELETE). Both added to `supabase_realtime` publication for cross-device collaboration.

**Existing tables read by the packet model (unchanged):**
`recertification_cases`, `recert_household_members`, `recert_income_sources`, `recert_asset_accounts`, `recert_deposit_reviews`, `recert_utility_allowance`, `recert_required_items`.

---

## 4. How HTML packet generation works

1. Manager opens `/recertification/[caseId]/packet` (new tab from the Submission Prep CTA).
2. The page calls `generateRecertPacketModel(caseId, packetId='primary')`.
3. That function fetches the case + members + income + assets + utility allowance + persisted field values + persisted signatures (8 parallel reads).
4. It builds 10 structured sections, each with a typed `fields[]` array and a `signatures[]` array:
   1. Package Cover / Case Summary
   2. TICQ — one section per adult
   3. TIRC (Tenant Income and Rent Certification)
   4. Applicant Statement
   5. Conflict of Interest
   6. Asset Certification
   7. Verification of Employment (Part 1) — only when employment income exists
   8. Record of Verification / Clarification
   9. Utility Allowance Worksheet
   10. Final Submission Checklist
5. Persisted field values + signatures are overlaid on top of the computed defaults.
6. Readiness is computed: percent complete = (completed required fields + signed slots) / (total required fields + total signature slots).
7. The React component renders sections, fields, and signature pads with color-coded status chips.

Output is **never a PDF**. The "Print / Save as PDF" button at top right calls `window.print()` so the manager or tenant can print the completed packet from the browser if they want a PDF copy.

---

## 5. How known / highlighted fields are pre-filled

Per-field classification in `pacField()`:
- If the case record has the value → `status: "prefilled"`, `filledBy: "baxterops"`, **green chip "Pre-filled by BaxterOps"**.
- If pending external data (e.g. HACLA rent determination still pending) → `status: "pending"`, **amber chip "Pending external data"**.
- If required but blank → `status: "missing"`, **red chip "Required — not yet filled"**.
- If not required and blank → `status: "not_applicable"`, **gray chip "Not applicable"**.
- If manager review needed → `status: "needs_review"`, **blue chip "Needs manager review"**.

**Verified pre-filled on the live unit 712 case (screenshots in transcript):**
- Tenant: Jose Humberto Ocaranza-Garcia
- Property: The Baxter Hollywood
- Unit: 712
- Bedrooms: 1
- Move-in: 2024-10-23
- Certification type: move_in
- Max income limit: $53,000
- Max allowable rent: $2,460
- Tenant portion of rent: $601
- Adults/children: 1/1
- TICQ adult name (per adult section): Jose Humberto Ocaranza-Garcia
- TIRC Project Name: The Baxter Hollywood
- TIRC Unit Number: 712

Each field shows an `officialLabelHint` line ("Maps to: Project Name") that Bailey can later replace with the exact LAHD/UFBA highlighted-field names — see Section 13.

---

## 6. How missing fields are handled

- Required missing fields render with **rose-50 background + rose-400 ring + red chip** "Required — not yet filled".
- Tenant/manager types directly into the input (text, date, money, longtext, yes/no, tri-state yes/no/unknown, checkbox, initial box).
- On `blur` of the input, the value autosaves to `recert_packet_field_values` (one row per `case_id × packet_id × section_key × field_key`).
- The save uses `filled_by_role = "tenant"` if the field has a `householdMemberId`, otherwise `"manager"`.
- After autosave, the status flips to `"prefilled"` and the chip turns green.

Verified live: typed "1818 N Cherokee Ave, Los Angeles, CA 90028" into Property Address. After full page refresh, the field still showed green "Pre-filled by BaxterOps" chip and the completion bar moved from 30% → 31%, missing-fields count from 46 → 45.

---

## 7. How iPad signatures work

`<SignaturePad>` is a canvas-based component sized 360×140 CSS px with `devicePixelRatio` scaling for crisp ink on retina displays. It uses **Pointer Events** so the same code path captures:
- Apple Pencil / stylus
- Finger touch on iPad
- Mouse clicks for desktop testing

UX:
- "Sign with finger or stylus" placeholder text.
- Touch + drag draws ink.
- "Save signature" exports the canvas as a PNG data URL via `canvas.toDataURL("image/png")`.
- Calls `onSave(dataUrl)` which writes to `recert_packet_signatures` via `saveRecertPacketSignature()`.
- Once saved, the canvas is replaced by an `<img>` of the saved PNG, plus a "✓ signed YYYY-MM-DD" timestamp and a "Re-sign" button (which deletes the row and re-shows the canvas).
- Color-coded border: green for tenant, blue for manager, violet for owner.

Each packet has up to 12 signature slots (1 cover + 1 TICQ-per-adult + 2 TIRC + 2 Applicant + 2 COI + 1 Asset-per-adult + 1+ VOE + 1 RoV + 1 UA + 1 Final).

---

## 8. Whether signatures persist

✅ **Yes, verified end-to-end:**

1. Drew an X on the "Owner / Duly Authorized Agent Signature" pad in the Package Cover section.
2. Clicked "Save signature".
3. Pad replaced canvas with the saved PNG, showed "✓ signed 2026-05-28", signer name "Sprint 12 Test User".
4. Direct SQL query confirmed 1 row in `recert_packet_signatures`: 28,582-byte PNG, section=cover, role=manager.
5. Full page reload (`navigate` to same URL): signature still visible, top bar still showed `30% complete · 11 missing signatures`.

---

## 9. Whether autosave works

✅ **Yes, verified end-to-end:**

1. Typed `1818 N Cherokee Ave, Los Angeles, CA 90028` into Property Address (was a red required-missing field).
2. Tabbed away to trigger `onBlur` → `handleFieldChange()` → optimistic UI update + `saveRecertPacketField()` POST.
3. Top bar transitioned: `Saving…` → `✓ Saved`.
4. Reloaded the page. Property Address now shows green "Pre-filled by BaxterOps" chip.
5. Top bar moved 30% → 31% complete, missing fields 46 → 45.

---

## 10. How readiness updates

`PacketReadiness` is computed inside `generateRecertPacketModel()`:
```
percent = round( (completedRequiredFields + completedSignatures)
              / (totalRequiredFields    + totalSignatures) × 100 )
```

After every autosave or signature save, the page calls `load()` which re-fetches the packet model. The new model recomputes `completedRequiredFields` and `completedSignatures`, and the sticky top bar re-renders the percentage + missing counts.

Pending fields (e.g. HACLA tenant portion when subsidy_status = `hacla_determination_pending`) are excluded from missing-count to avoid blocking the manager — they show in `blockers[]` for awareness.

Manager review is still required to mark the case ready to submit — readiness percentage alone does not auto-flip case status.

---

## 11. Build / browser test results

```
npm run build → ✓ Compiled successfully, 0 TypeScript errors
                /recertification/[caseId]/packet route 11.3 kB / 171 kB First Load JS
```

Manual browser tests passed (screenshots in transcript):
- ✅ Open `/recertification`
- ✅ Open seeded case `rc-712-ocaranza-2026`
- ✅ Submission Prep tab shows new green "Open iPad signing packet" CTA
- ✅ `/recertification/[caseId]/packet` renders as HTML, not PDF
- ✅ Known case fields prefilled + highlighted GREEN (Tenant, Property, Unit, Bedrooms, Move-in, Max income limit, Max rent, Tenant portion, Adults/children, etc.)
- ✅ Missing required fields highlighted RED ("Required — not yet filled")
- ✅ Every adult has a TICQ section (verified Jose's TICQ with tri-state yes/no/unknown buttons)
- ✅ Initial boxes and date fields render correctly in Applicant Statement
- ✅ Signature canvas pads render with placeholder text + Clear/Save buttons
- ✅ Drew + saved a signature → row visible in `recert_packet_signatures`
- ✅ Signature persists across full page refresh
- ✅ Typed a field value → row visible in `recert_packet_field_values`
- ✅ Field persists across full page refresh + status flips to "Pre-filled"
- ✅ Missing count + completion % update correctly
- ✅ Compliance banner clearly states "INTERNAL WORKFLOW TOOL — not an official LAHD or Urban Futures e-signature system"
- ✅ "Print / Save as PDF" button present at top right (browser print)

---

## 12. Remaining limitations

1. **No e-signature audit chain.** The signature is a PNG of canvas strokes — there is no cryptographic signing, IP address logging, or DocuSign-grade audit trail. The compliance banner says so explicitly. If Urban Futures requires DocuSign-style signatures, this packet is a draft/in-person tool only.

2. **Generic field labels, not exact LAHD wording.** The packet uses internal labels approximating each LAHD form section. Each field has an `officialLabelHint` ("Maps to: Project Name") that Bailey can refine once authoritative highlighted-field names are provided. See Section 13.

3. **Section text is not the official LAHD statement text.** Applicant Statement, Conflict of Interest, and Asset Certification sections show initial boxes + signature slots but do **not** reproduce the official statement language verbatim. Bailey should paste the exact statements before sending a real packet.

4. **No tenant-facing share link.** All access is manager-mediated for now (must be signed in to the BaxterOps Supabase auth). The `/tenant-packet/[secureToken]` token-based tenant link is documented but **not built** this sprint — Bailey said do not overbuild.

5. **Signatures stored as data URLs in Postgres.** Each PNG is ~28 KB inline. For 12 signature slots × dozens of cases this is fine, but if Bailey wants to keep thousands of completed packets, migrating to Supabase Storage and storing only object paths would be a small follow-up.

6. **Realtime collaboration not yet enabled on the packet page.** Two devices editing the same packet will not see each other's edits live until reload. Tables are in the realtime publication; we just haven't added a postgres_changes subscription on the packet route yet (lower priority than core functionality).

7. **Monica Orozco (the second household member from the FHSP Move-in Letter)** is seeded as a non-adult. If she is actually an adult co-tenant, Bailey should update `recert_household_members.is_adult = true` and she'll automatically get her own TICQ + Applicant Statement + COI sections on next load.

---

## 13. What Bailey needs to provide next

1. **Exact highlighted-field mappings from the official LAHD packet.** Bailey said in the sprint brief: "Claude should just be filling out the highlighted parts that we have the info for and that I will provide Claude with." The packet model has `officialLabelHint` slots ready — once Bailey sends the authoritative field names, we can swap them in and add a `packetFieldMappings` config layer for declarative re-mapping per official form version.

2. **Exact statement text** for Applicant Statement, Conflict of Interest, and Asset Certification sections. Currently we render generic "Initials: Penalty of perjury acknowledgement" labels next to initial boxes. Bailey should paste in the LAHD verbatim statement language so the tenant initials are next to the right paragraph on screen.

3. **Confirmation on Monica Orozco's adult status** (see #7 in limitations).

4. **Which other units to seed.** This sprint built and validated the workflow on Unit 712 (Jose Humberto Ocaranza-Garcia). Bailey listed 25 unit folders in `/Users/shane/Desktop/Baxter Data/`. Each one would need a `recertification_cases` row + `recert_household_members` rows seeded from the corresponding PDFs. A bulk seed script could be written if Bailey wants to onboard all 25 at once — but each unit's tenant PII would land in Supabase, so Bailey should approve before that bulk operation.

5. **Whether Supabase realtime is enabled at the project level.** From Sprint 12 we know the realtime WebSocket doesn't currently connect. This affects packet collaboration but not the core save flow. See Sprint 12 report.

6. **Decision on tenant-facing share links.** If Bailey wants tenants to fill out fields and sign without a manager present, a `/tenant-packet/[secureToken]` route with token-based RLS is doable in a follow-up sprint. Until then, the packet is opened by the manager in person on the iPad.

---

## Sprint 14 Verdict

The HTML/iPad packet workflow is shipped, type-clean, build-clean, and verified end-to-end on Unit 712 with screenshots:

- Known fields **pre-fill green** from BaxterOps case data.
- Missing required fields stay **blank with red highlight** for the tenant/manager to fill on iPad.
- Signature pads **work with touch/stylus** and save PNG data URLs to Supabase.
- **Autosave + signature persistence** both confirmed across full page refresh.
- Completion percentage + missing counts **update live** as fields and signatures save.
- The output is **HTML, not PDF**. Print/Save-as-PDF is a browser-print fallback only.
- Compliance posture: explicit banner states this is an **internal workflow tool**, not an official LAHD/Urban Futures e-signature system, and **manager review is required** before submission.

Bailey can now walk into a tenant meeting with an iPad, open `/recertification/[caseId]/packet`, see Jose's case pre-filled, fill the rest with the tenant present, capture both signatures, and (optionally) print to PDF — all without ever generating a PDF as the primary output.
