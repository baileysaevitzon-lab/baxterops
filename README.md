# BaxterOps

Internal web platform for SGD / SD Property Management — **The Baxter Hollywood** (1818 N Cherokee Ave, LA 90028).

Built as a **Baxter Competitive Intelligence + Recertification Command Center**: comp database, covariate matching, pricing model, walkthrough campaign manager, marketing ROI, recertification CRM, and weekly report generator.

## Run

```bash
npm install
npm run dev
# → http://localhost:3000
```

## Modules

| Route                     | Purpose                                              |
|---------------------------|------------------------------------------------------|
| `/`                       | Executive dashboard — Baxter vs comp gap            |
| `/baxter-units`           | Unit-level tracker with leasing covariates           |
| `/competitors`            | Hollywood comp database (18 properties seeded)       |
| `/comp-matching`          | Weighted-distance closest-comps engine               |
| `/pricing-model`          | Pseudo-regression rent estimate                      |
| `/photos-amenities`       | Photo + amenity tracker                              |
| `/walkthrough-campaigns`  | In-person tour planner (script, persona, post-form)  |
| `/marketing-roi`          | Channel ROI (apartments.com, Zumper, Craigslist…)    |
| `/lead-funnel`            | Lead → Toured → Applied → Signed                     |
| `/tenant-outreach`        | Recertification CRM with copyable templates          |
| `/recertification`        | Affordable compliance tracker                        |
| `/utility-allowance`      | LAHD utility allowance + cap calculator              |
| `/tasks`                  | Cross-module task manager                            |
| `/reports`                | Weekly report generator                              |
| `/settings`               | Data import + matching weights                       |

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind · Recharts · in-memory mock data (no backend yet).

## Seed data

- Baxter from market-comp report dated **2026-05-26**
- 17 Hollywood competitors from the same report (rents, sq ft, occupancy, leased %, specials)
- Baxter units 105, 301, 306, 308, 312 with qualitative covariates from the meeting transcript

See `lib/seed.ts`.

## Disclaimer

This is an **operating model**, not an appraisal. Predicted rents should be validated against real leasing outcomes. Tenant outreach templates draft only — no automated sending without explicit SendGrid/Twilio integration.
