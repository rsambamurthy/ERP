"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/layout/AdminShell";
import { ApiError, getAdminOrganizations, setOrgSubscription } from "@/lib/api";
import type { AdminOrganization } from "@/lib/types";

export default function AdminOrganizationsPage() {
  const [orgs, setOrgs] = useState<AdminOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await getAdminOrganizations();
      setOrgs(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load organizations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleToggle(org: AdminOrganization) {
    await setOrgSubscription(org.id, org.subscriptionStatus === "ACTIVE" ? "SUSPENDED" : "ACTIVE");
    await load();
  }

  return (
    <AdminShell>
      <div className="ent-page-hdr">
        <h1>Organizations</h1>
        <p>Every workspace signed up on SmartERP.</p>
      </div>

      <div className="grid-4" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="value">{orgs.length}</div>
          <div className="label">Total Organizations</div>
        </div>
        <div className="stat-card">
          <div className="value">{orgs.filter((o) => o.subscriptionStatus === "ACTIVE").length}</div>
          <div className="label">Active</div>
        </div>
        <div className="stat-card">
          <div className="value">{orgs.filter((o) => o.subscriptionStatus === "SUSPENDED").length}</div>
          <div className="label">Suspended</div>
        </div>
        <div className="stat-card">
          <div className="value">{orgs.reduce((s, o) => s + o.journalEntryCount, 0)}</div>
          <div className="label">Journal Entries Posted</div>
        </div>
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="ent-page-table">
        <table>
          <thead>
            <tr><th>Organization</th><th>Domains</th><th>Branches</th><th>Users</th><th>Status</th><th>Subscription</th><th>Signed up</th><th /></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="ent-empty">Loading…</td></tr>}
            {!loading && orgs.length === 0 && <tr><td colSpan={8} className="ent-empty">No organizations yet.</td></tr>}
            {orgs.map((o) => (
              <tr key={o.id}>
                <td style={{ fontWeight: 500 }}>{o.name}</td>
                <td style={{ color: "var(--color-muted)" }}>{o.domains.join(", ") || "—"}</td>
                <td>{o.branchCount}</td>
                <td>{o.userCount}</td>
                <td><span className="badge badge-gray">{o.status}</span></td>
                <td>
                  <span className={o.subscriptionStatus === "ACTIVE" ? "badge badge-green" : "badge badge-red"}>
                    {o.subscriptionStatus}
                  </span>
                </td>
                <td style={{ color: "var(--color-muted)" }}>{new Date(o.createdAt).toLocaleDateString()}</td>
                <td style={{ textAlign: "right" }}>
                  <button className="ent-ia ent-ia-edit" onClick={() => handleToggle(o)}>
                    {o.subscriptionStatus === "ACTIVE" ? "Suspend" : "Reactivate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
