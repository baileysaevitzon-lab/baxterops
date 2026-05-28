"use client";
// Sprint 15: Exact-form preview.
//
// Embeds the filled official PDF in an iframe at exact original layout.
// Shows the fill summary alongside (filled / blank-tenant / blank-manager
// / blank-pending / needs-review counts) and a Download button. Tenant
// completes remaining blanks in DocHub on iPad.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { useAuth } from "@/components/AuthProvider";
import type { FieldFillResult, FillStatus } from "@/lib/services/recertExactFormFill";

interface PacketResponse {
  blobUrl: string;
  packetId: string;
  filledCount: number;
  blankCount: number;
  results: FieldFillResult[];
}

const STATUS_STYLE: Record<FillStatus, { color: string; label: string }> = {
  filled_known:                { color: "good",    label: "Filled (BaxterOps known)" },
  blank_tenant_must_complete:  { color: "warn",    label: "Tenant must complete in DocHub" },
  blank_manager_must_complete: { color: "info",    label: "Manager must complete" },
  blank_pending_external:      { color: "warn",    label: "Pending (HACLA / other)" },
  blank_missing_data:          { color: "bad",     label: "Missing data" },
  not_applicable:              { color: "neutral", label: "Not applicable" },
  needs_review:                { color: "info",    label: "Needs manager review" },
};

export default function ExactFormPreviewPage() {
  const params = useParams();
  const caseId = String(params?.caseId ?? "");
  const { signedIn, loading: authLoading, profile, authUser } = useAuth();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [results, setResults] = useState<FieldFillResult[]>([]);
  const [filledCount, setFilledCount] = useState(0);
  const [blankCount, setBlankCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      // Get the auth session token to forward to the API route.
      const { getSupabase } = await import("@/lib/supabase/client");
      const sb = getSupabase();
      const session = sb ? (await sb.auth.getSession()).data.session : null;
      const token = session?.access_token;

      const res = await fetch(`/api/recertification/${caseId}/generate-exact-form`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          managerName: profile?.full_name ?? authUser?.email,
          managerEmail: authUser?.email,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Generate failed (${res.status}): ${txt.slice(0, 200)}`);
      }

      // Pull metadata from headers (the response itself is the PDF body).
      // To also receive the fill results, we'd need a parallel JSON endpoint;
      // for now we just derive counts from headers and re-fetch the JSON
      // summary lazily. Simpler: stash the PDF and ask the server for the
      // most recent packet's summary.
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
      const filled = Number(res.headers.get("X-Filled-Count") ?? 0);
      const blank = Number(res.headers.get("X-Blank-Count") ?? 0);
      setFilledCount(filled);
      setBlankCount(blank);

      // Pull the structured fill report from the DB summary row that the API
      // just wrote. This avoids changing the API contract while still giving
      // the UI access to per-field rows.
      try {
        if (sb) {
          const { data: pkt } = await sb
            .from("recert_generated_packets")
            .select("missing_data_json")
            .eq("case_id", caseId)
            .order("generated_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          const json = (pkt as { missing_data_json?: { results?: FieldFillResult[] } } | null)?.missing_data_json;
          if (json?.results) setResults(json.results);
        }
      } catch {
        /* non-fatal — summary view stays empty */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => {
    if (signedIn && !pdfUrl) generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  // Group results by section for the summary panel
  const groupedResults = useMemo(() => {
    const groups: Record<string, FieldFillResult[]> = {};
    for (const r of results) {
      const key = `Page ${r.pageNumber}`;
      (groups[key] = groups[key] ?? []).push(r);
    }
    return groups;
  }, [results]);

  if (authLoading) return <div className="p-6 text-sm text-slate-500">Loading auth…</div>;

  return (
    <>
      <PageHeader
        title="Exact form fill — preview"
        subtitle="Official LAHD recertification packet, filled with BaxterOps-known fields only. Tenant + manager complete remaining blanks in DocHub on iPad."
        action={
          <div className="flex gap-2 flex-wrap">
            <Link href={`/recertification/${caseId}`} className="text-xs underline text-slate-500 self-center">← back to case</Link>
            {pdfUrl && (
              <a href={pdfUrl} download={`lahd-recert-${caseId}.pdf`} className="px-3 py-1.5 rounded-md bg-emerald-700 text-white text-xs hover:bg-emerald-800">
                Download DocHub PDF
              </a>
            )}
            <button onClick={generate} disabled={generating || !signedIn} className="px-3 py-1.5 rounded-md bg-white border border-slate-300 text-xs disabled:opacity-50">
              {generating ? "Re-generating…" : "Re-generate"}
            </button>
          </div>
        }
      />

      {!signedIn && (
        <Card className="mb-4 border-amber-300 bg-amber-50">
          <CardBody className="text-sm text-amber-900">
            🔒 Sign in to generate the exact-form PDF. The API route uses your auth token to read the case record.
            <Link href="/login" className="ml-2 underline">Sign in →</Link>
          </CardBody>
        </Card>
      )}

      <div className="mb-4 rounded-md border border-violet-300 bg-violet-50 px-4 py-3 text-xs text-violet-900">
        <strong>Manager review required.</strong> This output preserves the official PDF layout. BaxterOps only fills known constant fields
        (property/case identifiers). Tenant signatures, initials, asset balances, and TICQ Y/N answers remain blank for completion in DocHub on iPad.
      </div>

      {error && (
        <Card className="mb-4 border-rose-300 bg-rose-50">
          <CardBody className="text-sm text-rose-900 font-mono whitespace-pre-wrap break-all">{error}</CardBody>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* PDF preview */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Filled PDF preview" subtitle={pdfUrl ? `${filledCount} filled · ${blankCount} blanks for tenant/manager` : "Generating…"} />
            <CardBody className="p-0">
              {pdfUrl ? (
                <iframe
                  src={pdfUrl}
                  className="w-full"
                  style={{ height: "85vh", border: 0 }}
                  title="Filled LAHD recertification packet"
                />
              ) : (
                <div className="p-6 text-sm text-slate-500">{generating ? "Generating filled PDF…" : "Click Re-generate to build the preview."}</div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Fill summary */}
        <div>
          <Card>
            <CardHeader title="Fill summary" subtitle={`${results.length} mapped fields`} />
            <CardBody>
              <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                <Stat label="Filled" value={filledCount} color="emerald" />
                <Stat label="Blank" value={blankCount} color="amber" />
              </div>
              {Object.entries(groupedResults).map(([page, fields]) => (
                <div key={page} className="mb-3">
                  <div className="text-xs font-semibold text-slate-600 mb-1">{page}</div>
                  <ul className="space-y-1">
                    {fields.map(f => (
                      <li key={f.fieldName} className="flex items-start justify-between gap-2 text-[11px] border-b border-slate-100 pb-1">
                        <div className="min-w-0">
                          <div className="text-slate-800 truncate">{f.label}</div>
                          {f.value && <div className="text-slate-500 font-mono truncate">{f.value}</div>}
                          {f.notes && <div className="text-slate-400 italic truncate">{f.notes}</div>}
                        </div>
                        <Badge intent={STATUS_STYLE[f.status].color as "good" | "warn" | "bad" | "info" | "neutral"}>
                          {STATUS_STYLE[f.status].label}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: "emerald" | "amber" }) {
  const cls = color === "emerald" ? "bg-emerald-50 border-emerald-200 text-emerald-900" : "bg-amber-50 border-amber-200 text-amber-900";
  return (
    <div className={`border rounded-md px-3 py-2 ${cls}`}>
      <div className="text-[10px] uppercase font-semibold opacity-70">{label}</div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
}
