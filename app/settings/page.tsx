"use client";
import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { DEFAULT_MATCHING_WEIGHTS, UTILITY_ALLOWANCE_SCHEDULE, LAHD_CAPS } from "@/lib/seed";
import { DATA_QUALITY_FLAGS } from "@/lib/dataQuality";
import { RoleSwitcher, useRole } from "@/components/RoleProvider";
import { MOCK_USERS, describePermission } from "@/lib/auth";
import { loadFlagStatuses, saveFlagStatus } from "@/lib/storage";
import { getAllRuntimeFlags } from "@/lib/services/dataQuality";
import { BACKEND_MODE, count, syncLocalFallbackToSupabase } from "@/lib/services/persistence";
import { hasSupabaseEnv } from "@/lib/supabase/client";
import { TABLES } from "@/lib/services/tables";
import { replayZenSeed, ZEN_FIELD_TOUR_ID, ZEN_COMPETITOR_ID } from "@/lib/zen";
import { loadCompetitorEvidence } from "@/lib/services/competitorEvidence";
import { ProductionSafetyPanel, DeploymentTargetPanel } from "@/components/ProductionSafetyPanel";
import type { DataQualityFlag, FlagStatus } from "@/lib/types";
import type { Permission } from "@/lib/auth";

const ALL_PERMS: Permission[] = [
  "view_sensitive_tenant",
  "view_general_tenant",
  "view_market_data",
  "view_owner_report",
  "edit_tenant",
  "edit_competitor",
];

export default function Settings() {
  const { user, can } = useRole();
  const [statuses, setStatuses] = useState<Record<string, { status: FlagStatus; notes?: string }>>(loadFlagStatuses());
  const [runtimeFlags, setRuntimeFlags] = useState<DataQualityFlag[]>([]);

  useEffect(() => {
    (async () => {
      await new Promise(r => setTimeout(r, 50));
      setRuntimeFlags(await getAllRuntimeFlags());
    })();
  }, []);

  // Merge static + runtime flags, dedupe by id (runtime wins)
  const allFlags: DataQualityFlag[] = (() => {
    const map = new Map<string, DataQualityFlag>();
    for (const f of DATA_QUALITY_FLAGS) map.set(f.id, f);
    for (const f of runtimeFlags) map.set(f.id, f);
    return Array.from(map.values());
  })();

  // ----- Sprint 4 admin panel state -----
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [adminMsg, setAdminMsg] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function refreshCounts() {
    const entries = await Promise.all(Object.values(TABLES).map(async t => [t, await count(t)] as const));
    setCounts(Object.fromEntries(entries));
  }
  useEffect(() => { refreshCounts(); }, []);

  async function handleReplayZen() {
    if (!confirm("Re-upsert all Zen seed rows into the backend?")) return;
    setBusy(true); setAdminMsg("Replaying Zen seed…");
    try {
      const r = await replayZenSeed();
      await refreshCounts();
      setAdminMsg(`Zen seed replayed: ${r.fieldTours} field tour, ${r.units} units, ${r.amenities} amenities, ${r.photos} photos, ${r.sources} sources, ${r.flags} flags.`);
    } catch (e) {
      setAdminMsg(`Replay failed: ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  async function handleSyncLocal() {
    if (BACKEND_MODE !== "supabase") { setAdminMsg("Sync requires Supabase mode."); return; }
    if (!confirm("Push every leftover localStorage row into Supabase? Non-destructive (upsert).")) return;
    setBusy(true); setAdminMsg("Syncing localStorage → Supabase…");
    try {
      const results = await syncLocalFallbackToSupabase(Object.values(TABLES));
      await refreshCounts();
      setAdminMsg("Sync complete: " + results.map(r => `${r.table}=${r.copied}`).join(", "));
    } catch (e) {
      setAdminMsg(`Sync failed: ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  async function handleValidateZen() {
    setBusy(true); setAdminMsg("Validating Zen evidence…");
    try {
      const e = await loadCompetitorEvidence(ZEN_COMPETITOR_ID);
      const ft = e.fieldTours.find(t => t.id === ZEN_FIELD_TOUR_ID);
      setAdminMsg(`Zen check: field tour ${ft ? "✓" : "✗"} · units ${e.observedUnits.length} · amenities ${e.amenityObservations.length} · photos ${e.photoEvidence.length} (${e.photoEvidence.filter(p => p.publicUrl).length} with image) · sources ${e.sourceVerifications.length} · flags ${e.flags.length}`);
    } catch (e) {
      setAdminMsg(`Validate failed: ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  async function handleExport() {
    setBusy(true); setAdminMsg("Exporting Zen JSON…");
    try {
      const e = await loadCompetitorEvidence(ZEN_COMPETITOR_ID);
      const blob = new Blob([JSON.stringify(e, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `zen-evidence-${new Date().toISOString().slice(0,10)}.json`;
      a.click(); URL.revokeObjectURL(url);
      setAdminMsg(`Exported ${e.observedUnits.length} units, ${e.photoEvidence.length} photos, ${e.amenityObservations.length} amenities.`);
    } catch (e) {
      setAdminMsg(`Export failed: ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  function handleClearLocalOnly() {
    if (!confirm("Clear all baxter-ops.* localStorage keys? Supabase data is NOT affected.")) return;
    let cleared = 0;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("baxter-ops")) { localStorage.removeItem(k); cleared++; }
    }
    setAdminMsg(`Cleared ${cleared} localStorage keys. Supabase rows untouched.`);
  }

  function setFlag(id: string, status: FlagStatus) {
    saveFlagStatus(id, status);
    setStatuses(s => ({ ...s, [id]: { ...s[id], status } }));
  }

  const effectiveStatus = (f: DataQualityFlag): FlagStatus => statuses[f.id]?.status ?? f.status;
  const open = allFlags.filter(f => effectiveStatus(f) !== "fixed");
  const fixed = allFlags.filter(f => effectiveStatus(f) === "fixed");

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle={`Acting role, data import, matching weights, compliance caps, and data quality flags. · Backend mode: ${BACKEND_MODE}`}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader title="Current role" subtitle="Session-scoped role switcher · MVP RBAC, not enterprise auth" />
          <CardBody>
            <RoleSwitcher />
            <div className="mt-4 text-sm">
              <div className="text-xs text-slate-500 mb-1">Active permissions</div>
              <ul className="space-y-1">
                {ALL_PERMS.map(p => (
                  <li key={p} className="flex items-center justify-between">
                    <span className="text-slate-700">{describePermission(p)}</span>
                    <Badge intent={can(p) ? "good" : "bad"}>{can(p) ? "yes" : "no"}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Mock user roster" subtitle="Switch from the top-right pill or here" />
          <CardBody>
            <ul className="text-sm divide-y divide-slate-100">
              {MOCK_USERS.map(u => (
                <li key={u.id} className="py-2 flex justify-between items-center">
                  <span>{u.name}</span>
                  <Badge intent={u.id === user.id ? "good" : "neutral"}>{u.role}</Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>

      {/* ----- Sprint 7: Production Deployment Safety ----- */}
      <ProductionSafetyPanel
        backendMode={BACKEND_MODE}
        hasEnv={hasSupabaseEnv}
        flagsCount={runtimeFlags.length}
      />

      {/* ----- Sprint 7: Deployment Target ----- */}
      <DeploymentTargetPanel />

      {/* ----- Sprint 4 backend admin ----- */}
      <Card className="mb-6 border-l-4 border-l-sky-500">
        <CardHeader
          title="Backend Admin"
          subtitle={`Mode: ${BACKEND_MODE} · Supabase env detected: ${hasSupabaseEnv ? "yes" : "no"}`}
        />
        <CardBody>
          <div className="mb-4 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            <strong>⚠ Security warning:</strong> Current Supabase RLS policies are <em>permissive</em> (anon read+write on every table and on the photos bucket) for MVP / local testing.
            Do not deploy publicly until Supabase Auth + role-based RLS policies are implemented. See task <code>tk-rls-prod</code>.
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4 text-xs">
            {Object.values(TABLES).map(t => (
              <div key={t} className="bg-slate-50 rounded p-2">
                <div className="text-slate-500">{t}</div>
                <div className="font-medium">{counts[t] ?? "—"}</div>
              </div>
            ))}
          </div>

          {adminMsg && (
            <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono whitespace-pre-wrap">{adminMsg}</div>
          )}

          <div className="flex flex-wrap gap-2 text-sm">
            <button disabled={busy} onClick={handleReplayZen} className="px-3 py-1.5 rounded-md bg-slate-900 text-white disabled:opacity-50">Replay Zen seed into backend</button>
            <button disabled={busy || BACKEND_MODE !== "supabase"} onClick={handleSyncLocal} className="px-3 py-1.5 rounded-md border border-slate-300 disabled:opacity-50">Sync local fallback → Supabase</button>
            <button disabled={busy} onClick={handleValidateZen} className="px-3 py-1.5 rounded-md border border-slate-300 disabled:opacity-50">Validate Zen evidence</button>
            <button disabled={busy} onClick={refreshCounts} className="px-3 py-1.5 rounded-md border border-slate-300 disabled:opacity-50">Refresh table counts</button>
            <button disabled={busy} onClick={handleExport} className="px-3 py-1.5 rounded-md border border-slate-300 disabled:opacity-50">Export Zen evidence JSON</button>
            <button disabled={busy} onClick={handleClearLocalOnly} className="px-3 py-1.5 rounded-md border border-rose-300 text-rose-700 disabled:opacity-50">Clear localStorage only</button>
          </div>
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader title={`Data quality flags · ${open.length} open / ${fixed.length} fixed`} subtitle="Issues surfaced by the Sprint 2 audit and from anomalous source data" />
        <CardBody className="p-0">
          <table className="bx">
            <thead>
              <tr><th>Issue</th><th>Entity</th><th>Severity</th><th>Status</th><th>Notes</th><th></th></tr>
            </thead>
            <tbody>
              {[...open, ...fixed].map(f => {
                const status = effectiveStatus(f);
                return (
                  <tr key={f.id}>
                    <td>{f.issue}</td>
                    <td className="text-xs">{f.affectedEntity}</td>
                    <td><Badge intent={f.severity === "critical" ? "bad" : f.severity === "high" ? "bad" : f.severity === "medium" ? "warn" : "neutral"}>{f.severity}</Badge></td>
                    <td>
                      <select value={status} onChange={e => setFlag(f.id, e.target.value as FlagStatus)} className="text-xs border rounded px-2 py-0.5">
                        <option value="open">open</option>
                        <option value="acknowledged">acknowledged</option>
                        <option value="needs_verification">needs_verification</option>
                        <option value="fixed">fixed</option>
                      </select>
                    </td>
                    <td className="text-xs text-slate-500 max-w-md">{f.notes}</td>
                    <td className="text-right whitespace-nowrap">
                      {status !== "fixed" && status !== "acknowledged" && (
                        <button onClick={() => setFlag(f.id, "acknowledged")} className="text-xs underline text-slate-700">Acknowledge</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Data import" subtitle="Upload weekly comp report or AppFolio export" />
          <CardBody>
            <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center text-slate-500 text-sm">
              Drop PDF, XLSX, or CSV here.
              <div className="text-xs text-slate-400 mt-2">v2 will auto-parse the call-around format.</div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Default matching weights" subtitle="Edit per-unit in /comp-matching" />
          <CardBody>
            <ul className="text-sm space-y-1">
              {Object.entries(DEFAULT_MATCHING_WEIGHTS).map(([k, v]) => (
                <li key={k} className="flex justify-between border-b border-slate-100 py-1">
                  <span>{k}</span>
                  <span className="font-medium">{(v * 100).toFixed(0)}%</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="LAHD utility allowance schedule" />
          <CardBody>
            <ul className="text-sm space-y-1">
              {Object.entries(UTILITY_ALLOWANCE_SCHEDULE).map(([k, v]) => (
                <li key={k} className="flex justify-between border-b border-slate-100 py-1">
                  <span>{k}</span>
                  <span className="font-medium">${v}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="LAHD caps (tenant rent + allowance)" />
          <CardBody>
            <ul className="text-sm space-y-1">
              {Object.entries(LAHD_CAPS).map(([k, v]) => (
                <li key={k} className="flex justify-between border-b border-slate-100 py-1">
                  <span>{k}</span>
                  <span className="font-medium">${v}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500 mt-3">Placeholder values. Confirm against the LAHD covenant.</p>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Privacy reminders" />
          <CardBody>
            <ul className="text-sm space-y-1 text-slate-700">
              <li>· Health-related tenant notes are flagged 🔒 Private and excluded from owner reports.</li>
              <li>· Compliance-sensitive material (LAHD cap violations, eviction notices) requires Admin / Manager role to view.</li>
              <li>· Outreach templates default to neutral, non-threatening language.</li>
              <li>· Every sensitive-field view is recorded in <a href="/audit-log" className="text-sky-700 underline">/audit-log</a>.</li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
