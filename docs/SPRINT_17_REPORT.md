# Sprint 17 — Tenant Typed-Signature Capture + PDF Overlay: Final Report

**Date:** 2026-05-28
**Goal:** After the tenant types their full legal name and clicks consent, auto-generate a cursive signature + initials and apply them to the LAHD packet's `/Sig` widgets and initial fields — without breaking the Sprint 15 exact-PDF output.

---

## 1. What changed

- New `lib/services/typedSignature.ts` — canvas-based cursive PNG generator + initials derivation.
- New `components/TypedSignatureCapture.tsx` — tenant-facing capture card with live preview, two-checkbox consent gate, and one-click save.
- `app/layout.tsx` — added Google Fonts Dancing Script preload so the canvas renders crisp cursive instead of system fallback.
- `app/api/recertification/[caseId]/generate-exact-form/route.ts` — after AcroForm fills, loads `recert_packet_signatures` rows for this case + packet_id `"exact_form"` and overlays the PNG at each tenant `/Sig` widget's exact rectangle on the corresponding page via `pdf-lib`'s `embedPng` + `page.drawImage`.
- `app/recertification/[caseId]/exact-form-preview/page.tsx` — the Classification tab now hosts the typed-signature capture card above the field-mapping table; `onCaptured` callback re-runs the field-override fetch + regenerates the PDF so the new signature + initials appear immediately.

The Sprint 15 PDF output is unchanged structurally — same template, same field-fill mechanism. Sprint 17 only adds an image-overlay pass at the end + 7 initial-text-field overrides driven through the Sprint 16 override pipeline.

---

## 2. How the workflow runs (Bailey's iPad scenario)

1. Bailey hands the iPad to the tenant on the Classification tab of `/recertification/[caseId]/exact-form-preview`.
2. Tenant types their full legal name into the input.
3. Live cursive preview renders on the right as they type. Initials auto-derive (e.g. "Jose Humberto Ocaranza-Garcia" → "JHO").
4. Tenant ticks **Identity confirmed** (acknowledges Bailey verified ID).
5. Tenant ticks **Consent to typed signature** (the consent line interpolates the typed name verbatim).
6. Tenant clicks **Save typed signature**.
7. System writes:
   - 2 PNG signature rows to `recert_packet_signatures` (one for `11-HouseholdMemberSignature`, one for `16-HHMbrSignature`)
   - 7 initial overrides to `recert_case_field_overrides` (`11-Initial1` through `11-Initial7`, value = the auto-derived initials string)
   - 1 audit row to `recert_audit_events` with event type `recert_typed_signature_captured` and full consent payload
8. The page auto-regenerates the PDF — initials now appear in the AcroForm text fields, and the cursive signature is overlaid at the `/Sig` widget positions on pages 11 and 16.
9. Bailey downloads the filled PDF. Tenant's typed signature + initials are visible. Asset balances, TICQ Y/N answers, and the manager's own signature widget remain blank for in-person completion or DocHub fallback.

---

## 3. Safety / consent posture

- **Manager is never the one who types the tenant's name.** The capture card is shown to the tenant on the iPad. The manager's role is recorded as the facilitator (chain of custody).
- **Two-checkbox consent gate.** Save button stays disabled until both "Identity confirmed" and "Consent to typed signature" are ticked. The consent line dynamically interpolates the typed name so the tenant sees exactly what they're authorizing.
- **Cursive, not wet-ink.** The generated signature renders the tenant's actual typed letters in a stylized cursive web font (Dancing Script). It is visually distinct from a scanned wet-ink signature so downstream readers can tell it was typed.
- **Audit row is comprehensive.** `event_payload_json` includes: `tenantName`, `initials`, `facilitator`, `facilitatorEmail`, `templateId`, `signatureFields` (which `/Sig` widgets got the PNG), `initialFields` (which text fields got the initials), and explicit `consent: { consented: true, identityConfirmed: true, method: "typed_name_in_person" }`.
- **Manager signature widgets are NEVER auto-signed.** Sprint 17 only writes the tenant signature fields (`11-HouseholdMemberSignature`, `16-HHMbrSignature`). The owner/manager slots (`11-OPMSignature`, `16-OPMSignature`) remain blank for Bailey to sign separately.
- **Re-capture is destructive and audited.** Clicking Re-capture overwrites the previous PNG via the unique-index upsert (Sprint 12 fix); the audit table preserves both the original capture event and the re-capture event.
- **Signature classifications are still triple-protected** by Sprint 16's signature-field guards — typed signatures arrive through the dedicated PNG-overlay path, not through generic `filled_known` overrides.

---

## 4. PDF overlay implementation

`pdf-lib` does not natively "sign" `/Sig` widgets in any cryptographic sense, but it does expose the widget annotation rectangles. The route does:

```ts
const field = form.getField("11-HouseholdMemberSignature");        // PDFSignature
const widgets = field.acroField.getWidgets();                       // annotation rects
const embeddedImage = await pdfDoc.embedPng(pngBytes);
for (const widget of widgets) {
  const rect = widget.getRectangle();                               // { x, y, width, height }
  const page = pdfDoc.getPages().find(p => p.ref === widget.P());
  page.drawImage(embeddedImage, {
    x: rect.x + 2, y: rect.y + 2,
    width: rect.width - 4, height: rect.height - 4,
  });
}
```

- The `/Sig` widget metadata is preserved — DocHub still recognizes the field. The PNG is drawn on top.
- Each widget's exact page-coordinate rectangle is honored so the signature lands precisely in the box on the original form, not in some new spot.
- A 2pt inset on each edge prevents the PNG from bleeding over the underline below the widget on LAHD's layout.

Initials (`11-Initial1` … `11-Initial7`) are TEXT fields, not signature widgets. They are filled via the existing Sprint 16 override path — `manualOverrideValue` set to the initials string. No image overlay needed.

---

## 5. Verified end-to-end (screenshots in transcript)

| Step | Result |
|---|---|
| Open `/recertification/rc-712-ocaranza-2026/exact-form-preview` | ✓ Both tabs render |
| Switch to Classification tab | ✓ TypedSignatureCapture card appears above the field table |
| Type "Jose Humberto Ocaranza-Garcia" into the name input | ✓ Live cursive preview renders in Dancing Script, initials auto-fill to "JHO" |
| Both consent checkboxes wired correctly | ✓ Save button stays disabled until both are ticked |
| Click Save | ✓ Button shows "Saving…" then changes to "Re-capture signature", "✓ captured 2026-05-28 19:48:15" timestamp visible |
| DB row count: `recert_packet_signatures` (packet `exact_form`) | ✓ 2 rows (one per tenant `/Sig` widget) |
| DB row count: `recert_case_field_overrides` (LIKE '11-Initial%') | ✓ 7 rows, all with `manual_override_value="JHO"` |
| DB row count: `recert_audit_events` event=`recert_typed_signature_captured` | ✓ 1 row with full consent payload |
| Auto-regenerate after capture | ✓ Triggered via `onCaptured` callback |
| `npm run build` | ✓ Compiled successfully, 0 type errors |

---

## 6. Files added / modified

| File | Status | Purpose |
|---|---|---|
| `lib/services/typedSignature.ts` | **new** | `textToSignatureDataUrl(text, opts)` canvas → PNG, `deriveInitials(name)`, `ensureSignatureFontReady()` |
| `components/TypedSignatureCapture.tsx` | **new** | Tenant-facing capture card with live preview + consent gate |
| `app/api/recertification/[caseId]/generate-exact-form/route.ts` | modified | Loads PNG rows for packet `exact_form`, overlays each at the matching `/Sig` widget rectangle, increments `signatureOverlays` counter for the missing-data report |
| `app/recertification/[caseId]/exact-form-preview/page.tsx` | modified | Mounts `<TypedSignatureCapture>` above `<FieldClassificationTable>`; `onCaptured` callback refreshes overrides + regenerates PDF |
| `app/layout.tsx` | modified | Adds Google Fonts Dancing Script preload + stylesheet |

No new tables required — Sprint 17 reuses `recert_packet_signatures` (Sprint 14) and `recert_case_field_overrides` (Sprint 16).

---

## 7. Remaining limitations

1. **`document.fonts.load` is best-effort.** On a very cold first paint the first canvas render may use the cursive fallback (Brush Script MT / Apple Chancery) instead of Dancing Script. Re-typing or re-saving picks up the loaded font.
2. **The captured PNG resolution is 480×120 CSS px × `devicePixelRatio`.** For retina iPads this is ~960×240 — crisp at the widget size in the LAHD form. Wider widgets in other templates may show slight pixelation.
3. **Initials field auto-derivation is naïve.** Hyphenated last names are treated as one component (so "Ocaranza-Garcia" gives "O" not "OG"). If Bailey prefers "JHOG" she can edit the initials input field before saving.
4. **Two tenant `/Sig` widgets only** (Applicant Statement + COI). If LAHD adds more tenant signature widgets in a future template revision, list them in the resolver's `sectionToSigFields` map.
5. **Manager signature is still a separate workflow.** Sprint 17 does not capture manager signatures — those continue to be drawn or DocHub-signed by Bailey herself. Could be a small Sprint 18 if she wants the same typed-signature flow for owner/manager slots.
6. **The downloaded PDF still contains the `/Sig` widget metadata.** A defender opening the PDF in Acrobat could see the field is present even though a visible PNG is drawn on top. If Bailey wants the signature flattened (so the PDF reads as a finished document with no remaining sign-here UI), we'd need to either remove the widget annotation or flatten the form. Deferred until Bailey has time to confirm DocHub behavior.
7. **No revoke flow yet.** If Bailey realizes after-the-fact that the wrong tenant signed, she can Re-capture to overwrite, but there is no "void this signature" button. Adding one is a small follow-up: set `signature_data_url = ''` and re-add the Sprint 16 override clearing for the 7 initial fields.

---

## Sprint 17 Verdict

The tenant typed-signature capture works end-to-end with explicit two-step consent. The tenant types their name, the system generates a cursive PNG, the manager's identity is recorded as facilitator, and the signature + initials are applied to the official LAHD PDF — preserving Sprint 15's exact-form layout. Every capture writes a full audit row and the page auto-regenerates the PDF so Bailey can immediately verify placement and download. The manager's own signature slot is intentionally left untouched.
