"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import {
  ApiError, cancelInvite, createOrgRole, deleteOrgRole, getOrgRoles, getOrgUsers,
  inviteUser, removeMember, updateMemberRole, updateOrgRole,
} from "@/lib/api";
import { PERMISSIONS, PERMISSION_LABELS } from "@/lib/types";
import type { CustomRole, OrgRole, OrgUsersResponse, Permission } from "@/lib/types";

const FIXED_ROLES: OrgRole[] = ["ADMIN", "ACCOUNTANT", "VIEWER"];

// The invite/role-change <select> needs one flat list of options mixing the
// three fixed roles with however many custom roles the org has defined.
// Encode a custom role's option value as "custom:<id>" so a single onChange
// can tell the two apart without a second control.
function roleValue(role: OrgRole, customRoleId: string | null): string {
  return role === "CUSTOM" && customRoleId ? `custom:${customRoleId}` : role;
}
function parseRoleValue(value: string): { role: OrgRole; customRoleId?: string } {
  if (value.startsWith("custom:")) return { role: "CUSTOM", customRoleId: value.slice(7) };
  return { role: value as OrgRole };
}

export default function TeamPage() {
  const [data, setData] = useState<OrgUsersResponse | null>(null);
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);

  const [form, setForm] = useState<{ identifier: string; roleValue: string }>({ identifier: "", roleValue: "ACCOUNTANT" });

  // Roles management (create/edit/delete custom roles)
  const [showRoles, setShowRoles] = useState(false);
  const [roleForm, setRoleForm] = useState<{ id: string | null; name: string; permissions: Permission[] }>({
    id: null, name: "", permissions: [],
  });
  const [showRoleForm, setShowRoleForm] = useState(false);
  const [roleSaving, setRoleSaving] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [users, roles] = await Promise.all([getOrgUsers(), getOrgRoles()]);
      setData(users.data);
      setCustomRoles(roles.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load team.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const roleOptions: { value: string; label: string }[] = [
    ...FIXED_ROLES.map((r) => ({ value: r, label: r })),
    ...customRoles.map((r) => ({ value: `custom:${r.id}`, label: r.name })),
  ];

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setLastInviteLink(null);
    try {
      const isEmail = form.identifier.includes("@");
      const { role, customRoleId } = parseRoleValue(form.roleValue);
      const res = await inviteUser({
        role, customRoleId,
        ...(isEmail ? { email: form.identifier } : { phone: form.identifier }),
      });
      if (res.devInviteToken) {
        setLastInviteLink(`${window.location.origin}/accept-invite?token=${res.devInviteToken}`);
      }
      setShowForm(false);
      setForm({ identifier: "", roleValue: "ACCOUNTANT" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send invite.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRoleChange(userId: string, value: string) {
    const { role, customRoleId } = parseRoleValue(value);
    await updateMemberRole(userId, role, customRoleId);
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

  function startNewRole() {
    setRoleForm({ id: null, name: "", permissions: [] });
    setRoleError(null);
    setShowRoleForm(true);
  }

  function startEditRole(role: CustomRole) {
    setRoleForm({ id: role.id, name: role.name, permissions: [...role.permissions] });
    setRoleError(null);
    setShowRoleForm(true);
  }

  function togglePermission(p: Permission) {
    setRoleForm((f) => ({
      ...f,
      permissions: f.permissions.includes(p) ? f.permissions.filter((x) => x !== p) : [...f.permissions, p],
    }));
  }

  async function handleSaveRole(e: React.FormEvent) {
    e.preventDefault();
    setRoleSaving(true);
    setRoleError(null);
    try {
      if (roleForm.id) {
        await updateOrgRole(roleForm.id, { name: roleForm.name, permissions: roleForm.permissions });
      } else {
        await createOrgRole({ name: roleForm.name, permissions: roleForm.permissions });
      }
      setShowRoleForm(false);
      await load();
    } catch (err) {
      setRoleError(err instanceof ApiError ? err.message : "Could not save role.");
    } finally {
      setRoleSaving(false);
    }
  }

  async function handleDeleteRole(id: string) {
    setRoleError(null);
    try {
      await deleteOrgRole(id);
      await load();
    } catch (err) {
      setRoleError(err instanceof ApiError ? err.message : "Could not delete role.");
    }
  }

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Team</h1>
        <p>Who can log in, and what they can do.</p>
      </div>

      <div className="ent-toolbar">
        <div style={{ flex: 1 }} />
        <button
          className="ent-btn-add"
          style={{ background: "#fff", color: "var(--color-navy, #1e3a5f)", border: "1px solid var(--color-border, #e2e8f0)" }}
          onClick={() => setShowRoles((s) => !s)}
        >
          {showRoles ? "Hide Roles" : "Manage Roles"}
        </button>
        <button className="ent-btn-add" onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "+ Invite"}</button>
      </div>

      {showRoles && (
        <div className="ent-section" style={{ marginBottom: 20 }}>
          <div className="ent-section-hdr">
            <span className="ent-section-title">Custom Roles</span>
          </div>
          <div style={{ padding: 14 }}>
            <p style={{ fontSize: 13, color: "var(--color-muted)", marginBottom: 12 }}>
              OWNER/ADMIN/ACCOUNTANT/VIEWER are fixed and always available. Define additional roles here — each
              one gets exactly the permissions you check below, nothing more. Team and role management stay
              OWNER/ADMIN-only regardless.
            </p>

            {roleError && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>{roleError}</p>}

            {customRoles.length > 0 && (
              <div className="ent-page-table" style={{ marginBottom: 12 }}>
                <table>
                  <thead><tr><th>Role</th><th>Permissions</th><th /></tr></thead>
                  <tbody>
                    {customRoles.map((r) => (
                      <tr key={r.id}>
                        <td style={{ fontWeight: 500 }}>{r.name}</td>
                        <td style={{ fontSize: 12, color: "var(--color-muted)" }}>
                          {r.permissions.length ? r.permissions.map((p) => PERMISSION_LABELS[p]).join(", ") : "None"}
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <button className="ent-ia ent-ia-edit" onClick={() => startEditRole(r)}>Edit</button>
                          <button className="ent-ia ent-ia-del" onClick={() => handleDeleteRole(r.id)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!showRoleForm && (
              <button className="ent-btn-add" onClick={startNewRole}>+ New Role</button>
            )}

            {showRoleForm && (
              <form onSubmit={handleSaveRole} style={{ border: "1px solid var(--color-border, #e2e8f0)", borderRadius: 8, padding: 14 }}>
                <div className="ent-fg" style={{ marginBottom: 10 }}>
                  <label className="ent-fl">Role Name</label>
                  <input
                    className="ent-fc"
                    value={roleForm.name}
                    onChange={(e) => setRoleForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Sales Clerk"
                    required
                  />
                </div>
                <div className="ent-fg" style={{ marginBottom: 12 }}>
                  <label className="ent-fl" style={{ marginBottom: 6, display: "block" }}>Permissions</label>
                  {PERMISSIONS.map((p) => (
                    <label key={p} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 6, textTransform: "none" }}>
                      <input type="checkbox" checked={roleForm.permissions.includes(p)} onChange={() => togglePermission(p)} />
                      {PERMISSION_LABELS[p]}
                    </label>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="submit" className="ent-btn-save" disabled={roleSaving}>
                    {roleSaving ? "Saving…" : roleForm.id ? "Save Changes" : "Create Role"}
                  </button>
                  <button type="button" className="ent-ia" onClick={() => setShowRoleForm(false)}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

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
              <select className="ent-fc" value={form.roleValue} onChange={(e) => setForm((f) => ({ ...f, roleValue: e.target.value }))}>
                {roleOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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
                <td style={{ fontWeight: 500 }}>
                  {m.name || m.email || m.phone}
                  {m.name && <div style={{ fontWeight: 400, fontSize: 12, color: "var(--color-muted)" }}>{m.email || m.phone}</div>}
                </td>
                <td>
                  {m.role === "OWNER" ? (
                    <span className="badge badge-purple">OWNER</span>
                  ) : (
                    <select
                      className="ent-fc"
                      style={{ height: 30, width: 160 }}
                      value={roleValue(m.role, m.customRoleId)}
                      onChange={(e) => handleRoleChange(m.userId, e.target.value)}
                    >
                      {roleOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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
                  <td><span className="badge badge-blue">{i.role === "CUSTOM" ? i.customRoleName ?? "Custom" : i.role}</span></td>
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
