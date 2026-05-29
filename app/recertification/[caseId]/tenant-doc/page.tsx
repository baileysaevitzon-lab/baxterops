"use client";
// Sprint 23: Tenant Recertification Doc — simplified workflow route.
// Reuses the existing tenant completion form (CompletionFormView + OfflineTenantFormPanel).
// Route: /recertification/[caseId]/tenant-doc

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { buildTenantFormSchema, type CompletionFormSchema } from "@/lib/services/recertCompletionForms";
import { CompletionFormView } from "@/components/CompletionFormView";
import { OfflineTenantFormPanel } from "@/components/OfflineTenantFormPanel";
import { useAuth } from "@/components/AuthProvider";
import { loadRosterByToken, markOpened } from "@/lib/services/recertTenantRoster";
import Link from "next/link";

export default function TenantDocPage() {
  const params = useParams();
  const search = useSearchParams();
  const caseId = String(params?.caseId ?? "");
  const inviteToken = search?.get("invite") ?? "";
  const { signedIn, loading: authLoading } = useAuth();
  const [schema, setSchema] = useState<CompletionFormSchema | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    (async () => {
      try {
        const s = await buildTenantFormSchema(caseId);
        if (!s) setError("Case not found or you do not have access.");
        else setSchema(s);
        if (inviteToken) {
          const entry = await loadRosterByToken(inviteToken);
          if (entry && entry.eligible && entry.caseId === caseId && !entry.invitationOpenedAt) {
            await markOpened(entry.id);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [caseId, signedIn, inviteToken]);

  if (authLoading) return <div className="p-6 text-sm text-slate-500">Loading auth…</div>;
  if (!signedIn) return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Sign in required</h1>
      <p className="text-sm text-slate-600 mt-2">
        This form is for authenticated staff. <Link href="/login" className="underline">Sign in →</Link>
      </p>
    </div>
  );
  if (error) return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-rose-700">Could not load form</h1>
      <p className="text-sm text-slate-700 mt-2 font-mono">{error}</p>
      <Link href={`/recertification/${caseId}`} className="text-xs underline text-slate-500 mt-3 inline-block">
        ← back to case
      </Link>
    </div>
  );
  if (!schema) return <div className="p-6 text-sm text-slate-500">Building tenant form…</div>;

  return (
    <>
      <div className="max-w-3xl mx-auto px-4 pt-4">
        <OfflineTenantFormPanel caseId={caseId} />
      </div>
      <CompletionFormView schema={schema} backHref={`/recertification/${caseId}`} />
    </>
  );
}
