"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const sections = [
  {
    label: "Intelligence",
    items: [
      { href: "/", label: "Executive Dashboard" },
      { href: "/baxter-units", label: "Baxter Units" },
      { href: "/competitors", label: "Competitor Database" },
      { href: "/competitor-intelligence", label: "Competitor Intelligence" },
      { href: "/comp-matching", label: "Comp Matching" },
      { href: "/pricing-model", label: "Pricing Model" },
      { href: "/photos-amenities", label: "Photos + Amenities" },
    ],
  },
  {
    label: "Field + Marketing",
    items: [
      { href: "/walkthrough-campaigns", label: "Walkthrough Campaigns" },
      { href: "/add-tour", label: "Add Tour (new property)" },
      { href: "/local-partnerships", label: "Local Partnerships" },
      { href: "/marketing-roi", label: "Marketing ROI" },
      { href: "/lead-funnel", label: "Lead Funnel" },
    ],
  },
  {
    label: "Compliance",
    items: [
      { href: "/tenant-outreach", label: "Tenant Outreach" },
      { href: "/recertification/tenant-form", label: "Tenant Recertification Form" },
      { href: "/recertification/manager-form", label: "Prop. Manager Recert. Form" },
      { href: "/recertification/compiler", label: "Income Cert. Compiler" },
      { href: "/utility-allowance", label: "Utility Allowance" },
    ],
  },
  {
    label: "Data Quality",
    items: [
      { href: "/data-quality-dashboard", label: "Quality Dashboard" },
      { href: "/number-inventory", label: "Number Inventory" },
      { href: "/data-dictionary", label: "Data Dictionary" },
      { href: "/source-conflicts", label: "Source Conflicts" },
      { href: "/verification-queue", label: "Verification Queue" },
      { href: "/covariate-rubric", label: "Covariate Rubric" },
    ],
  },
  {
    label: "Workflow",
    items: [
      { href: "/tasks", label: "Tasks" },
      { href: "/reports", label: "Weekly Reports" },
      { href: "/audit-log", label: "Audit Log" },
      { href: "/settings", label: "Settings" },
      { href: "/login", label: "Sign in / Auth" },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  // Sprint 21: hide the staff sidebar on the public token-gated tenant form.
  if (pathname?.startsWith("/recertification/tenant/")) return null;
  return (
    <aside className="w-64 shrink-0 border-r border-slate-200 bg-white min-h-screen">
      <div className="p-5 border-b border-slate-200">
        <div className="text-lg font-semibold tracking-tight">BaxterOps</div>
        <div className="text-xs text-slate-500 mt-1">The Baxter Hollywood · SGD</div>
      </div>
      <nav className="p-3 space-y-5">
        {sections.map(section => (
          <div key={section.label}>
            <div className="px-2 text-[11px] uppercase tracking-wider text-slate-400 mb-1">
              {section.label}
            </div>
            <ul className="space-y-0.5">
              {section.items.map(item => {
                const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`block px-2 py-1.5 rounded-md text-sm ${
                        active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
