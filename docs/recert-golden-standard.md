# LAHD Recertification — Golden Standard (KBI)

**Internal documentation — do not surface tenant data in public UI.**

## The golden reference

- **File:** `LAHD-recert-Victoria_Ibrahim-unit-511- edited by KBI.pdf` (received **2026-06-11**, Shane's Desktop)
- **Authority:** Katherine Ingersoll (KBI) reviewed, corrected, and filled this packet. It is the authoritative reference for how BaxterOps generates the final LAHD income-certification form.
- **What it verifies:** field mapping, checkbox placement, owner/agent defaults, rent/subsidy/UA math, signature/initials/date behavior ("TBD" until countersign), and final-packet completeness.

## Universal Baxter defaults (Sprint 38)

Defined in `lib/services/recertExactFormFill.ts` → `BAXTER_RECERT_DEFAULTS`. Apply to **every** Baxter packet:

| Field | Value |
|---|---|
| Project name | 1818 North Cherokee Avenue |
| Property address | 1818 N Cherokee Ave, Los Angeles, 90028 |
| Owner | FWP Baxter, LLC |
| Owner phone | 858-945-1190 |
| Owner address | PO Box 7132 Rancho Santa Fe, CA 92067 |
| Owner/agent email | katherine@faulknercapitalpartners.com |
| Duly authorized agent | Katherine Ingersoll, Director |
| Submitter role | Duly Authorized Agent (boxes `3-Duly Authorized Agent`, `3-Agent`, `6-Agent` checked) |
| Utilities (all-electric bldg) | `5-ElectricCooking`, `5-BasicElectricity`, `5-AirConditioning`, `5-ElectricSpaceHeating` checked |
| OPM dates before countersign | literal `TBD` (pages 6, 11, 16, 17) |

The old "BMS" placeholder came from the signed-in user's auth profile (`full_name = "BMS"`) flowing into OPM-name fields via an unfiltered `user_profiles` lookup. That path is removed; the agent defaults above are used unless the request body explicitly overrides them.

## What stays case-specific (never global)

Tenant name/unit/contact, household composition, sqft (per-case override `3-Unit Square Footage`), move-in date, income level schedule, rent/UA/subsidy amounts, income sources, assets, ages, signatures/initials/dates, certification-type checkboxes (e.g. `5-Post MoveIn Cert` is an rc-511 override, not a default).

Victoria's values live in: `recertification_cases`, `recert_household_members`, `recert_income_sources`, `recert_asset_accounts`, `recert_utility_allowance`, `recert_case_field_overrides`, `recert_packet_field_values` (rows tagged `kbi-golden-import` / `KBI golden import`).

## TIC-Q mapping fix (Sprint 38 — affects all tenants)

The simplified tenant form previously mapped its questions **sequentially** onto TIC-Q 1–8 / 18–26; the official form's order is different, so answers landed on wrong lines (e.g. Social Security → Q4 "unemployment"). Corrected map (in `recertCompletionForms.ts`):

| Simplified question | Official TIC-Q |
|---|---|
| Employment income | Q2 (`12-2`) |
| Self-employment / 1099 | Q1 (`12-1`) |
| Business / partnership | *no single line* → stored under `x-biz` for manager review |
| Social Security / SSI | Q6 (`12-6`) — SSI (Q8) left for manager |
| Unemployment / EDD | Q4 (`12-4`) |
| Child support / alimony | Q11 (`13-11`) — alimony (Q12) left for manager |
| Pension / retirement | Q13 (`13-13`) |
| Disability / workers' comp | Q9 (`12-9`) |
| Checking / savings | Q18 / Q19 (unchanged) |
| Cash on hand | Q30 (`15-30`) |
| Investments | Q25 (`15-25`) |
| Real estate | Q23 (`14-23`) |
| Trusts / life insurance | Q22 (`14-22`) — life insurance (Q28) left for manager |

Stored `recert_packet_field_values` rows for the 3 affected cases (rc-001, rc-511, rc-712) were re-keyed in place. **Questions the simplified form does not ask (Q3, Q5, Q7, Q8, Q10, Q12, Q14–Q17, Q20, Q21, Q24, Q26–Q29) stay blank** for manager verification — for rc-511 Katherine's verified answers were imported as `manager_completion` rows.

## How to regenerate / compare

1. `POST /api/recertification/{caseId}/generate-exact-form` with `{"mode":"full"}` (or `tenant_only` / `manager_only` / `preview`).
2. Extract fields from both PDFs (`pypdf` → `reader.get_fields()`, keep values not in `(None,'','/Off')`).
3. Diff against the golden PDF. As of 2026-06-11 the full-mode regeneration matches **142/163** golden fields.

## Known acceptable / open differences vs the golden PDF

- `12-Phone`, golden "ADD" → we fill the real phone (golden asked for it).
- `5-OriginalMoveIn` `02/01/2025` vs `2/1/2025` — date formatting only.
- `14-18Info1` / `16-HHMbrDate` — tenant-typed values; we never overwrite tenant answers.
- **Needs Katherine:** golden p.3 max rent `867` vs p.8 `876`; golden `5-TotalRent 2,186.83` and `8-TotalUnitRent 2211.83` vs the form's own 1+2+3 math (`2,221.83`). BaxterOps writes the computed value.
- **Page 24 (Record of Verification):** golden contains explicit placeholders ("ADD", "ADD LUCAS NAME/SIGNATURE") — intentionally not generated; manual completion by Lucas/Katherine.

The editable official template (`public/templates/lahd-recert-2026.pdf`) is **never flattened**; generated packets keep their AcroForm.

## Utility Allowance and Rent Calculation — KBI CONFIRMED (2026-06-11)

**Status: RESOLVED.** Katherine confirmed (directly + via the Baxter rent-roll/covenant workbook, Drive sheet `12l47-r2Bx4J7AQDLkKcAv-7pgWsQXvD-oGpEH9UlLyA`):

1. **Unit 511 = Studio/0BR.** The covenant calls studios "Single" (rent roll: S1, 0/1.00 BD/BA). Generator now maps covenant unit-type names: 0→"Single", 1→"One", 2→"Two".
2. **Tenant-paid set:** the all-electric utilities, **SCEP $3 included**. Note: at 0BR, Electric Cooking ($3) and SCEP ($3) are interchangeable in the math — `$35` total either way (basic 17 + space heat 7 + A/C 8 + 3). RSO fee N/A (post-1978 build; workbook marks it N/A).
3. **Utility Allowance = $35** (confirmed; matches HACLA MFR 12/01/2025 0BR column).
4. **Total Unit Rent = printed formula** tenant + UA + subsidy → Victoria 179.72 + 35 + 2,007.11 = **$2,221.83** (golden p.8's "2211.83" and p.5's "2,186.83" were golden-side inconsistencies; generator's printed-formula value is correct).
5. **Max allowable rent = $876** (covenant studio limit; golden p.3 "867" was a typo — case data corrected, so new packets intentionally differ from golden on that one field).

Still open (unconfirmed; unchanged behavior): page-16 household-member date and page-24 completion responsibility from the original template prompt were not answered. The covenant workbook also shows a separate UFBA table (Studio allowed rent $757 + UA $119 = $876 limit) used for covenant rent-limit derivation — informational only; the TIRC UA remains $35.

---

### (Superseded) original pending notes

### Researched rule (verified 2026-06-11)
Utility Allowance is determined by **bedroom count/unit type + which utilities the tenant pays** — the official schedule has **no income, grant, Social Security, or subsidy inputs whatsoever**. Bailey's understanding is confirmed.

- **Source:** HACLA "Utility Allowances for Multi-Family Residential Housing," **effective 12/01/2025** (current for this recert cycle).
  PDF: <https://hacla.org/sites/default/files/Section%208/Utility%20Allowances/Utility%20Allowance%20Schedule%202025%20-SFR%20%26%20MFR.pdf> (retrieved 2026-06-11, via <https://www.hacla.org/en/about-section-8/utility-allowances>).
- Schedule transcribed into `lib/services/utilityAllowanceSchedule.ts` (`HACLA_MFR_2025`, `calculateUtilityAllowance()` — **advisory only**, never feeds the generator).

### Victoria (Unit 511) — checked utilities per the golden PDF
Electric Cooking · Basic Electricity · Air Conditioning · Electric Space Heating (Baxter all-electric set).

### Computed scenarios (MFR schedule, those 4 components)
| Bedroom treatment | Cooking | Basic elec | A/C | Space heat | **Total** |
|---|---:|---:|---:|---:|---:|
| SRO | 2 | 10 | 5 | 4 | **$21** |
| **Studio / 0BR** | 3 | 17 | 8 | 7 | **$35 ← equals golden** |
| 1-Bedroom | 4 | 24 | 11 | 9 | **$48** |

**Finding:** golden UA **$35 exactly equals the 0BR (studio) column** — implying Katherine treats "Single"/Unit 511 as a **studio** for UA purposes, while our case data stores `bedroom_count = 1`. **Not assumed — needs her confirmation.** City fees: SCEP $3/mo exists on the MFR sheet (applicability to Baxter unconfirmed; golden excludes it); RSO $2/mo applies to pre-Oct-1978 buildings only → almost certainly N/A for Baxter.

### Unresolved rent-math conflicts (golden internal inconsistencies)
1. **Max Allowable Rent:** page 3 says **867**, page 8 says **876** (both Katherine-entered).
2. **Total rent formula:** tenant 179.72 + UA 35 + subsidy 2,007.11 = **2,221.83** (the form's printed 1+2+3 math). Golden page 5 shows **2,186.83** (= tenant + subsidy, no UA); golden page 8 shows **2211.83** (matches neither). The generator currently writes the computed **2,221.83** — flagged, not final.

### Confirmation questions for Katherine
1. Is Unit 511 SRO, studio/0BR, or 1BR for the HACLA UA schedule?
2. Which tenant-paid utilities count (the 4 electric ones? plus SCEP $3?)?
3. Is $35 correct, and which components produce it?
4. Should Total Unit Rent = tenant + UA + subsidy (printed formula) or tenant + subsidy?
5. Max rent: 867 or 876?
6. Should page 8 follow the printed formula exactly?
