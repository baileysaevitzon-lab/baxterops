# BaxterOps — Current Status Checkpoint

_Last updated: 2026-06-11. Internal status note. BaxterOps is an ownership/property-ops system for The Baxter Hollywood (1818 N Cherokee, SGD) — recertification automation, vacancy reduction, 2BR competitive analysis, competitor intelligence, and owner deliverables. Recert is one pillar, not the whole product._

## Recertification compiler — OPERATIONAL DRAFT

**What works**
- KBI-reviewed Victoria (Unit 511) packet is the golden standard; generator matches 141/163 golden fields (the intentional diffs are the corrected $876 max-rent typo and the confirmed total-rent formula).
- Universal Baxter/Katherine defaults (owner FWP Baxter LLC, agent Katherine Ingersoll/Director, project/address, all-electric utilities, duly-authorized-agent checkboxes) — applied to every packet, not hardcoded per tenant.
- Utility allowance verified against the HACLA Multi-Family schedule (eff. 2025-12-01). UA depends on bedroom/unit type + tenant-paid utilities only — never income/subsidy.
- Victoria math locked: Studio/0BR treatment, UA $35, max rent $876, total unit rent = tenant + UA + subsidy = $2,221.83.
- Form-mapping bugs fixed: owner/agent fields, checkboxes, TIC-Q mapping, page-6 assets, "BMS" profile fallback, covenant unit-type labels (0→"Single", 1→"One", 2→"Two").
- **Manager Auto-Fill engine** (`lib/services/recertManagerAutoFill.ts` + `components/ManagerAutoFillPanel.tsx`): reusable, derives UA / covenant rent + income limits / income + asset structure from covenant constants + tenant answers + accepted docs. Preview is **read-only**; Apply is **confirm-gated** and writes only draft / needs_review values.

**Intentionally still manual (by design)**
- Tenant portion + subsidy come from the HACLA rent determination — never auto-computed.
- Income/asset **amounts** (no OCR) — engine proposes the row + source, manager keys the number.
- Final review + signatures happen in the existing tenant/manager flow.

**What staff must approve**
- Every auto-derived value before it reaches the official PDF (nothing is `manager_approved` until a person says so).
- The system **never auto-submits or auto-approves** a packet. Hard rule: auto-fill prepares and gates; staff approves; system never finalizes.

**Known open items**
- Page 16 household-member date: actual date vs "TBD" — Katherine decision.
- Page 24 verification fields (completion responsibility — Lucas/Katherine) — unconfirmed.
- Manager-form PDF parsing not built yet (manager values are read from saved responses / case data, not parsed from an uploaded manager PDF).
- Supporting docs: Government IDs missing for most cases; several screenshots/scans still `needs_review`.
- Elizabeth and other tenants are intentionally NOT completed — automation is ready, but no batch completion until requested.

## Other pillars (summary — see roadmap)
- **2BR Competitive Analysis** (`/two-bedroom-analysis`): owner-facing, market-rate vs restricted split, live June-9 competitor band + conflicts, action plan. Working.
- **Competitor intelligence** (`/competitors`, `/competitor-intelligence`): real field-tour data + staged research + conflicts, but carries low-confidence uploaded-report rows and flagged bad data (Ava/Camden sqft, duplicate 1600 Vine) to clean up.
- **Weekly owner dashboard**: not built yet — the highest-value next step for ownership.
- Marketing ROI / Lead Funnel / Local Partnerships: localStorage/static-seed, hidden from nav — not production data.
