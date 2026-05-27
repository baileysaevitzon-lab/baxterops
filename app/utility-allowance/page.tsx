"use client";
import { useState } from "react";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { UTILITY_ALLOWANCE_SCHEDULE, LAHD_CAPS } from "@/lib/seed";
import { fmtMoney, tenantBurden, isOverLahdCap } from "@/lib/calc";

export default function UtilityAllowance() {
  const [unitType, setUnitType] = useState<"studio" | "oneBR" | "twoBR">("oneBR");
  const [tenantRent, setTenantRent] = useState(950);
  const [actualRubs, setActualRubs] = useState(120);
  const [allowance, setAllowance] = useState(UTILITY_ALLOWANCE_SCHEDULE.oneBR);
  const [cap, setCap] = useState(LAHD_CAPS.oneBR);

  const burden = tenantBurden(tenantRent, allowance);
  const over = isOverLahdCap(tenantRent, allowance, cap);

  function handleUnit(t: "studio" | "oneBR" | "twoBR") {
    setUnitType(t);
    setAllowance(t === "studio" ? UTILITY_ALLOWANCE_SCHEDULE.studio : t === "oneBR" ? UTILITY_ALLOWANCE_SCHEDULE.oneBR : UTILITY_ALLOWANCE_SCHEDULE.twoBR);
    setCap(t === "studio" ? LAHD_CAPS.studio : t === "oneBR" ? LAHD_CAPS.oneBR : LAHD_CAPS.twoBR);
  }

  return (
    <>
      <PageHeader
        title="Utility Allowance / Tenant Burden Calculator"
        subtitle="LAHD covenant rule: tenant rent + utility allowance must not exceed the cap for unit size. This calculator does NOT provide legal conclusions — verify with Catherine / Urban / LAHD."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Inputs" />
          <CardBody>
            <div className="space-y-4 text-sm">
              <div>
                <label className="text-xs text-slate-500">Unit type</label>
                <div className="flex gap-2 mt-1">
                  {(["studio", "oneBR", "twoBR"] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => handleUnit(t)}
                      className={`px-3 py-1.5 rounded-md text-xs border ${unitType === t ? "bg-slate-900 text-white" : "bg-white border-slate-200"}`}
                    >
                      {t === "oneBR" ? "1BR" : t === "twoBR" ? "2BR" : "Studio"}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-500">Tenant rent portion ($)</label>
                <input type="number" value={tenantRent} onChange={e => setTenantRent(parseFloat(e.target.value) || 0)} className="w-full border rounded-md px-3 py-1.5 mt-1" />
              </div>

              <div>
                <label className="text-xs text-slate-500">Utility allowance ($)</label>
                <input type="number" value={allowance} onChange={e => setAllowance(parseFloat(e.target.value) || 0)} className="w-full border rounded-md px-3 py-1.5 mt-1" />
              </div>

              <div>
                <label className="text-xs text-slate-500">Actual RUBS / monthly utility charge ($)</label>
                <input type="number" value={actualRubs} onChange={e => setActualRubs(parseFloat(e.target.value) || 0)} className="w-full border rounded-md px-3 py-1.5 mt-1" />
              </div>

              <div>
                <label className="text-xs text-slate-500">LAHD cap for this unit size ($)</label>
                <input type="number" value={cap} onChange={e => setCap(parseFloat(e.target.value) || 0)} className="w-full border rounded-md px-3 py-1.5 mt-1" />
                <p className="text-xs text-slate-400 mt-1">Edit if your LAHD schedule differs from the seeded values.</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Outputs" />
          <CardBody>
            <div className="space-y-4">
              <div className="border border-slate-200 rounded-lg p-4">
                <div className="text-xs text-slate-500">Tenant burden (rent + allowance)</div>
                <div className="text-2xl font-semibold">{fmtMoney(burden)}</div>
                <div className="text-xs text-slate-500 mt-1">LAHD cap: {fmtMoney(cap)}</div>
              </div>

              <div className={`rounded-lg p-4 ${over ? "bg-rose-50 border border-rose-200" : "bg-emerald-50 border border-emerald-200"}`}>
                <div className="flex justify-between items-center">
                  <div className="font-medium">{over ? "⚠ Potential compliance risk" : "✓ Within LAHD cap"}</div>
                  <Badge intent={over ? "bad" : "good"}>
                    {over ? `+${fmtMoney(burden - cap)} over` : `${fmtMoney(cap - burden)} headroom`}
                  </Badge>
                </div>
                {over && (
                  <p className="text-xs text-rose-700 mt-2">
                    Tenant rent + utility allowance exceeds the LAHD cap. Verify with Catherine / Urban / LAHD.
                    This may indicate a unit/tenant mismatch (see open LAHD escalation case in tenant outreach — Admin/Manager only).
                  </p>
                )}
              </div>

              <div className="border border-slate-200 rounded-lg p-4">
                <div className="text-xs text-slate-500 mb-2">Actual vs allowance</div>
                <div className="text-sm">
                  Tenant burden using actual RUBS: <strong>{fmtMoney(tenantRent + actualRubs)}</strong>
                </div>
                <div className="text-sm">
                  Difference (actual − allowance): <strong className={actualRubs - allowance > 0 ? "text-rose-700" : "text-emerald-700"}>
                    {actualRubs - allowance > 0 ? "+" : ""}{fmtMoney(actualRubs - allowance)}
                  </strong>
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  If actual RUBS &gt; allowance, the tenant pays the overage out-of-pocket via the utility addendum — only enforceable via small claims, not eviction.
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Current Baxter utility allowance schedule (LAHD)" />
        <CardBody>
          <table className="bx max-w-md">
            <thead><tr><th>Unit size</th><th>Allowance</th><th>LAHD cap</th></tr></thead>
            <tbody>
              <tr><td>Studio</td><td>{fmtMoney(UTILITY_ALLOWANCE_SCHEDULE.studio)}</td><td>{fmtMoney(LAHD_CAPS.studio)}</td></tr>
              <tr><td>1BR</td><td>{fmtMoney(UTILITY_ALLOWANCE_SCHEDULE.oneBR)}</td><td>{fmtMoney(LAHD_CAPS.oneBR)}</td></tr>
              <tr><td>2BR</td><td>{fmtMoney(UTILITY_ALLOWANCE_SCHEDULE.twoBR)}</td><td>{fmtMoney(LAHD_CAPS.twoBR)}</td></tr>
            </tbody>
          </table>
          <p className="text-xs text-slate-500 mt-3">
            Editable in /settings. Caps are placeholders — confirm with LAHD schedule for the building's unit-size definitions.
          </p>
        </CardBody>
      </Card>
    </>
  );
}
