"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/layout/AdminShell";
import { ApiError, getAdminAuditLogs } from "@/lib/api";
import type { AuditLogEntry } from "@/lib/types";

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAdminAuditLogs()
      .then((res) => setLogs(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load audit trail."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AdminShell>
      <div className="ent-page-hdr">
        <h1>Audit Trail</h1>
        <p>Recent activity across every organization.</p>
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="ent-page-table">
        <table>
          <thead><tr><th>When</th><th>Organization</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="ent-empty">Loading…</td></tr>}
            {!loading && logs.length === 0 && <tr><td colSpan={5} className="ent-empty">Nothing logged yet.</td></tr>}
            {logs.map((l) => (
              <tr key={l.id}>
                <td style={{ color: "var(--color-muted)", whiteSpace: "nowrap" }}>{new Date(l.createdAt).toLocaleString()}</td>
                <td>{l.organization?.name ?? "—"}</td>
                <td style={{ color: "var(--color-muted)" }}>{l.actor?.email || l.actor?.phone || "—"}</td>
                <td><span className="badge badge-blue">{l.action} {l.entityType}</span></td>
                <td>{l.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
