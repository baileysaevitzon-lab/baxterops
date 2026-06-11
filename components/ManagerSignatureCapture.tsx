// Sprint 32: Property-Manager / Owner typed-signature capture.
//
// Mirrors the tenant TypedSignatureCapture save path, but for the manager (OPM)
// signature widgets. Writes to recert_packet_signatures with signer_role='manager'
// and packet_id='exact_form' for sections applicant_statement + conflict_of_interest.
// The exact-form generator already maps (manager, applicant_statement) -> 11-OPMSignature
// and (manager, conflict_of_interest) -> 16-OPMSignature, so no PDF-side change is needed.
//
// Safety: we never claim "signed" until the rows are actually written. The signature
// is an explicitly-labeled typed cursive rendering of the manager's own name + consent.
"use client";

import { useEffect, useMemo, useState } from "react";
import { textToSignatureDataUrl, ensureSignatureFontReady } from "@/lib/services/typedSignature";
import { saveRecertPacketSignature } from "@/lib/services/recertPacket";
import { getSupabase } from "@/lib/supabase/client";

interface Props {
  caseId: string;
  /** Authenticated manager's name/email (pre-filled, editable). */
  managerName?: string;
  managerEmail?: string;
  /** Existing captured manager signature, if any. */
  existing?: { signerName: string; signedAt: string };
  onCaptured?: (info: { managerName: string; signedAt: string }) => void;
}

// The two OPM /Sig sections the manager signs. Section keys match what the
// generator's sigFieldsFor(role, section) expects for the manager role.
const MANAGER_SIGNATURE_SECTIONS: { sectionKey: string; label: string; pdfField: string }[] = [
  { sectionKey: "applicant_statement", label: "Applicant Statement (page 11)", pdfField: "11-OPMSignature" },
  { sectionKey: "conflict_of_interest", label: "Conflict of Interest (page 16)", pdfField: "16-OPMSignature" },
];

export function ManagerSignatureCapture({ caseId, managerName, managerEmail, existing, onCaptured }: Props) {
  const [name, setName] = useState(managerName ?? "");
  const [consented, setConsented] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(existing?.signedAt ?? null);

  useEffect(() => { ensureSignatureFontReady(); }, []);
  useEffect(() => { if (managerName && !name) setName(managerName); }, [managerName, name]);

  const preview = useMemo(() => textToSignatureDataUrl(name, { variant: "signature" }), [name]);
  const canSave = name.trim().length >= 2 && consented && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true); setError(null);
    try {
      const dataUrl = textToSignatureDataUrl(name, { variant: "signature" });
      if (!dataUrl) throw new Error("Could not render signature (open this on a device with a browser canvas).");

      for (const sec of MANAGER_SIGNATURE_SECTIONS) {
        const ok = await saveRecertPacketSignature({
          caseId,
          packetId: "exact_form",
          sectionKey: sec.sectionKey,
          householdMemberId: null,
          signerRole: "manager",
          signerName: name.trim(),
          signatureDataUrl: dataUrl,
        });
        if (!ok) throw new Error(`Failed to save manager signature for ${sec.pdfField} (not signed).`);
      }

      try {
        const sb = getSupabase();
        if (sb) {
          await sb.from("recert_audit_events").insert({
            id: `ae-mgrsig-${caseId}-${Date.now()}`,
            case_id: caseId,
            event_type: "recert_manager_signature_captured",
            event_summary: `Manager typed signature captured for "${name.trim()}". Applied to ${MANAGER_SIGNATURE_SECTIONS.map(s => s.pdfField).join(", ")}.`,
            actor_email: managerEmail ?? null,
            event_payload_json: {
              managerName: name.trim(),
              managerEmail: managerEmail ?? null,
              signatureFields: MANAGER_SIGNATURE_SECTIONS.map(s => s.pdfField),
              consent: { consented: true, method: "typed_name_self_signed" },
            },
          });
        }
      } catch { /* non-fatal */ }

      const now = new Date().toISOString();
      setSavedAt(now);
      onCaptured?.({ managerName: name.trim(), signedAt: now });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save manager signature");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-violet-300 bg-violet-50/40 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-bold text-violet-900">Manager / Owner signature</h3>
          <p className="text-xs text-violet-800 mt-0.5 max-w-2xl">
            Type your legal name and consent to apply a typed cursive rendering as your manager (OPM) signature on the
            official LAHD packet. Embeds on the OPM signature widgets (pages 11 &amp; 16) for Full and Manager-Only modes.
          </p>
        </div>
        {savedAt && <div className="text-[10px] text-violet-700 font-mono">✓ signed {savedAt.slice(0, 19).replace("T", " ")}</div>}
      </div>

      {existing && !savedAt && (
        <div className="mb-3 rounded-md bg-white border border-violet-200 p-3 text-xs text-violet-900">
          A manager signature is already on file for <strong>{existing.signerName}</strong> from {existing.signedAt.slice(0, 10)}. Re-signing overwrites it.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Manager full legal name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Bailey Saevitzon"
              className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={consented} onChange={e => setConsented(e.target.checked)} className="mt-0.5" />
            <span>
              <strong>Consent to typed signature.</strong> I, <em>{name || "(name)"}</em>, the property manager/owner
              representative, certify the information in this recertification and authorize the typed cursive rendering of my
              name as my signature on this LAHD packet. I understand this is a typed (not wet-ink) signature.
            </span>
          </label>
          <div className="flex gap-2 items-center">
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="px-4 py-2 rounded-md bg-violet-700 text-white text-sm font-semibold hover:bg-violet-800 disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : savedAt ? "Re-sign" : "Save manager signature"}
            </button>
            {error && <span className="text-xs text-rose-700 font-mono">{error}</span>}
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">Signature preview</div>
          <div className="rounded-md border-2 border-slate-300 bg-white p-3" style={{ minHeight: 120 }}>
            {preview ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={preview} alt="Manager signature preview" style={{ maxWidth: "100%", maxHeight: 120 }} />
            ) : (
              <div className="text-xs text-slate-400 italic h-[100px] flex items-center justify-center">Start typing your name to preview your signature</div>
            )}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">Saved as a PNG and overlaid on 11-OPMSignature &amp; 16-OPMSignature.</div>
        </div>
      </div>
    </div>
  );
}
