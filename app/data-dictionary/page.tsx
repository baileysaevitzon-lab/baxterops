"use client";
import { useEffect, useMemo, useState } from "react";
import { Card, CardBody, CardHeader, PageHeader, Badge, Stat } from "@/components/Card";
import { DATA_DICTIONARY, type DictCategory } from "@/lib/dataDictionary";
import { getAllLedger } from "@/lib/services/sourceLedger";

export default function DataDictionaryPage() {
  const [coverage, setCoverage] = useState<Record<string, { total: number; verified: number; stale: number }>>({});
  const [filter, setFilter] = useState<DictCategory | "all">("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    (async () => {
      const rows = await getAllLedger();
      const by: Record<string, { total: number; verified: number; stale: number }> = {};
      for (const r of rows) {
        const k = r.fieldKey;
        by[k] = by[k] ?? { total: 0, verified: 0, stale: 0 };
        by[k].total++;
        if (r.verificationStatus === "verified") by[k].verified++;
        if (r.verificationStatus === "stale" || r.isStale) by[k].stale++;
      }
      setCoverage(by);
    })();
  }, []);

  const categories: (DictCategory | "all")[] = ["all", "rent", "sqft", "concession", "occupancy", "leasing_activity", "amenity", "utility", "parking", "marketing", "conversion", "subjective_covariate", "computed_metric", "compliance", "pricing_model", "identity"];

  const filtered = useMemo(() => DATA_DICTIONARY
    .filter(e => filter === "all" || e.category === filter)
    .filter(e => !query || e.key.includes(query.toLowerCase()) || e.label.toLowerCase().includes(query.toLowerCase()) || e.description.toLowerCase().includes(query.toLowerCase()))
  , [filter, query]);

  const totals = useMemo(() => ({
    variables: DATA_DICTIONARY.length,
    withLedger: Object.keys(coverage).filter(k => DATA_DICTIONARY.find(d => d.key === k) && coverage[k].total > 0).length,
    subjective: DATA_DICTIONARY.filter(e => e.category === "subjective_covariate").length,
    computed: DATA_DICTIONARY.filter(e => e.canBeComputed).length,
  }), [coverage]);

  return (
    <>
      <PageHeader
        title="Data Dictionary"
        subtitle={`Every variable BaxterOps uses, with description, source requirement, and current ledger coverage.`}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Variables defined" value={`${totals.variables}`} />
        <Stat label="With ledger entries" value={`${totals.withLedger}`} intent={totals.withLedger > 30 ? "good" : "warn"} />
        <Stat label="Subjective (manual-only)" value={`${totals.subjective}`} sub="rubric-driven" />
        <Stat label="Computed metrics" value={`${totals.computed}`} sub="have formula + deps" />
      </div>

      <Card>
        <CardHeader title={`${filtered.length} variables`} subtitle="Searchable by key, label, or description"
          action={
            <div className="flex gap-2 text-xs">
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search…" className="border rounded px-2 py-1" />
              <select value={filter} onChange={e => setFilter(e.target.value as DictCategory | "all")} className="border rounded px-2 py-1">
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          }
        />
        <CardBody className="p-0">
          <table className="bx">
            <thead>
              <tr>
                <th>Key</th><th>Label</th><th>Category</th><th>Type</th><th>Manual / Computed</th>
                <th>Used on</th><th>Source requirement</th><th>Ledger coverage</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => {
                const cov = coverage[e.key] ?? { total: 0, verified: 0, stale: 0 };
                return (
                  <tr key={e.key}>
                    <td className="font-mono text-xs">{e.key}</td>
                    <td className="font-medium">{e.label}<div className="text-xs text-slate-500 mt-0.5">{e.description}</div></td>
                    <td><Badge>{e.category}</Badge></td>
                    <td className="text-xs">{e.valueType}{e.unit ? ` · ${e.unit}` : ""}</td>
                    <td className="text-xs">
                      {e.canBeManual && <Badge intent="info">manual</Badge>}{" "}
                      {e.canBeComputed && <Badge intent="neutral">computed</Badge>}
                      {e.formula && <div className="text-[10px] text-slate-500 mt-1 font-mono">{e.formula}</div>}
                    </td>
                    <td className="text-xs text-slate-500">{e.usedOn.join(", ")}</td>
                    <td className="text-xs text-slate-600 max-w-xs">{e.sourceRequirement}</td>
                    <td>
                      {cov.total === 0 ? <Badge intent="bad">0 entries</Badge> : (
                        <span className="text-xs">
                          <Badge intent={cov.verified === cov.total ? "good" : cov.verified > 0 ? "warn" : "bad"}>{cov.verified} / {cov.total} verified</Badge>
                          {cov.stale > 0 && <Badge intent="warn">{cov.stale} stale</Badge>}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </>
  );
}
