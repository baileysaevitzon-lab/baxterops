// Sprint 19: Tenant roster service.
//
// Provides the management-facing list of tenants who are eligible (or blocked)
// for recertification. Wraps create / read / status-lifecycle for the
// public.recert_tenant_roster table.
//
// Lifecycle status values, in order:
//   not_sent → sent → opened → in_progress → submitted → manager_reviewed → merged
// (blocked tenants stay at "blocked" forever)
//
// The status is recomputed every time a milestone timestamp is written, so the
// UI can show a status pill without joining against recert_completion_sessions.

import { getSupabase } from "@/lib/supabase/client";
import { TABLES } from "./tables";

export type RosterStatus =
  | "not_sent"
  | "sent"
  | "opened"
  | "in_progress"
  | "submitted"
  | "manager_reviewed"
  | "merged"
  | "blocked";

export interface RosterEntry {
  id: string;
  tenantName: string;
  unitNumber: string;
  eligible: boolean;
  blockedReason: string | null;
  caseId: string | null;
  invitationToken: string | null;
  invitationSentAt: string | null;
  invitationOpenedAt: string | null;
  managerReviewedAt: string | null;
  finalPdfGeneratedAt: string | null;
  status: RosterStatus;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Row mapping
// ─────────────────────────────────────────────────────────────────────────────

interface RosterRow {
  id: string;
  tenant_name: string;
  unit_number: string;
  eligible: boolean;
  blocked_reason: string | null;
  case_id: string | null;
  invitation_token: string | null;
  invitation_sent_at: string | null;
  invitation_opened_at: string | null;
  manager_reviewed_at: string | null;
  final_pdf_generated_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function rowToEntry(r: RosterRow): RosterEntry {
  return {
    id: r.id,
    tenantName: r.tenant_name,
    unitNumber: r.unit_number,
    eligible: r.eligible,
    blockedReason: r.blocked_reason,
    caseId: r.case_id,
    invitationToken: r.invitation_token,
    invitationSentAt: r.invitation_sent_at,
    invitationOpenedAt: r.invitation_opened_at,
    managerReviewedAt: r.manager_reviewed_at,
    finalPdfGeneratedAt: r.final_pdf_generated_at,
    status: r.status as RosterStatus,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────────────────────────────────

export async function loadRoster(): Promise<RosterEntry[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from(TABLES.recertTenantRoster)
    .select("*")
    .order("unit_number", { ascending: true });
  if (error || !data) return [];
  return (data as RosterRow[]).map(rowToEntry);
}

export async function loadRosterEntry(id: string): Promise<RosterEntry | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from(TABLES.recertTenantRoster)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return rowToEntry(data as RosterRow);
}

export async function loadRosterByToken(token: string): Promise<RosterEntry | null> {
  const sb = getSupabase();
  if (!sb || !token) return null;
  const { data, error } = await sb
    .from(TABLES.recertTenantRoster)
    .select("*")
    .eq("invitation_token", token)
    .maybeSingle();
  if (error || !data) return null;
  return rowToEntry(data as RosterRow);
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function generateRosterId(unit: string, name: string): string {
  return `trr-unit-${slugify(unit)}-${slugify(name)}`;
}

export async function addTenant(args: {
  tenantName: string;
  unitNumber: string;
  eligible?: boolean;
  blockedReason?: string;
}): Promise<{ ok: boolean; entry?: RosterEntry; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "Supabase not configured" };
  const name = args.tenantName.trim();
  const unit = args.unitNumber.trim();
  if (!name) return { ok: false, error: "Tenant name is required" };
  if (!unit) return { ok: false, error: "Unit number is required" };

  const id = generateRosterId(unit, name);
  const eligible = args.eligible ?? true;
  const status: RosterStatus = eligible ? "not_sent" : "blocked";

  const { data, error } = await sb
    .from(TABLES.recertTenantRoster)
    .insert({
      id,
      tenant_name: name,
      unit_number: unit,
      eligible,
      blocked_reason: args.blockedReason ?? null,
      status,
    })
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, entry: data ? rowToEntry(data as RosterRow) : undefined };
}

/**
 * Creates a recertification_cases row for an eligible roster tenant, links
 * the roster entry to that case, and returns the case id.
 *
 * If the roster entry already has a case_id, that case is reused — never
 * silently overwritten.
 */
export async function startRecertificationFor(
  rosterId: string,
  options?: { propertyId?: string; propertyName?: string },
): Promise<{ ok: boolean; caseId?: string; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "Supabase not configured" };
  const entry = await loadRosterEntry(rosterId);
  if (!entry) return { ok: false, error: "Roster entry not found" };
  if (!entry.eligible) return { ok: false, error: "This tenant is blocked from recertification." };
  if (entry.caseId) return { ok: true, caseId: entry.caseId };

  const caseId = `rc-${entry.unitNumber}-${slugify(entry.tenantName)}-2026`;
  // Idempotent insert: skip if a case already exists with this id.
  const { data: existingCase } = await sb
    .from(TABLES.recertificationCases)
    .select("id")
    .eq("id", caseId)
    .maybeSingle();
  if (!existingCase) {
    const { error: insErr } = await sb.from(TABLES.recertificationCases).insert({
      id: caseId,
      primary_tenant_name: entry.tenantName,
      unit_number: entry.unitNumber,
      property_id: options?.propertyId ?? "baxter-hollywood",
      property_name: options?.propertyName ?? "Baxter Hollywood (1818 N Cherokee)",
      certification_type: "annual",
      case_status: "not_started",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (insErr) return { ok: false, error: insErr.message };
  }

  const { error: linkErr } = await sb
    .from(TABLES.recertTenantRoster)
    .update({
      case_id: caseId,
      status: "not_sent",
      updated_at: new Date().toISOString(),
    })
    .eq("id", rosterId);
  if (linkErr) return { ok: false, error: linkErr.message };

  await writeAudit(caseId, "roster_case_started", `Recertification case created from roster for unit ${entry.unitNumber} (${entry.tenantName}).`, {
    rosterId,
    tenantName: entry.tenantName,
    unitNumber: entry.unitNumber,
  });

  return { ok: true, caseId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle helpers
// ─────────────────────────────────────────────────────────────────────────────

function nextStatusFromEntry(e: RosterEntry): RosterStatus {
  if (!e.eligible) return "blocked";
  if (e.finalPdfGeneratedAt) return "merged";
  if (e.managerReviewedAt) return "manager_reviewed";
  if (e.invitationOpenedAt) return "opened";
  if (e.invitationSentAt) return "sent";
  return "not_sent";
}

/** Crypto-strength token, safe for URL query strings. */
function generateToken(): string {
  // 16 random bytes → 32-char hex token
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function generateInvitationToken(rosterId: string): Promise<{ ok: boolean; token?: string; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "Supabase not configured" };
  const entry = await loadRosterEntry(rosterId);
  if (!entry) return { ok: false, error: "Roster entry not found" };
  if (!entry.eligible) return { ok: false, error: "Cannot issue an invitation for a blocked tenant." };
  if (entry.invitationToken) return { ok: true, token: entry.invitationToken };
  const token = generateToken();
  const { error } = await sb
    .from(TABLES.recertTenantRoster)
    .update({ invitation_token: token, updated_at: new Date().toISOString() })
    .eq("id", rosterId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, token };
}

async function patchStatus(rosterId: string, patch: Partial<RosterRow>): Promise<{ ok: boolean; entry?: RosterEntry; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "Supabase not configured" };
  const before = await loadRosterEntry(rosterId);
  if (!before) return { ok: false, error: "Roster entry not found" };
  const merged: RosterEntry = {
    ...before,
    invitationSentAt: patch.invitation_sent_at ?? before.invitationSentAt,
    invitationOpenedAt: patch.invitation_opened_at ?? before.invitationOpenedAt,
    managerReviewedAt: patch.manager_reviewed_at ?? before.managerReviewedAt,
    finalPdfGeneratedAt: patch.final_pdf_generated_at ?? before.finalPdfGeneratedAt,
  };
  const computed = nextStatusFromEntry(merged);
  const { data, error } = await sb
    .from(TABLES.recertTenantRoster)
    .update({ ...patch, status: computed, updated_at: new Date().toISOString() })
    .eq("id", rosterId)
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, entry: data ? rowToEntry(data as RosterRow) : undefined };
}

export async function markSent(rosterId: string): Promise<{ ok: boolean; entry?: RosterEntry; error?: string }> {
  return patchStatus(rosterId, { invitation_sent_at: new Date().toISOString() });
}

export async function markOpened(rosterId: string): Promise<{ ok: boolean; entry?: RosterEntry; error?: string }> {
  return patchStatus(rosterId, { invitation_opened_at: new Date().toISOString() });
}

export async function markManagerReviewed(rosterId: string): Promise<{ ok: boolean; entry?: RosterEntry; error?: string }> {
  return patchStatus(rosterId, { manager_reviewed_at: new Date().toISOString() });
}

export async function markMerged(rosterId: string): Promise<{ ok: boolean; entry?: RosterEntry; error?: string }> {
  return patchStatus(rosterId, { final_pdf_generated_at: new Date().toISOString() });
}

/**
 * Sync the roster's in_progress / submitted state from
 * recert_completion_sessions. Called from the roster UI on load so we don't
 * need to wire roster updates into every completion-form save path.
 */
export async function refreshRosterStatusFromSessions(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const [rosterRes, sessionRes] = await Promise.all([
    sb.from(TABLES.recertTenantRoster).select("id, case_id, status, invitation_sent_at, invitation_opened_at, manager_reviewed_at, final_pdf_generated_at, eligible"),
    sb.from(TABLES.recertCompletionSessions).select("case_id, role, status"),
  ]);
  if (!rosterRes.data || !sessionRes.data) return;
  // Group sessions by case_id
  const byCase = new Map<string, { tenant?: string; manager?: string }>();
  for (const s of sessionRes.data as Array<{ case_id: string; role: string; status: string }>) {
    const slot = byCase.get(s.case_id) ?? {};
    if (s.role === "tenant") slot.tenant = s.status;
    if (s.role === "manager") slot.manager = s.status;
    byCase.set(s.case_id, slot);
  }
  for (const r of rosterRes.data as RosterRow[]) {
    if (!r.eligible || !r.case_id) continue;
    if (r.final_pdf_generated_at || r.manager_reviewed_at) continue;
    const sess = byCase.get(r.case_id);
    if (!sess) continue;
    let next: RosterStatus | null = null;
    if (sess.tenant === "submitted") next = "submitted";
    else if (sess.tenant === "draft") next = "in_progress";
    if (next && next !== r.status) {
      await sb
        .from(TABLES.recertTenantRoster)
        .update({ status: next, updated_at: new Date().toISOString() })
        .eq("id", r.id);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public-facing helpers
// ─────────────────────────────────────────────────────────────────────────────

export function buildInvitationUrl(origin: string, _caseId: string, token: string): string {
  // Sprint 21: the public tenant form is token-gated at /recertification/tenant/[token].
  // The caseId is no longer in the URL — the API route resolves it from the token.
  const cleanOrigin = origin.replace(/\/+$/, "");
  return `${cleanOrigin}/recertification/tenant/${encodeURIComponent(token)}`;
}

export function describeStatus(s: RosterStatus): { label: string; tone: "slate" | "amber" | "blue" | "green" | "rose" | "violet" } {
  switch (s) {
    case "not_sent":         return { label: "Not sent",          tone: "slate"  };
    case "sent":             return { label: "Sent",              tone: "amber"  };
    case "opened":           return { label: "Opened",            tone: "amber"  };
    case "in_progress":      return { label: "In progress",       tone: "blue"   };
    case "submitted":        return { label: "Submitted",         tone: "green"  };
    case "manager_reviewed": return { label: "Manager reviewed",  tone: "violet" };
    case "merged":           return { label: "Merged into PDF",   tone: "green"  };
    case "blocked":          return { label: "Blocked",           tone: "rose"   };
    default:                 return { label: s,                   tone: "slate"  };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit
// ─────────────────────────────────────────────────────────────────────────────

async function writeAudit(caseId: string, eventType: string, eventSummary: string, payload: Record<string, unknown>): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.from(TABLES.recertAuditEvents).insert({
      id: `ae-roster-${caseId}-${Date.now()}`,
      case_id: caseId,
      event_type: eventType,
      event_summary: eventSummary,
      event_payload_json: payload,
    });
  } catch {
    /* non-fatal */
  }
}
