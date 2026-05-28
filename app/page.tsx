"use client";
import { Card, CardBody, CardHeader, PageHeader, Stat, Badge } from "@/components/Card";
import { SourceBadge } from "@/components/SourceBadge";
import { DashboardPhotoUpload } from "@/components/DashboardPhotoUpload";
import { BAXTER_UNITS, COMPETITORS as SEED_COMPETITORS, MARKETING_SOURCES, TENANTS, WALKTHROUGH_TOURS } from "@/lib/seed";
import { useCompetitors } from "@/lib/hooks/useCompetitors";
import { useTouredIds } from "@/lib/hooks/useTouredIds";
import { useTouredOnly } from "@/lib/hooks/useTouredOnly";
import { TouredOnlyToggle } from "@/components/TouredOnlyToggle";
import { useRole } from "@/components/RoleProvider";
import {
  compAverageLeased,
  compAverageOccupancy,
  compAverageRent,
  compAverageSqft,
  fmtMoney,
  fmtPct,
  rentPerSqft,
  vacancyLoss,
} from "@/lib/calc";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Baxter aggregate stats from the call-around (2026-05-26)
const BAXTER_OCC = 89;
const BAXTER_LEASED = 89;

export default function Dashboard() {
  const { can } = useRole();
  const canSensitive = can("view_sensitive_tenant");
  const vacantUnits = BAXTER_UNITS.filter(u => u.occupancy === "vacant");
  const monthlyVacancyLoss = vacancyLoss(BAXTER_UNITS);

  // Sprint 13: live competitor list + Toured-Only filter.
  const { competitors: ALL_COMPETITORS } = useCompetitors();
  const { touredIds, touredCount } = useTouredIds();
  const [touredOnly, setTouredOnly] = useTouredOnly();
  // Use seed fallback if live list is empty (e.g. signed-out path) so dashboard never blanks.
  const baseList = ALL_COMPETITORS.length > 0 ? ALL_COMPETITORS : SEED_COMPETITORS;
  const COMPETITORS = touredOnly ? baseList.filter(c => touredIds.has(c.id)) : baseList;

  const compOcc = compAverageOccupancy(COMPETITORS);
  const compLeased = compAverageLeased(COMPETITORS);

  const compStudio = compAverageRent(COMPETITORS, "studio");
  const comp1BR = compAverageRent(COMPETITORS, "1BR");
  const comp2BR = compAverageRent(COMPETITORS, "2BR");

  const baxter1BRRents = BAXTER_UNITS.filter(u => u.type === "1BR" && u.askingRent).map(u => u.askingRent);
  const baxter2BRRents = BAXTER_UNITS.filter(u => u.type === "2BR" && u.askingRent).map(u => u.askingRent);
  const baxter1BRAvg = baxter1BRRents.length ? baxter1BRRents.reduce((a, b) => a + b, 0) / baxter1BRRents.length : 0;
  const baxter2BRAvg = baxter2BRRents.length ? baxter2BRRents.reduce((a, b) => a + b, 0) / baxter2BRRents.length : 0;

  const baxterPpsf1BR = BAXTER_UNITS.filter(u => u.type === "1BR").map(u => rentPerSqft(u.askingRent, u.sqft));
  const baxter1BRPpsf = baxterPpsf1BR.length ? baxterPpsf1BR.reduce((a, b) => a + b, 0) / baxterPpsf1BR.length : 0;

  const totalLeads = MARKETING_SOURCES.reduce((s, m) => s + m.leads, 0);
  const totalMktSpend = MARKETING_SOURCES.reduce((s, m) => s + m.monthlyCost, 0);

  const pendingTours = WALKTHROUGH_TOURS.filter(t => t.status !== "completed").length;
  const completedTours = WALKTHROUGH_TOURS.filter(t => t.status === "completed").length;

  const outreachPending = TENANTS.filter(t =>
    ["not_started", "initial_drafted", "waiting_response", "docs_requested", "partial_docs"].includes(t.status),
  ).length;
  const escalations = TENANTS.filter(t => t.status === "escalation").length;

  const rentChart = [
    { type: "Studio", Baxter: 2325, Comp: Math.round(compStudio) },
    { type: "1BR", Baxter: Math.round(baxter1BRAvg), Comp: Math.round(comp1BR) },
    { type: "2BR", Baxter: Math.round(baxter2BRAvg), Comp: Math.round(comp2BR) },
  ];

  const occupancyChart = [
    { property: "The Baxter", occupancy: BAXTER_OCC, leased: BAXTER_LEASED },
    ...COMPETITORS.slice(0, 10).map(c => ({
      property: c.name.replace(" Hollywood", ""),
      occupancy: c.occupancyPct ?? 0,
      leased: c.leasedPct ?? 0,
    })),
  ];

  const topThreats = [...COMPETITORS]
    .sort((a, b) => (b.compQualityScore ?? 0) - (a.compQualityScore ?? 0))
    .slice(0, 5);

  return (
    <>
      <PageHeader
        title="Executive Dashboard"
        subtitle={`Baxter vs Hollywood comp snapshot · 2026-05-26 call-around. The headline problem is traffic, not price.${touredOnly ? " · Comp metrics use field-toured properties only." : ""}`}
        action={
          <TouredOnlyToggle
            on={touredOnly}
            onToggle={setTouredOnly}
            touredCount={touredCount}
            totalCount={baseList.length}
          />
        }
      />

      {/* Sprint 7 — photo upload widget */}
      <div className="mb-6">
        <DashboardPhotoUpload />
      </div>

      {/* Top stat row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat
          label="Baxter Occupancy"
          value={`${BAXTER_OCC}%`}
          delta={`${(BAXTER_OCC - compOcc).toFixed(1)} pp vs comp`}
          intent={BAXTER_OCC >= compOcc ? "good" : "bad"}
          sub={`Comp avg ${compOcc.toFixed(1)}%`}
          source={<SourceBadge fieldKey="occupancy_pct" entityType="global_metric" entityId="baxter" compact />}
        />
        <Stat
          label="Baxter Leased"
          value={`${BAXTER_LEASED}%`}
          delta={`${(BAXTER_LEASED - compLeased).toFixed(1)} pp vs comp`}
          intent="bad"
          sub={`Comp avg ${compLeased.toFixed(1)}%`}
          source={<SourceBadge fieldKey="leased_pct" entityType="global_metric" entityId="baxter" compact />}
        />
        <Stat
          label="Vacancy Loss / mo"
          value={fmtMoney(monthlyVacancyLoss)}
          intent="bad"
          sub={`${vacantUnits.length} vacant units tracked`}
          source={<SourceBadge fieldKey="monthly_vacancy_loss" entityType="global_metric" entityId="baxter" compact />}
        />
        <Stat
          label="Marketing Spend / mo"
          value={fmtMoney(totalMktSpend)}
          intent="warn"
          sub={`${totalLeads} leads → 1 from Apartments.com`}
          source={<SourceBadge fieldKey="monthly_marketing_spend" entityType="marketing_source" entityId="ms-apartments" compact />}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Active Comps" value={`${COMPETITORS.length}`} sub={`${COMPETITORS.filter(c => (c.compQualityScore ?? 0) >= 75).length} high-quality`} />
        <Stat label="Pending Walkthroughs" value={`${pendingTours}`} sub={`${completedTours} completed`} />
        <Stat label="Recert Outreach" value={`${outreachPending}`} intent="warn" sub={`${escalations} escalations`} />
        <Stat
          label="Avg 1BR $/sqft"
          value={`$${baxter1BRPpsf.toFixed(2)}`}
          sub="Baxter vacant 1BR"
          source={<SourceBadge fieldKey="rent_per_sqft" entityType="global_metric" entityId="baxter" compact />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader title="Rent by unit type — Baxter vs comp avg" subtitle="Asking rent, $/month" />
          <CardBody>
            <div style={{ width: "100%", height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={rentChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="type" />
                  <YAxis />
                  <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
                  <Legend />
                  <Bar dataKey="Baxter" fill="#0ea5e9" />
                  <Bar dataKey="Comp" fill="#94a3b8" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Occupancy vs leased — top 10 comps" subtitle="Leased % is the leading indicator" />
          <CardBody>
            <div style={{ width: "100%", height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={occupancyChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="property" hide />
                  <YAxis domain={[80, 100]} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="occupancy" fill="#0ea5e9" />
                  <Bar dataKey="leased" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Top 5 comp threats" subtitle="Sorted by comp quality score" />
          <CardBody>
            <table className="bx">
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Quality</th>
                  <th>Specials</th>
                </tr>
              </thead>
              <tbody>
                {topThreats.map(c => (
                  <tr key={c.id}>
                    <td className="font-medium">{c.name}</td>
                    <td><Badge intent={c.compQualityScore && c.compQualityScore >= 80 ? "bad" : "warn"}>{c.compQualityScore}</Badge></td>
                    <td className="text-slate-600">{c.specials ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="This week's recommended actions" subtitle="From comp gap + marketing + compliance signals" />
          <CardBody>
            <ul className="space-y-3 text-sm">
              <li className="flex gap-3">
                <Badge intent="bad">P1</Badge>
                <div>
                  <div className="font-medium">Cut Apartments.com tier or pause — $6.5K/mo for 1 lead.</div>
                  <div className="text-slate-500 text-xs">Zumper (free, AppFolio feed) is driving 7 of 8 leads. Reallocate.</div>
                </div>
              </li>
              <li className="flex gap-3">
                <Badge intent="bad">P1</Badge>
                <div>
                  <div className="font-medium">Tour Zen Hollywood + Jardine — both adjacent. Capture hidden concessions.</div>
                  <div className="text-slate-500 text-xs">Highest comp-quality scores. Assign Bailey + Shane.</div>
                </div>
              </li>
              <li className="flex gap-3">
                <Badge intent="warn">P2</Badge>
                <div>
                  <div className="font-medium">Match Camden/Hanover concession: bump to 6-8 weeks free with $1K look-and-lease on slow units.</div>
                  <div className="text-slate-500 text-xs">Current "1st month free" is the weakest concession in the comp set.</div>
                </div>
              </li>
              <li className="flex gap-3">
                <Badge intent="warn">P2</Badge>
                <div>
                  <div className="font-medium">
                    {canSensitive
                      ? "Escalate the LAHD compliance case to Catherine (admin/manager only — see tenant_private_details)."
                      : "Escalate 1 affordable-unit LAHD compliance case to Catherine."}
                  </div>
                  <div className="text-slate-500 text-xs">
                    {canSensitive
                      ? "Tenant share $1,900 exceeds $1,000 cap. Move-out + HACLA re-inspect."
                      : "🔒 Tenant-specific details restricted (Admin/Manager only)."}
                  </div>
                </div>
              </li>
              <li className="flex gap-3">
                <Badge intent="info">P3</Badge>
                <div>
                  <div className="font-medium">Reactivate Craigslist + migrate inherited website.</div>
                </div>
              </li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
