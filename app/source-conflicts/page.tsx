"use client";
import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, PageHeader, Badge, Stat } from "@/components/Card";
import { getAllConflicts, upsertConflict } from "@/lib/services/sourceConflicts";
import { useRole } from "@/components/RoleProvider";
import type { SourceConflictRow } from "@/lib/types";

export default function SourceConflictsPage() {
  const [rows, setRows] = useState<SourceConflictRow[]>([]);
  const { user } = useRole();

  async function refresh() { setRows(await getAllConflicts()); }
  useEffect(() => { refresh(); }, []);

  async function resolve(r: SourceConflictRow, status: SourceConflictRow["status"], resolved: string | undefined) {
    await upsertConflict({ ...r, status, resolvedValue: resolved, resolution: `${status} by ${user.name} on ${new Date().toISOString().slice(0,10)}` });
    await refresh();
  }

  return (
    <>
      <PageHeader
        title="Source Conflicts"
        subtitle="When two or more sources disagree, the conflict is preserved here. None are silently overwritten."
      />
      <div className="grid grid-cols-4 gap-3 mb-6">
        <Stat label="Total conflicts" value={`${rows.length}`} />
        <Stat label="Needs live confirm" value={`${rows.filter(r => r.status === "needs_live_confirmation").length}`} intent="warn" />
        <Stat label="Open" value={`${rows.filter(r => r.status === "open").length}`} intent="warn" />
        <Stat label="Resolved" value={`${rows.filter(r => r.status.startsWith("accept") || r.status === "resolved").length}`} intent="good" />
      </div>

      <div className="space-y-4">
        {rows.map(r => (
          <Card key={r.id}>
            <CardHeader
              title={`${r.entityName} · ${r.fieldKey}`}
              subtitle={r.conflictType}
              action={<Badge intent={r.status === "open" ? "warn" : r.status === "needs_live_confirmation" ? "bad" : "good"}>{r.status}</Badge>}
            />
            <CardBody>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <SourceCell label="Source A" name={r.sourceALabel} value={r.sourceAValue} url={r.sourceAUrl} />
                <SourceCell label="Source B" name={r.sourceBLabel} value={r.sourceBValue} url={r.sourceBUrl} />
                {r.sourceCLabel && <SourceCell label="Source C" name={r.sourceCLabel} value={r.sourceCValue} url={r.sourceCUrl} />}
              </div>
              {r.notes && <p className="text-xs text-slate-500 mt-3 italic">{r.notes}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => resolve(r, "accept_a", r.sourceAValue)} className="text-xs px-2 py-1 rounded border border-slate-300">Accept A</button>
                <button onClick={() => resolve(r, "accept_b", r.sourceBValue)} className="text-xs px-2 py-1 rounded border border-slate-300">Accept B</button>
                {r.sourceCValue && <button onClick={() => resolve(r, "accept_c", r.sourceCValue)} className="text-xs px-2 py-1 rounded border border-slate-300">Accept C</button>}
                <button onClick={() => resolve(r, "needs_live_confirmation", undefined)} className="text-xs px-2 py-1 rounded border border-amber-300 text-amber-700">Needs live confirm</button>
                <button onClick={() => resolve(r, "resolved", r.resolvedValue)} className="text-xs px-2 py-1 rounded border border-emerald-300 text-emerald-700">Mark resolved</button>
              </div>
              {r.resolution && <div className="text-xs text-slate-500 mt-2">{r.resolution}</div>}
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}

function SourceCell({ label, name, value, url }: { label: string; name?: string; value?: string; url?: string }) {
  return (
    <div className="bg-slate-50 rounded p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-medium">{name ?? "—"}</div>
      <div className="text-sm mt-1">{value ?? "—"}</div>
      {url && <a href={url} target="_blank" rel="noreferrer" className="text-xs text-sky-700 underline mt-1 block break-all">{url}</a>}
    </div>
  );
}
