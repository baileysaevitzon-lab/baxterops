"use client";
import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, PageHeader, Badge, Stat } from "@/components/Card";
import { getAllQueueItems, upsertQueueItem } from "@/lib/services/verificationQueue";
import { useRole } from "@/components/RoleProvider";
import { bulkUpsertLedger } from "@/lib/services/sourceLedger";
import { useSourceLedger } from "@/components/SourceLedgerProvider";
import type { DataSourceLedgerRow, ManualVerificationQueueRow } from "@/lib/types";

export default function VerificationQueuePage() {
  const [rows, setRows] = useState<ManualVerificationQueueRow[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<ManualVerificationQueueRow>>({});
  const [msg, setMsg] = useState("");
  const { user } = useRole();
  const ledger = useSourceLedger();

  async function refresh() { setRows(await getAllQueueItems()); }
  useEffect(() => { refresh(); }, []);

  async function createLedgerFromManual(r: ManualVerificationQueueRow) {
    if (!r.manualEnteredValue) { setMsg("No manual value to convert."); return; }
    const row: DataSourceLedgerRow = {
      id: `led-mvq-${r.id}`,
      entityType: r.entityType,
      entityId: r.entityId,
      entityName: r.entityName,
      fieldKey: r.fieldKey,
      fieldLabel: r.fieldLabel,
      fieldCategory: r.fieldKey.includes("rent") ? "rent" : r.fieldKey.includes("sqft") ? "sqft" : "identity",
      valueType: "text",
      valueText: r.manualEnteredValue,
      displayValue: r.manualEnteredValue,
      sourceType: "manual_entry",
      sourceName: `Manual entry from blocked public source (${r.sourceType})`,
      sourceUrl: r.sourceUrl,
      sourceDate: new Date().toISOString().slice(0, 10),
      collectedBy: user.name,
      verificationStatus: "needs_review",
      confidence: "medium",
      entryMethod: "public_source_entry",
      requiresManualVerification: false,
      staleAfterDays: 30,
      pageRoutes: [`/competitors/${r.entityId.replace("c-", "")}`],
    };
    await bulkUpsertLedger([row]);
    await ledger?.refresh();
    setMsg(`Ledger row created for ${r.fieldKey}. Status: needs_review (not auto-verified — Bailey must explicitly mark verified).`);
  }

  async function startEditing(r: ManualVerificationQueueRow) {
    setEditing(r.id);
    setDraft({ manualEnteredValue: r.manualEnteredValue, manualNotes: r.manualNotes, status: r.status });
  }

  async function save(r: ManualVerificationQueueRow) {
    const next: ManualVerificationQueueRow = {
      ...r,
      manualEnteredValue: draft.manualEnteredValue ?? r.manualEnteredValue,
      manualNotes: draft.manualNotes ?? r.manualNotes,
      enteredBy: user.name,
      enteredAt: new Date().toISOString(),
      status: (draft.status as ManualVerificationQueueRow["status"]) ?? "in_progress",
    };
    await upsertQueueItem(next);
    await refresh();
    setEditing(null); setDraft({});
    setMsg(`Saved ${r.id}.`);
  }

  async function markStatus(r: ManualVerificationQueueRow, status: ManualVerificationQueueRow["status"]) {
    await upsertQueueItem({ ...r, status, reviewedBy: user.name, reviewedAt: new Date().toISOString() });
    await refresh();
    setMsg(`${r.id} → ${status}`);
  }

  const pending = rows.filter(r => r.status === "pending" || r.status === "in_progress").length;
  const confirmed = rows.filter(r => r.status === "confirmed").length;

  return (
    <>
      <PageHeader
        title="Manual Verification Queue"
        subtitle="Sources blocked by bot detection (Apartments.com, Zillow, etc.). Open each URL in a real browser, paste the relevant text or screenshot path, then confirm."
      />

      <div className="grid grid-cols-3 gap-3 mb-6">
        <Stat label="Pending" value={`${pending}`} intent={pending > 0 ? "warn" : "good"} />
        <Stat label="Confirmed" value={`${confirmed}`} intent="good" />
        <Stat label="Total" value={`${rows.length}`} />
      </div>

      {msg && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{msg}</div>}

      <div className="space-y-4">
        {rows.map(r => (
          <Card key={r.id}>
            <CardHeader
              title={`${r.entityName ?? r.entityId} · ${r.fieldLabel ?? r.fieldKey}`}
              subtitle={r.sourceType}
              action={<Badge intent={r.status === "confirmed" ? "good" : r.status === "rejected" ? "bad" : "warn"}>{r.status}</Badge>}
            />
            <CardBody>
              {r.sourceUrl && (
                <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="text-sm text-sky-700 underline block mb-2 break-all">
                  {r.sourceUrl} ↗
                </a>
              )}
              {r.expectedValue && <div className="text-sm mb-2"><span className="text-slate-500 text-xs">Expected:</span> {r.expectedValue}</div>}
              {r.reason && <div className="text-xs text-slate-500 italic mb-3">{r.reason}</div>}

              {editing === r.id ? (
                <div className="space-y-2 text-sm">
                  <div>
                    <label className="text-xs text-slate-500">Manually entered value (paste from browser)</label>
                    <textarea
                      value={draft.manualEnteredValue ?? ""}
                      onChange={e => setDraft(d => ({ ...d, manualEnteredValue: e.target.value }))}
                      className="w-full border rounded px-2 py-1 mt-1" rows={3}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Notes</label>
                    <input
                      value={draft.manualNotes ?? ""}
                      onChange={e => setDraft(d => ({ ...d, manualNotes: e.target.value }))}
                      className="w-full border rounded px-2 py-1 mt-1"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => save(r)} className="px-3 py-1.5 rounded bg-slate-900 text-white text-sm">Save</button>
                    <button onClick={() => markStatus({ ...r, manualEnteredValue: draft.manualEnteredValue, manualNotes: draft.manualNotes }, "confirmed")} className="px-3 py-1.5 rounded bg-emerald-700 text-white text-sm">Save + confirm</button>
                    <button onClick={() => setEditing(null)} className="text-xs underline text-slate-500">cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 text-sm flex-wrap">
                  <button onClick={() => startEditing(r)} className="px-3 py-1.5 rounded border border-slate-300">Enter manual value</button>
                  {r.manualEnteredValue && (
                    <button onClick={() => createLedgerFromManual(r)} className="px-3 py-1.5 rounded bg-emerald-700 text-white text-xs">
                      Create ledger record from manual entry
                    </button>
                  )}
                  <button onClick={() => markStatus(r, "needs_screenshot")} className="px-3 py-1.5 rounded border border-slate-300 text-xs">Needs screenshot</button>
                  <button onClick={() => markStatus(r, "rejected")} className="px-3 py-1.5 rounded border border-rose-300 text-rose-700 text-xs">Mark still blocked</button>
                  {r.manualEnteredValue && (
                    <div className="ml-auto text-xs text-slate-600">
                      <strong>Entered:</strong> {r.manualEnteredValue}
                      {r.enteredBy && <span className="text-slate-400"> by {r.enteredBy}</span>}
                    </div>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}
