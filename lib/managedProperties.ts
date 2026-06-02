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
  /** Optional street address (not exposed on the public overview page yet). */
  address?: string;
  /** Optional region/property-type tag for future grouping/filtering. */
  region?: string;
  /** Public SGD marketing page (external). */
  websiteUrl: string;
  /** Public hero image (SGD Duda CDN). Undefined → card shows a styled fallback. */
  imageUrl?: string;
  /** Protected Ops workspace entry route, or null if not built yet. */
  opsRoute: string | null;
  workspaceStatus: WorkspaceStatus;
}

const SGD = "https://www.livesdproperties.com";
// SGD Duda CDN base. Each imageUrl below is the verified first hero image
// extracted from that property's public detail page (not guessed).
const IMG = "https://lirp.cdn-website.com/44166221/dms3rep/multi/opt";

// Verified public SGD logo (Duda CDN), used in the portal header.
export const SGD_LOGO = `${IMG}/sd-prop-logo-1920w.png`;

// The Baxter first (the only active workspace today), then the rest as listed
// on the public SGD properties page. Add `opsRoute` + flip status to "active"
// as each property's workspace is built.
export const MANAGED_PROPERTIES: ManagedProperty[] = [
  { slug: "the-baxter",     name: "The Baxter Hollywood", city: "Hollywood",      websiteUrl: `${SGD}/the-baxter`,    imageUrl: `${IMG}/The-Baxter-1920w.jpg`,                                  opsRoute: "/baxter", workspaceStatus: "active" },
  { slug: "the-commodore",  name: "The Commodore",        city: "Hollywood",      websiteUrl: `${SGD}/the-commodore`, imageUrl: `${IMG}/The-James-511-Studio-01-1920w.jpg`,                     opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "burton-almont",  name: "Burton Almont",        city: "Los Angeles",    websiteUrl: `${SGD}/Burton-almont`, imageUrl: `${IMG}/IMG_9074-1920w.jpg`,                                    opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "casa-real",      name: "Casa Real",            city: "West Hollywood", websiteUrl: `${SGD}/casa-real`,     imageUrl: `${IMG}/original-443-44466c5b-1920w.jpg`,                       opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "the-elizabeth",  name: "The Elizabeth",        city: "West Hollywood", websiteUrl: `${SGD}/the-elizabeth`, imageUrl: `${IMG}/WSI+Fountain-11-1920w.jpg`,                             opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "villa-rebecca",  name: "Villa Rebecca",        city: "Beverly Hills",  websiteUrl: `${SGD}/villa-rebecca`, imageUrl: `${IMG}/NJ1_8080-Edit-1920w.jpg`,                               opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "rivers-edge",    name: "Rivers Edge",          city: "Los Angeles",    websiteUrl: `${SGD}/rivers-edge`,   imageUrl: `${IMG}/964d80_4c7d51d160e2420884dd2a8d11f6549d%7Emv2-1920w.jpg`, opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "burbank",        name: "Burbank",              city: "Valley Village", websiteUrl: `${SGD}/burbank`,       imageUrl: `${IMG}/original-41-1920w.jpg`,                                 opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "the-dahlia",     name: "The Dahlia",           city: "West Hollywood", websiteUrl: `${SGD}/dahlia`,        imageUrl: `${IMG}/WSI+Hancock-8-1920w.jpg`,                               opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "zvi-coast",      name: "ZVI Coast",            city: "Santa Monica",   websiteUrl: `${SGD}/zvi-coast`,     imageUrl: `${IMG}/938+4th+Street+Santa+Monica-7-1920w.jpg`,               opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "le-cove",        name: "Le Cove",              city: "Santa Monica",   websiteUrl: `${SGD}/le-cove`,       imageUrl: `${IMG}/WSI+937+3rd+Street+Interiors-5-1920w.jpg`,              opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "the-line-lofts", name: "The Line Lofts",       city: "Hollywood",      websiteUrl: `${SGD}/line-lofts`,    imageUrl: `${IMG}/GS_TLL_Lobby_III-1920w.jpg`,                            opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "the-nirvana",    name: "The Nirvana",          city: "Hollywood",      websiteUrl: `${SGD}/the-nirvana`,   imageUrl: `${IMG}/1775+Orange-Exterior1-EDIT-1920w.jpg`,                  opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "the-purser",     name: "The Purser",           city: "Santa Monica",   websiteUrl: `${SGD}/the-purser`,    imageUrl: `${IMG}/NJ1_6989-HDR-1920w.jpg`,                                opsRoute: null, workspaceStatus: "coming_soon" },
  { slug: "the-sofia",      name: "The Sofia",            city: "West Hollywood", websiteUrl: `${SGD}/the-sofia`,     imageUrl: `${IMG}/IMG_6208-1920w.jpg`,                                    opsRoute: null, workspaceStatus: "coming_soon" },
];
