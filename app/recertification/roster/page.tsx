"use client";
// Sprint 19: Tenant roster page. Lets management:
//   • see all eligible + blocked tenants
//   • start a recertification case from a roster entry (auto-fills name + unit)
//   • generate / copy a tenant completion link + mark "sent"
//   • inline-add a brand-new tenant (name + unit only)
//   • track per-tenant lifecycle status (not_sent → sent → opened → in_progress
//     → submitted → manager_reviewed → merged)
//
// Realtime: subscribes to recert_tenant_roster so status changes from other
// browsers appear here without refresh.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { getSupabase } from "@/lib/supabase/client";
import {
  loadRoster,
  addTenant,
  startRecertificationFor,
  generateInvitationToken,
  markSent,
  refreshRosterStatusFromSessions,
  buildInvitationUrl,
  describeStatus,
  type RosterEntry,
} from "@/lib/services/recertTenantRoster";

type Tab = "eligible" | "blocked";

export default function RosterPage() {
  const { signedIn, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<Tab>("eligible");
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copied, setCopied] = useState<{ id: string; url: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const [adding, setAdding] = useState(false);

  // Initial load
  useEffect(() => {
    if (!signedIn) return;
    (async () => {
      await refreshRosterStatusFromSessions();
      const rows = await loadRoster();
      setRoster(rows);
    })();
  }, [signedIn]);

  // Realtime subscription
  useEffect(() => {
    if (!signedIn) return;
    const sb = getSupabase();
    if (!sb) return;
    const channel = sb
      .channel(`recert-roster-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "recert_tenant_roster" },
        () => { loadRoster().then(setRoster); },
      )
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [signedIn]);

  const eligible = useMemo(() => roster.filter(r => r.eligible), [roster]);
  const blocked = useMemo(() => roster.filter(r => !r.eligible), [roster]);

  async function handleStartRecert(entry: RosterEntry) {
    setBusyId(entry.id); setError(null);
    const res = await startRecertificationFor(entry.id);
    setBusyId(null);
    if (!res.ok) { setError(res.error ?? "Failed to start case"); return; }
    const fresh = await loadRoster();
    setRoster(fresh);
  }

  async function handleCopyLink(entry: RosterEntry) {
    setBusyId(entry.id); setError(null);
    let caseId = entry.caseId;
    if (!caseId) {
      const startRes = await startRecertificationFor(entry.id);
      if (!startRes.ok || !startRes.caseId) {
        setBusyId(null); setError(startRes.error ?? "Could not create case"); return;
      }
      caseId = startRes.caseId;
    }
    const tokenRes = await generateInvitationToken(entry.id);
    if (!tokenRes.ok || !tokenRes.token) {
      setBusyId(null); setError(tokenRes.error ?? "Could not generate token"); return;
    }
    const url = buildInvitationUrl(window.location.origin, caseId, tokenRes.token);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* clipboard blocked; still show link */
    }
    await markSent(entry.id);
    const fresh = await loadRoster();
    setRoster(fresh);
    setCopied({ id: entry.id, url });
    setBusyId(null);
  }

  async function handleAddTenant() {
    if (!newName.trim() || !newUnit.trim()) { setError("Name + unit are required"); return; }
    setAdding(true); setError(null);
    const res = await addTenant({ tenantName: newName.trim(), unitNumber: newUnit.trim() });
    setAdding(false);
    if (!res.ok) { setError(res.error ?? "Add failed"); return; }
    setNewName(""); setNewUnit("");
    const fresh = await loadRoster();
    setRoster(fresh);
  }

  if (authLoading) return <div className="p-6 text-sm text-slate-500">Loading auth…</div>;
  if (!signedIn) return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Sign in required</h1>
      <Link href="/login" className="underline">Sign in →</Link>
    </div>
  );

  const visible = tab === "eligible" ? eligible : blocked;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-4">
        <Link href="/recertification" className="text-xs text-slate-500 underline">← Recertification Command Center</Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">Tenant Roster</h1>
        <p className="text-sm text-slate-600 mt-1">
          Pick a tenant → start a recertification case → copy the tenant completion link.
          Status updates automatically when the tenant opens / submits the form.
        </p>
      </div>

      <div className="flex gap-2 border-b border-slate-200 mb-4">
        <TabButton active={tab === "eligible"} onClick={() => setTab("eligible")}>
          Eligible <span className="ml-1 text-xs text-emerald-700 font-semibold">{eligible.length}</span>
        </TabButton>
        <TabButton active={tab === "blocked"} onClick={() => setTab("blocked")}>
          Blocked <span className="ml-1 text-xs text-rose-700 font-semibold">{blocked.length}</span>
        </TabButton>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-900">{error}</div>
      )}

      {copied && (
        <div className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
          ✓ Link copied to clipboard for <strong>{roster.find(r => r.id === copied.id)?.tenantName}</strong>.<br />
          <code className="font-mono text-xs break-all">{copied.url}</code>
        </div>
      )}

      {tab === "eligible" && (
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-800 mb-2">Add a new tenant</h2>
          <p className="text-xs text-slate-500 mb-2">Use name + unit only. The case will pre-fill these into the LAHD packet.</p>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-slate-600 mb-1">Tenant name</label>
              <input
                type="text" value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Jane Doe"
                className="w-full px-3 py-2 rounded border border-slate-300 text-sm"
              />
            </div>
            <div className="w-32">
              <label className="block text-xs text-slate-600 mb-1">Unit #</label>
              <input
                type="text" value={newUnit} onChange={e => setNewUnit(e.target.value)}
                placeholder="e.g. 502"
                className="w-full px-3 py-2 rounded border border-slate-300 text-sm"
              />
            </div>
            <button
              onClick={handleAddTenant} disabled={adding || !newName.trim() || !newUnit.trim()}
              className="px-4 py-2 rounded bg-emerald-700 text-white text-sm disabled:bg-slate-300"
            >
              {adding ? "Adding…" : "Add tenant"}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 border-b border-slate-200">
            <tr className="text-left text-xs uppercase tracking-wide text-slate-600">
              <th className="px-3 py-2 w-16">Unit</th>
              <th className="px-3 py-2">Tenant name</th>
              <th className="px-3 py-2 w-44">Status</th>
              <th className="px-3 py-2 w-72">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-500 text-sm">No tenants in this list.</td></tr>
            )}
            {visible.map(entry => {
              const status = describeStatus(entry.status);
              return (
                <tr key={entry.id} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-3 py-2 font-mono text-slate-700">{entry.unitNumber}</td>
                  <td className="px-3 py-2">
                    <div className="text-slate-900 font-semibold">{entry.tenantName}</div>
                    {entry.caseId && (
                      <Link href={`/recertification/${entry.caseId}`} className="text-[11px] text-sky-700 underline font-mono">
                        {entry.caseId}
                      </Link>
                    )}
                    {!entry.eligible && entry.blockedReason && (
                      <div className="text-[11px] text-rose-700 mt-0.5">{entry.blockedReason}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill tone={status.tone} label={status.label} />
                    {entry.invitationSentAt && (
                      <div className="text-[10px] text-slate-500 mt-0.5">Sent {new Date(entry.invitationSentAt).toLocaleDateString()}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {!entry.eligible ? (
                      <span className="text-xs text-slate-400 italic">No actions available</span>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {!entry.caseId && (
                          <button
                            onClick={() => handleStartRecert(entry)}
                            disabled={busyId === entry.id}
                            className="px-3 py-1.5 rounded bg-slate-900 text-white text-xs disabled:bg-slate-400"
                          >
                            {busyId === entry.id ? "…" : "Start Recertification"}
                          </button>
                        )}
                        <button
                          onClick={() => handleCopyLink(entry)}
                          disabled={busyId === entry.id}
                          className="px-3 py-1.5 rounded bg-emerald-700 text-white text-xs disabled:bg-slate-400"
                        >
                          {busyId === entry.id ? "…" : (entry.invitationToken ? "Copy link again" : "Copy tenant link")}
                        </button>
                        {entry.caseId && (
                          <Link href={`/recertification/${entry.caseId}`} className="px-3 py-1.5 rounded border border-slate-300 text-xs text-slate-700 bg-white">
                            Open case →
                          </Link>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-500 mt-3">
        Eligible / blocked status is configured at the table level. Blocked tenants cannot be issued invitation links.
      </p>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${active ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}
    >
      {children}
    </button>
  );
}

function StatusPill({ tone, label }: { tone: "slate" | "amber" | "blue" | "green" | "rose" | "violet"; label: string }) {
  const toneClasses: Record<string, string> = {
    slate:  "bg-slate-100 text-slate-700 border-slate-300",
    amber:  "bg-amber-100 text-amber-900 border-amber-300",
    blue:   "bg-sky-100 text-sky-900 border-sky-300",
    green:  "bg-emerald-100 text-emerald-900 border-emerald-300",
    rose:   "bg-rose-100 text-rose-900 border-rose-300",
    violet: "bg-violet-100 text-violet-900 border-violet-300",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-semibold ${toneClasses[tone]}`}>
      {label}
    </span>
  );
}
