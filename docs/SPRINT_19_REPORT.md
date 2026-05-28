# Sprint 19 — Tenant Roster + Conditional Follow-up Questions

Date: 2026-05-28
Author: Shane (Cornell) + Bailey (Cornell)
Scope: Make the tenant completion workflow accurate and production-ready by
(1) adding conditional follow-up questions on every Yes/No, and (2) introducing
a tenant roster with eligibility + invitation lifecycle tracking.

## Bailey's Sprint 19 ask

> The current tenant completion form is a good start, but the workflow needs to
> become more accurate and production ready.
>
> **Main correction:** The tenant form must support conditional follow up
> questions. Example: If the tenant answers Yes to employment income, the form
> must immediately show follow up fields such as Name of employer, Monthly
> gross income, etc. If the tenant answers No, those follow up fields should
> stay hidden and should not be required.
>
> **Tenant roster requirement:** Add a tenant roster seed list so management
> can select tenants and generate completion links for them. Every tenant
> below should be eligible for recertification except Thamara Matthews and
> Jayson Burch. The excluded tenants should appear as not eligible or blocked
> from the recertification workflow.

## Outcome

Both asks shipped end-to-end. Build passes with **36 routes, 0 type errors**.
New table seeded with **17 tenants (15 eligible + 2 blocked)** matching the
units in Bailey's screenshot exactly. The tenant completion form now hides
follow-up fields on a "No" answer, deletes any previously-saved follow-up
values on a Yes → No flip, and the PDF merge step skips orphan rows even if
the UI delete didn't fire.

## Changes by file

### Database

`migrations/create_recert_tenant_roster_sprint19.sql` — new table:

```
recert_tenant_roster (
  id text primary key,
  tenant_name text not null,
  unit_number text not null unique,
  eligible boolean not null default true,
  blocked_reason text,
  case_id text references recertification_cases(id),
  invitation_token text unique,
  invitation_sent_at timestamptz,
  invitation_opened_at timestamptz,
  manager_reviewed_at timestamptz,
  final_pdf_generated_at timestamptz,
  status text not null default 'not_sent',
  created_at, updated_at
)
```

RLS: authenticated-only read + write (same as Sprint 18 tables).
REPLICA IDENTITY FULL + added to `supabase_realtime` publication so the
roster page receives live updates across browsers.

**Seeded rows (17):** the 15 eligible tenants listed in the Sprint 19 prompt
(units 111, 203, 208, 307, 310, 314, 405, 409, 413, 511, 604, 607, 610, 706,
712) plus the 2 blocked rows for unit 406 (Thamara Matthews) and unit 508
(Jayson Burch). Unit 712 pre-links to the existing `rc-712-ocaranza-2026`
case from earlier sprints.

### Service layer

**`lib/services/recertTenantRoster.ts`** (NEW)

- `loadRoster()`, `loadRosterEntry(id)`, `loadRosterByToken(token)` — reads
- `addTenant({ tenantName, unitNumber, eligible?, blockedReason? })` — adds
  a new tenant; generates deterministic id `trr-unit-{unit}-{slug-name}`
- `startRecertificationFor(rosterId, opts?)` — creates a `recertification_cases`
  row pre-filled with name + unit, links it to the roster entry, writes
  `recert_audit_events.roster_case_started`. Idempotent: re-running returns
  the existing case_id rather than duplicating
- `generateInvitationToken(rosterId)` — issues a 32-char hex token via
  `crypto.getRandomValues`. Rejects blocked tenants
- `markSent / markOpened / markManagerReviewed / markMerged` — atomic
  timestamp + lifecycle status update
- `refreshRosterStatusFromSessions()` — re-derives `in_progress` /
  `submitted` from `recert_completion_sessions.status` so the roster reflects
  tenant-side activity without coupling form-saves to roster updates
- `buildInvitationUrl(origin, caseId, token)` — produces the
  `/recertification/{caseId}/tenant-completion?invite=<token>` link
- `describeStatus(s)` — UI label + tone for the status pill

**`lib/services/recertCompletionForms.ts`** (extended)

`CompletionFormField` gained four optional fields for conditional logic:

```ts
parentFieldName?: string;        // PDF field name of the controlling parent
parentTriggerValue?: string;     // value that activates this child (e.g. "yes")
clearsValueWhenHidden?: boolean; // default true — orphans get deleted
requiredWhenVisible?: boolean;   // required only when parent matches trigger
```

Three new exported helpers used by the form view + the API merge:

- `isFieldVisible(field, responses)` — true iff parent matches trigger (or
  no parent at all)
- `computeDynamicRequired(sections, responses)` — counts required visible
  fields only
- `clearOrphanedFollowups({ caseId, role, schema, responses })` — best-effort
  cleanup of stored values for fields whose parent no longer matches trigger

TICQ income (page 12, questions 1–8) now expands to **20 fields**: each
Yes/No plus its Info (where present) and Monthly children. Self-employment
(12-2) adds two optional secondary slots for the PDF's `12-2Info{2,3}` /
`12-2Monthly{2,3}` widgets.

TICQ assets (pages 14–15, questions 18–26) now expand similarly to cover
`Info{1,2}`, `Value{1,2}`, `Interest{1,2}` for each Yes/No, except 14-20
(cash on hand) which only has a single `Value` widget per the LAHD PDF.

`countCompleted` was updated so orphan follow-ups don't count toward the
"completed" total when they're hidden.

### UI

**`components/CompletionFormView.tsx`** (extended)

- Top-bar progress (`pctRequired`, `requiredComplete`, `missing`) now uses
  `visibleFields` so hidden follow-ups don't drag the percentage down
- Section nav badge counts skip hidden required follow-ups too
- `saveField()` computes the post-save value map locally; if the saved field
  is a parent and the new value moves away from a child's `parentTriggerValue`,
  the child rows are nulled in local state AND a follow-up
  `saveCompletionResponse(... valueText: null ...)` is fired per orphan
- `valueJson` now persists `parentFieldName` + `parentTriggerValue` so the
  API merge can replicate the visibility check without re-loading the schema
- `SectionView` groups children directly under their parent and only renders
  them when the parent's answer matches the trigger. Visual treatment: small
  emerald rail + "↳ Because you answered Yes, please fill in:" header
- `ReviewView` filters hidden fields and indents visible children

**`app/recertification/roster/page.tsx`** (NEW)

The management-facing roster page:

- Eligible / Blocked tabs with row counts
- Per-row status pill (Not sent · Sent · Opened · In progress · Submitted ·
  Manager reviewed · Merged into PDF · Blocked)
- "Start Recertification" → calls `startRecertificationFor`, links the case
- "Copy tenant link" → ensures case exists, generates token, writes URL to
  clipboard, marks `invitation_sent_at`. Shows the URL inline so the manager
  can verify before sharing
- Inline "Add a new tenant" form on the Eligible tab (name + unit, eligible
  by default)
- Realtime subscription to `recert_tenant_roster` so status updates appear
  without refresh

**`app/recertification/[caseId]/tenant-completion/page.tsx`** (extended)

When a tenant arrives with `?invite=<token>`, the page looks up the matching
roster entry by token and calls `markOpened` if it matches this case and
hasn't already been opened.

**`app/recertification/page.tsx`** + **`app/recertification/[caseId]/page.tsx`**

Both add a prominent link to `/recertification/roster` so the workflow is
discoverable from either the main dashboard or any case page.

### API

**`app/api/recertification/[caseId]/generate-exact-form/route.ts`** (extended)

Completion-merge step now:

1. Builds a `(packet_id, field_key) → value_text` map in O(n) up-front
2. For each row, looks up `value_json.parentFieldName`. If set, fetches the
   parent's stored answer from the map. If the parent value ≠
   `value_json.parentTriggerValue`, **skips the row** and increments
   `orphans_skipped`
3. Otherwise applies as before (yes/no → Y/N checkboxes via resolverPair,
   initial fan-out to 11-Initial1..7, generic text, etc.)

Response headers now include `X-Completions-Applied` + `X-Orphans-Skipped`
for debugging. Audit event payload + `recert_generated_packets.missing_data_json`
both include `orphans_skipped`.

Final step: writes `final_pdf_generated_at` + `status = 'merged'` on any
roster row pointing to this case_id (advances the lifecycle to "Merged into
PDF" without coupling the API to the roster service).

## Verification

### Build

```
npm run build
✓ Compiled successfully
✓ Generating static pages (32/32)
Route (app)                                            Size     First Load JS
...
├ ƒ /recertification/[caseId]/tenant-completion        3.05 kB   176 kB
├ ○ /recertification/roster                            6.04 kB   161 kB
```

36 routes, 0 TypeScript errors, 0 ESLint blockers.

### Roster seed verification

```sql
select eligible, count(*), array_agg(unit_number order by unit_number)
from public.recert_tenant_roster group by eligible;
```

| eligible | n  | units                                                          |
|----------|----|----------------------------------------------------------------|
| true     | 15 | 111, 203, 208, 307, 310, 314, 405, 409, 413, 511, 604, 607, 610, 706, 712 |
| false    | 2  | 406, 508                                                       |

Exactly matches Bailey's screenshot. Unit 712 is pre-linked to
`rc-712-ocaranza-2026` so the existing test case is reachable from the roster
without a fresh "Start Recertification".

### Orphan-skip verification (database)

Inserted a `12-1Y = yes` parent + two child rows (`12-1Info = "ACME Hollywood"`
+ `12-1Monthly = "2500"`) each with `value_json.parentFieldName = "12-1Y"`,
`parentTriggerValue = "yes"`. Then flipped the parent to `no` without
deleting the children — i.e. the worst case where the UI cleanup didn't fire.

The children remain in the table but their parent's stored answer (`no`) no
longer matches their trigger (`yes`). When `/api/recertification/.../generate-exact-form`
runs:

- The map lookup yields parent value `"no"` for both children
- `parentAnswer !== parentTriggerValue` → both rows skipped, `orphans_skipped += 2`
- `12-1Info` + `12-1Monthly` are NOT written to the LAHD PDF

After verification, the test rows were cleaned up. `rc-712-ocaranza-2026`
remains in the same Sprint 18 baseline (`12-1Y = yes` only).

### Conditional UI verification (manual)

1. Open `/recertification/rc-712-ocaranza-2026/tenant-completion` — Section 5
   "Income questions (TICQ)" lists all 8 Yes/No questions
2. Click "Yes" on Question 1 — two follow-up inputs slide in beneath it with
   the emerald rail: "Employer name" + "Monthly gross amount (USD)"
3. Both are marked required (red asterisk), and the progress bar advances by
   2 required slots
4. Click "No" — the follow-up fields hide and the progress bar resets the 2
   slots back. Any text typed into them gets nulled in local state
5. Section nav badge counts no longer include hidden orphans

### Lifecycle verification

The status pill on `/recertification/roster` advances through these steps:

| Trigger                                                  | Status              |
|----------------------------------------------------------|---------------------|
| Roster seed (eligible)                                   | Not sent            |
| Click "Copy tenant link"                                 | Sent                |
| Tenant opens form via `?invite=<token>` URL              | Opened              |
| Tenant saves any field in their form                     | In progress         |
| Tenant clicks Submit on the completion form              | Submitted           |
| Manager submits their completion form                    | Manager reviewed    |
| Manager generates final PDF                              | Merged into PDF     |
| Roster seed (blocked)                                    | Blocked             |

In-progress / submitted are derived from `recert_completion_sessions.status`
by `refreshRosterStatusFromSessions()` on roster page load (so the form-save
path stays decoupled).

## Constraints preserved

- Signature protections from Sprint 17 are untouched — typed signature
  capture still requires consent + an explicit submit
- Manager review still required (banner kept on the Completion Portals card)
- No new public-anon data access — RLS on `recert_tenant_roster` is
  authenticated-only
- Audit events written for `roster_case_started` and the existing
  `exact_form_fill_generated` event now also tracks `orphansSkipped`
- Blocked tenants have ALL workflow buttons hidden in the roster UI; the
  service layer also rejects `startRecertificationFor` /
  `generateInvitationToken` for ineligible rows server-side

## Known limitations

- The "Manager reviewed" lifecycle pill activates when the manager submits
  their completion form. We don't currently distinguish that from "the manager
  reviewed the tenant's submission" because we don't have a separate review-
  approval action. Bailey can decide whether a separate explicit review step is
  needed in Sprint 20
- Invitation tokens are durable (no expiry) — this is fine for internal use
  but should be revisited if the link is ever sent through email
- The 32-char hex token is good entropy but is generated client-side. The
  server doesn't yet validate that tokens match the case before allowing form
  saves. Sprint 20 candidate: server-side token check + RLS policy that
  scopes tenant access to their own case via a `recert_completion_sessions`
  link rather than full authenticated access

## Sprint 20 candidates

- Inline edit on roster rows to fix typos in tenant_name or unit_number
- Bulk-add tenants from a CSV upload
- Per-tenant resend / regenerate-token controls (currently the "Copy link
  again" button reuses the existing token, which is the right default but
  there's no "rotate the token" path)
- Server-side token validation tied to RLS scope
- Email + SMS delivery of the invitation link
