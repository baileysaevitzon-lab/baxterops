// Audit-log persistence. Supabase when env is present, localStorage fallback otherwise.

import { BACKEND_MODE } from "./persistence";
import { getSupabase } from "@/lib/supabase/client";
import { TABLES } from "./tables";
import type { AuditEntry } from "@/lib/types";

const LS_KEY = "baxter-ops.auditLog";
const TABLE = TABLES.auditLogs ?? "audit_logs";

interface Row {
  id: string;
  timestamp: string;
  user_id: string;
  user_name: string;
  role: string;
  page: string | null;
  tenant_id: string | null;
  field_type: string;
  action: string;
}

function toEntry(r: Row): AuditEntry {
  return {
    id: r.id,
    timestamp: r.timestamp,
    userId: r.user_id,
    userName: r.user_name,
    role: r.role as AuditEntry["role"],
    page: r.page ?? "",
    tenantId: r.tenant_id ?? undefined,
    fieldType: r.field_type,
    action: r.action as AuditEntry["action"],
  };
}

export async function writeAuditEntry(entry: AuditEntry): Promise<void> {
  if (BACKEND_MODE === "supabase") {
    const sb = getSupabase();
    if (sb) {
      const row = {
        id: entry.id,
        timestamp: entry.timestamp,
        user_id: entry.userId,
        user_name: entry.userName,
        role: entry.role,
        page: entry.page,
        tenant_id: entry.tenantId ?? null,
        field_type: entry.fieldType,
        action: entry.action,
      };
      const { error } = await sb.from(TABLE).insert(row);
      if (error) console.warn("[auditLogs.write]", error.message);
      return;
    }
  }
  // localStorage fallback
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr: AuditEntry[] = raw ? JSON.parse(raw) : [];
    arr.unshift(entry);
    localStorage.setItem(LS_KEY, JSON.stringify(arr.slice(0, 500)));
  } catch {}
}

export async function loadRecentAuditEntries(limit = 500): Promise<AuditEntry[]> {
  if (BACKEND_MODE === "supabase") {
    const sb = getSupabase();
    if (sb) {
      const { data, error } = await sb.from(TABLE).select("*").order("timestamp", { ascending: false }).limit(limit);
      if (error) {
        console.warn("[auditLogs.load]", error.message);
        return [];
      }
      return (data ?? []).map(r => toEntry(r as Row));
    }
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as AuditEntry[]) : [];
  } catch { return []; }
}

export async function clearAllAuditEntries(): Promise<void> {
  if (BACKEND_MODE === "supabase") {
    const sb = getSupabase();
    if (sb) {
      const { error } = await sb.from(TABLE).delete().neq("id", "__never_matches__");
      if (error) console.warn("[auditLogs.clear]", error.message);
      return;
    }
  }
  try { localStorage.removeItem(LS_KEY); } catch {}
}
