"use client";
// Production Deployment Safety panel.
//
// Reads real runtime state (backend mode, Supabase env presence, ledger conflicts
// count, audit log writes) and renders an honest readiness verdict.
// Does NOT pretend the deployment is safe when RLS is permissive.

import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, Badge, Stat } from "./Card";
import { useSourceLedger } from "./SourceLedgerProvider";
import { getAllConflicts } from "@/lib/services/sourceConflicts";
import { count as countRows } from "@/lib/services/persistence";
import type { SourceConflictRow } from "@/lib/types";

interface Props {
  backendMode: string;
  hasEnv: boolean;
  flagsCount: number;
}

// Sprint 7 — current RLS state is permissive. Hardcoded honest. Until someone
// updates this constant after locking down policies, the UI must shout.
const RLS_STATE = "permissive_mvp" as const;

export function ProductionSafetyPanel({ backendMode, hasEnv, flagsCount }: Props) {
  const ledger = useSourceLedger();
  const [conflicts, setConflicts] = useState<SourceConflictRow[]>([]);
  const [auditCount, setAuditCount] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      setConflicts(await getAllConflicts());
      setAuditCount(await countRows("audit_logs"));
    })();
  }, []);

  const openConflicts = conflicts.filter(c => c.status !== "resolved" && !c.status.startsWith("accept")).length;
  const needsReview = (ledger?.rows ?? []).filter(r => r.verificationStatus === "needs_review" || r.verificationStatus === "needs_verification").length;
  const reportUnverified = (ledger?.rows ?? []).filter(r => (r.pageRoutes ?? []).includes("/reports") && r.verificationStatus !== "verified").length;

  // Readiness verdict (intentionally conservative).
  const verdict: { label: string; tone: "bad" | "warn" | "good"; reason: string } =
    !hasEnv ? { label: "BLOCKED — no backend env vars", tone: "bad", reason: "App is running in localStorage fallback. No Supabase deploy possible." } :
    RLS_STATE === "permissive_mvp" ? { label: "DO NOT SHARE PUBLICLY", tone: "bad", reason: "Supabase RLS is permissive (anon read+write on every table). UI RBAC is not enough on its own." } :
    openConflicts > 0 ? { label: "CAUTION — unresolved source conflicts", tone: "warn", reason: `${openConflicts} open conflicts in /source-conflicts.` } :
    needsReview > 0 ? { label: "READY FOR INTERNAL DEPLOYMENT", tone: "warn", reason: `${needsReview} ledger entries still needs_review.` } :
    { label: "READY FOR INTERNAL DEPLOYMENT", tone: "good", reason: "All checks passed." };

  return (
    <Card className="mb-6 border-l-4 border-l-rose-500">
      <CardHeader
        title="Production Deployment Safety"
        subtitle="Honest readiness check before sharing this URL with anyone."
      />
      <CardBody>
        <div className={`rounded-md px-4 py-3 text-sm border mb-4 ${
          verdict.tone === "bad" ? "border-rose-300 bg-rose-50 text-rose-900" :
          verdict.tone === "warn" ? "border-amber-300 bg-amber-50 text-amber-900" :
          "border-emerald-300 bg-emerald-50 text-emerald-900"
        }`}>
          <div className="font-semibold">{verdict.label}</div>
          <div className="text-xs mt-1">{verdict.reason}</div>
          {RLS_STATE === "permissive_mvp" && (
            <div className="text-xs mt-2">
              See <a href="/docs" className="underline" title="docs/PRODUCTION_SECURITY.md">docs/PRODUCTION_SECURITY.md</a> and task <code>tk-rls-prod</code>.
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
          <Stat label="Backend mode" value={backendMode} intent={backendMode === "supabase" ? "good" : "warn"} />
          <Stat label="Supabase env detected" value={hasEnv ? "yes" : "no"} intent={hasEnv ? "good" : "bad"} />
          <Stat label="RLS status" value="permissive" intent="bad" sub="MVP — open to anon" />
          <Stat label="UI RBAC" value="enabled" intent="warn" sub="client-side only" />
          <Stat label="Audit log backend" value={auditCount === null ? "—" : `supabase (${auditCount})`} intent={auditCount === null ? "neutral" : "good"} />
          <Stat label="Sensitive tenant data" value="seeded in JS bundle" intent="bad" sub="lib/seed.ts ships to browser" />
          <Stat label="Open data conflicts" value={`${openConflicts}`} intent={openConflicts > 0 ? "warn" : "good"} />
          <Stat label="Needs-review ledger" value={`${needsReview}`} intent={needsReview > 0 ? "warn" : "good"} />
          <Stat label="Report unverified" value={`${reportUnverified}`} intent={reportUnverified > 0 ? "warn" : "good"} />
          <Stat label="Data quality flags" value={`${flagsCount}`} />
        </div>

        <div className="space-y-2 text-xs text-slate-700">
          <div><strong>What is currently safe:</strong> local dev (your laptop), a private Vercel preview URL that you don't share, internal SGD users who you trust to keep the URL private.</div>
          <div><strong>What is NOT safe:</strong> sharing the URL with anyone outside SGD, listing bmsbets.com publicly, embedding in marketing material, anyone reading the JS bundle (they get tenant seed data and the anon key, and the anon key currently has full DB write access).</div>
          <div><strong>What unblocks public deployment:</strong> Supabase Auth + per-role RLS policies on every table (see <code>docs/PRODUCTION_SECURITY.md</code> phases 1-4), plus moving the four seeded tenants out of <code>lib/seed.ts</code> into a Supabase table with strict RLS.</div>
        </div>
      </CardBody>
    </Card>
  );
}

export function DeploymentTargetPanel() {
  return (
    <Card className="mb-6 border-l-4 border-l-sky-500">
      <CardHeader title="Deployment Target" subtitle="Hosting / DNS / SSL plan" />
      <CardBody>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <Row k="Hosting target" v="Vercel" />
          <Row k="Domain registrar / DNS" v="IONOS" />
          <Row k="Primary domain" v="bmsbets.com" />
          <Row k="WWW domain" v="www.bmsbets.com" />
          <Row k="SSL" v="Vercel-managed (auto-issued Let's Encrypt)" />
          <Row k="IONOS wildcard SSL" v="On file, not needed for Vercel deployment" />
          <Row k="Deployment status" v="local dev only" />
          <Row k="Production URL" v="not connected yet" />
          <Row k="Last deployment checklist" v="never" />
        </div>
        <p className="text-xs text-slate-500 mt-4">
          See <code>docs/DEPLOYMENT.md</code> for the exact GitHub → Vercel → IONOS step-by-step.
        </p>
      </CardBody>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-slate-100 py-1">
      <span className="text-slate-500">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
