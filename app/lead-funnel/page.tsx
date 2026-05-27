"use client";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { LEADS } from "@/lib/seed";

const STAGES = [
  "lead",
  "contacted",
  "tour_scheduled",
  "toured",
  "applied",
  "approved",
  "lease_sent",
  "lease_signed",
  "lost",
] as const;

export default function LeadFunnel() {
  const counts = STAGES.map(s => ({
    stage: s,
    count: LEADS.filter(l => l.stage === s).length,
  }));

  return (
    <>
      <PageHeader
        title="Lead Funnel"
        subtitle={`${LEADS.length} leads tracked (illustrative seed — replace with AppFolio + apartments.com export).`}
      />

      <div className="grid grid-cols-9 gap-2 mb-6">
        {counts.map(c => (
          <div key={c.stage} className="bg-white border border-slate-200 rounded-lg p-3 text-center">
            <div className="text-2xl font-semibold">{c.count}</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mt-1">{c.stage.replace("_", " ")}</div>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader title="All leads" />
        <CardBody className="p-0">
          <table className="bx">
            <thead>
              <tr>
                <th>Date</th>
                <th>Source</th>
                <th>Stage</th>
                <th>Unit interest</th>
                <th>Lost reason</th>
              </tr>
            </thead>
            <tbody>
              {LEADS.map(l => (
                <tr key={l.id}>
                  <td>{l.receivedDate}</td>
                  <td>{l.source}</td>
                  <td>
                    <Badge intent={l.stage === "lease_signed" ? "good" : l.stage === "lost" ? "bad" : "neutral"}>
                      {l.stage.replace("_", " ")}
                    </Badge>
                  </td>
                  <td>{l.unitOfInterest ?? "—"}</td>
                  <td className="text-xs text-slate-500">{l.lostReason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Lost reasons (capture every dead lead)" />
        <CardBody>
          <ul className="grid grid-cols-2 md:grid-cols-3 gap-1 text-sm text-slate-600">
            {[
              "Price", "Better competitor", "Parking", "Location",
              "Unit size", "Unit quality", "No bedroom window",
              "Concession weaker elsewhere", "No response", "Timing",
              "Application rejected", "Unknown",
            ].map(r => <li key={r}>· {r}</li>)}
          </ul>
        </CardBody>
      </Card>
    </>
  );
}
