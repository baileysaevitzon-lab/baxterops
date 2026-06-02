// Sprint 25 — SGD Operations Portal: managed-property registry.
//
// Static config (no DB table yet — see proposed `managed_properties` migration).
// Source: https://www.livesdproperties.com/our-properties (public page).
// This drives the public property-selector landing page at `/`. It contains
// ZERO tenant / financial / operational data — public marketing facts only.

export type WorkspaceStatus = "active" | "coming_soon";

export interface ManagedProperty {
  slug: string;
  name: string;
  city: string;
  /** Public SGD marketing page (external). */
  websiteUrl: string;
  /** Protected Ops workspace entry route, or null if not built yet. */
  opsRoute: string | null;
  workspaceStatus: WorkspaceStatus;
}

const SGD = "https://www.livesdproperties.com";

// The Baxter first (the only active workspace today), then the rest as listed
// on the public SGD properties page. Add `opsRoute` + flip status to "active"
// as each property's workspace is built.
export const MANAGED_PROPERTIES: ManagedProperty[] = [
  { slug: "the-baxter",     name: "The Baxter Hollywood", city: "Hollywood",      websiteUrl: `${SGD}/the-baxter`,    opsRoute: "/baxter", workspaceStatus: "active" },
  { slug: "the-commodore",  name: "The Commodore",        city: "Hollywood",      websiteUrl: `${SGD}/the-commodore`, opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "burton-almont",  name: "Burton Almont",        city: "Los Angeles",    websiteUrl: `${SGD}/Burton-almont`, opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "casa-real",      name: "Casa Real",            city: "West Hollywood", websiteUrl: `${SGD}/casa-real`,     opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "the-elizabeth",  name: "The Elizabeth",        city: "West Hollywood", websiteUrl: `${SGD}/the-elizabeth`, opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "villa-rebecca",  name: "Villa Rebecca",        city: "Beverly Hills",  websiteUrl: `${SGD}/villa-rebecca`, opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "rivers-edge",    name: "Rivers Edge",          city: "Los Angeles",    websiteUrl: `${SGD}/rivers-edge`,   opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "burbank",        name: "Burbank",              city: "Valley Village", websiteUrl: `${SGD}/burbank`,       opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "the-dahlia",     name: "The Dahlia",           city: "West Hollywood", websiteUrl: `${SGD}/dahlia`,        opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "zvi-coast",      name: "ZVI Coast",            city: "Santa Monica",   websiteUrl: `${SGD}/zvi-coast`,     opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "le-cove",        name: "Le Cove",              city: "Santa Monica",   websiteUrl: `${SGD}/le-cove`,       opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "the-line-lofts", name: "The Line Lofts",       city: "Hollywood",      websiteUrl: `${SGD}/line-lofts`,    opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "the-nirvana",    name: "The Nirvana",          city: "Hollywood",      websiteUrl: `${SGD}/the-nirvana`,   opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "the-purser",     name: "The Purser",           city: "Santa Monica",   websiteUrl: `${SGD}/the-purser`,    opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "the-sofia",      name: "The Sofia",            city: "West Hollywood", websiteUrl: `${SGD}/the-sofia`,     opsRoute: null, workspaceStatus: "coming_soon" },
];
