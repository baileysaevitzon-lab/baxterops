"use client";
// Sprint 6 — Ledger Coverage Dashboard.
// "Is BaxterOps safe to use in an owner meeting?" — one page that answers it.

import { useEffect, useMemo, useState } from "react";
import { Card, CardBody, CardHeader, PageHeader, Stat, Badge } from "@/components/Card";
import { getAllLedger, isStale } from "@/lib/services/sourceLedger";
import { getAllConflicts } from "@/lib/services/sourceConflicts";
import { getAllQueueItems } from "@/lib/services/verificationQueue";
import type { DataSourceLedgerRow, ManualVerificationQueueRow, SourceConflictRow } from "@/lib/types";

export default function DataQualityDashboard() {
  const [rows, setRows] = useState<DataSourceLedgerRow[]>([]);
  const [conflicts, setConflicts] = useState<SourceConflictRow[]>([]);
  const [queue, setQueue] = useState<ManualVerificationQueueRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [l, c, q] = await Promise.all([getAllLedger(), getAllConflicts(), getAllQueueItems()]);
      for (const r of l) r.isStale = isStale(r);
      setRows(l); setConflicts(c); setQueue(q); setLoading(false);
    })();
  }, []);

  const totals = useMemo(() => ({
    total: rows.length,
    verified: rows.filter(r => r.verificationStatus === "verified").length,
    needsReview: rows.filter(r => r.verificationStatus === "needs_review" || r.verificationStatus === "needs_verification").length,
    unverified: rows.filter(r => r.verificationStatus === "unverified").length,
    conflicting: rows.filter(r => r.verificationStatus === "conflicting_sources").length,
    stale: rows.filter(r => r.isStale).length,
    manual: rows.filter(r => r.entryMethod === "manual_user_entry" || r.entryMethod === "field_tour_entry" || r.entryMethod === "public_source_entry").length,
    computed: rows.filter(r => r.isComputed).length,
  }), [rows]);

  // Coverage by route — extract page_routes
  const coverageByRoute = useMemo(() => {
    const map = new Map<string, { total: number; verified: number }>();
    for (const r of rows) {
      for (const p of r.pageRoutes ?? []) {
        const cur = map.get(p) ?? { total: 0, verified: 0 };
        cur.total++;
        if (r.verificationStatus === "verified") cur.verified++;
        map.set(p, cur);
      }
    }
    return Array.from(map.entries()).map(([route, c]) => ({ route, ...c })).sort((a, b) => b.total - a.total);
  }, [rows]);

  const topMissing = rows.filter(r => r.verificationStatus !== "verified" && !r.isStale).slice(0, 10);
  const topStale = rows.filter(r => r.isStale).slice(0, 10);
  const openConflicts = conflicts.filter(c => c.status !== "resolved" && !c.status.startsWith("accept"));

  // values used in reports but not verified
  const inReportUnverified = rows.filter(r => (r.pageRoutes ?? []).includes("/reports") && r.verificationStatus !== "verified");

  const safety: { label: string; intent: "good" | "warn" | "bad" } =
    openConflicts.length === 0 && totals.needsReview === 0 ? { label: "READY FOR OWNER MEETING", intent: "good" } :
    openConflicts.length > 0 ? { label: "DO NOT SHIP — UNRESOLVED CONFLICTS", intent: "bad" } :
    { label: "SHIP WITH CAUTION — needs_review items present", intent: "warn" };

  return (
    <>
      <PageHeader title="Data Quality Dashboard" subtitle="One page: is BaxterOps safe to use in an owner / SGD meeting?" />

      <div className={`mb-6 rounded-md px-4 py-3 text-sm border ${
        safety.intent === "good" ? "border-emerald-300 bg-emerald-50 text-emerald-800" :
        safety.intent === "warn" ? "border-amber-300 bg-amber-50 text-amber-800" :
        "border-rose-300 bg-rose-50 text-rose-800"
      }`}>
        <strong>{safety.label}</strong>
        {openConflicts.length > 0 && <span> — {openConflicts.length} unresolved source conflict{openConflicts.length === 1 ? "" : "s"}.</span>}
        {totals.needsReview > 0 && <span> · {totals.needsReview} ledger entries need review.</span>}
        {inReportUnverified.length > 0 && <span> · {inReportUnverified.length} report values unverified.</span>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
        <Stat label="Total ledger" value={`${totals.total}`} />
        <Stat label="Verified" value={`${totals.verified}`} intent="good" />
        <Stat label="Needs review" value={`${totals.needsReview}`} intent={totals.needsReview > 0 ? "warn" : "good"} />
        <Stat label="Unverified" value={`${totals.unverified}`} intent={totals.unverified > 0 ? "bad" : "good"} />
        <Stat label="Conflicting" value={`${totals.conflicting + openConflicts.length}`} intent={openConflicts.length > 0 ? "bad" : "good"} />
        <Stat label="Stale" value={`${totals.stale}`} intent={totals.stale > 0 ? "warn" : "good"} />
        <Stat label="Manual" value={`${totals.manual}`} />
        <Stat label="Computed" value={`${totals.computed}`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader title="Source coverage by route" subtitle="Verified / total ledger entries per page" />
          <CardBody className="p-0">
            <table className="bx">
              <thead><tr><th>Route</th><th>Verified</th><th>Total</th><th>Coverage</th></tr></thead>
              <tbody>
                {coverageByRoute.map(r => (
                  <tr key={r.route}>
                    <td className="font-mono text-xs">{r.route}</td>
                    <td>{r.verified}</td>
                    <td>{r.total}</td>
                    <td>
                      <Badge intent={r.verified === r.total ? "good" : r.verified > r.total / 2 ? "warn" : "bad"}>
                        {Math.round((r.verified / r.total) * 100)}%
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={`Top 10 unresolved conflicts (${openConflicts.length} total open)`} />
          <CardBody className="p-0">
            {openConflicts.length === 0 ? <p className="p-4 text-sm text-emerald-700">No open conflicts. Owner-meeting ready.</p> : (
              <table className="bx">
                <thead><tr><th>Entity</th><th>Field</th><th>Source A</th><th>Source B</th><th>Status</th></tr></thead>
                <tbody>
                  {openConflicts.slice(0, 10).map(c => (
                    <tr key={c.id}>
                      <td>{c.entityName}</td>
                      <td className="font-mono text-xs">{c.fieldKey}</td>
                      <td className="text-xs">{c.sourceALabel} ({c.sourceAValue})</td>
                      <td className="text-xs">{c.sourceBLabel} ({c.sourceBValue})</td>
                      <td><Badge intent="warn">{c.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={`Top 10 missing-source values`} subtitle="Ledger rows not yet verified (excluding stale)" />
          <CardBody className="p-0">
            <table className="bx">
              <thead><tr><th>Value</th><th>Field</th><th>Entity</th><th>Status</th></tr></thead>
              <tbody>
                {topMissing.length === 0 ? <tr><td colSpan={4} className="p-4 text-sm text-emerald-700">All values have sources.</td></tr> :
                  topMissing.map(r => (
                    <tr key={r.id}>
                      <td className="font-medium">{r.displayValue ?? r.valueText ?? r.valueNumber}</td>
                      <td className="font-mono text-xs">{r.fieldKey}</td>
                      <td className="text-xs">{r.entityName}</td>
                      <td><Badge intent="warn">{r.verificationStatus}</Badge></td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={`Top 10 stale values (${totals.stale} total)`} />
          <CardBody className="p-0">
            <table className="bx">
              <thead><tr><th>Value</th><th>Field</th><th>Entity</th><th>Days old</th></tr></thead>
              <tbody>
                {topStale.length === 0 ? <tr><td colSpan={4} className="p-4 text-sm text-emerald-700">No stale data.</td></tr> :
                  topStale.map(r => {
                    const age = r.sourceDate ? Math.round((Date.now() - new Date(r.sourceDate).getTime()) / 86_400_000) : "?";
                    return (
                      <tr key={r.id}>
                        <td>{r.displayValue}</td>
                        <td className="font-mono text-xs">{r.fieldKey}</td>
                        <td className="text-xs">{r.entityName}</td>
                        <td><Badge intent="warn">{age}d / {r.staleAfterDays}d</Badge></td>
                      </tr>
                    );
                  })
                }
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader title={`Values used in /reports but not yet verified (${inReportUnverified.length})`} />
        <CardBody className="p-0">
          {inReportUnverified.length === 0 ? <p className="p-4 text-sm text-emerald-700">Every value referenced in the weekly report is verified.</p> : (
            <table className="bx">
              <thead><tr><th>Field</th><th>Entity</th><th>Value</th><th>Source</th><th>Status</th></tr></thead>
              <tbody>
                {inReportUnverified.map(r => (
                  <tr key={r.id}>
                    <td className="font-mono text-xs">{r.fieldKey}</td>
                    <td className="text-xs">{r.entityName}</td>
                    <td>{r.displayValue}</td>
                    <td className="text-xs">{r.sourceName ?? r.sourceType}</td>
                    <td><Badge intent="warn">{r.verificationStatus}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Manual verification queue snapshot" />
        <CardBody className="p-0">
          <table className="bx">
            <thead><tr><th>Source</th><th>Field</th><th>Status</th><th>Manual entry</th></tr></thead>
            <tbody>
              {queue.map(q => (
                <tr key={q.id}>
                  <td className="text-xs">{q.sourceType}</td>
                  <td className="font-mono text-xs">{q.fieldKey}</td>
                  <td><Badge intent={q.status === "confirmed" ? "good" : q.status === "rejected" ? "bad" : "warn"}>{q.status}</Badge></td>
                  <td className="text-xs">{q.manualEnteredValue ?? <span className="text-slate-400 italic">none</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </>
  );
}
