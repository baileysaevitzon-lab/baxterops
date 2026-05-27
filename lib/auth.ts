// RBAC infrastructure — MVP mock auth.
// NOT production-grade: this is a session-scoped role gate, not real authentication.
// Lives in localStorage + React context.

import type { MockUser, Role } from "./types";

export const MOCK_USERS: MockUser[] = [
  { id: "u-steve", name: "Steve", role: "Admin" },
  { id: "u-catherine", name: "Catherine", role: "Manager" },
  { id: "u-evan", name: "Evan", role: "Manager" },
  { id: "u-lucas", name: "Lucas", role: "Leasing" },
  { id: "u-joanna", name: "Joanna", role: "Leasing" },
  { id: "u-bailey", name: "Bailey", role: "Analyst" },
  { id: "u-shane", name: "Shane", role: "Analyst" },
  { id: "u-owner", name: "Ownership", role: "Viewer" },
];

export const DEFAULT_USER_ID = "u-bailey";

// Permission categories we gate on.
// "sensitive_tenant" covers income, private notes, compliance-sensitive notes,
// health-related notes, LAHD cap failure details, and tenant rent burden tied to
// named tenants. Admin + Manager only.
export type Permission =
  | "view_sensitive_tenant"
  | "view_general_tenant"
  | "view_market_data"
  | "view_owner_report"
  | "edit_tenant"
  | "edit_competitor";

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  Admin: [
    "view_sensitive_tenant",
    "view_general_tenant",
    "view_market_data",
    "view_owner_report",
    "edit_tenant",
    "edit_competitor",
  ],
  Manager: [
    "view_sensitive_tenant",
    "view_general_tenant",
    "view_market_data",
    "view_owner_report",
    "edit_tenant",
    "edit_competitor",
  ],
  Leasing: [
    "view_general_tenant",
    "view_market_data",
    "view_owner_report",
    "edit_competitor",
  ],
  Analyst: [
    "view_general_tenant",
    "view_market_data",
    "view_owner_report",
    "edit_competitor",
  ],
  Viewer: [
    "view_owner_report",
  ],
};

export function can(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(perm);
}

export function describePermission(perm: Permission): string {
  switch (perm) {
    case "view_sensitive_tenant":
      return "View sensitive tenant data (income, private notes, compliance risks)";
    case "view_general_tenant":
      return "View general tenant outreach status";
    case "view_market_data":
      return "View market/comparison/marketing data";
    case "view_owner_report":
      return "View owner-safe reports and dashboards";
    case "edit_tenant":
      return "Edit tenant data";
    case "edit_competitor":
      return "Edit competitor data";
  }
}
