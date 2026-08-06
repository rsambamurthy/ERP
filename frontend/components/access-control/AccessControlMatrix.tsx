"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, getMenuConfigForOrg, saveMenuConfig } from "@/lib/api";
import { NAV_GROUPS } from "@/components/layout/navGroups";
import type { MenuConfigMap, OrgRole } from "@/lib/types";

const ROLE_LABEL: Record<OrgRole, string> = {
  OWNER: "Owner", ADMIN: "Admin", ACCOUNTANT: "Accountant", VIEWER: "Viewer",
};
const ROLE_ORDER: OrgRole[] = ["OWNER", "ADMIN", "ACCOUNTANT", "VIEWER"];

// Who sees what, per role — one matrix, reused for an OWNER/ADMIN configuring
// their own org (/settings/access-control) and a platform admin configuring
// any org (/admin/organizations/[id]/access-control). Ported from
// SmartAppt's WebMenuPage.tsx: the item catalogue comes straight from
// NAV_GROUPS (the same array the sidebar renders from), so this screen can
// never drift out of sync with what's actually in the app, and only cells
// that depart from an item's default `roles` are ever stored.
export default function AccessControlMatrix({ organizationId }: { organizationId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editableRoles, setEditableRoles] = useState<OrgRole[]>([]);
  const [draft, setDraft] = useState<MenuConfigMap>({});
  const [dirty, setDirty] = useState(false);
  const [role, setRole] = useState<OrgRole | null>(null);

  const items = useMemo(() => NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label }))), []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await getMenuConfigForOrg(organizationId);
      setDraft(res.data ?? {});
      setEditableRoles(res.editableRoles);
      setDirty(false);
      if (res.editableRoles.length && (!role || !res.editableRoles.includes(role))) {
        setRole(ROLE_ORDER.find((r) => res.editableRoles.includes(r)) ?? res.editableRoles[0]);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load access control settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [organizationId]);

  const isOn = (itemId: string, defaultRoles: OrgRole[]) => {
    if (!role) return false;
    const stored = draft[role]?.[itemId];
    if (stored !== undefined) return stored;
    return defaultRoles.includes(role);
  };
  const isOverridden = (itemId: string) => (role ? draft[role]?.[itemId] !== undefined : false);

  const toggle = (itemId: string, defaultRoles: OrgRole[]) => {
    if (!role) return;
    const current = isOn(itemId, defaultRoles);
    const next = !current;
    const isDefault = next === defaultRoles.includes(role);
    setDraft((prev) => {
      const forRole = { ...(prev[role] ?? {}) };
      if (isDefault) delete forRole[itemId];
      else forRole[itemId] = next;
      return { ...prev, [role]: forRole };
    });
    setDirty(true);
  };

  const resetRole = () => {
    if (!role) return;
    setDraft((prev) => {
      const next = { ...prev };
      delete next[role];
      return next;
    });
    setDirty(true);
  };

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const flat = Object.entries(draft).flatMap(([r, cells]) =>
        editableRoles.includes(r as OrgRole)
          ? Object.entries(cells).map(([itemId, enabled]) => ({ itemId, role: r as OrgRole, enabled }))
          : [],
      );
      const res = await saveMenuConfig(organizationId, flat);
      setDraft(res.data);
      setDirty(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save access control settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="ent-empty">Loading…</p>;
  if (editableRoles.length === 0) {
    return <p style={{ fontSize: 13, color: "var(--color-muted)" }}>Nothing here is configurable for your role.</p>;
  }

  return (
    <div>
      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="ent-toolbar" style={{ gap: 6 }}>
        {editableRoles.map((r) => (
          <button
            key={r}
            className="ent-ia ent-ia-edit"
            style={role === r ? { background: "var(--color-navy-800, #1e3a5f)", color: "#fff" } : undefined}
            onClick={() => setRole(r)}
          >
            {ROLE_LABEL[r]}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="ent-ia ent-ia-del" onClick={resetRole}>Reset {role ? ROLE_LABEL[role] : ""} to defaults</button>
        <button className="ent-btn-save" disabled={saving || !dirty} onClick={handleSave}>{saving ? "Saving…" : "Save"}</button>
      </div>

      <div className="ent-page-table">
        <table>
          <thead><tr><th>Item</th><th>Group</th><th style={{ textAlign: "right" }}>Visible to {role ? ROLE_LABEL[role] : ""}</th></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td style={{ fontWeight: 500 }}>
                  <span className="sa-dot" style={{ background: item.dot, marginRight: 8, display: "inline-block", width: 8, height: 8, borderRadius: "50%" }} />
                  {item.label}
                </td>
                <td style={{ color: "var(--color-muted)" }}>{item.group}</td>
                <td style={{ textAlign: "right" }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    {isOverridden(item.id) && <span className="badge badge-blue" style={{ fontSize: 10 }}>Override</span>}
                    <input
                      type="checkbox"
                      checked={isOn(item.id, item.roles)}
                      onChange={() => toggle(item.id, item.roles)}
                    />
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
