"use client";
// Sprint 21: Public token-gated tenant completion page.
// No Supabase auth required — the 32-char hex invitation token is the
// credential. The caseId is resolved server-side by the API route so it
// never appears in the URL.
//
// Flow:
//   1. Management copies the link from /recertification/roster
//   2. Tenant opens /recertification/tenant/<token>
//   3. This page fetches the form schema via GET /api/tenant-form/<token>
//   4. CompletionFormView renders in tokenMode — saves go through
//      POST /api/tenant-form/<token> which calls the SECURITY DEFINER
//      Postgres functions (tenant_save_field, tenant_submit_form, etc.)
//   5. On submit, the roster row status is flipped to "submitted" in the DB

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { type CompletionFormSchema } from "@/lib/services/recertCompletionForms";
import { CompletionFormView } from "@/components/CompletionFormView";

export default function PublicTenantFormPage() {
  const params = useParams();
  const token = String(params?.token ?? "");

  const [schema, setSchema] = useState<CompletionFormSchema | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) { setError("Missing invitation token."); setLoading(false); return; }
    (async () => {
      try {
        const res = await fetch(`/api/tenant-form/${encodeURIComponent(token)}`);
        const json = await res.json();
        if (!res.ok || json.error) {
          setError(json.error ?? "Could not load your form. Please contact your property manager.");
        } else {
          setSchema(json.schema);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error — please try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-sm text-slate-500">Loading your recertification form…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-xl mx-auto py-12 px-4">
        <div className="rounded-xl border-2 border-rose-200 bg-rose-50 p-6">
          <h1 className="text-lg font-bold text-rose-900 mb-2">Unable to load form</h1>
          <p className="text-sm text-rose-800">{error}</p>
          <p className="text-xs text-slate-500 mt-4">
            If you believe this is an error, contact your property manager.
          </p>
        </div>
      </div>
    );
  }

  if (!schema) return null;

  return (
    // Negative margin counteracts the root layout's p-8 so the form fills
    // the full column width (sticky header aligns to viewport edge).
    <div className="-m-8">
      <CompletionFormView
        schema={schema}
        backHref="/"
        tokenMode={{ token, actorName: schema.caseSummary.tenantName }}
      />
    </div>
  );
}
