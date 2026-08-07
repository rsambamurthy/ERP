"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AdminShell from "@/components/layout/AdminShell";
import {
  ApiError, deleteAdminOrganization, getAdminOrganization, setOrgSubscription, updateAdminOrganization,
} from "@/lib/api";
import type { AdminOrganizationDetail } from "@/lib/types";

// The platform-admin equivalent of SmartAppt's AssociationDetailPage: team,
// branches, and module standing for one org, plus the lifecycle actions
// (suspend/reactivate, rename, permanently delete) a superuser needs when
// actually operating the platform rather than just watching it.
export default function AdminOrganizationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [org, setOrg] = useState<AdminOrganizationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await getAdminOrganization(id);
      setOrg(res.data);
      setNameDraft(res.data.name);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this organization.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [id]);

  async function handleToggleSubscription() {
    if (!org) return;
    await setOrgSubscription(org.id, org.subscriptionStatus === "ACTIVE" ? "SUSPENDED" : "ACTIVE");
    await load();
  }

  async function handleSaveName() {
    if (!org || !nameDraft.trim()) return;
    await updateAdminOrganization(org.id, nameDraft.trim());
    setEditingName(false);
    await load();
  }

  async function handleDelete() {
    if (!org) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteAdminOrganization(org.id);
      router.push("/admin");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete this organization.");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (loading) {
    return <AdminShell><p className="ent-empty">Loading…</p></AdminShell>;
  }
  if (!org) {
    return <AdminShell><p style={{ color: "#dc2626", fontSize: 13 }}>{error ?? "Organization not found."}</p></AdminShell>;
  }

  return (
    <AdminShell>
      <div className="ent-page-hdr">
        {editingName ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input className="ent-fc" style={{ maxWidth: 320 }} value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
            <button className="ent-btn-save" onClick={handleSaveName}>Save</button>
            <button className="ent-ia ent-ia-del" onClick={() => { setEditingName(false); setNameDraft(org.name); }}>Cancel</button>
          </div>
        ) : (
          <h1>
            {org.name}{" "}
            <button className="ent-ia ent-ia-edit" onClick={() => setEditingName(true)}>Rename</button>
          </h1>
        )}
        <p>Signed up {new Date(org.createdAt).toLocaleDateString()} · Status <span className="badge badge-gray">{org.status}</span></p>
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="grid-4" style={{ marginBottom: 20 }}>
        <div className="stat-card"><div className="value">{org.branches.length}</div><div className="label">Branches</div></div>
        <div className="stat-card"><div className="value">{org.users.length}</div><div className="label">Team Members</div></div>
        <div className="stat-card"><div className="value">{org.counts.accounts}</div><div className="label">Chart of Accounts</div></div>
        <div className="stat-card"><div className="value">{org.counts.journalEntries}</div><div className="label">Journal Entries</div></div>
      </div>

      <div className="ent-section" style={{ marginBottom: 20, padding: 14 }}>
        <div className="ent-section-hdr"><span className="ent-section-title">Subscription</span></div>
        <p style={{ fontSize: 13, color: "var(--color-muted)", margin: "8px 0" }}>
          Org-wide access switch. When suspended, every accounting endpoint returns "subscription suspended" for this org's own users.
        </p>
        <span className={org.subscriptionStatus === "ACTIVE" ? "badge badge-green" : "badge badge-red"} style={{ marginRight: 12 }}>
          {org.subscriptionStatus}
        </span>
        <button className="ent-ia ent-ia-edit" onClick={handleToggleSubscription}>
          {org.subscriptionStatus === "ACTIVE" ? "Suspend" : "Reactivate"}
        </button>
        <Link href={`/admin/organizations/${org.id}/access-control`} className="ent-ia ent-ia-edit" style={{ marginLeft: 8 }}>
          Access Control
        </Link>
      </div>

      <div className="ent-page-table" style={{ marginBottom: 20 }}>
        <div className="ent-section-hdr"><span className="ent-section-title">Domains</span></div>
        <table>
          <thead><tr><th>Domain</th><th>Added</th></tr></thead>
          <tbody>
            {org.domains.length === 0 && <tr><td colSpan={2} className="ent-empty">No domain selected yet.</td></tr>}
            {org.domains.map((d) => (
              <tr key={d.code}><td>{d.name}</td><td style={{ color: "var(--color-muted)" }}>{new Date(d.addedAt).toLocaleDateString()}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ent-page-table" style={{ marginBottom: 20 }}>
        <div className="ent-section-hdr"><span className="ent-section-title">Modules</span></div>
        <table>
          <thead><tr><th>Module</th><th>Status</th><th>Expires</th></tr></thead>
          <tbody>
            {org.modules.length === 0 && <tr><td colSpan={3} className="ent-empty">No modules granted — see the Subscriptions console.</td></tr>}
            {org.modules.map((m) => (
              <tr key={m.code}>
                <td>{m.name}</td>
                <td>
                  <span className={m.status === "ACTIVE" ? "badge badge-green" : m.status === "TRIAL" ? "badge badge-blue" : "badge badge-red"}>
                    {m.status}
                  </span>
                </td>
                <td style={{ color: "var(--color-muted)" }}>{m.expiresOn ? new Date(m.expiresOn).toLocaleDateString() : "Perpetual"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ent-page-table" style={{ marginBottom: 20 }}>
        <div className="ent-section-hdr"><span className="ent-section-title">Branches</span></div>
        <table>
          <thead><tr><th>Code</th><th>Name</th><th>Status</th></tr></thead>
          <tbody>
            {org.branches.length === 0 && <tr><td colSpan={3} className="ent-empty">No branches yet.</td></tr>}
            {org.branches.map((b) => (
              <tr key={b.id}>
                <td>{b.code}</td>
                <td>{b.name}{b.isHeadOffice && <span className="badge badge-purple" style={{ marginLeft: 6 }}>HO</span>}</td>
                <td><span className="badge badge-gray">{b.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ent-page-table" style={{ marginBottom: 20 }}>
        <div className="ent-section-hdr"><span className="ent-section-title">Team</span></div>
        <table>
          <thead><tr><th>Member</th><th>Role</th><th>Status</th></tr></thead>
          <tbody>
            {org.users.length === 0 && <tr><td colSpan={3} className="ent-empty">No team members yet.</td></tr>}
            {org.users.map((u) => (
              <tr key={u.userId}>
                <td>{u.email || u.phone}</td>
                <td><span className={u.role === "OWNER" ? "badge badge-purple" : "badge badge-blue"}>{u.role === "CUSTOM" ? u.customRoleName ?? "Custom" : u.role}</span></td>
                <td><span className={u.isVerified ? "badge badge-green" : "badge badge-yellow"}>{u.isVerified ? "Active" : "Pending"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ent-section" style={{ padding: 14, borderColor: "#fecaca" }}>
        <div className="ent-section-hdr"><span className="ent-section-title" style={{ color: "#dc2626" }}>Danger zone</span></div>
        <p style={{ fontSize: 13, color: "var(--color-muted)", margin: "8px 0" }}>
          Permanently deletes this organization and all its data. Only possible once it's suspended and has no posted journal entries — export its books first.
        </p>
        {!confirmDelete ? (
          <button className="ent-ia ent-ia-del" onClick={() => setConfirmDelete(true)}>Delete organization…</button>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 13 }}>Are you sure? This can't be undone.</span>
            <button className="ent-ia ent-ia-del" disabled={deleting} onClick={handleDelete}>
              {deleting ? "Deleting…" : "Yes, permanently delete"}
            </button>
            <button className="ent-ia ent-ia-edit" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
