"use client";
// Sprint 28 (Phase 2) — READ-ONLY reconciliation report surface.
// Button-triggered (not auto-run) to keep the Photos page quiet. Renders the
// diagnostic JSON from /api/photo-reconciliation. There is NO cleanup action
// here by design — this surface only reports.
import { useState } from "react";
import { Card, CardBody, CardHeader, Badge } from "@/components/Card";

interface Section {
  count: number;
  items?: unknown[];
  recommendation: string;
  note?: string;
}
interface Report {
  ok: boolean;
  error?: string;
  readOnly?: boolean;
  generatedAt?: string;
  bucket?: string;
  totals?: { storageObjects: number; dbRows: number };
  sections?: {
    orphanStorageObjects: Section;
    dbRowsMissingStorage: Section;
    rowsMissingPathOrUrl: Section;
    duplicateCollectionOrder: Section;
    rowsMissingCompetitor: Section;
    rowsMissingTour: Section;
    countsByCompetitor: { competitorName: string; count: number }[];
    countsByCollection: { collectionId: string; competitorName: string; count: number }[];
  };
}

const SECTION_LABELS: Record<string, string> = {
  orphanStorageObjects: "1 · Storage objects with no DB row (orphans)",
  dbRowsMissingStorage: "2 · DB rows with missing/unreachable storage object",
  rowsMissingPathOrUrl: "3 · Rows with NULL storage_path / public_url (placeholders)",
  duplicateCollectionOrder: "4 · Duplicate collection_id + photo_order",
  rowsMissingCompetitor: "5 · Rows attached to a missing competitor",
  rowsMissingTour: "6 · Rows whose field_tour_id has no matching tour",
};

function SectionRow({ id, section }: { id: string; section: Section }) {
  const [open, setOpen] = useState(false);
  const clean = section.count === 0;
  return (
    <div className="border-b border-slate-100 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-800">{SECTION_LABELS[id] ?? id}</div>
          <div className="text-xs text-slate-500 mt-0.5">{section.recommendation}</div>
          {section.note && <div className="text-[11px] text-slate-400 mt-0.5">{section.note}</div>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge intent={clean ? "good" : "warn"}>{clean ? "safe / 0" : `${section.count}`}</Badge>
          {!clean && section.items && section.items.length > 0 && (
            <button onClick={() => setOpen(o => !o)} className="text-xs text-sky-700 underline">
              {open ? "hide" : "show"}
            </button>
          )}
        </div>
      </div>
      {open && section.items && section.items.length > 0 && (
        <pre className="mt-2 max-h-60 overflow-auto rounded bg-slate-50 border border-slate-200 p-2 text-[11px] text-slate-600">
          {JSON.stringify(section.items, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function PhotoReconciliationReport() {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/photo-reconciliation", { cache: "no-store" });
      const json: Report = await res.json();
      if (!json.ok) setError(json.error ?? `Request failed (${res.status})`);
      setReport(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run report");
    } finally {
      setLoading(false);
    }
  }

  const s = report?.sections;

  return (
    <Card>
      <CardHeader
        title="Storage reconciliation · read-only admin"
        subtitle="Diagnoses orphans, broken links, duplicates & dangling references. Reports only — no cleanup is performed."
        action={
          <button
            onClick={run}
            disabled={loading}
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-900 text-white font-medium hover:bg-slate-700 disabled:opacity-50"
          >
            {loading ? "Running…" : report ? "Re-run report" : "Run report"}
          </button>
        }
      />
      <CardBody>
        <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-800 mb-4">
          🔒 Read-only. This report never deletes, updates, or moves anything. Use it to decide what to clean later —
          cleanup is a separate, explicitly-approved step.
        </div>

        {!report && !error && (
          <p className="text-sm text-slate-500">Click “Run report” to scan the <code>baxter-ops-photos</code> bucket against the <code>photo_evidence</code> table.</p>
        )}

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>
        )}

        {report?.ok && s && (
          <>
            <div className="flex flex-wrap gap-4 text-sm mb-4">
              <span className="text-slate-600">Storage objects: <strong>{report.totals?.storageObjects}</strong></span>
              <span className="text-slate-600">DB rows: <strong>{report.totals?.dbRows}</strong></span>
              <span className="text-slate-400 text-xs ml-auto">generated {report.generatedAt?.replace("T", " ").slice(0, 19)} UTC</span>
            </div>

            <div className="divide-y divide-slate-100">
              <SectionRow id="orphanStorageObjects" section={s.orphanStorageObjects} />
              <SectionRow id="dbRowsMissingStorage" section={s.dbRowsMissingStorage} />
              <SectionRow id="rowsMissingPathOrUrl" section={s.rowsMissingPathOrUrl} />
              <SectionRow id="duplicateCollectionOrder" section={s.duplicateCollectionOrder} />
              <SectionRow id="rowsMissingCompetitor" section={s.rowsMissingCompetitor} />
              <SectionRow id="rowsMissingTour" section={s.rowsMissingTour} />
            </div>

            <div className="grid md:grid-cols-2 gap-4 mt-5">
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase mb-1">Counts by competitor</div>
                <table className="bx text-sm">
                  <tbody>
                    {s.countsByCompetitor.map(c => (
                      <tr key={c.competitorName}><td>{c.competitorName}</td><td className="text-right"><Badge intent="info">{c.count}</Badge></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase mb-1">Counts by collection / tour</div>
                <table className="bx text-sm">
                  <tbody>
                    {s.countsByCollection.map(c => (
                      <tr key={c.collectionId}><td className="font-mono text-[11px]">{c.collectionId}</td><td>{c.competitorName}</td><td className="text-right"><Badge intent="info">{c.count}</Badge></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
