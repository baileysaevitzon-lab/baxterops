"use client";
// Sprint 12: /sync-test — QA tool for proving cross-device sync.
//
// Workflow (with two browsers, A and B):
//   1. Open /sync-test on Computer A and Computer B, signed in.
//   2. Computer A: click "Create test property" — a competitor row is inserted
//      with a unique timestamped ID. Computer B's "Live test properties" list
//      updates within ~1s via Postgres realtime.
//   3. Computer A: edit the inline notes. Computer B sees the new value live.
//   4. Computer A: add a sample unit ($X). Computer B sees the unit row.
//   5. Either device: click "Archive" to soft-delete and stop receiving updates.
//
// What this page proves (and what it does NOT):
//   - PROVES: writes from one session land in Supabase and are observable by
//             another authenticated session, via both realtime AND refresh.
//   - DOES NOT PROVE: anonymous/unauthenticated cross-device reads (RLS blocks
//             those — see LiveDataBanner for that path).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { useAuth } from "@/components/AuthProvider";
import { getSupabase, hasSupabaseEnv } from "@/lib/supabase/client";
import {
  upsertCompetitor,
  deactivateCompetitor,
  deleteCompetitor,
  updateCompetitorFields,
  loadAllCompetitors,
} from "@/lib/services/competitors";
import { LiveDataBanner } from "@/components/LiveDataBanner";
import { InlineEditField } from "@/components/InlineEditField";
import type { CompetitorProperty } from "@/lib/types";

const TEST_PREFIX = "c-sync-test-";

function randomSuffix() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export default function SyncTest() {
  const { authUser, profile, signedIn, loading } = useAuth();
  const userLabel = profile?.full_name ?? authUser?.email ?? "anonymous";
  const [props, setProps] = useState<CompetitorProperty[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<string | null>(null);

  async function refresh() {
    const all = await loadAllCompetitors();
    setProps(all.filter(c => c.id.startsWith(TEST_PREFIX)));
  }

  useEffect(() => {
    let channel: ReturnType<NonNullable<ReturnType<typeof getSupabase>>["channel"]> | null = null;
    refresh().catch(e => setError(String(e)));

    const sb = getSupabase();
    if (sb) {
      channel = sb
        // Sprint 12: unique-per-mount channel name to avoid StrictMode collisions
        .channel(`sync-test-live-${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "competitors" },
          (payload) => {
            const row = (payload.new || payload.old) as { id?: string } | null;
            if (row?.id?.startsWith(TEST_PREFIX)) {
              setLastEvent(`[${new Date().toLocaleTimeString()}] ${payload.eventType} ${row.id}`);
              refresh().catch(() => {});
            }
          },
        )
        .subscribe();
    }

    return () => {
      const sb2 = getSupabase();
      if (channel && sb2) sb2.removeChannel(channel);
    };
  }, []);

  async function createTestProperty() {
    setError(null);
    setCreating(true);
    try {
      const suffix = randomSuffix();
      const id = `${TEST_PREFIX}${suffix}`;
      await upsertCompetitor({
        id,
        name: `Sync Test ${suffix}`,
        address: `[Cross-device test row created at ${new Date().toLocaleString()}]`,
        units: 1,
        unitTypes: [
          {
            type: "1BR",
            avgRent: 1000 + Math.floor(Math.random() * 3000),
            avgSqft: 600 + Math.floor(Math.random() * 600),
          },
        ],
        amenities: ["sync-test-only"],
        notes: "Created from /sync-test — safe to delete.",
        threatLevel: 1,
        fieldVerified: false,
        dataConfidence: "low",
        createdBy: userLabel,
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function archiveAllTestProps() {
    setError(null);
    for (const p of props) {
      try {
        await deactivateCompetitor(p.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    await refresh();
  }

  async function hardDeleteAll() {
    if (!confirm(`Permanently delete ${props.length} test rows from Supabase?`)) return;
    setError(null);
    for (const p of props) {
      try {
        await deleteCompetitor(p.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    await refresh();
  }

  const sessionInfo = useMemo(() => {
    if (loading) return "loading…";
    if (!signedIn) return "NOT SIGNED IN — writes will be blocked by RLS";
    return `signed in as ${userLabel}`;
  }, [loading, signedIn, userLabel]);

  return (
    <>
      <LiveDataBanner />
      <PageHeader
        title="Cross-Device Sync Test"
        subtitle="Internal QA tool. Create + edit + delete a temporary 'Sync Test' competitor and watch it appear on another browser."
        action={
          <Link href="/settings" className="text-xs underline text-slate-500">
            ← back to settings
          </Link>
        }
      />

      <Card className="mb-6">
        <CardHeader title="Session" />
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-xs text-slate-500 mb-1">Session</div>
              <div className="font-mono text-slate-800">{sessionInfo}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1">Supabase configured</div>
              <div className="font-mono text-slate-800">{hasSupabaseEnv ? "✓ yes" : "✗ no"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1">Last realtime event</div>
              <div className="font-mono text-slate-800 text-[11px]">{lastEvent ?? "—"}</div>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader title="Step 1 — Create a test property" />
        <CardBody>
          <p className="text-sm text-slate-700 mb-3">
            Open this page on a second browser/computer (both signed in) before clicking. The new
            row should appear on both within 1–2 seconds via Postgres realtime.
          </p>
          <button
            onClick={createTestProperty}
            disabled={creating || !signedIn}
            className="px-4 py-2 rounded-md bg-emerald-700 text-white text-sm disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            {creating ? "Creating…" : "Create test property"}
          </button>
          {!signedIn && (
            <p className="text-xs text-amber-700 mt-2">
              Sign in first — RLS blocks writes for anonymous sessions (that's intentional).
            </p>
          )}
          {error && (
            <p className="text-xs text-rose-700 mt-2 font-mono whitespace-pre-wrap">{error}</p>
          )}
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader title={`Step 2 — Live test properties (${props.length})`} />
        <CardBody>
          {props.length === 0 ? (
            <p className="text-sm text-slate-500">
              No active test rows. Click "Create test property" to start.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left p-2">ID (last 6)</th>
                  <th className="text-left p-2">Name</th>
                  <th className="text-left p-2">Notes (✏️ inline-edit me)</th>
                  <th className="text-left p-2">Last updated</th>
                </tr>
              </thead>
              <tbody>
                {props.map(p => (
                  <tr key={p.id} className="border-b border-slate-100">
                    <td className="p-2 font-mono text-[10px] text-slate-500">
                      …{p.id.slice(-6)}
                    </td>
                    <td className="p-2 text-slate-800">{p.name}</td>
                    <td className="p-2 text-slate-700">
                      <InlineEditField
                        value={p.notes ?? ""}
                        placeholder="(no notes — click ✏️)"
                        multiline
                        label="Notes"
                        onSave={async (v) => {
                          await updateCompetitorFields(p.id, { notes: v });
                          await refresh();
                        }}
                      />
                    </td>
                    <td className="p-2 text-[10px] text-slate-500 font-mono">
                      {p.lastVerifiedAt ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Step 3 — Cleanup" />
        <CardBody className="flex gap-3 items-center">
          <button
            onClick={archiveAllTestProps}
            disabled={!signedIn || props.length === 0}
            className="px-3 py-1.5 rounded-md bg-amber-600 text-white text-xs disabled:bg-slate-300"
          >
            Archive all test rows (soft delete)
          </button>
          <button
            onClick={hardDeleteAll}
            disabled={!signedIn || props.length === 0}
            className="px-3 py-1.5 rounded-md bg-rose-700 text-white text-xs disabled:bg-slate-300"
          >
            Hard delete all test rows
          </button>
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="How to read the results" />
        <CardBody>
          <ul className="text-xs text-slate-700 list-disc pl-5 space-y-1">
            <li>
              <strong>Realtime sync works</strong> if "Last realtime event" updates on the OTHER
              device after you click "Create" or edit notes on THIS device.
            </li>
            <li>
              <strong>Refresh sync works</strong> if hard-refreshing the other device shows the same
              test rows in the list.
            </li>
            <li>
              <strong>RLS is correct</strong> if anonymous (signed-out) sessions see 0 test rows
              and the create button is disabled.
            </li>
            <li>
              <strong>If nothing happens</strong>, check the browser console for Supabase auth or
              network errors. Make sure both devices are signed in to the same project.
            </li>
          </ul>
        </CardBody>
      </Card>
    </>
  );
}
