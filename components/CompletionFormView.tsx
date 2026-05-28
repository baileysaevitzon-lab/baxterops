"use client";
// Sprint 18 (pivot): renders a CompletionFormSchema as a guided HTML form.
// Reused by the tenant and manager pages with role-specific schema sources.
// Autosaves on field blur, shows progress, validates required, and submits
// the completion session.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  saveCompletionResponse,
  submitCompletionSession,
  isFieldVisible,
  type CompletionFormSchema,
  type CompletionFormField,
} from "@/lib/services/recertCompletionForms";
import { textToSignatureDataUrl, deriveInitials, ensureSignatureFontReady } from "@/lib/services/typedSignature";
import { useAuth } from "@/components/AuthProvider";

type Values = Record<string, string>;

export function CompletionFormView({ schema: initialSchema, backHref, tokenMode }: {
  schema: CompletionFormSchema;
  backHref: string;
  /** Sprint 21: when set, the form is in public token-gated mode — saves go
   *  through /api/tenant-form/[token] (no Supabase auth required). */
  tokenMode?: { token: string; actorName: string };
}) {
  const { profile, authUser } = useAuth();
  const actorName = tokenMode?.actorName ?? profile?.full_name ?? authUser?.email ?? "Anonymous";
  const [values, setValues] = useState<Values>(() => {
    const v: Values = {};
    for (const s of initialSchema.sections) for (const f of s.fields) v[f.pdfFieldName] = f.defaultValue ?? "";
    return v;
  });
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "submitted" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState(0);
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => { ensureSignatureFontReady(); }, []);

  // Compute progress. Sprint 19: visibility is dynamic — a follow-up field
  // whose parent is "no" should not count toward required total.
  const allFields = useMemo(() => initialSchema.sections.flatMap(s => s.fields), [initialSchema]);
  const valueMap = useMemo(() => new Map(Object.entries(values)), [values]);
  const visibleFields = useMemo(
    () => allFields.filter(f => isFieldVisible(f, valueMap)),
    [allFields, valueMap],
  );
  const requiredFields = useMemo(
    () => visibleFields.filter(f => f.required || f.requiredWhenVisible),
    [visibleFields],
  );
  const completedCount = useMemo(
    () => visibleFields.filter(f => (values[f.pdfFieldName] ?? "") !== "").length,
    [visibleFields, values],
  );
  const requiredComplete = useMemo(
    () => requiredFields.filter(f => (values[f.pdfFieldName] ?? "") !== "").length,
    [requiredFields, values],
  );
  const pctRequired = requiredFields.length === 0 ? 100 : Math.round((requiredComplete / requiredFields.length) * 100);
  const missing = requiredFields.filter(f => (values[f.pdfFieldName] ?? "") === "");

  const saveField = useCallback(async (field: CompletionFormField, raw: string) => {
    setSaveStatus("saving");

    // Compute the next values BEFORE we hit the network. If this is a parent
    // and the answer flips away from a trigger, also null out every child
    // field (locally + persisted) so stale answers can't leak into the PDF.
    const childrenToClear: CompletionFormField[] = [];
    for (const s of initialSchema.sections) {
      for (const f of s.fields) {
        if (f.parentFieldName !== field.pdfFieldName) continue;
        if (f.clearsValueWhenHidden === false) continue;
        if (raw !== f.parentTriggerValue && (values[f.pdfFieldName] ?? "") !== "") {
          childrenToClear.push(f);
        }
      }
    }

    setValues(prev => {
      const next = { ...prev, [field.pdfFieldName]: raw };
      for (const c of childrenToClear) next[c.pdfFieldName] = "";
      return next;
    });

    // ── Sprint 21: token-mode — use the public API route (no Supabase auth) ──
    if (tokenMode) {
      const valJson = {
        fieldType: field.fieldType,
        pageNumber: field.pageNumber,
        label: field.label,
        resolverPair: field.resolverPair,
        parentFieldName: field.parentFieldName,
        parentTriggerValue: field.parentTriggerValue,
        timestamp: new Date().toISOString(),
        actorRole: "tenant",
        actorName,
      };
      let ok = true;
      try {
        const r = await fetch(`/api/tenant-form/${encodeURIComponent(tokenMode.token)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action:   "save",
            caseId:   initialSchema.caseId,
            section:  `page_${field.pageNumber}`,
            field:    field.pdfFieldName,
            valText:  raw === "" ? null : raw,
            valJson,
            pageNum:  field.pageNumber,
            ftype:    field.fieldType,
          }),
        });
        const j = await r.json().catch(() => ({ ok: false }));
        ok = j.ok === true;
        if (!ok) setError(j.error ?? "Save failed");
      } catch {
        ok = false;
        setError("Network error — please check your connection.");
      }
      // Best-effort orphan cleanup via clear
      if (ok && childrenToClear.length > 0) {
        await Promise.all(childrenToClear.map(c =>
          fetch(`/api/tenant-form/${encodeURIComponent(tokenMode.token)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "clear", caseId: initialSchema.caseId, field: c.pdfFieldName }),
          }).catch(() => {/* non-fatal */}),
        ));
      }
      setSaveStatus(ok ? "saved" : "error");
      if (ok) setTimeout(() => setSaveStatus("idle"), 1200);
      return;
    }

    // ── Auth-based path (staff / manager forms) ───────────────────────────
    const res = await saveCompletionResponse({
      caseId: initialSchema.caseId,
      role: initialSchema.role,
      pdfFieldName: field.pdfFieldName,
      pageNumber: field.pageNumber,
      fieldType: field.fieldType,
      valueText: raw === "" ? null : raw,
      valueJson: {
        fieldType: field.fieldType,
        pageNumber: field.pageNumber,
        label: field.label,
        resolverPair: field.resolverPair,
        // Sprint 19: persist parent linkage so the API merge can skip orphans.
        parentFieldName: field.parentFieldName,
        parentTriggerValue: field.parentTriggerValue,
        timestamp: new Date().toISOString(),
        actorRole: initialSchema.role,
        actorName,
      },
      actorRole: initialSchema.role,
      actorName,
    });

    // Best-effort cleanup of orphaned children. Failures here are non-fatal
    // — the merge step in /generate-exact-form also skips orphans.
    if (res.ok && childrenToClear.length > 0) {
      await Promise.all(childrenToClear.map(c => saveCompletionResponse({
        caseId: initialSchema.caseId,
        role: initialSchema.role,
        pdfFieldName: c.pdfFieldName,
        pageNumber: c.pageNumber,
        fieldType: c.fieldType,
        valueText: null,
        valueJson: {
          fieldType: c.fieldType,
          pageNumber: c.pageNumber,
          label: c.label,
          clearedBy: field.pdfFieldName,
          clearedAt: new Date().toISOString(),
          actorRole: initialSchema.role,
          actorName,
        },
        actorRole: initialSchema.role,
        actorName,
      })));
    }

    setSaveStatus(res.ok ? "saved" : "error");
    if (!res.ok) setError(res.error ?? "Save failed");
    else setTimeout(() => setSaveStatus("idle"), 1200);
  }, [initialSchema, actorName, values, tokenMode]);

  async function handleSubmit() {
    if (missing.length > 0) {
      setError(`Cannot submit — ${missing.length} required field${missing.length === 1 ? "" : "s"} missing.`);
      return;
    }
    setSubmitState("submitting");
    setError(null);

    // ── Sprint 21: token-mode submit ──────────────────────────────────────
    if (tokenMode) {
      try {
        const r = await fetch(`/api/tenant-form/${encodeURIComponent(tokenMode.token)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action:       "submit",
            caseId:       initialSchema.caseId,
            submittedBy:  actorName,
            totalReq:     requiredFields.length,
            completed:    requiredComplete,
          }),
        });
        const j = await r.json().catch(() => ({ ok: false }));
        if (!j.ok) { setError(j.error ?? "Submit failed"); setSubmitState("error"); return; }
      } catch {
        setError("Network error — please check your connection."); setSubmitState("error"); return;
      }
      setSubmitState("submitted");
      return;
    }

    // ── Auth-based path ───────────────────────────────────────────────────
    const res = await submitCompletionSession({
      caseId: initialSchema.caseId,
      role: initialSchema.role,
      submittedBy: actorName,
      totalRequired: requiredFields.length,
      completed: requiredComplete,
    });
    if (!res.ok) {
      setError(res.error ?? "Submit failed");
      setSubmitState("error");
      return;
    }
    setSubmitState("submitted");
  }

  if (submitState === "submitted") {
    return (
      <div className="max-w-2xl mx-auto py-8 px-4">
        <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-6">
          <h2 className="text-xl font-bold text-emerald-900">✓ Submitted — thank you!</h2>
          <p className="text-sm text-emerald-800 mt-2">
            All {requiredFields.length} required fields are complete. The property manager will merge your answers
            into the final LAHD recertification PDF and contact you if anything else is needed.
          </p>
          <div className="mt-4 flex gap-2">
            {!tokenMode && (
              <Link href={backHref} className="px-4 py-2 rounded bg-emerald-700 text-white text-sm">← Back to case</Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 min-h-screen pb-16">
      {/* Sticky top bar */}
      <div className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="px-4 py-3 flex flex-wrap gap-3 items-center max-w-4xl mx-auto">
          {!tokenMode && <Link href={backHref} className="text-xs text-slate-500 underline shrink-0">← Case</Link>}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-800 truncate">
              {initialSchema.role === "tenant" ? "Tenant" : "Manager"} completion · {initialSchema.caseSummary.tenantName}
              {initialSchema.caseSummary.unitNumber ? ` · Unit ${initialSchema.caseSummary.unitNumber}` : ""}
            </div>
            <div className="text-[11px] text-slate-500 truncate">{initialSchema.caseSummary.propertyName}</div>
          </div>
          <div className="text-xs font-mono text-slate-700"><span className="font-semibold">{pctRequired}%</span> required complete</div>
          <div className="text-[11px] text-slate-500">{requiredComplete}/{requiredFields.length} required · {missing.length} missing</div>
          <div className="text-[11px] min-w-[60px]">
            {saveStatus === "saving" && "Saving…"}
            {saveStatus === "saved" && <span className="text-emerald-700">✓ Saved</span>}
            {saveStatus === "error" && <span className="text-rose-700">Save failed</span>}
          </div>
        </div>
        <div className="h-1 bg-slate-200"><div className="h-1 bg-emerald-600 transition-all" style={{ width: `${pctRequired}%` }} /></div>
      </div>

      <div className="max-w-3xl mx-auto px-4 pt-4">
        {/* Banner */}
        <div className="mb-4 rounded-md border border-violet-300 bg-violet-50 px-4 py-3 text-xs text-violet-900">
          {tokenMode ? (
            <>
              <strong>Your answers save automatically.</strong> Work through each section at your own pace. When you
              have filled in all required fields, click <strong>Review answers →</strong> and then <strong>Submit</strong>.
              Your property manager will be notified once you submit.
            </>
          ) : (
            <>
              <strong>Internal workflow.</strong> Your answers are saved as you type. We only ask for what we don&apos;t
              already know from BaxterOps. Each answer maps back to the original LAHD recertification PDF field.
            </>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div>
        )}

        {/* Section nav */}
        {!reviewing && (
          <div className="flex flex-wrap gap-2 mb-4 text-xs">
            {initialSchema.sections.map((s, i) => {
              // Only count visible required fields toward "missing" badge —
              // a hidden follow-up shouldn't make a section look incomplete.
              const sectionMissing = s.fields.filter(f =>
                isFieldVisible(f, valueMap)
                && (f.required || f.requiredWhenVisible)
                && (values[f.pdfFieldName] ?? "") === "",
              ).length;
              const active = i === activeSection;
              return (
                <button key={s.key} onClick={() => setActiveSection(i)}
                  className={`px-3 py-1.5 rounded border ${active ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-300 text-slate-700"}`}>
                  {s.title}
                  {sectionMissing > 0 && <span className="ml-1 text-rose-600">•{sectionMissing}</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* Sections */}
        {!reviewing ? (
          <SectionView
            section={initialSchema.sections[activeSection]}
            values={values}
            valueMap={valueMap}
            onChange={(field, raw) => saveField(field, raw)}
          />
        ) : (
          <ReviewView schema={initialSchema} values={values} valueMap={valueMap} missing={missing} />
        )}

        {/* Navigation */}
        <div className="mt-6 flex gap-2 items-center">
          {!reviewing ? (
            <>
              <button
                onClick={() => setActiveSection(i => Math.max(0, i - 1))}
                disabled={activeSection === 0}
                className="px-4 py-2 rounded border border-slate-300 bg-white text-sm disabled:opacity-40"
              >
                ← Previous
              </button>
              {activeSection < initialSchema.sections.length - 1 ? (
                <button onClick={() => setActiveSection(i => i + 1)} className="px-4 py-2 rounded bg-slate-900 text-white text-sm">
                  Next →
                </button>
              ) : (
                <button onClick={() => setReviewing(true)} className="px-4 py-2 rounded bg-sky-700 text-white text-sm">
                  Review answers →
                </button>
              )}
              <span className="text-xs text-slate-500 ml-auto">Section {activeSection + 1} of {initialSchema.sections.length}</span>
            </>
          ) : (
            <>
              <button onClick={() => setReviewing(false)} className="px-4 py-2 rounded border border-slate-300 bg-white text-sm">
                ← Back to edit
              </button>
              <button onClick={handleSubmit} disabled={submitState === "submitting" || missing.length > 0} className="px-4 py-2 rounded bg-emerald-700 text-white text-sm disabled:bg-slate-300">
                {submitState === "submitting" ? "Submitting…" : `Submit ${initialSchema.role === "tenant" ? "tenant" : "manager"} completion`}
              </button>
              <span className="text-xs text-slate-500 ml-auto">{completedCount}/{allFields.length} fields filled</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionView({ section, values, valueMap, onChange }: {
  section: ReturnType<() => { fields: CompletionFormField[]; title: string; description?: string; key: string }>;
  values: Values;
  valueMap: Map<string, string>;
  onChange: (f: CompletionFormField, raw: string) => void;
}) {
  // Group children directly under their parent so the form reads top-to-
  // bottom: parent question, then its inline follow-ups (when visible).
  const parents = section.fields.filter(f => !f.parentFieldName);
  const childrenByParent = new Map<string, CompletionFormField[]>();
  for (const f of section.fields) {
    if (!f.parentFieldName) continue;
    const arr = childrenByParent.get(f.parentFieldName) ?? [];
    arr.push(f);
    childrenByParent.set(f.parentFieldName, arr);
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 mb-4">
      <h2 className="text-lg font-bold text-slate-900 mb-1">{section.title}</h2>
      {section.description && <p className="text-xs text-slate-500 mb-4">{section.description}</p>}
      <div className="space-y-4">
        {parents.map(f => {
          const kids = childrenByParent.get(f.pdfFieldName) ?? [];
          const showKids = kids.length > 0 && isFieldVisible(kids[0], valueMap);
          return (
            <div key={f.pdfFieldName}>
              <FieldInput field={f} value={values[f.pdfFieldName] ?? ""} onChange={raw => onChange(f, raw)} />
              {showKids && (
                <div className="mt-2 ml-6 pl-3 border-l-2 border-emerald-300 space-y-3">
                  <div className="text-[11px] uppercase tracking-wide text-emerald-800 font-semibold">
                    ↳ Because you answered Yes, please fill in:
                  </div>
                  {kids.map(c => (
                    <FieldInput key={c.pdfFieldName} field={c} value={values[c.pdfFieldName] ?? ""} onChange={raw => onChange(c, raw)} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FieldInput({ field, value, onChange }: { field: CompletionFormField; value: string; onChange: (raw: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);

  function commit(v: string) { if (v !== value) onChange(v); }

  const baseInput = "w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-base text-slate-900";

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="text-sm font-semibold text-slate-800">
          {field.label}{field.required && <span className="text-rose-600 ml-1">*</span>}
        </label>
        <span className="text-[10px] text-slate-400 font-mono">{field.fieldType}</span>
      </div>
      {field.context && <p className="text-xs text-slate-500 mb-2">{field.context}</p>}
      {renderInput(field, local, setLocal, commit, baseInput)}
      <div className="text-[10px] text-slate-400 mt-1 font-mono">
        Maps to: page {field.pageNumber} · field <code>{field.pdfFieldName}</code>
        {field.resolverPair?.no && <span> · pair: <code>{field.resolverPair.no}</code></span>}
      </div>
    </div>
  );
}

function renderInput(
  field: CompletionFormField,
  local: string,
  setLocal: (v: string) => void,
  commit: (v: string) => void,
  baseInput: string,
) {
  switch (field.fieldType) {
    case "longtext":
      return <textarea value={local} onChange={e => setLocal(e.target.value)} onBlur={() => commit(local)} rows={3} className={baseInput} />;
    case "date":
      return <input type="date" value={local} onChange={e => { setLocal(e.target.value); commit(e.target.value); }} className={baseInput} />;
    case "amount":
      return <input type="number" inputMode="decimal" value={local} onChange={e => setLocal(e.target.value)} onBlur={() => commit(local)} className={baseInput} placeholder="$" />;
    case "yesno":
      return (
        <div className="flex gap-2">
          {["yes", "no"].map(opt => (
            <button key={opt} onClick={() => { setLocal(opt); commit(opt); }}
              className={`flex-1 py-2.5 rounded-md border text-sm font-medium ${local === opt ? "bg-emerald-700 text-white border-emerald-700" : "bg-white border-slate-300 text-slate-700"}`}>
              {opt === "yes" ? "Yes" : "No"}
            </button>
          ))}
        </div>
      );
    case "tristate":
      return (
        <div className="flex gap-2">
          {["yes", "no", "unknown"].map(opt => (
            <button key={opt} onClick={() => { setLocal(opt); commit(opt); }}
              className={`flex-1 py-2.5 rounded-md border text-sm font-medium ${local === opt ? (opt === "yes" ? "bg-emerald-700 text-white border-emerald-700" : opt === "no" ? "bg-slate-700 text-white border-slate-700" : "bg-amber-500 text-white border-amber-500") : "bg-white border-slate-300 text-slate-700"}`}>
              {opt[0].toUpperCase() + opt.slice(1)}
            </button>
          ))}
        </div>
      );
    case "checkbox":
      return (
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={local === "true" || local === "1" || local === "yes"}
            onChange={e => { const v = e.target.checked ? "true" : "false"; setLocal(v); commit(v); }} className="w-5 h-5" />
          {local === "true" || local === "1" || local === "yes" ? "Checked" : "Click to confirm"}
        </label>
      );
    case "initial":
      return <input type="text" value={local} maxLength={6} onChange={e => setLocal(e.target.value.toUpperCase())} onBlur={() => commit(local)} className={`${baseInput} w-24 font-mono uppercase tracking-widest text-center`} placeholder="ABC" />;
    case "name":
      return <input type="text" value={local} onChange={e => setLocal(e.target.value)} onBlur={() => commit(local)} className={baseInput} placeholder="Full legal name" />;
    case "select":
      return (
        <select value={local} onChange={e => { setLocal(e.target.value); commit(e.target.value); }} className={baseInput}>
          <option value="">— Select —</option>
          {(field.options ?? []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    case "signature":
      return <SignatureBlock value={local} onChange={v => { setLocal(v); commit(v); }} />;
    default:
      return <input type="text" value={local} onChange={e => setLocal(e.target.value)} onBlur={() => commit(local)} className={baseInput} />;
  }
}

function SignatureBlock({ value, onChange }: { value: string; onChange: (raw: string) => void }) {
  // The "value" we store is the typed name. The PDF merge step renders the
  // cursive PNG at merge time. We just need to record the typed name + consent.
  const [name, setName] = useState(value);
  const [consented, setConsented] = useState(value !== "");
  useEffect(() => { setName(value); setConsented(value !== ""); }, [value]);
  const preview = useMemo(() => textToSignatureDataUrl(name, { variant: "signature" }), [name]);
  const initials = useMemo(() => deriveInitials(name), [name]);
  return (
    <div className="space-y-2">
      <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 rounded-md border border-slate-300 text-base" placeholder="Type your full legal name" />
      <div className="text-[10px] text-slate-500">Auto-derived initials: <code>{initials}</code></div>
      <div className="rounded-md border-2 border-emerald-200 bg-white p-2" style={{ minHeight: 90 }}>
        {preview ? <img src={preview} alt="signature preview" style={{ maxHeight: 80 }} /> : <span className="text-xs italic text-slate-400">Start typing to preview…</span>}
      </div>
      <label className="flex items-start gap-2 text-xs text-slate-700">
        <input type="checkbox" checked={consented} onChange={e => { setConsented(e.target.checked); onChange(e.target.checked ? name : ""); }} className="mt-0.5" />
        <span>I confirm this is my legal name and authorize the cursive rendering above to be used as my signature on the LAHD recertification packet.</span>
      </label>
    </div>
  );
}

function ReviewView({ schema, values, valueMap, missing }: { schema: CompletionFormSchema; values: Values; valueMap: Map<string, string>; missing: CompletionFormField[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 mb-4">
      <h2 className="text-lg font-bold text-slate-900 mb-2">Review your answers</h2>
      {missing.length > 0 ? (
        <div className="rounded border border-rose-300 bg-rose-50 p-3 mb-4 text-sm text-rose-900">
          <strong>{missing.length} required field{missing.length === 1 ? "" : "s"} still missing.</strong> Go back and complete them before submitting.
        </div>
      ) : (
        <div className="rounded border border-emerald-300 bg-emerald-50 p-3 mb-4 text-sm text-emerald-900">
          ✓ All required fields complete. Click <strong>Submit</strong> below to send.
        </div>
      )}
      {schema.sections.map(section => {
        const visible = section.fields.filter(f => isFieldVisible(f, valueMap));
        if (visible.length === 0) return null;
        return (
          <div key={section.key} className="mb-4">
            <div className="text-sm font-semibold text-slate-700 mb-1">{section.title}</div>
            <ul className="text-xs text-slate-700 space-y-1">
              {visible.map(f => {
                const v = values[f.pdfFieldName] ?? "";
                const isRequired = f.required || (f.requiredWhenVisible && isFieldVisible(f, valueMap));
                const indent = f.parentFieldName ? "pl-4 border-l-2 border-emerald-200" : "";
                return (
                  <li key={f.pdfFieldName} className={`flex items-baseline gap-2 border-b border-slate-100 pb-1 ${indent}`}>
                    <span className="flex-1">{f.label}</span>
                    <span className="text-slate-800 font-mono max-w-[300px] truncate">{v || (isRequired ? "— MISSING —" : "—")}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
