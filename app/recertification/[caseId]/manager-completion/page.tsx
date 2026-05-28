"use client";
// Sprint 18 (pivot): manager / owner guided completion form.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { buildManagerFormSchema, type CompletionFormSchema } from "@/lib/services/recertCompletionForms";
import { CompletionFormView } from "@/components/CompletionFormView";
import { useAuth } from "@/components/AuthProvider";
import Link from "next/link";

export default function ManagerCompletionPage() {
  const params = useParams();
  const caseId = String(params?.caseId ?? "");
  const { signedIn, loading: authLoading } = useAuth();
  const [schema, setSchema] = useState<CompletionFormSchema | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    (async () => {
      try {
        const s = await buildManagerFormSchema(caseId);
        if (!s) setError("Case not found.");
        else setSchema(s);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [caseId, signedIn]);

  if (authLoading) return <div className="p-6 text-sm text-slate-500">Loading auth…</div>;
  if (!signedIn) return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Sign in required</h1>
      <Link href="/login" className="underline">Sign in →</Link>
    </div>
  );
  if (error) return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-rose-700">Could not load form</h1>
      <p className="text-sm text-slate-700 mt-2 font-mono">{error}</p>
      <Link href={`/recertification/${caseId}`} className="text-xs underline text-slate-500 mt-3 inline-block">← back to case</Link>
    </div>
  );
  if (!schema) return <div className="p-6 text-sm text-slate-500">Building manager form…</div>;

  return <CompletionFormView schema={schema} backHref={`/recertification/${caseId}`} />;
}
