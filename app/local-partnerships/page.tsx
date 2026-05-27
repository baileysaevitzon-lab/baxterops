"use client";
import { useEffect, useMemo, useState } from "react";
import { Card, CardBody, CardHeader, PageHeader, Badge, Stat } from "@/components/Card";
import { LOCAL_PARTNERSHIPS_SEED } from "@/lib/seed";
import { loadPartnerships, savePartnerships, upsertPartnership, deletePartnership } from "@/lib/storage";
import type { LocalPartnership, PartnershipEntityType, PartnershipStatus } from "@/lib/types";

const ENTITY_OPTIONS: PartnershipEntityType[] = [
  "hospital", "performing_arts_school", "film_school", "entertainment_employer",
  "university", "production_studio", "hospitality_employer", "corporate_housing",
  "referral_partner", "other",
];

const STATUS_OPTIONS: PartnershipStatus[] = [
  "not_contacted", "researching", "pitched", "interested", "declined", "partnered",
];

const blank = (): LocalPartnership => ({
  id: `lp-${Date.now()}`,
  entityType: "hospital",
  name: "",
  partnershipIdea: "employee_housing_resource",
  leadPotentialScore: 3,
  confidence: "needs_research",
  status: "not_contacted",
  notes: "Contact not verified. Research before outreach.",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

function outreachDraft(p: LocalPartnership): string {
  return `Subject: Housing Resource for ${p.name || "[Organization]"} Employees / Students

Hi ${p.contactName || "[Contact Name]"},

I'm reaching out from The Baxter Hollywood, a nearby apartment community at 1818 N Cherokee Ave. We're building relationships with local organizations whose employees or students may need housing in Hollywood.

We'd be happy to provide current availability, preferred move-in information, and a direct leasing contact for anyone looking nearby.

Would there be a good person on your team to discuss housing resources or relocation referrals?

Best,
[Name]`;
}

export default function LocalPartnerships() {
  const [items, setItems] = useState<LocalPartnership[]>([]);
  const [filterType, setFilterType] = useState<"all" | PartnershipEntityType>("all");
  const [filterStatus, setFilterStatus] = useState<"all" | PartnershipStatus>("all");
  const [draft, setDraft] = useState<LocalPartnership>(blank());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showDraft, setShowDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    // first-time hydration: merge seeded list with anything in localStorage
    const existing = loadPartnerships();
    if (existing.length === 0) {
      savePartnerships(LOCAL_PARTNERSHIPS_SEED);
      setItems(LOCAL_PARTNERSHIPS_SEED);
    } else {
      setItems(existing);
    }
  }, []);

  const filtered = useMemo(() => items.filter(p =>
    (filterType === "all" || p.entityType === filterType) &&
    (filterStatus === "all" || p.status === filterStatus),
  ), [items, filterType, filterStatus]);

  const kpis = {
    total: items.length,
    verified: items.filter(p => p.confidence === "verified").length,
    pitched: items.filter(p => p.status === "pitched").length,
    partnered: items.filter(p => p.status === "interested" || p.status === "partnered").length,
    dueFollowUp: items.filter(p => p.nextFollowUp && p.nextFollowUp <= new Date().toISOString().slice(0, 10)).length,
  };

  function patch<K extends keyof LocalPartnership>(k: K, v: LocalPartnership[K]) {
    setDraft(d => ({ ...d, [k]: v, updatedAt: new Date().toISOString() }));
  }

  function save() {
    if (!draft.name.trim()) { alert("Name is required."); return; }
    setItems(upsertPartnership(draft));
    setDraft(blank());
    setEditingId(null);
  }

  function edit(p: LocalPartnership) {
    setDraft(p);
    setEditingId(p.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function remove(id: string) {
    if (!confirm("Delete this partnership target?")) return;
    setItems(deletePartnership(id));
    if (editingId === id) { setDraft(blank()); setEditingId(null); }
  }

  async function copyDraft(p: LocalPartnership) {
    const text = outreachDraft(p);
    await navigator.clipboard.writeText(text);
    setCopied(p.id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <>
      <PageHeader
        title="Local Partnerships"
        subtitle="Non-listing demand channels. Reduce dependence on Apartments.com. All seeded contacts are unverified — research before outreach."
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Stat label="Total targets" value={`${kpis.total}`} />
        <Stat label="Verified" value={`${kpis.verified}`} intent={kpis.verified === 0 ? "warn" : "good"} />
        <Stat label="Pitched" value={`${kpis.pitched}`} />
        <Stat label="Interested / partnered" value={`${kpis.partnered}`} intent="good" />
        <Stat label="Follow-ups due" value={`${kpis.dueFollowUp}`} intent={kpis.dueFollowUp ? "warn" : "neutral"} />
      </div>

      <Card className="mb-6">
        <CardHeader title={editingId ? "Edit partnership" : "Add partnership target"} action={editingId ? <button onClick={() => { setDraft(blank()); setEditingId(null); }} className="text-xs underline text-slate-500">cancel</button> : undefined} />
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
            <Field label="Organization name *">
              <input value={draft.name} onChange={e => patch("name", e.target.value)} className="w-full border rounded-md px-3 py-1.5" />
            </Field>
            <Field label="Entity type">
              <select value={draft.entityType} onChange={e => patch("entityType", e.target.value as PartnershipEntityType)} className="w-full border rounded-md px-3 py-1.5">
                {ENTITY_OPTIONS.map(o => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Partnership idea">
              <select value={draft.partnershipIdea} onChange={e => patch("partnershipIdea", e.target.value as LocalPartnership["partnershipIdea"])} className="w-full border rounded-md px-3 py-1.5">
                <option value="preferred_employer_discount">preferred_employer_discount</option>
                <option value="relocation_referral">relocation_referral</option>
                <option value="corporate_housing">corporate_housing</option>
                <option value="housing_fair">housing_fair</option>
                <option value="flyer_drop">flyer_drop</option>
                <option value="employee_housing_resource">employee_housing_resource</option>
                <option value="student_housing_resource">student_housing_resource</option>
                <option value="other">other</option>
              </select>
            </Field>
            <Field label="Lead potential (1–5)">
              <input type="number" min={1} max={5} value={draft.leadPotentialScore} onChange={e => patch("leadPotentialScore", parseInt(e.target.value) || 1)} className="w-full border rounded-md px-3 py-1.5" />
            </Field>
            <Field label="Confidence">
              <select value={draft.confidence} onChange={e => patch("confidence", e.target.value as LocalPartnership["confidence"])} className="w-full border rounded-md px-3 py-1.5">
                <option value="unverified">unverified</option>
                <option value="needs_research">needs_research</option>
                <option value="verified">verified</option>
              </select>
            </Field>
            <Field label="Status">
              <select value={draft.status} onChange={e => patch("status", e.target.value as PartnershipStatus)} className="w-full border rounded-md px-3 py-1.5">
                {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Contact name (verify before adding)">
              <input value={draft.contactName ?? ""} onChange={e => patch("contactName", e.target.value)} className="w-full border rounded-md px-3 py-1.5" />
            </Field>
            <Field label="Contact role">
              <input value={draft.contactRole ?? ""} onChange={e => patch("contactRole", e.target.value)} className="w-full border rounded-md px-3 py-1.5" />
            </Field>
            <Field label="Email">
              <input value={draft.email ?? ""} onChange={e => patch("email", e.target.value)} className="w-full border rounded-md px-3 py-1.5" />
            </Field>
            <Field label="Phone">
              <input value={draft.phone ?? ""} onChange={e => patch("phone", e.target.value)} className="w-full border rounded-md px-3 py-1.5" />
            </Field>
            <Field label="Source URL">
              <input value={draft.sourceUrl ?? ""} onChange={e => patch("sourceUrl", e.target.value)} placeholder="https://…" className="w-full border rounded-md px-3 py-1.5" />
            </Field>
            <Field label="Next follow-up">
              <input type="date" value={draft.nextFollowUp ?? ""} onChange={e => patch("nextFollowUp", e.target.value)} className="w-full border rounded-md px-3 py-1.5" />
            </Field>
            <Field label="Notes" className="md:col-span-2 lg:col-span-3">
              <textarea value={draft.notes ?? ""} onChange={e => patch("notes", e.target.value)} rows={2} className="w-full border rounded-md px-3 py-1.5" />
            </Field>
          </div>
          <button onClick={save} className="mt-4 px-4 py-2 bg-slate-900 text-white rounded-md text-sm">
            {editingId ? "Update partnership" : "Save partnership"}
          </button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Partnership targets"
          subtitle="Click outreach draft to copy a templated email"
          action={
            <div className="flex gap-2 text-xs">
              <select value={filterType} onChange={e => setFilterType(e.target.value as "all" | PartnershipEntityType)} className="border rounded-md px-2 py-1">
                <option value="all">All types</option>
                {ENTITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as "all" | PartnershipStatus)} className="border rounded-md px-2 py-1">
                <option value="all">All statuses</option>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          }
        />
        <CardBody className="p-0">
          <table className="bx">
            <thead>
              <tr>
                <th>Organization</th><th>Type</th><th>Idea</th><th>Lead potential</th>
                <th>Confidence</th><th>Status</th><th>Follow-up</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id}>
                  <td>
                    <div className="font-medium">{p.name}</div>
                    {p.sourceUrl && <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-sky-700 underline">source</a>}
                    <div className="text-xs text-slate-500">{p.notes}</div>
                  </td>
                  <td className="text-xs">{p.entityType}</td>
                  <td className="text-xs">{p.partnershipIdea}</td>
                  <td><Badge intent={p.leadPotentialScore >= 4 ? "good" : "neutral"}>{p.leadPotentialScore}/5</Badge></td>
                  <td>
                    <Badge intent={p.confidence === "verified" ? "good" : p.confidence === "needs_research" ? "warn" : "bad"}>
                      {p.confidence}
                    </Badge>
                  </td>
                  <td>
                    <Badge intent={p.status === "partnered" || p.status === "interested" ? "good" : p.status === "declined" ? "bad" : "neutral"}>
                      {p.status}
                    </Badge>
                  </td>
                  <td className="text-xs">{p.nextFollowUp ?? "—"}</td>
                  <td className="text-right whitespace-nowrap">
                    <button onClick={() => setShowDraft(showDraft === p.id ? null : p.id)} className="text-xs text-slate-700 underline mr-3">
                      {showDraft === p.id ? "hide draft" : "outreach draft"}
                    </button>
                    <button onClick={() => edit(p)} className="text-xs text-sky-700 underline mr-3">edit</button>
                    <button onClick={() => remove(p.id)} className="text-xs text-rose-700 underline">delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {showDraft && (
            <div className="p-5 border-t bg-slate-50">
              <div className="flex justify-between items-center mb-2">
                <div className="text-xs font-medium text-slate-500">Outreach draft (does not send)</div>
                <button onClick={() => copyDraft(items.find(p => p.id === showDraft)!)} className="text-xs px-3 py-1 rounded-md bg-slate-900 text-white">
                  {copied === showDraft ? "Copied!" : "Copy to clipboard"}
                </button>
              </div>
              <pre className="whitespace-pre-wrap text-sm bg-white p-3 rounded-md border">{outreachDraft(items.find(p => p.id === showDraft)!)}</pre>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="text-xs text-slate-500">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
