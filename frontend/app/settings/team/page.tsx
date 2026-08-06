"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { ApiError, cancelInvite, getOrgUsers, inviteUser, removeMember, updateMemberRole } from "@/lib/api";
import type { OrgRole, OrgUsersResponse } from "@/lib/types";

const ROLES: OrgRole[] = ["ADMIN", "ACCOUNTANT", "VIEWER"];

export default function TeamPage() {
  const [data, setData] = useState<OrgUsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);

  const [form, setForm] = useState<{ identifier: string; role: OrgRole }>({ identifier: "", role: "ACCOUNTANT" });

  async function load() {
    setLoading(true);
    try {
      const res = await getOrgUsers();
      setData(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load team.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setLastInviteLink(null);
    try {
      const isEmail = form.identifier.includes("@");
      const res = await inviteUser({
        role: form.role,
        ...(isEmail ? { email: form.identifier } : { phone: form.identifier }),
      });
      if (res.devInviteToken) {
        setLastInviteLink(`${window.location.origin}/accept-invite?token=${res.devInviteToken}`);
      }
      setShowForm(false);
      setForm({ identifier: "", role: "ACCOUNTANT" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send invite.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRoleChange(userId: string, role: OrgRole) {
    await updateMemberRole(userId, role);
    await load();
  }

  async function handleRemove(userId: string) {
    await removeMember(userId);
    await load();
  }

  async function handleCancelInvite(id: string) {
    await cancelInvite(id);
    await load();
  }

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Team</h1>
        <p>Who can log in, and what they can do.</p>
      </div>

      <div className="ent-toolbar">
        <div style={{ flex: 1 }} />
        <button className="ent-btn-add" onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "+ Invite"}</button>
      </div>

      {showForm && (
        <form onSubmit={handleInvite} className="ent-section">
          <div className="ent-section-hdr"><span className="ent-section-title">Invite a teammate</span></div>
          <div className="ent-form-grid">
            <div className="ent-fg">
              <label className="ent-fl">Email or Phone</label>
              <input className="ent-fc" value={form.identifier} onChange={(e) => setForm((f) => ({ ...f, identifier: e.target.value }))} required />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Role</label>
              <select className="ent-fc" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as OrgRole }))}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          {error && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 10px" }}>{error}</p>}
          <div style={{ padding: "0 14px 14px" }}>
            <button type="submit" className="ent-btn-save" disabled={saving}>{saving ? "Sending…" : "Send Invite"}</button>
          </div>
        </form>
      )}

      {lastInviteLink && (
        <div className="ent-section" style={{ padding: 14 }}>
          <p style={{ fontSize: 13, color: "var(--color-muted)", marginBottom: 6 }}>
            No email/SMS provider is wired up yet — share this link with them directly:
          </p>
          <code style={{ fontSize: 12, wordBreak: "break-all" }}>{lastInviteLink}</code>
        </div>
      )}

      {error && !showForm && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="ent-page-table" style={{ marginBottom: 20 }}>
        <table>
          <thead><tr><th>Member</th><th>Role</th><th>Status</th><th /></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={4} className="ent-empty">Loading…</td></tr>}
            {data?.members.map((m) => (
              <tr key={m.userId}>
                <td style={{ fontWeight: 500 }}>{m.email || m.phone}</td>
                <td>
                  {m.role === "OWNER" ? (
                    <span className="badge badge-purple">OWNER</span>
                  ) : (
                    <select className="ent-fc" style={{ height: 30, width: 140 }} value={m.role} onChange={(e) => handleRoleChange(m.userId, e.target.value as OrgRole)}>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  )}
                </td>
                <td><span className={m.isVerified ? "badge badge-green" : "badge badge-yellow"}>{m.isVerified ? "Active" : "Pending verification"}</span></td>
                <td style={{ textAlign: "right" }}>
                  {m.role !== "OWNER" && (
                    <button className="ent-ia ent-ia-del" onClick={() => handleRemove(m.userId)}>Remove</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.invites.length > 0 && (
        <div className="ent-page-table">
          <table>
            <thead><tr><th>Pending Invite</th><th>Role</th><th>Expires</th><th /></tr></thead>
            <tbody>
              {data.invites.map((i) => (
                <tr key={i.id}>
                  <td>{i.email || i.phone}</td>
                  <td><span className="badge badge-blue">{i.role}</span></td>
                  <td style={{ color: "var(--color-muted)" }}>{new Date(i.expiresAt).toLocaleDateString()}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="ent-ia ent-ia-del" onClick={() => handleCancelInvite(i.id)}>Cancel</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
