// Sprint 25 — SGD Operations Portal: public property-selector landing page.
//
// PUBLIC. No auth, no AppGate (see AppGate PUBLIC_PATHS), no Sidebar/TopBar
// (hidden on "/" ). Contains only public marketing facts — NO tenant, financial,
// compliance, or operational data. Clicking "Open Ops" routes into a property
// workspace (e.g. /baxter), where AppGate enforces login + approval.
//
// Server component on purpose: no client hooks, no auth context — guarantees the
// page renders for anyone without touching authenticated state.

import Link from "next/link";
import { MANAGED_PROPERTIES } from "@/lib/managedProperties";

export const metadata = {
  title: "SGD Operations Portal",
  description: "Select a property workspace.",
};

export default function PortalLanding() {
  return (
    <div className="min-h-[80vh] -m-8 p-8 bg-slate-50">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <header className="text-center mb-10 pt-6">
          <div className="text-xs font-semibold tracking-widest text-slate-400 uppercase">SGD Property Management</div>
          <h1 className="text-3xl font-bold text-slate-900 mt-2">SGD Operations Portal</h1>
          <p className="text-sm text-slate-500 mt-2">Select a property workspace.</p>
        </header>

        {/* Property grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {MANAGED_PROPERTIES.map(p => {
            const active = p.workspaceStatus === "active" && p.opsRoute;
            return (
              <div
                key={p.slug}
                className={`rounded-xl border bg-white p-5 flex flex-col ${active ? "border-slate-300 shadow-sm" : "border-slate-200"}`}
              >
                {/* Letter avatar (no public thumbnails available from SGD site) */}
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-11 h-11 rounded-lg flex items-center justify-center text-base font-bold ${active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-400"}`}>
                    {p.name.replace(/^The /, "").charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.city}</div>
                  </div>
                </div>

                {/* Status */}
                <div className="mb-4">
                  {active ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active workspace
                    </span>
                  ) : (
                    <span className="inline-flex items-center text-xs font-medium text-slate-500 bg-slate-100 rounded-full px-2.5 py-1">
                      Ops not built yet
                    </span>
                  )}
                </div>

                {/* Action */}
                <div className="mt-auto flex items-center justify-between gap-2">
                  {active ? (
                    <Link
                      href={p.opsRoute!}
                      className="flex-1 text-center px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700"
                    >
                      Open Ops →
                    </Link>
                  ) : (
                    <button
                      disabled
                      className="flex-1 px-4 py-2 rounded-lg bg-slate-100 text-slate-400 text-sm font-semibold cursor-not-allowed"
                    >
                      Coming Soon
                    </button>
                  )}
                  <a
                    href={p.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-slate-400 hover:text-slate-600 underline whitespace-nowrap"
                    title="Public property website"
                  >
                    Website
                  </a>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-center text-[11px] text-slate-400 mt-10">
          Sign-in is required only inside a property Ops workspace. This portal shows public property information only.
        </p>
      </div>
    </div>
  );
}
