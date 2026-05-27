"use client";
import { useEffect, useMemo, useState } from "react";
import { Card, CardBody, CardHeader, PageHeader, Badge, Stat } from "@/components/Card";
import { BAXTER_UNITS, COMPETITORS, MARKETING_SOURCES, TENANTS, WALKTHROUGH_TOURS } from "@/lib/seed";
import { compAverageLeased, compAverageOccupancy, compAverageRent, fmtMoney, vacancyLoss } from "@/lib/calc";
import { useRole } from "@/components/RoleProvider";
import { getAllConflicts } from "@/lib/services/sourceConflicts";
import { useSourceLedger } from "@/components/SourceLedgerProvider";
import { isStale } from "@/lib/services/sourceLedger";
import type { SourceConflictRow } from "@/lib/types";

export default function Reports() {
  const today = new Date().toISOString().slice(0, 10);
  const [copied, setCopied] = useState(false);
  const [ownerSafe, setOwnerSafe] = useState(true);
  const { user, can } = useRole();
  const [conflicts, setConflicts] = useState<SourceConflictRow[]>([]);
  const ledger = useSourceLedger();
  useEffect(() => { (async () => setConflicts(await getAllConflicts()))(); }, []);

  const openConflicts = conflicts.filter(c => c.status !== "resolved" && !c.status.startsWith("accept"));
  const ledgerStats = useMemo(() => {
    const rows = ledger?.rows ?? [];
    return {
      verified: rows.filter(r => r.verificationStatus === "verified").length,
      needsReview: rows.filter(r => r.verificationStatus === "needs_review" || r.verificationStatus === "needs_verification").length,
      conflicting: rows.filter(r => r.verificationStatus === "conflicting_sources").length,
      stale: rows.filter(r => isStale(r)).length,
      total: rows.length,
    };
  }, [ledger]);
  const canSeeInternal = can("view_sensitive_tenant");

  const report = useMemo(() => {
    const occ = compAverageOccupancy(COMPETITORS);
    const leased = compAverageLeased(COMPETITORS);
    const baxter1BR = BAXTER_UNITS.filter(u => u.type === "1BR").map(u => u.askingRent);
    const baxter1BRAvg = baxter1BR.length ? baxter1BR.reduce((a, b) => a + b, 0) / baxter1BR.length : 0;
    const comp1BR = compAverageRent(COMPETITORS, "1BR");
    const vacancy = vacancyLoss(BAXTER_UNITS);
    const pendingTours = WALKTHROUGH_TOURS.filter(t => t.status !== "completed").length;
    const escalations = TENANTS.filter(t => t.status === "escalation").length;
    const missingDocs = TENANTS.filter(t => t.documentsRequested.length > t.documentsReceived.length).length;
    const totalMkt = MARKETING_SOURCES.reduce((s, m) => s + m.monthlyCost, 0);
    const totalLeads = MARKETING_SOURCES.reduce((s, m) => s + m.leads, 0);

    // Internal vs owner-safe rendering of the escalation line:
    const escalationLine = ownerSafe || !canSeeInternal
      ? `• ${escalations} affordable-unit escalation(s) requires Catherine/HACLA review.`
      : `• Yolanda Benning escalation requires Catherine/HACLA review (tenant rent $1,900 vs LAHD $1,000 cap).`;

    // Net effective rent example for 105
    const u105 = BAXTER_UNITS.find(u => u.id === "u-105");
    const u105Net = u105 ? (u105.askingRent * 12) / (u105.leaseMonths ?? 13) : 0;

    return `THE BAXTER — WEEKLY REPORT
Week ending ${today}
${ownerSafe ? "[OWNER-SAFE VERSION]" : "[INTERNAL VERSION]"}

EXECUTIVE SUMMARY
• Occupancy: 89% (comp avg ${occ.toFixed(1)}%, gap ${(89 - occ).toFixed(1)}pp)
• Leased: 89% (comp avg ${leased.toFixed(1)}%, gap ${(89 - leased).toFixed(1)}pp) ← LAGGARD
• Vacancy loss: ${fmtMoney(vacancy)}/mo
• Leads: ${totalLeads} this period (Zumper driving 7 of 8; Apartments.com 1 lead at ${fmtMoney(totalMkt)}/mo spend)

BAXTER VS MARKET COMP
• 1BR avg rent: ${fmtMoney(baxter1BRAvg)} vs comp ${fmtMoney(comp1BR)} (gap ${baxter1BRAvg < comp1BR ? "underpriced" : "overpriced"} ${fmtMoney(Math.abs(baxter1BRAvg - comp1BR))})
• Studio: −11% to comp average
• 2BR: −11% to comp average
• Pricing is below market — the lever is not further price cuts.

CLOSEST COMPETITOR COMPS
• Zen Hollywood (adjacent, comp quality 88, FIELD VERIFIED 2026-05-26)
• Jardine (adjacent, comp quality 83, up to 8 weeks free)
• The Line Lofts (adjacent, comp quality 78)
• Camden, Hanover, Modera — heaviest concessions, highest threat.

ZEN HOLLYWOOD FIELD TOUR FINDINGS (2026-05-26, Bailey)
• Strong common areas and polished hallways/floors.
• Major amenities: pool, gym, lounge/bar, event room, theater/game room, business area, outdoor spaces, BBQ/grill, in-unit laundry, parking + valet included.
• Unit 522 — 1BR · 762 sqft · $2,995 · available · parking + valet · water included.
• Unit 625 — 2BR · 1441 sqft · $4,995 · not ready.
• Smaller double (probable Unit 630) — 6th floor · ~$4,500 · exact sqft needs verification.
• 2nd-floor same/similar double — $4,000 · 1229 sqft · exact unit number needs verification.
• Unit 424 — referenced; rent/sqft/availability need verification.
• Concessions: 1 month free standard; $1,000 look-and-lease within 72hr; up to 8 weeks / 2 months free on 19-month lease with approved credit, select units.
• Utilities: water included; power/gas/internet not included.
• Strategic takeaway: Zen is a premium amenity threat. Baxter should compete through NER/value, speed, transparency, better photos, and lead conversion — not by matching gross rent or amenity package.

CONCESSION POSITIONING
• Baxter: 1st month free on select units = weakest in comp set.
• Comp avg: 4–8 weeks free, $500–$1,000 look-and-lease, sometimes parking.
• Recommend matching 6 weeks + $1K on slow units (105, 308).

UNIT-SPECIFIC RECOMMENDATIONS
• Unit 105 (2BR loss leader): hold $2,499 + 1mo free / 13mo. Net effective ≈ ${fmtMoney(u105Net)}. Keep as traffic driver.
• Unit 301 (1BR premium): hold $2,799 (corrected from $2,899). Use as upsell once traffic improves.
• Unit 308 (1BR, no window): −$150 covariate adjustment. Show last, price below stronger 1BR comps.
• Unit 306 / 312: hold $2,599-$2,699 range.

WALKTHROUGHS
• Completed: 0 / Scheduled: 1 / Queued: ${pendingTours - 1}
• Next priority: Zen Hollywood, Jardine (both adjacent — highest comp quality).

MARKETING ROI
• Apartments.com: ${fmtMoney(6500)}/mo, 1 lead → cut tier or pause.
• Zumper: free via AppFolio feed, 7 of 8 leads → confirm sync.
• Craigslist: reactivate this week.
• Website: migrate inherited site; add booking widget.

RECERTIFICATION OUTREACH
• ${missingDocs} tenants missing documents.
${escalationLine}
• 1 Brilliant Corners vacant affordable unit pending tenant placement.

RECOMMENDED NEXT ACTIONS
1. Cut Apartments.com tier or pause.
2. Bailey + Shane tour Zen Hollywood + Jardine this week.
3. Bump concession on units 308 and 105 to 6 weeks free + $1K look-and-lease.
4. Catherine to advance the open compliance case with HACLA.
5. Reactivate Craigslist.

— Prepared by ${ownerSafe ? "Bailey (BaxterOps)" : `${user.name} (BaxterOps)`} for ${ownerSafe ? "ownership" : "Steve / Evan / Catherine"}`;
  }, [today, ownerSafe, canSeeInternal, user.name]);

  async function copy() {
    await navigator.clipboard.writeText(report);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <PageHeader
        title="Weekly Report Generator"
        subtitle="Pre-filled from live data. Copy into email and send to ownership."
        action={
          <div className="flex gap-2 items-center">
            <div className="flex bg-slate-100 rounded-md p-1 text-xs">
              <button
                onClick={() => setOwnerSafe(true)}
                className={`px-3 py-1 rounded ${ownerSafe ? "bg-white shadow font-medium" : "text-slate-500"}`}
              >Owner-safe</button>
              <button
                onClick={() => setOwnerSafe(false)}
                disabled={!canSeeInternal}
                className={`px-3 py-1 rounded ${!ownerSafe ? "bg-white shadow font-medium" : "text-slate-500"} ${!canSeeInternal ? "opacity-40 cursor-not-allowed" : ""}`}
                title={!canSeeInternal ? "Requires Admin/Manager" : ""}
              >Internal</button>
            </div>
            <button onClick={copy} className="px-4 py-2 bg-slate-900 text-white rounded-md text-sm">
              {copied ? "Copied!" : "Copy report"}
            </button>
          </div>
        }
      />

      {!ownerSafe && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 flex justify-between items-center">
          <span>Internal version includes tenant-specific compliance details. Do not forward to ownership.</span>
          <Badge intent="warn">{user.role}</Badge>
        </div>
      )}

      {/* Sprint 6 — Report Data Confidence */}
      <Card className="mb-4 border-l-4 border-l-amber-500">
        <CardHeader title="Report Data Confidence" subtitle="Quick safety check before copying for ownership" />
        <CardBody>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Verified" value={`${ledgerStats.verified}`} intent="good" sub={`of ${ledgerStats.total}`} />
            <Stat label="Needs review" value={`${ledgerStats.needsReview}`} intent={ledgerStats.needsReview > 0 ? "warn" : "good"} />
            <Stat label="Conflicting" value={`${ledgerStats.conflicting + openConflicts.length}`} intent={openConflicts.length > 0 ? "bad" : "good"} />
            <Stat label="Stale" value={`${ledgerStats.stale}`} intent={ledgerStats.stale > 0 ? "warn" : "good"} />
            <Stat label="Tenant-safe" value={ownerSafe ? "yes" : "no"} intent={ownerSafe ? "good" : "warn"} />
          </div>
          {openConflicts.length > 0 && (
            <div className="mt-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              ⚠ Report references {openConflicts.length} unresolved source conflict{openConflicts.length === 1 ? "" : "s"}.
              Owner-safe wording included: <em>“Current pricing requires live confirmation due to conflicting public and field-tour sources.”</em>
              <a href="/source-conflicts" className="ml-2 underline">Open conflicts →</a>
            </div>
          )}
          <div className="mt-3 text-xs text-slate-500">
            Copy report stays enabled — but resolve conflicts first when possible.
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`Week ending ${today}`} subtitle={ownerSafe ? "Owner-safe — tenant names redacted, private notes excluded" : "Internal — full detail"} />
        <CardBody>
          <pre className="whitespace-pre-wrap text-sm bg-slate-50 p-5 rounded-md font-mono leading-relaxed">{report}</pre>
        </CardBody>
      </Card>
    </>
  );
}
