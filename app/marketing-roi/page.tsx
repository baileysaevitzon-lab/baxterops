"use client";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { SourceBadge } from "@/components/SourceBadge";
import { MARKETING_SOURCES } from "@/lib/seed";
import { fmtMoney } from "@/lib/calc";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function MarketingROI() {
  const totals = MARKETING_SOURCES.reduce(
    (acc, m) => ({
      cost: acc.cost + m.monthlyCost,
      leads: acc.leads + m.leads,
      tours: acc.tours + m.tours,
      leases: acc.leases + m.leases,
    }),
    { cost: 0, leads: 0, tours: 0, leases: 0 },
  );

  const chartData = MARKETING_SOURCES.map(m => ({
    name: m.name.split(" ")[0],
    cost: m.monthlyCost,
    leads: m.leads,
    costPerLead: m.leads ? Math.round(m.monthlyCost / m.leads) : 0,
  }));

  return (
    <>
      <PageHeader
        title="Marketing ROI"
        subtitle={`Total $${totals.cost.toLocaleString()}/mo across ${MARKETING_SOURCES.length} channels driving ${totals.leads} leads. Apartments.com is $1K/unit/mo for ~1 lead — kill or cut.`}
      />

      <Card className="mb-6">
        <CardHeader title="Cost per lead by source" />
        <CardBody>
          <div style={{ width: "100%", height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
                <Bar dataKey="costPerLead" name="$ / lead" fill="#0ea5e9" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Source detail" />
        <CardBody className="p-0">
          <table className="bx">
            <thead>
              <tr>
                <th>Source</th>
                <th>$/mo</th>
                <th>Leads</th>
                <th>Tours</th>
                <th>Leases</th>
                <th>$/lead</th>
                <th>$/lease</th>
                <th>Recommendation</th>
              </tr>
            </thead>
            <tbody>
              {MARKETING_SOURCES.map(m => {
                const costPerLead = m.leads ? m.monthlyCost / m.leads : Infinity;
                const costPerLease = m.leases ? m.monthlyCost / m.leases : Infinity;
                return (
                  <tr key={m.id}>
                    <td>
                      <div className="font-medium">{m.name}</div>
                      <div className="text-xs text-slate-500 max-w-md">{m.notes}</div>
                    </td>
                    <td>
                      {fmtMoney(m.monthlyCost)}
                      <div className="mt-1"><SourceBadge fieldKey="monthly_marketing_spend" entityType="marketing_source" entityId={m.id} compact /></div>
                    </td>
                    <td>{m.leads}</td>
                    <td>{m.tours}</td>
                    <td>{m.leases}</td>
                    <td>
                      {costPerLead === Infinity ? (
                        m.monthlyCost === 0 ? "—" : <Badge intent="bad">∞</Badge>
                      ) : costPerLead > 1000 ? (
                        <Badge intent="bad">${Math.round(costPerLead)}</Badge>
                      ) : (
                        <Badge intent="good">${Math.round(costPerLead)}</Badge>
                      )}
                    </td>
                    <td>{costPerLease === Infinity ? "—" : `$${Math.round(costPerLease)}`}</td>
                    <td className="text-xs text-slate-600 max-w-xs">{m.recommendation}</td>
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
