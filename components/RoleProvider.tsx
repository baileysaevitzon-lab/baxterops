"use client";
import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { MOCK_USERS, DEFAULT_USER_ID, can } from "@/lib/auth";
import type { AuditEntry, MockUser, Role } from "@/lib/types";
import type { Permission } from "@/lib/auth";
import { BACKEND_MODE } from "@/lib/services/persistence";
import { writeAuditEntry, loadRecentAuditEntries } from "@/lib/services/auditLogs";

const USER_KEY = "baxter-ops.currentUser";
const AUDIT_KEY = "baxter-ops.auditLog";

interface RoleContextValue {
  user: MockUser;
  setUserId: (id: string) => void;
  can: (perm: Permission) => boolean;
  logAccess: (entry: Omit<AuditEntry, "id" | "timestamp" | "userId" | "userName" | "role">) => void;
  auditLog: AuditEntry[];
  clearAudit: () => void;
}

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [userId, setUserIdState] = useState<string>(DEFAULT_USER_ID);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);

  // hydrate from localStorage (role) and Supabase (audit log) on client
  useEffect(() => {
    try {
      const u = localStorage.getItem(USER_KEY);
      if (u && MOCK_USERS.find(x => x.id === u)) setUserIdState(u);
    } catch {}
    (async () => {
      if (BACKEND_MODE === "supabase") {
        try {
          const remote = await loadRecentAuditEntries(500);
          setAuditLog(remote);
          return;
        } catch (e) { console.warn("[audit] supabase load failed, falling back to localStorage:", e); }
      }
      try {
        const a = localStorage.getItem(AUDIT_KEY);
        if (a) setAuditLog(JSON.parse(a));
      } catch {}
    })();
  }, []);

  const setUserId = useCallback((id: string) => {
    setUserIdState(id);
    try { localStorage.setItem(USER_KEY, id); } catch {}
  }, []);

  const user = MOCK_USERS.find(u => u.id === userId) ?? MOCK_USERS[0];

  const logAccess: RoleContextValue["logAccess"] = useCallback((entry) => {
    const fullEntry: AuditEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      userId: user.id,
      userName: user.name,
      role: user.role,
      ...entry,
    };
    setAuditLog(prev => [fullEntry, ...prev].slice(0, 500));
    // fire-and-forget write to Supabase (or localStorage fallback)
    writeAuditEntry(fullEntry).catch(e => console.warn("[audit] write failed:", e));
  }, [user]);

  const clearAudit = useCallback(async () => {
    setAuditLog([]);
    try { localStorage.removeItem(AUDIT_KEY); } catch {}
    if (BACKEND_MODE === "supabase") {
      try {
        const { clearAllAuditEntries } = await import("@/lib/services/auditLogs");
        await clearAllAuditEntries();
      } catch (e) { console.warn("[audit] supabase clear failed:", e); }
    }
  }, []);

  return (
    <RoleContext.Provider value={{
      user,
      setUserId,
      can: (perm) => can(user.role, perm),
      logAccess,
      auditLog,
      clearAudit,
    }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used inside <RoleProvider>");
  return ctx;
}

// Convenience component for gated sensitive fields.
// Logs an access entry whenever the field renders for a privileged role.
export function ProtectedField({
  perm,
  page,
  tenantId,
  fieldType,
  children,
}: {
  perm: Permission;
  page: string;
  tenantId?: string;
  fieldType: string;
  children: ReactNode;
}) {
  const { can, logAccess } = useRole();
  const allowed = can(perm);

  useEffect(() => {
    if (allowed) {
      logAccess({ page, tenantId, fieldType, action: "view" });
    } else {
      logAccess({ page, tenantId, fieldType, action: "redact" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, page, tenantId, fieldType]);

  if (!allowed) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs italic text-slate-500">
        🔒 Restricted compliance-sensitive note. Visible to Admin / Manager only.
      </div>
    );
  }
  return <>{children}</>;
}

// Top-bar role switcher used in /settings and globally.
export function RoleSwitcher({ compact = false }: { compact?: boolean }) {
  const { user, setUserId } = useRole();
  return (
    <div className={compact ? "text-xs" : "text-sm"}>
      <label className="text-slate-500 mr-2">Acting as</label>
      <select
        value={user.id}
        onChange={e => setUserId(e.target.value)}
        className="border border-slate-300 rounded-md px-2 py-1 bg-white"
      >
        {MOCK_USERS.map(u => (
          <option key={u.id} value={u.id}>{u.name} — {u.role}</option>
        ))}
      </select>
    </div>
  );
}
