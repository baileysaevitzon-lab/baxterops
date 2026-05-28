// Sprint 17: Tenant typed-signature capture with explicit consent.
//
// Workflow:
//   1. Manager hands iPad to tenant.
//   2. Tenant types their full legal name.
//   3. UI shows a live cursive preview + auto-derived initials.
//   4. Tenant ticks the consent checkbox (explicit "I authorize this typed signature").
//   5. Tenant clicks Save — system generates PNG signatures + initials.
//   6. Generated PNGs are written to recert_packet_signatures (one row per /Sig
//      widget on the form). Initials are written as overrides to recert_case_field_overrides
//      for each 11-Initial1..7 etc. text field on the form.
//   7. Audit event recorded with the typed name, timestamp, and the manager
//      who facilitated the in-person signing session.
//
// Safety posture:
//   - The system clearly labels the signature as "typed by the tenant".
//   - The cursive style is distinct from wet ink and renders the actual letters.
//   - We never auto-generate a signature without the tenant's typed name + consent click.
//   - Manager identity is recorded alongside as the facilitator (chain of custody).

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  textToSignatureDataUrl,
  deriveInitials,
  ensureSignatureFontReady,
} from "@/lib/services/typedSignature";
import { SIGNATURE_FIELD_NAMES } from "@/lib/services/recertExactFormFill";
import { saveRecertPacketSignature } from "@/lib/services/recertPacket";
import { saveFieldOverride } from "@/lib/services/recertFieldOverrides";
import { getSupabase } from "@/lib/supabase/client";

interface Props {
  caseId: string;
  /** Template the signatures apply to (e.g. lahd-recert-2026). */
  templateId: string;
  /** Authenticated manager facilitating the in-person signing session. */
  facilitatorName: string;
  facilitatorEmail?: string;
  /** Called after successful save so the parent can refresh classification + regenerate the PDF. */
  onCaptured?: (info: { tenantName: string; initials: string; signatureDataUrl: string; signedAt: string }) => void;
  /** Existing captured signature, if any, to show "already captured" state. */
  existing?: { tenantName: string; signedAt: string; signatureDataUrl: string };
}

// LAHD 2026 form initials fields (page 11 Applicant Statement has 7).
// Page 16 (COI) does not have separate initials in the current mapping —
// only signatures. If future templates add initials we extend this list.
const INITIAL_FIELD_NAMES = [
  "11-Initial1",
  "11-Initial2",
  "11-Initial3",
  "11-Initial4",
  "11-Initial5",
  "11-Initial6",
  "11-Initial7",
];

// /Sig widget names that should receive the tenant typed signature.
// The owner/manager signature slots (11-OPMSignature / 16-OPMSignature) are
// deliberately NOT included — those are the manager's own signature and the
// manager signs them separately.
const TENANT_SIGNATURE_FIELDS = SIGNATURE_FIELD_NAMES.filter(
  n => n.includes("HouseholdMember") || n.includes("HHMbr"),
);

export function TypedSignatureCapture({ caseId, templateId, facilitatorName, facilitatorEmail, onCaptured, existing }: Props) {
  const [tenantName, setTenantName] = useState("");
  const [initials, setInitials] = useState("");
  const [consented, setConsented] = useState(false);
  const [confirmedIdentity, setConfirmedIdentity] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(existing?.signedAt ?? null);

  // Preload the cursive font so the first preview is rendered in Dancing Script,
  // not the system fallback.
  useEffect(() => { ensureSignatureFontReady(); }, []);

  // Auto-derive initials when the user types their name, but allow override.
  useEffect(() => {
    setInitials(prev => prev || deriveInitials(tenantName));
  }, [tenantName]);

  const signaturePreview = useMemo(
    () => textToSignatureDataUrl(tenantName, { variant: "signature" }),
    [tenantName],
  );
  const initialsPreview = useMemo(
    () => textToSignatureDataUrl(initials, { variant: "initials", width: 180, height: 90 }),
    [initials],
  );

  const canSave =
    tenantName.trim().length >= 2 &&
    initials.trim().length >= 1 &&
    consented &&
    confirmedIdentity &&
    !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const dataUrl = textToSignatureDataUrl(tenantName, { variant: "signature" });
      if (!dataUrl) throw new Error("Could not render signature");
      const initialsImg = textToSignatureDataUrl(initials, { variant: "initials", width: 180, height: 90 });
      void initialsImg; // currently unused; initials go to text fields, not PNG overlays

      // Save one signature row per tenant /Sig widget on the form
      for (const fieldName of TENANT_SIGNATURE_FIELDS) {
        const sectionKey = fieldName.startsWith("11-") ? "applicant_statement"
                         : fieldName.startsWith("16-") ? "conflict_of_interest"
                         : "exact_form_typed";
        const ok = await saveRecertPacketSignature({
          caseId,
          packetId: "exact_form",
          sectionKey,
          householdMemberId: null,
          signerRole: "tenant",
          signerName: tenantName,
          signatureDataUrl: dataUrl,
        });
        if (!ok) throw new Error(`Failed to save signature for ${fieldName}`);
      }

      // Write initial overrides as text-field fills so the PDF picks them up
      // via the existing classification pipeline.
      for (const fieldName of INITIAL_FIELD_NAMES) {
        const res = await saveFieldOverride({
          caseId,
          templateId,
          fieldName,
          patch: {
            fillStatus: "filled_known",
            manualOverrideValue: initials,
            valueSource: "manual_override",
            confidence: "medium",
            notes: `Typed by ${tenantName} during in-person review with ${facilitatorName}`,
          },
          editedBy: facilitatorName,
        });
        if (!res.ok) throw new Error(`Initials override failed for ${fieldName}: ${res.error ?? "unknown"}`);
      }

      // Audit row — explicit "typed signature" event distinct from a drawn one
      try {
        const sb = getSupabase();
        if (sb) {
          await sb.from("recert_audit_events").insert({
            id: `ae-typedsig-${caseId}-${Date.now()}`,
            case_id: caseId,
            event_type: "recert_typed_signature_captured",
            event_summary: `Typed signature captured for tenant "${tenantName}" (initials: ${initials}). Applied to ${TENANT_SIGNATURE_FIELDS.length} signature widgets + ${INITIAL_FIELD_NAMES.length} initial fields.`,
            actor_email: facilitatorEmail ?? null,
            event_payload_json: {
              tenantName,
              initials,
              facilitator: facilitatorName,
              facilitatorEmail: facilitatorEmail ?? null,
              templateId,
              signatureFields: TENANT_SIGNATURE_FIELDS,
              initialFields: INITIAL_FIELD_NAMES,
              consent: {
                consented: true,
                identityConfirmed: true,
                method: "typed_name_in_person",
              },
            },
          });
        }
      } catch {
        /* non-fatal */
      }

      const now = new Date().toISOString();
      setSavedAt(now);
      onCaptured?.({ tenantName, initials, signatureDataUrl: dataUrl, signedAt: now });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save typed signature");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-emerald-300 bg-emerald-50/40 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-bold text-emerald-900">Tenant typed-signature capture</h3>
          <p className="text-xs text-emerald-800 mt-0.5 max-w-2xl">
            Hand the iPad to the tenant. They type their legal name, confirm identity, and consent to use the
            generated cursive rendering of their name as their signature for this packet. Applies to all tenant
            signature widgets + applicant-statement initials.
          </p>
        </div>
        {savedAt && (
          <div className="text-[10px] text-emerald-700 font-mono">
            ✓ captured {savedAt.slice(0, 19).replace("T", " ")}
          </div>
        )}
      </div>

      {existing && !savedAt && (
        <div className="mb-3 rounded-md bg-white border border-emerald-200 p-3 text-xs text-emerald-900">
          A typed signature is already on file for <strong>{existing.tenantName}</strong> from {existing.signedAt.slice(0, 10)}.
          Re-capturing below will overwrite it.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Inputs */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Tenant full legal name</label>
            <input
              type="text"
              value={tenantName}
              onChange={e => setTenantName(e.target.value)}
              placeholder="e.g. Jose Humberto Ocaranza-Garcia"
              className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="text-[10px] text-slate-500 mt-1">Exactly as on government-issued ID</div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Initials</label>
            <input
              type="text"
              value={initials}
              onChange={e => setInitials(e.target.value.toUpperCase())}
              placeholder="JHO"
              maxLength={6}
              className="w-24 px-3 py-2 rounded-md border border-slate-300 text-sm font-mono tracking-widest"
            />
            <div className="text-[10px] text-slate-500 mt-1">
              Auto-derived from name. Edit if you prefer a different combination.
            </div>
          </div>

          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={confirmedIdentity}
              onChange={e => setConfirmedIdentity(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <strong>Identity confirmed.</strong> The person typing above is the named tenant on the recertification case,
              identity verified by {facilitatorName}.
            </span>
          </label>

          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={consented}
              onChange={e => setConsented(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <strong>Consent to typed signature.</strong> I, <em>{tenantName || "(name)"}</em>, authorize the typed
              cursive rendering of my name above to be applied as my signature and my initials to the LAHD
              recertification packet for this case. I understand this is a typed (not wet-ink) signature.
            </span>
          </label>

          <div className="flex gap-2 items-center">
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="px-4 py-2 rounded-md bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : savedAt ? "Re-capture signature" : "Save typed signature"}
            </button>
            {error && <span className="text-xs text-rose-700 font-mono">{error}</span>}
          </div>
        </div>

        {/* Preview */}
        <div className="space-y-3">
          <div>
            <div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">Signature preview</div>
            <div className="rounded-md border-2 border-slate-300 bg-white p-3" style={{ minHeight: 120 }}>
              {signaturePreview ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={signaturePreview} alt="Typed signature preview" style={{ maxWidth: "100%", maxHeight: 120 }} />
              ) : (
                <div className="text-xs text-slate-400 italic h-[100px] flex items-center justify-center">Start typing your name to preview your signature</div>
              )}
            </div>
            {tenantName && (
              <div className="text-[10px] text-slate-500 mt-1">
                Typed cursive rendering of "{tenantName}". Will be saved as a PNG and overlaid on the form's tenant signature widgets.
              </div>
            )}
          </div>

          <div>
            <div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">Initials preview</div>
            <div className="rounded-md border-2 border-slate-300 bg-white p-3 inline-block" style={{ minWidth: 180, minHeight: 90 }}>
              {initialsPreview ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={initialsPreview} alt="Initials preview" style={{ maxWidth: 180, maxHeight: 90 }} />
              ) : (
                <div className="text-xs text-slate-400 italic h-[70px] flex items-center justify-center w-[160px]">—</div>
              )}
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              Applied to {INITIAL_FIELD_NAMES.length} initial fields on the form (page 11 applicant statements).
            </div>
          </div>
        </div>
      </div>

      <p className="text-[10px] italic text-slate-500 mt-3">
        Audit trail records: tenant typed name, facilitator (you), timestamp, identity confirmation, explicit consent click,
        and the exact PDF field names the signature was applied to. Re-capture overwrites the previous signature and audits the change.
      </p>
    </div>
  );
}
