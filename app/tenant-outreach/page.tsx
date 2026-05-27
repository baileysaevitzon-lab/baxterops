"use client";
import { useMemo, useState } from "react";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { TENANTS } from "@/lib/seed";
import type { Tenant } from "@/lib/types";
import { ProtectedField } from "@/components/RoleProvider";

const TEMPLATES = {
  friendly_first: {
    label: "Friendly first request",
    subject: "Action Needed: Income Certification Documents for Your Baxter Apartment",
    body: (t: Tenant) => `Hi ${t.name},

We are updating the affordable housing certification records for The Baxter. To complete your file, we need current income documentation and any required household information.

Please send or bring the following documents:
${(t.documentsRequested.length ? t.documentsRequested : ["Income verification", "Recent pay stubs", "Household composition form"]).map(d => `  • ${d}`).join("\n")}

You can reply to this email with the documents or schedule a time to meet with our office.

Thank you,
The Baxter management team`,
  },
  formal_second: {
    label: "Formal second request",
    subject: "Second Notice: Income Certification — Action Required",
    body: (t: Tenant) => `Hi ${t.name},

We previously reached out about your annual income certification for The Baxter. Per the terms of your lease and the building's affordable housing covenant, we still need:

${t.documentsRequested.filter(d => !t.documentsReceived.includes(d)).map(d => `  • ${d}`).join("\n")}

Please respond within 5 business days so we can complete your file.

Thank you,
The Baxter management team`,
  },
  meeting_schedule: {
    label: "Schedule meeting",
    subject: "Schedule a quick visit — Baxter income certification",
    body: (t: Tenant) => `Hi ${t.name},

Would a 15-minute visit to the leasing office work this week to help you complete your income certification packet? We can scan documents on the spot.

Available times this week — pick whichever works:
  • Tue 10am – 12pm
  • Wed 2pm – 5pm
  • Thu 9am – 11am

Thank you,
The Baxter management team`,
  },
  thanks: {
    label: "Thanks / received",
    subject: "Thanks — documents received",
    body: (t: Tenant) => `Hi ${t.name},

Confirming we received your documents. Your file is in review and we'll follow up if anything is missing.

Thank you,
The Baxter management team`,
  },
} as const;

type TKey = keyof typeof TEMPLATES;

const STATUS_LABEL: Record<Tenant["status"], string> = {
  not_started: "Not started",
  initial_drafted: "Drafted",
  initial_sent: "Initial sent",
  waiting_response: "Waiting on tenant",
  responded: "Tenant responded",
  meeting_scheduled: "Meeting scheduled",
  docs_requested: "Docs requested",
  partial_docs: "Partial docs",
  all_docs: "All docs received",
  under_review: "Under review",
  submitted_catherine: "→ Catherine",
  submitted_urban: "→ Urban",
  approved: "Approved",
  escalation: "ESCALATION",
};

export default function TenantOutreach() {
  const [selectedId, setSelectedId] = useState(TENANTS[0]?.id);
  const [template, setTemplate] = useState<TKey>("friendly_first");
  const [copied, setCopied] = useState(false);

  const tenant = TENANTS.find(t => t.id === selectedId)!;
  const tpl = TEMPLATES[template];
  const body = tpl.body(tenant);

  // Outreach queue sorted by priority signal
  const queue = useMemo(() => {
    const score = (t: Tenant) => {
      if (t.status === "escalation") return 100;
      if (t.documentsRequested.length > t.documentsReceived.length) return 80;
      if (t.status === "not_started") return 70;
      if (t.status === "partial_docs") return 60;
      if (t.status === "waiting_response") return 50;
      return 10;
    };
    return [...TENANTS].sort((a, b) => score(b) - score(a));
  }, []);

  async function copy() {
    await navigator.clipboard.writeText(`Subject: ${tpl.subject}\n\n${body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <PageHeader
        title="Tenant Outreach CRM"
        subtitle="Generate copyable templates for recertification outreach. MVP does not auto-send — log contact attempts manually."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader title="Outreach queue" subtitle={`${queue.length} tenants, sorted by urgency`} />
          <CardBody className="p-0">
            <ul>
              {queue.map(t => (
                <li
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={`px-4 py-3 border-b border-slate-100 cursor-pointer ${selectedId === t.id ? "bg-sky-50" : "hover:bg-slate-50"}`}
                >
                  <div className="flex justify-between items-start">
                    <div className="font-medium text-sm">{t.name}</div>
                    {t.status === "escalation" && <Badge intent="bad">!</Badge>}
                  </div>
                  <div className="text-xs text-slate-500">
                    Unit {t.unitNumber} · {t.program}
                  </div>
                  <div className="text-xs mt-1">
                    <Badge intent={t.status === "escalation" ? "bad" : t.status === "approved" ? "good" : "warn"}>
                      {STATUS_LABEL[t.status]}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title={tenant.name}
            subtitle={`Unit ${tenant.unitNumber} · ${tenant.program} · ${tenant.subsidyProvider ?? "—"}`}
            action={<Badge intent={tenant.riskLevel === "high" ? "bad" : tenant.riskLevel === "medium" ? "warn" : "neutral"}>{tenant.riskLevel} risk</Badge>}
          />
          <CardBody>
            <div className="grid grid-cols-2 gap-3 text-sm mb-4">
              <div>
                <div className="text-xs text-slate-500">Status</div>
                <Badge intent={tenant.status === "escalation" ? "bad" : "neutral"}>{STATUS_LABEL[tenant.status]}</Badge>
              </div>
              <div>
                <div className="text-xs text-slate-500">Assigned</div>
                <div className="font-medium">{tenant.assignedStaff ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Contact attempts</div>
                <div className="font-medium">{tenant.contactAttempts}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Last contacted</div>
                <div className="font-medium">{tenant.lastContacted ?? "—"}</div>
              </div>
            </div>

            <div className="mb-4">
              <div className="text-xs text-slate-500 mb-1">Documents</div>
              <ul className="text-sm">
                {tenant.documentsRequested.map(d => (
                  <li key={d} className={tenant.documentsReceived.includes(d) ? "text-emerald-700" : "text-rose-700"}>
                    {tenant.documentsReceived.includes(d) ? "✓" : "✗"} {d}
                  </li>
                ))}
                {tenant.documentsRequested.length === 0 && <li className="text-slate-400">No documents requested yet.</li>}
              </ul>
            </div>

            {tenant.notes && (
              <div className="bg-slate-50 rounded-md p-3 text-sm mb-4">
                <div className="text-xs text-slate-500 mb-1">Notes</div>
                {tenant.notes}
              </div>
            )}

            {tenant.privateNotes && (
              <div className="mb-4">
                <div className="text-xs text-amber-700 font-medium mb-1">🔒 Private note · compliance-sensitive · do not include in owner report</div>
                <ProtectedField perm="view_sensitive_tenant" page="/tenant-outreach" tenantId={tenant.id} fieldType="privateNotes">
                  <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm">{tenant.privateNotes}</div>
                </ProtectedField>
              </div>
            )}

            {(tenant.tenantRentPortion || tenant.lahdMaxAllowed) && (
              <div className="mb-4">
                <div className="text-xs text-amber-700 font-medium mb-1">🔒 Compliance figures · sensitive</div>
                <ProtectedField perm="view_sensitive_tenant" page="/tenant-outreach" tenantId={tenant.id} fieldType="rent_burden">
                  <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm space-y-1">
                    {tenant.tenantRentPortion !== undefined && <div>Tenant rent portion: <strong>${tenant.tenantRentPortion}</strong></div>}
                    {tenant.lahdMaxAllowed !== undefined && <div>LAHD max allowed: <strong>${tenant.lahdMaxAllowed}</strong></div>}
                  </div>
                </ProtectedField>
              </div>
            )}

            <div className="border-t pt-4 mt-4">
              <div className="flex gap-2 mb-3 flex-wrap">
                {(Object.keys(TEMPLATES) as TKey[]).map(k => (
                  <button
                    key={k}
                    onClick={() => setTemplate(k)}
                    className={`text-xs px-3 py-1.5 rounded-md border ${template === k ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200"}`}
                  >
                    {TEMPLATES[k].label}
                  </button>
                ))}
              </div>

              <div className="text-xs text-slate-500 mb-1">Subject</div>
              <div className="bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm mb-3">{tpl.subject}</div>

              <div className="text-xs text-slate-500 mb-1">Body</div>
              <pre className="whitespace-pre-wrap bg-slate-50 border border-slate-200 rounded-md p-3 text-sm">{body}</pre>

              <button onClick={copy} className="mt-3 px-4 py-2 bg-slate-900 text-white rounded-md text-sm">
                {copied ? "Copied!" : "Copy template to clipboard"}
              </button>

              <p className="text-xs text-slate-400 mt-3 italic">
                Be consistent across all tenants. Do not threaten. Only request documents required for certification.
                Escalate legal questions to Catherine / LAHD / Urban / counsel.
              </p>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
