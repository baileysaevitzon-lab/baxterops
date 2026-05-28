# Sprint 11 — Cross-Device Live Sync: Final Report

**Date:** 2026-05-28  
**Sprint goal:** Diagnose and fix the cross-device data sync failure Bailey reported. Data edited on one computer must appear on another.

---

## Root Cause Diagnosis

### Root Cause #1 — `persistSession: false` _(CRITICAL)_

**File:** `lib/supabase/client.ts`

The Supabase client was initialized with `auth: { persistSession: false }`. This destroyed the auth session on every page reload. Every RLS-protected database read returned `[]` (empty), silently. Users appeared signed in (the AuthProvider knew about them) but Supabase's internal token was wiped on each navigation event.

**Fix:** Removed the `auth` config block entirely. Supabase defaults to `persistSession: true`, which stores the token in localStorage so it survives reloads.

```diff
- cached = createClient(url!, key!, {
-   auth: { persistSession: false },
- });
+ // Sprint 11: persistSession defaults to true — sessions stored in localStorage
+ cached = createClient(url!, key!);
```

### Root Cause #2 — Walkthrough tours wrote only to localStorage

**File:** `app/walkthrough-campaigns/page.tsx`

The `save()` function called `upsertTour()` from `lib/storage.ts`, a pure localStorage adapter. Supabase's `competitor_field_tours` table was never written to. A second device loading `/competitors` or `/comp-matching` would never see the tours.

**Fix:** `save()` now calls `saveFieldTour()` (Supabase write) in addition to the existing localStorage write. The Supabase write is non-fatal — if it fails, the local save still succeeds and a warning is logged.

### Root Cause #3 — No indication when signed out

Pages showed empty data (or static seed data) without any explanation. Users had no way to know they were not authenticated.

**Fix:** `LiveDataBanner` component added to all 6 critical data pages. Shows an amber banner with a "Sign in →" link when the user is not authenticated. Silent when signed in.

---

## Features Shipped

### 1. `LiveDataBanner` component
**File:** `components/LiveDataBanner.tsx`

- Amber banner shown on all data pages when user is not signed in
- Shows "Viewing static snapshot data. Live Supabase intelligence requires authentication."
- Special message variant when Supabase is not configured at all
- No flash on load (returns null while auth state is loading)
- Added to: `/competitors`, `/competitor-intelligence`, `/comp-matching`, `/walkthrough-campaigns`, `/competitors/[id]`, `/add-tour`

### 2. Supabase Realtime subscriptions
**Files:** `app/competitors/page.tsx`, `app/competitor-intelligence/page.tsx`, `app/competitors/[id]/page.tsx`

Each page subscribes to `postgres_changes` on `competitor_intelligence_summary`. When any device writes an update, all other connected devices receive a push event and re-fetch from Supabase within ~1 second — no page reload required.

Channels:
- `"competitors-page-intel"` → refreshes all intelligence summaries on `/competitors`
- `"intel-page-summaries"` → refreshes the full matrix on `/competitor-intelligence`
- `"detail-intel-{competitorId}"` → filtered to the specific competitor on `/competitors/[id]`

All subscriptions clean up via `removeChannel()` on component unmount.

### 3. "Toured Only" toggle
**Files:** `app/competitors/page.tsx`, `app/competitor-intelligence/page.tsx`, `app/comp-matching/page.tsx`

Filters the competitor list and matching matrix to only show properties that have at least one field tour in Supabase (`competitor_field_tours`) or `fieldVerified: true` in the seed. The toggle persists per-session in component state. Label switches between "★ Toured Only" and "All comps" to show current filter state.

### 4. Inline pencil editing (notes)
**Files:** `components/InlineEditField.tsx`, `lib/services/competitorIntelligence.ts`

A reusable `<InlineEditField>` component renders a value with a ✏️ button that appears on hover. Clicking the pencil opens an `<input>` or `<textarea>` in place. Changes:
- Save: writes to Supabase via `updateSummaryNotes()`, optimistically updates local state
- Cancel: Esc key or Cancel button restores the original value
- Multiline: ⌘↵ saves, Enter adds newline
- Syncs if parent value changes (Realtime update from another device)

Wired to `summary_notes` on `/competitors` (card view) and `/competitors/[id]` (detail page).

`updateSummaryNotes()` uses `upsert` with `onConflict: "competitor_id"` so it never overwrites computed threat scores — only patches the notes column.

### 5. Intelligence summary written after `/add-tour` save
**File:** `app/add-tour/page.tsx`

After all tour data is persisted (field tour, units, amenities, ledger), the page now calls `recomputeCompetitorIntelligence()` and `upsertIntelligenceSummary()`. This ensures the competitor's row in the intelligence matrix is updated immediately after a new tour is added — no manual refresh required. The compute is non-fatal: failure logs a warning but does not block the save confirmation.

---

## Files Changed

| File | Change |
|------|--------|
| `lib/supabase/client.ts` | Removed `persistSession: false` (root cause #1) |
| `app/walkthrough-campaigns/page.tsx` | Added Supabase write in `save()` (root cause #2) |
| `components/LiveDataBanner.tsx` | **New** — auth status banner |
| `components/InlineEditField.tsx` | **New** — pencil-edit UI component |
| `lib/services/competitorIntelligence.ts` | Added `updateSummaryNotes()` function |
| `app/competitors/page.tsx` | Toured Only toggle, realtime, InlineEditField, LiveDataBanner |
| `app/competitor-intelligence/page.tsx` | Toured Only toggle, realtime, LiveDataBanner |
| `app/competitors/[id]/page.tsx` | Realtime, InlineEditField, LiveDataBanner |
| `app/comp-matching/page.tsx` | Toured Only toggle, LiveDataBanner |
| `app/add-tour/page.tsx` | Intelligence summary post-save, LiveDataBanner |

---

## Build Status

```
✓ Compiled successfully — 30 routes, 0 TypeScript errors
```

---

## Manual Test Protocol (Bailey to run)

The following 6 tests must be completed by a human with access to two browser sessions or two devices. Both sessions must be signed into BaxterOps.

> **Rule:** Do not mark this sprint as fully verified until at least one test is observed live on two sessions. Supabase write confirmation alone is not sufficient.

---

### Test 1 — Walkthrough tour sync

**Goal:** A tour saved on Device A appears on Device B without a page reload.

**Steps:**
1. Device A: open `/walkthrough-campaigns`. Create a new tour for any competitor. Click Save.
2. Device B: open `/walkthrough-campaigns`. Wait up to 5 seconds.
3. Device B: open `/competitors` and toggle "★ Toured Only".

**Pass criteria:**
- The tour saved on A is visible in Device B's walkthrough list
- The toured competitor appears in the Toured Only filter on Device B

**What to look for:** If the tour does NOT appear on Device B after 10 seconds, check the browser console on Device A for `[walkthrough-campaigns] Supabase write failed` — this means the Supabase write is failing (likely auth issue).

---

### Test 2 — Intelligence notes sync (realtime)

**Goal:** A note edited on Device A appears on Device B within ~1 second without a page reload.

**Steps:**
1. Device A: open `/competitors`. Hover over a competitor card. Click the ✏️ pencil next to the notes field. Type a new note. Click Save.
2. Device B: same `/competitors` page must already be open (do not reload).
3. Observe Device B's screen.

**Pass criteria:**
- Device B's notes field updates within ~1–3 seconds without any user action
- The updated note also persists after a hard reload on Device B

**What to look for:** If the update is not received in real time, check Supabase Dashboard → Database → Replication to confirm the `competitor_intelligence_summary` table has replication enabled.

---

### Test 3 — Signed-out experience shows banner (not empty UI)

**Goal:** An unauthenticated user sees a clear sign-in prompt, not a blank page.

**Steps:**
1. Open an incognito/private window (no prior session).
2. Navigate to `/competitors` without signing in.

**Pass criteria:**
- The amber `LiveDataBanner` is visible near the top of the page: _"Viewing static snapshot data. Live Supabase intelligence requires authentication."_
- A "Sign in →" link is present and navigates to `/login`
- The page does NOT show an error, spinner, or completely blank content

---

### Test 4 — "Toured Only" filter is accurate

**Goal:** The toggle filters to exactly the competitors with verified field tours.

**Steps:**
1. Sign in. Open `/competitors`.
2. Note the total number of competitor cards shown.
3. Click "★ Toured Only".

**Pass criteria:**
- The list shrinks to show only competitors that have at least one tour in Supabase OR `fieldVerified: true` in seed data
- Currently seeded as field-verified: Zen (zenith-broadway), The Jardine, Highland, 1600 Vine (verify these match what you see)
- The toggle label switches to "★ Toured Only" (green) when active and back to "All comps" when inactive

---

### Test 5 — Pencil edit writes to Supabase

**Goal:** A note edited via the inline pencil is confirmed written to the database.

**Steps:**
1. Sign in. Open `/competitors`. Hover a competitor card. Click ✏️. Enter a unique test string like `sync-test-2026-05-28`. Save.
2. Reload the page (hard refresh).
3. Open Supabase Dashboard → Table Editor → `competitor_intelligence_summary`. Find the row for that competitor.

**Pass criteria:**
- After reload, the test string is still visible in the competitor card (not reverted to old value)
- The `summary_notes` column in Supabase for that competitor shows the test string
- The `updated_at` timestamp reflects the save time

---

### Test 6 — Add Tour triggers intelligence matrix update

**Goal:** Completing `/add-tour` immediately updates the competitor's row in `/competitor-intelligence`.

**Steps:**
1. Sign in. Open `/competitor-intelligence` and note the last-updated time (or threat score) for any competitor.
2. In a second tab, open `/add-tour` for the same competitor. Fill in at least 2–3 unit rows and a few covariate scores. Submit.
3. Return to the `/competitor-intelligence` tab. Reload the page.

**Pass criteria:**
- The competitor's row in the intelligence matrix shows updated data
- Check Supabase Dashboard → `competitor_intelligence_summary` — the row's `updated_at` should match the time of the `/add-tour` save
- No error toast appeared after the tour save

**What to look for:** If the matrix does not update, check the browser console for `[AddTour] intelligence summary compute failed` — this means `recomputeCompetitorIntelligence()` threw, likely due to missing unit data.

---

## Security Constraints Verified (unchanged from Sprint 10)

| Constraint | Status |
|------------|--------|
| No public anon table access | ✓ All tables require `auth.role() = 'authenticated'` |
| Authenticated-only writes | ✓ RLS `WITH CHECK` blocks unauthenticated inserts |
| Audit log anti-spoof | ✓ `user_id` set server-side via `auth.uid()` |
| Storage uploads authenticated-only | ✓ Storage bucket policy unchanged |
| No service role key in frontend | ✓ Only `NEXT_PUBLIC_SUPABASE_ANON_KEY` in bundle |
| No sensitive tenant data in seed/bundle | ✓ Resident PII remains server-side only |
| Empty UI replaced by sign-in prompt | ✓ `LiveDataBanner` on all 6 critical pages |

---

## Known Limitations / Not In Scope

- **`/photos-amenities`, `/pricing-model`, `/data-quality-dashboard`, `/number-inventory`, `/reports`** — `LiveDataBanner` was not added to these pages in Sprint 11. They are lower-risk (less likely to show dangerously stale data as authoritative) but should be covered in a future sprint.
- **Inline editing is wired to `summary_notes` only.** Editing rent, unit counts, or covariate scores via pencil is not yet implemented. Those writes are more complex (they affect computed threat scores) and require a separate sprint.
- **The "Toured Only" filter on `/comp-matching` reads `COMPETITORS` seed + Supabase tour IDs** but does not yet pull the full Supabase competitor list. If a net-new competitor exists only in Supabase (not in `lib/seed.ts`), it won't appear in comp-matching. This is a known limitation of the current architecture.

---

## Sprint 11 Verdict

All code changes are complete and the build passes. The three root causes of the cross-device sync failure have been resolved. Manual verification by Bailey is required to confirm the fixes are observable end-to-end in two live browser sessions.
