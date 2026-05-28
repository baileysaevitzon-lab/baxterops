"use client";
// Sprint 14: iPad-friendly HTML certification packet.
//
// Replaces the previous "generate a PDF" workflow with a structured HTML
// document optimized for an iPad walking through certification with a
// tenant. Pre-filled fields are green; missing required fields are amber/red;
// signature pads render large enough for fingers/stylus.
//
// Compliance: this is an internal workflow tool. It is NOT an LAHD or
// Urban Futures official e-signature system. Manager review is required.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  generateRecertPacketModel,
  saveRecertPacketField,
  saveRecertPacketSignature,
  clearRecertPacketSignature,
  type PacketModel,
  type PacketField,
  type PacketSection,
  type PacketSignatureSlot,
  type PacketFieldStatus,
} from "@/lib/services/recertPacket";
import { SignaturePad } from "@/components/SignaturePad";
import { useAuth } from "@/components/AuthProvider";

const STATUS_STYLE: Record<PacketFieldStatus, { ring: string; bg: string; label: string; chip: string }> = {
  prefilled:      { ring: "ring-emerald-300", bg: "bg-emerald-50",  chip: "bg-emerald-100 text-emerald-800",  label: "Pre-filled by BaxterOps" },
  missing:        { ring: "ring-rose-400",     bg: "bg-rose-50",     chip: "bg-rose-100 text-rose-800",         label: "Required — not yet filled" },
  needs_review:   { ring: "ring-blue-300",    bg: "bg-blue-50",    chip: "bg-blue-100 text-blue-800",        label: "Needs manager review" },
  not_applicable: { ring: "ring-slate-200",   bg: "bg-slate-50",   chip: "bg-slate-100 text-slate-600",      label: "Not applicable" },
  pending:        { ring: "ring-amber-300",   bg: "bg-amber-50",   chip: "bg-amber-100 text-amber-800",      label: "Pending external data" },
};

export default function RecertPacketPage() {
  const params = useParams();
  const caseId = String(params?.caseId ?? "");
  const { profile, authUser, signedIn, loading: authLoading } = useAuth();
  const editorName = profile?.full_name ?? authUser?.email ?? "Manager";
  const [model, setModel] = useState<PacketModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const load = useCallback(async () => {
    setLoading(true);
    const m = await generateRecertPacketModel(caseId);
    setModel(m);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { load(); }, [load]);

  async function handleFieldChange(section: PacketSection, field: PacketField, raw: string | number | boolean | null) {
    setSaveStatus("saving");
    // optimistic update
    setModel(prev => {
      if (!prev) return prev;
      const sections = prev.sections.map(s => {
        if (s.sectionKey !== section.sectionKey) return s;
        return {
          ...s,
          fields: s.fields.map(f => {
            if (f.key !== field.key) return f;
            const status: PacketFieldStatus = raw === null || raw === "" ? (f.required ? "missing" : "not_applicable") : "prefilled";
            return { ...f, value: raw, status, filledBy: status === "prefilled" ? "manager" : f.filledBy };
          }),
        };
      });
      return { ...prev, sections };
    });
    const role: "manager" | "tenant" = field.householdMemberId ? "tenant" : "manager";
    const ok = await saveRecertPacketField({
      caseId,
      sectionKey: section.sectionKey,
      fieldKey: field.key,
      valueText: raw === null ? null : String(raw),
      filledByRole: role,
      filledByName: editorName,
      status: raw === null || raw === "" ? (field.required ? "missing" : "not_applicable") : "prefilled",
    });
    setSaveStatus(ok ? "saved" : "error");
    if (ok) setTimeout(() => setSaveStatus("idle"), 1200);
  }

  async function handleSignatureSave(section: PacketSection, slot: PacketSignatureSlot, dataUrl: string): Promise<boolean> {
    const ok = await saveRecertPacketSignature({
      caseId,
      sectionKey: section.sectionKey,
      householdMemberId: slot.householdMemberId ?? null,
      signerRole: slot.signerRole,
      signerName: slot.signerName ?? editorName,
      signatureDataUrl: dataUrl,
    });
    if (ok) await load();
    return ok;
  }

  async function handleSignatureClear(section: PacketSection, slot: PacketSignatureSlot): Promise<boolean> {
    const ok = await clearRecertPacketSignature({
      caseId,
      sectionKey: section.sectionKey,
      householdMemberId: slot.householdMemberId ?? null,
      signerRole: slot.signerRole,
    });
    if (ok) await load();
    return ok;
  }

  const missingFieldsCount = useMemo(() => {
    if (!model) return 0;
    let n = 0;
    for (const s of model.sections) for (const f of s.fields) {
      if (f.required && (f.value === null || f.value === "" || f.value === false)) n += 1;
    }
    return n;
  }, [model]);

  const missingSignaturesCount = useMemo(() => {
    if (!model) return 0;
    let n = 0;
    for (const s of model.sections) for (const sig of s.signatures) {
      if (!sig.signed) n += 1;
    }
    return n;
  }, [model]);

  if (authLoading) {
    return <div className="p-6 text-sm text-slate-500">Loading auth…</div>;
  }
  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Generating packet…</div>;
  }
  if (!model) {
    return (
      <div className="p-6">
        <Link href={`/recertification/${caseId}`} className="text-xs underline text-slate-500">← back to case</Link>
        <h1 className="text-xl font-semibold mt-2">Packet not available</h1>
        <p className="text-sm text-slate-600">
          We could not load this recertification case. Make sure you are signed in and that the case exists.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 min-h-screen pb-16">
      {/* Sticky top bar — iPad-optimized */}
      <div className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm print:hidden">
        <div className="px-4 py-3 flex flex-wrap gap-3 items-center">
          <Link href={`/recertification/${caseId}`} className="text-xs text-slate-500 underline shrink-0">← Case</Link>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-800 truncate">
              {model.caseSummary.primaryTenantName}
              {model.caseSummary.unitNumber ? ` · Unit ${model.caseSummary.unitNumber}` : ""}
            </div>
            <div className="text-[11px] text-slate-500 truncate">{model.caseSummary.propertyName}</div>
          </div>
          <div className="text-xs font-mono text-slate-700">
            <span className="font-semibold">{model.readiness.percent}%</span> complete
          </div>
          <div className="text-xs text-slate-600 hidden md:inline">
            {missingFieldsCount} missing fields · {missingSignaturesCount} missing signatures
          </div>
          <div className="text-[11px] text-slate-500 min-w-[60px]">
            {saveStatus === "saving" && "Saving…"}
            {saveStatus === "saved" && <span className="text-emerald-700">✓ Saved</span>}
            {saveStatus === "error" && <span className="text-rose-700">Save failed</span>}
          </div>
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 rounded-md text-xs border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          >
            Print / Save as PDF
          </button>
        </div>
        {/* Progress bar */}
        <div className="h-1 bg-slate-200">
          <div className="h-1 bg-emerald-600 transition-all" style={{ width: `${model.readiness.percent}%` }} />
        </div>
      </div>

      {/* Compliance + auth banner */}
      <div className="px-4 pt-4 max-w-4xl mx-auto">
        {!signedIn && (
          <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong>You are not signed in.</strong> Tenant signatures and autosaved field values will fail until you sign in. <Link href="/login" className="underline">Sign in →</Link>
          </div>
        )}
        <div className="mb-4 rounded-md border border-violet-300 bg-violet-50 px-4 py-3 text-xs text-violet-900">
          <strong>Manager review required.</strong> {model.complianceNote}
        </div>

        {/* Case summary card */}
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-base font-semibold text-slate-800 mb-2">Case summary (pre-filled from BaxterOps)</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <SummaryRow label="Tenant" value={model.caseSummary.primaryTenantName} />
            <SummaryRow label="Property" value={model.caseSummary.propertyName} />
            <SummaryRow label="Unit" value={model.caseSummary.unitNumber} />
            <SummaryRow label="Bedrooms" value={model.caseSummary.bedroomCount?.toString()} />
            <SummaryRow label="Move-in / renewal" value={model.caseSummary.moveInDate} />
            <SummaryRow label="Certification type" value={model.caseSummary.certificationType} />
            <SummaryRow label="Max income limit" value={model.caseSummary.maxIncomeLimit ? `$${model.caseSummary.maxIncomeLimit.toLocaleString()}` : null} />
            <SummaryRow label="Max allowable rent" value={model.caseSummary.maxAllowableRent ? `$${model.caseSummary.maxAllowableRent.toLocaleString()}` : null} />
            <SummaryRow label="Tenant portion of rent" value={model.caseSummary.proposedTenantRent ? `$${model.caseSummary.proposedTenantRent.toLocaleString()}` : "(pending)"} />
            <SummaryRow label="Adults / children" value={`${model.caseSummary.adultCount} / ${model.caseSummary.childCount}`} />
          </dl>
        </div>

        {/* Sections */}
        {model.sections.map(section => (
          <SectionCard
            key={section.sectionKey}
            section={section}
            onFieldChange={handleFieldChange}
            onSignatureSave={handleSignatureSave}
            onSignatureClear={handleSignatureClear}
          />
        ))}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between border-b border-slate-100 py-1.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-800 font-medium text-right">{value ?? <span className="italic text-slate-400">—</span>}</dd>
    </div>
  );
}

function SectionCard({
  section,
  onFieldChange,
  onSignatureSave,
  onSignatureClear,
}: {
  section: PacketSection;
  onFieldChange: (s: PacketSection, f: PacketField, raw: string | number | boolean | null) => Promise<void>;
  onSignatureSave: (s: PacketSection, sig: PacketSignatureSlot, dataUrl: string) => Promise<boolean>;
  onSignatureClear: (s: PacketSection, sig: PacketSignatureSlot) => Promise<boolean>;
}) {
  return (
    <section className="mb-8 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold text-slate-900 mb-1">{section.title}</h2>
      {section.description && <p className="text-xs text-slate-500 mb-4">{section.description}</p>}

      <div className="space-y-3">
        {section.fields.map(field => (
          <PacketFieldRow key={field.key} field={field} onChange={raw => onFieldChange(section, field, raw)} />
        ))}
      </div>

      {section.signatures.length > 0 && (
        <div className="mt-6 border-t border-slate-100 pt-4">
          <div className="text-sm font-semibold text-slate-700 mb-2">Signatures</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {section.signatures.map(slot => (
              <SignaturePad
                key={slot.key}
                label={slot.label}
                signerName={slot.signerName}
                role={slot.signerRole}
                required
                existingSignatureDataUrl={slot.signatureDataUrl}
                existingSignedAt={slot.signedAt}
                onSave={dataUrl => onSignatureSave(section, slot, dataUrl)}
                onClear={() => onSignatureClear(section, slot)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function PacketFieldRow({ field, onChange }: { field: PacketField; onChange: (raw: string | number | boolean | null) => Promise<void> }) {
  const s = STATUS_STYLE[field.status];
  // Local input state so typing isn't laggy.
  const [localValue, setLocalValue] = useState<string>(field.value === null || field.value === undefined ? "" : String(field.value));
  useEffect(() => {
    setLocalValue(field.value === null || field.value === undefined ? "" : String(field.value));
  }, [field.value]);

  function commit() {
    if (localValue === "" && field.value === null) return;
    if (localValue === String(field.value ?? "")) return;
    void onChange(localValue === "" ? null : localValue);
  }

  return (
    <div className={`rounded-md p-3 ring-1 ${s.ring} ${s.bg}`}>
      <div className="flex justify-between items-baseline gap-2 mb-1">
        <label className="text-xs font-semibold text-slate-700">
          {field.label}
          {field.required && <span className="ml-1 text-rose-600">*</span>}
        </label>
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${s.chip}`}>{s.label}</span>
      </div>
      {field.officialLabelHint && (
        <div className="text-[10px] text-slate-400 mb-1">Maps to: {field.officialLabelHint}</div>
      )}
      {renderInput(field, localValue, setLocalValue, commit)}
      {field.source && (
        <div className="text-[10px] text-slate-500 mt-1 italic">{field.source}</div>
      )}
    </div>
  );
}

function renderInput(
  field: PacketField,
  value: string,
  setValue: (v: string) => void,
  commit: () => void,
) {
  const baseInput = "w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500";
  switch (field.type) {
    case "longtext":
      return (
        <textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={commit}
          rows={3}
          className={baseInput}
        />
      );
    case "date":
      return (
        <input
          type="date"
          value={value}
          onChange={e => { setValue(e.target.value); }}
          onBlur={commit}
          className={baseInput}
        />
      );
    case "number":
    case "money":
      return (
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={commit}
          className={baseInput}
          placeholder={field.type === "money" ? "$" : ""}
        />
      );
    case "yesno":
      return (
        <div className="flex gap-2">
          {["yes", "no"].map(opt => (
            <button
              key={opt}
              onClick={() => { setValue(opt); commit(); }}
              className={`flex-1 py-2 rounded-md border text-sm font-medium ${value === opt ? "bg-emerald-700 text-white border-emerald-700" : "bg-white border-slate-300 text-slate-700"}`}
            >
              {opt === "yes" ? "Yes" : "No"}
            </button>
          ))}
        </div>
      );
    case "tristate":
      return (
        <div className="flex gap-2">
          {["yes", "no", "unknown"].map(opt => (
            <button
              key={opt}
              onClick={() => { setValue(opt); commit(); }}
              className={`flex-1 py-2 rounded-md border text-sm font-medium ${value === opt ? (opt === "yes" ? "bg-emerald-700 text-white border-emerald-700" : opt === "no" ? "bg-slate-700 text-white border-slate-700" : "bg-amber-500 text-white border-amber-500") : "bg-white border-slate-300 text-slate-700"}`}
            >
              {opt[0].toUpperCase() + opt.slice(1)}
            </button>
          ))}
        </div>
      );
    case "checkbox":
      return (
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={value === "true" || value === "1" || value === "yes"}
            onChange={e => { setValue(e.target.checked ? "true" : "false"); commit(); }}
            className="w-5 h-5"
          />
          <span className="text-sm text-slate-700">Checked</span>
        </label>
      );
    case "initial":
      return (
        <input
          type="text"
          maxLength={4}
          value={value}
          onChange={e => setValue(e.target.value.toUpperCase())}
          onBlur={commit}
          placeholder="Initials"
          className={`${baseInput} font-mono text-center uppercase tracking-widest w-24`}
        />
      );
    default:
      return (
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={commit}
          className={baseInput}
        />
      );
  }
}
