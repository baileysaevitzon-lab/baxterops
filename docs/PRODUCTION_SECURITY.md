# BaxterOps — Production Security Reality

**Status: NOT production-grade. Safe for trusted internal SGD users only on the local network or a private Vercel preview. DO NOT share publicly.**

## Current state (verified 2026-05-27)

- Supabase row-level security (RLS) is **enabled** on every public table.
- Every policy is **permissive** with `using=true` and `with_check=true` against `anon` and `authenticated`.
- Translation: anyone holding the publishable / anon key (which ships in the browser) can `select / insert / update / delete` every row in every table — `audit_logs`, `manual_covariate_scores`, `data_source_ledger`, `competitor_*`, `local_partnerships`, `photo_evidence`, everything.
- The Storage bucket `baxter-ops-photos` is **public-read** and has anon write+update policies. Public URLs work for everyone with the link.
- The UI implements role-based redaction via `<ProtectedField>` / `useRole()`. That is **client-side only**. A user opening DevTools or hitting the Supabase REST endpoint directly can bypass it entirely.
- Audit log writes go to Supabase but a bypassed client can also `delete from audit_logs`.

## What this means

| Audience | Safe? |
|---|---|
| Local dev on your laptop | ✓ yes |
| Trusted SGD team on a private Vercel preview URL | ✓ acceptable for MVP |
| A coworker who can keep a URL secret | ⚠ borderline — the publishable key is in the JS bundle |
| A landlord-info-blog reader, anonymous internet visitor | ✗ **NO** — every row of tenant + Yolanda-Benning-style compliance data is readable |
| Listed on bmsbets.com root for public traffic | ✗ **NO** until RLS is locked down |

## Why NEXT_PUBLIC_SUPABASE_ANON_KEY is okay in the browser, but not enough

The Supabase model expects the anon key to be public. Browser apps publish it. RLS policies are the actual security boundary. **If RLS lets anon do anything, your "anon key in the browser" + "permissive RLS" = no security.**

The fix is not to hide the anon key. The fix is to write real RLS policies.

## Why UI RBAC (`<ProtectedField>` + `useRole`) is not enough

Anyone with browser DevTools can flip their `localStorage.baxter-ops.currentUser` to `u-steve` and become Admin. The UI then renders sensitive data. Even simpler: anyone with the anon key can `curl` Supabase directly and skip the UI entirely.

UI RBAC is a UX feature, not a security feature.

## Why service-role key is forbidden in frontend

The service-role key bypasses ALL RLS. If it ships in the JS bundle, every visitor effectively has root on the database. This project never imports it; the only reference is a comment in `lib/supabase/client.ts` explicitly warning against it. Keep it that way.

## Required next steps before public deployment

### Phase 1 — auth
- Enable Supabase Auth.
- Provision real user rows for Steve / Catherine / Evan / Lucas / Joanna / Bailey / Shane / Ownership.
- Map each Supabase auth user to a `role` claim (or join table) matching the `MOCK_USERS` table in `lib/auth.ts`.

### Phase 2 — replace permissive policies with auth-aware policies

For each table below, drop the current `*_anon_all` policy and create per-cmd policies that check `auth.uid()` and the user's role claim.

Tables needing policies:

| Table | Sensitivity | Suggested policy outline |
|---|---|---|
| `competitor_field_tours` | medium | authenticated read; insert/update requires `role in (Admin, Manager, Analyst, Leasing)` |
| `competitor_unit_observations` | medium | same |
| `competitor_amenity_observations` | medium | same |
| `competitor_source_verifications` | medium | same |
| `competitor_overrides` | medium | same |
| `data_source_ledger` | medium | authenticated read; write restricted; **no anon access** |
| `source_conflicts` | medium | same |
| `manual_verification_queue` | medium | same |
| `data_quality_flags` | medium | same |
| `manual_covariate_scores` | medium | authenticated read; write only by the scorer or `Admin/Manager` |
| `photo_evidence` | medium | authenticated read; write `Admin/Manager/Analyst` |
| `app_tasks` | medium | authenticated read; write `Admin/Manager` |
| `local_partnerships` | medium | authenticated read; write `Admin/Manager/Analyst` |
| **`audit_logs`** | **high** | `insert only`, `select` restricted to `role in (Admin, Manager)`, **no delete except Admin** |
| `tenants` (when added) | **high** | strict — only `role in (Admin, Manager)` can select; redact tenant.privateNotes column for `Leasing/Analyst` |
| `recertification_cases` (when added) | **high** | same as tenants |

The current schema does not yet have a `tenants` table — the four seeded tenants live in `lib/seed.ts` as a static export, so they ship in the JS bundle. Anyone viewing the JS gets `t-yolanda` private notes regardless of RLS. **Move tenant data into Supabase with strict RLS before public sharing.**

### Phase 3 — storage

Currently `baxter-ops-photos` is `public = true` with anon select/insert/update.

- If photos contain anything sensitive (interior shots that identify tenants), make the bucket private and use signed URLs.
- Even if photos stay public-read, restrict insert/update to authenticated `Admin/Manager/Analyst` roles.

### Phase 4 — audit log integrity

`audit_logs` must become append-only for everyone except Admin (who can clear during audits). Current policy lets anon truncate it. Until fixed, the audit log is not legally / operationally trustworthy.

### Phase 5 — verify

1. Reload the app while logged out — every protected route should error or return empty.
2. Curl Supabase REST anonymously — every protected table should return 401 / empty.
3. Log in as an Analyst and try to update an audit-log row — should fail.
4. Log in as Admin and view Yolanda's private notes — should succeed and produce an `audit_logs` row.
5. Log in as a Viewer and attempt to read `manual_verification_queue` — should be denied.

## Recommended role model (matches `lib/auth.ts`)

- **Admin** — full read/write/delete; only Admin can clear audit_logs.
- **Manager** — full read of all sensitive tenant + compliance data; write to most tables.
- **Leasing** — read general tenant outreach status; cannot view income / private notes / LAHD cap data.
- **Analyst** — read market + comparison + marketing data; cannot read sensitive tenant data; can write covariate scores, field tours, photos.
- **Viewer** — read owner-safe reports + dashboards only.

## Bottom line

**Until phases 1-4 are done, BaxterOps is internal-only. The current Supabase deploy is convenient for development, but the anon key is public and the RLS is wide-open.** Sharing the URL widely is the same as publishing the database.
