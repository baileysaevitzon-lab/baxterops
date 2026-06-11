"use client";
// Sprint 29 (Phase 6) — Connector staging panel.
//
// Shows connector-discovered facts (Apify / official-site scrapes) that are PENDING
// Bailey review. SAFETY CONTRACT:
//   - Promote is DISABLED. Promoting would write a structured competitor field, which
//     is not permitted in the pilot — it requires an explicit, separate Bailey action.
//   - Reject only updates the staging row's status in manual_verification_queue
//     (never touches competitors / unit_types / structured fields).
//   - Field-tour data is always marked as stronger than connector data.
import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, Badge } from "@/components/Card";
import { getAllQueueItems, upsertQueueItem } from "@/lib/services/verificationQueue";
import { loadCompetitor } from "@/lib/services/competitors";
import { planConnectorPromote, commitConnectorPromote, type PromotePlan } from "@/lib/services/promoteConnectorFact";
import { useRole } from "@/components/RoleProvider";
import type { ManualVerificationQueueRow } from "@/lib/types";

const NON_PROMOTABLE = (k: string) => k === "name" || k.endsWith("_rent_live");

// reason is stored as "CLASS | confidence | action"
function parseReason(reason?: string): { cls: string; confidence: string; action: string } {
  if (!reason) return { cls: "", confidence: "", action: "" };
  const [cls = "", confidence = "", ...rest] = reason.split(" | ");
  return { cls: cls.trim(), confidence: confidence.trim(), action: rest.join(" | ").trim() };
}
function dbCurrent(notes?: string): string {
  if (!notes) return "—";
  return notes.replace(/^DB current:\s*/i, "").trim() || "—";
}
function clsIntent(cls: string): "bad" | "warn" | "good" | "info" | "neutral" {
  if (cls.startsWith("CONFLICT")) return "bad";
  if (cls.startsWith("REVIEW")) return "warn";
  if (cls.startsWith("NEW")) return "info";
  if (cls.startsWith("MATCH")) return "good";
  return "neutral";
}
function statusLabel(s: string): string {
  return s === "confirmed" ? "approved" : s === "rejected" ? "rejected" : s === "in_progress" ? "needs_review" : "pending";
}

export function ConnectorStagingPanel() {
  const [rows, setRows] = useState<ManualVerificationQueueRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [confirm, setConfirm] = useState<{ row: ManualVerificationQueueRow; plan: PromotePlan } | null>(null);
  const { user } = useRole();

  async function refresh() {
    const all = await getAllQueueItems();
    setRows(all.filter(r => (r.enteredBy ?? "").startsWith("Connector")));
  }
  useEffect(() => { refresh(); }, []);

  // Step 1 of Promote: compute the dry-run plan and show a confirm box. No write yet.
  async function startPromote(r: ManualVerificationQueueRow) {
    setMsg("");
    setBusy(r.id);
    try {
      const comp = await loadCompetitor(r.entityId);
      if (!comp) { setMsg("Could not load competitor."); return; }
      const plan = planConnectorPromote(r, comp, user.name);
      if (!plan.ok) { setMsg(`Cannot promote "${r.fieldLabel}": ${plan.blockedReason}`); return; }
      setConfirm({ row: r, plan });
    } finally {
      setBusy(null);
    }
  }

  // Step 2 of Promote: commit the previewed plan (writes field + ledger + status).
  async function commitPromote() {
    if (!confirm) return;
    setBusy(confirm.row.id);
    try {
      await commitConnectorPromote(confirm.row, confirm.plan, user.name);
      setMsg(`Promoted "${confirm.row.fieldLabel}" → ${confirm.plan.destination}.`);
      setConfirm(null);
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Promote failed.");
    } finally {
      setBusy(null);
    }
  }

  async function reject(r: ManualVerificationQueueRow) {
    setBusy(r.id);
    try {
      // Queue-status-only write. Does NOT touch any structured competitor field.
      await upsertQueueItem({ ...r, status: "rejected", reviewedBy: user.name, reviewedAt: new Date().toISOString() });
      setMsg(`Rejected "${r.fieldLabel}" (staging only — no structured field changed).`);
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader title="Connector staging · pending review" subtitle="Apify / official-site discovered facts awaiting Promote/Reject. None staged." />
        <CardBody><p className="text-sm text-slate-500">No connector-staged facts.</p></CardBody>
      </Card>
    );
  }

  const pending = rows.filter(r => r.status === "pending").length;

  return (
    <Card>
      <CardHeader
        title="Connector staging · pending review"
        subtitle={`${rows.length} connector-discovered facts · ${pending} pending. Nothing here has been written to structured competitor data.`}
      />
      <CardBody>
        <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-800 mb-3">
          🔒 <strong>Identity (name) and live-rent rows cannot be promoted here.</strong> Official live rents are <strong>observed listing facts</strong> and are <strong>not</strong> currently promoted into avgRent/minRent/maxRent — promote only after the rent-source strategy is approved. Reject only updates this staging row. <span className="font-medium">Field-tour data always outranks connector data.</span>
        </div>
        {msg && <div className="text-xs text-emerald-700 mb-2">{msg}</div>}

        {confirm && (
          <div className="mb-3 rounded-md border border-sky-300 bg-sky-50 px-3 py-3 text-sm">
            <div className="font-semibold text-sky-900">Confirm promote · {confirm.row.fieldLabel}</div>
            <div className="text-xs text-slate-600 mt-1">Destination: <code>{confirm.plan.destination}</code></div>
            <div className="mt-2 grid sm:grid-cols-2 gap-2 text-xs">
              <div className="bg-white border border-slate-200 rounded p-2"><div className="text-slate-400">Previous</div><div className="text-slate-700 break-words">{confirm.plan.prev || "—"}</div></div>
              <div className="bg-white border border-emerald-200 rounded p-2"><div className="text-emerald-600">New</div><div className="text-slate-900 break-words">{confirm.plan.next}</div></div>
            </div>
            <div className="mt-2 flex gap-2">
              <button onClick={commitPromote} disabled={busy === confirm.row.id} className="text-xs px-3 py-1.5 rounded bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50">
                {busy === confirm.row.id ? "Writing…" : "Confirm & write"}
              </button>
              <button onClick={() => setConfirm(null)} disabled={busy === confirm.row.id} className="text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-600 hover:bg-slate-50">Cancel</button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="bx text-sm">
            <thead>
              <tr>
                <th>Field</th><th>DB current</th><th>Connector value</th><th>Class / action</th>
                <th>Source</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const { cls, confidence, action } = parseReason(r.reason);
                return (
                  <tr key={r.id}>
                    <td className="font-medium whitespace-nowrap">{r.fieldLabel ?? r.fieldKey}</td>
                    <td className="text-slate-600 max-w-[180px]">{dbCurrent(r.manualNotes)}</td>
                    <td className="text-slate-900 max-w-[220px]">{r.expectedValue}</td>
                    <td className="max-w-[260px]">
                      <Badge intent={clsIntent(cls)}>{cls || "—"}</Badge>
                      {confidence && <span className="ml-1 text-[11px] text-slate-400">{confidence}</span>}
                      {action && <div className="text-[11px] text-slate-500 mt-1">{action}</div>}
                      {r.fieldKey.endsWith("_rent_live") && (
                        <div className="mt-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-1">
                          <strong>Held (observed-only).</strong> Single-floorplan snapshot, not a building average. Promoting would affect owner-facing pricing recommendations. Needs Bailey approval or a full-floorplan scrape first.
                        </div>
                      )}
                    </td>
                    <td className="text-[11px] whitespace-nowrap">
                      <div className="text-slate-600">{r.sourceType}</div>
                      {r.sourceUrl && <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="text-sky-700 underline">source ↗</a>}
                      <div className="text-slate-400">connector · weaker than field tour</div>
                    </td>
                    <td><Badge intent={r.status === "rejected" ? "neutral" : r.status === "confirmed" ? "good" : "warn"}>{statusLabel(r.status)}</Badge></td>
                    <td className="whitespace-nowrap">
                      {NON_PROMOTABLE(r.fieldKey) ? (
                        <button
                          disabled
                          title="Identity/name and live-rent facts cannot be promoted yet — needs an explicit Bailey decision."
                          className="text-xs px-2 py-1 rounded border border-slate-200 text-slate-400 cursor-not-allowed"
                        >
                          Promote 🔒
                        </button>
                      ) : (
                        <button
                          onClick={() => startPromote(r)}
                          disabled={busy === r.id || r.status !== "pending"}
                          title="Preview the change, then confirm to write the structured field."
                          className="text-xs px-2 py-1 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                        >
                          {r.status === "confirmed" ? "Promoted ✓" : "Promote"}
                        </button>
                      )}
                      <button
                        onClick={() => reject(r)}
                        disabled={busy === r.id || r.status === "rejected"}
                        className="ml-1 text-xs px-2 py-1 rounded border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                      >
                        {busy === r.id ? "…" : "Reject"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
