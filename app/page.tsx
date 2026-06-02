// Sprint 25 — SGD Operations Portal: public property-selector landing page.
//
// PUBLIC. No auth, no AppGate (see AppGate PUBLIC_PATHS), no Sidebar/TopBar
// (hidden on "/"). Public marketing facts only — NO tenant, financial,
// compliance, or operational data. "Open Ops" routes into a property workspace
// (e.g. /baxter), where AppGate enforces login + approval.
//
// Server component on purpose: no client hooks, no auth context.

import Link from "next/link";
import { MANAGED_PROPERTIES, SGD_LOGO } from "@/lib/managedProperties";

export const metadata = {
  title: "SGD Operations Portal",
  description: "Select a property workspace.",
};

export default function PortalLanding() {
  return (
    <div className="min-h-screen -m-8 bg-slate-50">
      {/* SGD-branded header */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={SGD_LOGO} alt="SGD Property Management" className="h-8 w-auto" />
            <span className="hidden sm:inline text-sm font-semibold text-slate-400 border-l border-slate-200 pl-3">
              Operations Portal
            </span>
          </div>
          <a
            href="https://www.livesdproperties.com/our-properties"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-slate-400 hover:text-slate-600"
          >
            livesdproperties.com ↗
          </a>
        </div>
      </header>

      {/* Hero */}
      <div className="max-w-6xl mx-auto px-6">
        <div className="py-10 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">SGD Operations Portal</h1>
          <p className="text-sm text-slate-500 mt-3">
            Select a property to open its operations workspace.
          </p>
        </div>

        {/* Property grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 pb-16">
          {MANAGED_PROPERTIES.map(p => {
            const active = p.workspaceStatus === "active" && !!p.opsRoute;
            const initial = p.name.replace(/^The /, "").charAt(0);
            return (
              <div
                key={p.slug}
                className={`group rounded-2xl bg-white overflow-hidden border transition-shadow ${
                  active ? "border-slate-200 shadow-sm hover:shadow-md" : "border-slate-200"
                }`}
              >
                {/* Image area (image-first; graceful fallback when no imageUrl) */}
                <div className="relative h-44 w-full overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200">
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.imageUrl}
                      alt={p.name}
                      className={`h-full w-full object-cover ${active ? "" : "grayscale opacity-80"}`}
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center">
                      <span className="text-4xl font-bold text-slate-300">{initial}</span>
                    </div>
                  )}
                  {/* Status pill overlay */}
                  <div className="absolute top-3 left-3">
                    {active ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800 bg-white/90 backdrop-blur rounded-full px-2.5 py-1 shadow-sm">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active workspace
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-[11px] font-semibold text-slate-500 bg-white/90 backdrop-blur rounded-full px-2.5 py-1 shadow-sm">
                        Coming soon
                      </span>
                    )}
                  </div>
                </div>

                {/* Body */}
                <div className="p-4">
                  <div className="font-semibold text-slate-900 leading-tight">{p.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{p.city}</div>

                  <div className="mt-4 flex items-center justify-between gap-2">
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
              </div>
            );
          })}
        </div>

        <p className="text-center text-[11px] text-slate-400 pb-10 -mt-6">
          Sign-in is required only inside a property Ops workspace. This portal shows public property information only.
        </p>
      </div>
    </div>
  );
}
