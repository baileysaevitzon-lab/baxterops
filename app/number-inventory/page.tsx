"use client";
import { useEffect, useMemo, useState } from "react";
import { Card, CardBody, CardHeader, PageHeader, Badge, Stat } from "@/components/Card";
import { getAllLedger, isStale } from "@/lib/services/sourceLedger";
import type { DataSourceLedgerRow } from "@/lib/types";

type Filter = "all" | "unverified" | "stale" | "computed" | "manual" | "rent" | "sqft" | "marketing" | "subjective" | "conflicting";

export default function NumberInventoryPage() {
  const [rows, setRows] = useState<DataSourceLedgerRow[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const all = await getAllLedger();
      // mark stale
      for (const r of all) r.isStale = isStale(r);
      setRows(all);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    return rows
      .filter(r => {
        if (filter === "unverified") return r.verificationStatus !== "verified";
        if (filter === "stale") return r.isStale;
        if (filter === "computed") return r.isComputed;
        if (filter === "manual") return r.entryMethod === "manual_user_entry" || r.entryMethod === "field_tour_entry";
        if (filter === "rent") return r.fieldCategory === "rent";
        if (filter === "sqft") return r.fieldCategory === "sqft";
        if (filter === "marketing") return r.fieldCategory === "marketing";
        if (filter === "subjective") return r.fieldCategory === "subjective_covariate";
        if (filter === "conflicting") return r.verificationStatus === "conflicting_sources";
        return true;
      })
      .filter(r => !query ||
        r.fieldKey.includes(query.toLowerCase()) ||
        (r.entityName ?? "").toLowerCase().includes(query.toLowerCase()) ||
        (r.fieldLabel ?? "").toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => (a.entityType + a.entityId + a.fieldKey).localeCompare(b.entityType + b.entityId + b.fieldKey));
  }, [rows, filter, query]);

  const stats = useMemo(() => ({
    total: rows.length,
    verified: rows.filter(r => r.verificationStatus === "verified").length,
    stale: rows.filter(r => r.isStale).length,
    computed: rows.filter(r => r.isComputed).length,
    manual: rows.filter(r => r.entryMethod === "manual_user_entry" || r.entryMethod === "field_tour_entry").length,
    needsReview: rows.filter(r => r.verificationStatus === "needs_review" || r.verificationStatus === "needs_verification").length,
  }), [rows]);

  function exportCsv() {
    const headers = ["fieldKey","fieldLabel","entityType","entityId","entityName","displayValue","valueNumber","valueText","unit","sourceType","sourceName","sourceUrl","sourceDate","verificationStatus","confidence","entryMethod","isComputed","formula","dependsOn","isStale","pageRoutes"];
    const escape = (v: unknown) => {
      const s = v === undefined || v === null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    for (const r of filtered) lines.push(headers.map(h => escape((r as unknown as Record<string, unknown>)[h])).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `baxter-number-inventory-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        title="Number Inventory"
        subtitle="Every number BaxterOps shows, with its source, confidence, and verification status."
        action={<button onClick={exportCsv} className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-sm">Export CSV</button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        <Stat label="Total numbers" value={`${stats.total}`} />
        <Stat label="Verified" value={`${stats.verified}`} intent="good" />
        <Stat label="Needs review" value={`${stats.needsReview}`} intent="warn" />
        <Stat label="Stale" value={`${stats.stale}`} intent={stats.stale > 0 ? "warn" : "good"} />
        <Stat label="Manual" value={`${stats.manual}`} />
        <Stat label="Computed" value={`${stats.computed}`} />
      </div>

      <Card>
        <CardHeader title={`${filtered.length} entries`} subtitle={loading ? "loading…" : "Click filters to slice"}
          action={
            <div className="flex flex-wrap gap-1 text-xs">
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search…" className="border rounded px-2 py-1 mr-1" />
              {(["all","unverified","stale","computed","manual","rent","sqft","marketing","subjective","conflicting"] as Filter[]).map(f => (
                <button key={f} onClick={() => setFilter(f)} className={`px-2 py-1 rounded border ${filter === f ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200"}`}>{f}</button>
              ))}
            </div>
          }
        />
        <CardBody className="p-0">
          <table className="bx">
            <thead>
              <tr>
                <th>Value</th><th>Field</th><th>Entity</th><th>Source</th><th>Confidence</th><th>Status</th><th>Date</th><th>Formula</th><th>Pages</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id}>
                  <td className="font-medium whitespace-nowrap">{r.displayValue ?? (r.valueNumber ?? r.valueText ?? (r.valueBoolean !== undefined ? (r.valueBoolean ? "yes" : "no") : "—"))}</td>
                  <td>
                    <div className="font-mono text-xs">{r.fieldKey}</div>
                    <div className="text-xs text-slate-500">{r.fieldLabel}</div>
                  </td>
                  <td className="text-xs">{r.entityName ?? r.entityId}</td>
                  <td className="text-xs">
                    {r.sourceName ?? r.sourceType}
                    {r.sourceUrl && <a className="ml-1 text-sky-700 underline" href={r.sourceUrl} target="_blank" rel="noreferrer">link</a>}
                  </td>
                  <td><Badge intent={r.confidence === "high" ? "good" : r.confidence === "medium" ? "warn" : "bad"}>{r.confidence}</Badge></td>
                  <td>
                    <Badge intent={r.verificationStatus === "verified" ? "good" : r.verificationStatus === "conflicting_sources" ? "bad" : "warn"}>
                      {r.verificationStatus.replace("_", " ")}
                    </Badge>
                    {r.isStale && <Badge intent="warn">stale</Badge>}
                  </td>
                  <td className="text-xs">{r.sourceDate ?? "—"}</td>
                  <td className="text-[10px] font-mono max-w-xs text-slate-500">{r.formula ?? "—"}</td>
                  <td className="text-[10px] text-slate-500">{(r.pageRoutes ?? []).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </>
  );
}
