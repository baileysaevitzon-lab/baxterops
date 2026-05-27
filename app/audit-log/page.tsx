"use client";
import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { useRole } from "@/components/RoleProvider";
import { loadRecentAuditEntries } from "@/lib/services/auditLogs";
import { BACKEND_MODE } from "@/lib/services/persistence";
import type { AuditEntry } from "@/lib/types";

export default function AuditLogPage() {
  const { auditLog: localAudit, clearAudit, can } = useRole();
  const allowed = can("view_sensitive_tenant");
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);

  useEffect(() => {
    (async () => {
      const remote = await loadRecentAuditEntries(500);
      // Merge: remote authoritative, local entries that aren't yet persisted appended
      const seen = new Set(remote.map(r => r.id));
      const extras = localAudit.filter(e => !seen.has(e.id));
      setAuditLog([...remote, ...extras].slice(0, 500));
    })();
  }, [localAudit.length]);

  return (
    <>
      <PageHeader
        title="Audit Log"
        subtitle={`Every view of a sensitive tenant field is logged here. Backend: ${BACKEND_MODE}. Admin/Manager only.`}
        action={allowed && (
          <button onClick={clearAudit} className="px-3 py-2 text-sm rounded-md border border-rose-300 text-rose-700">
            Clear log
          </button>
        )}
      />

      {!allowed && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You are viewing the audit log without elevated permission. You can see the activity stream but cannot clear it.
        </div>
      )}

      <Card>
        <CardHeader title={`${auditLog.length} entries`} subtitle={`Most recent first · ${BACKEND_MODE === "supabase" ? "Supabase-backed (audit_logs table)" : "localStorage-backed"} · capped at 500`} />
        <CardBody className="p-0">
          {auditLog.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No audit entries yet. Visit /tenant-outreach or /recertification to populate.</p>
          ) : (
            <table className="bx">
              <thead>
                <tr>
                  <th>Time</th><th>User</th><th>Role</th><th>Page</th><th>Tenant</th><th>Field</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.map(e => (
                  <tr key={e.id}>
                    <td className="text-xs">{new Date(e.timestamp).toLocaleString()}</td>
                    <td>{e.userName}</td>
                    <td><Badge>{e.role}</Badge></td>
                    <td className="text-xs">{e.page}</td>
                    <td className="text-xs">{e.tenantId ?? "—"}</td>
                    <td className="text-xs">{e.fieldType}</td>
                    <td>
                      <Badge intent={e.action === "view" ? "good" : e.action === "redact" ? "warn" : "neutral"}>
                        {e.action}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </>
  );
}
