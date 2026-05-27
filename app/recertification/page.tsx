"use client";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { TENANTS } from "@/lib/seed";
import { useRole } from "@/components/RoleProvider";

export default function Recertification() {
  const { can } = useRole();
  const canSeeSensitive = can("view_sensitive_tenant");
  const total = TENANTS.length;
  const approved = TENANTS.filter(t => t.status === "approved").length;
  const escalations = TENANTS.filter(t => t.status === "escalation").length;
  const missingDocs = TENANTS.filter(t => t.documentsRequested.length > t.documentsReceived.length).length;

  return (
    <>
      <PageHeader
        title="Recertification / Affordable Compliance"
        subtitle="20 affordable units at Baxter (19 existing + 1 to fill). Previous owner did not certify properly — clean-up in progress with Catherine/Urban/LAHD."
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card><CardBody><div className="text-xs text-slate-500">Tracked tenants</div><div className="text-2xl font-semibold">{total}</div></CardBody></Card>
        <Card><CardBody><div className="text-xs text-slate-500">Approved</div><div className="text-2xl font-semibold text-emerald-600">{approved}</div></CardBody></Card>
        <Card><CardBody><div className="text-xs text-slate-500">Missing docs</div><div className="text-2xl font-semibold text-amber-600">{missingDocs}</div></CardBody></Card>
        <Card><CardBody><div className="text-xs text-slate-500">Escalations</div><div className="text-2xl font-semibold text-rose-600">{escalations}</div></CardBody></Card>
      </div>

      <Card>
        <CardHeader title="Compliance tracker" subtitle="Each row is one affordable / subsidized tenant case" />
        <CardBody className="p-0">
          <table className="bx">
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Unit</th>
                <th>Program</th>
                <th>Provider</th>
                <th>Status</th>
                <th>Docs</th>
                <th>Risk</th>
                <th>Assigned</th>
              </tr>
            </thead>
            <tbody>
              {TENANTS.map(t => (
                <tr key={t.id}>
                  <td className="font-medium">
                    {canSeeSensitive ? t.name : (t.status === "escalation" || t.riskLevel === "high") ? "🔒 Restricted (sensitive case)" : t.name}
                  </td>
                  <td>{t.unitNumber}</td>
                  <td>{t.program}</td>
                  <td>{t.subsidyProvider ?? "—"}</td>
                  <td>
                    <Badge intent={t.status === "escalation" ? "bad" : t.status === "approved" ? "good" : "warn"}>
                      {t.status.replace("_", " ")}
                    </Badge>
                  </td>
                  <td className="text-xs">
                    <span className="text-emerald-700">{t.documentsReceived.length}</span>
                    {" / "}
                    <span className="text-slate-500">{t.documentsRequested.length}</span>
                  </td>
                  <td>
                    <Badge intent={t.riskLevel === "high" ? "bad" : t.riskLevel === "medium" ? "warn" : "good"}>
                      {t.riskLevel ?? "—"}
                    </Badge>
                  </td>
                  <td>{t.assignedStaff ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Compliance flow (LAHD covenant)" />
        <CardBody>
          <ol className="text-sm space-y-2 list-decimal pl-5 text-slate-700">
            <li>Tenant brings income verification to leasing office.</li>
            <li>Document uploaded to template (RFTA + LAHD income certification + utility allowance form).</li>
            <li>Submitted to Catherine for internal approval.</li>
            <li>Forwarded to Urban (LAHD's contractor) for review.</li>
            <li>Urban returns notes or approval. If approved → file complete.</li>
            <li>If LAHD covenant exceeded (tenant rent + utility allowance &gt; cap) → escalate to legal / Catherine.</li>
          </ol>
        </CardBody>
      </Card>
    </>
  );
}
