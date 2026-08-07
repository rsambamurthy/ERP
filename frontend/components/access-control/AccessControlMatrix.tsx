"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, getMenuConfigForOrg, saveMenuConfig } from "@/lib/api";
import { NAV_GROUPS, NavItem } from "@/components/layout/navGroups";
import type { EditableRoleOption, MenuConfigMap } from "@/lib/types";

// Auto-selected tab preference when the screen first loads — fixed roles in
// their usual hierarchy order, then whatever custom roles the org defined
// (in the order the backend already sorted them, alphabetical by name).
const FIXED_ORDER = ["OWNER", "ADMIN", "ACCOUNTANT", "VIEWER"];

// Who sees what, per role — one matrix, reused for an OWNER/ADMIN configuring
// their own org (/settings/access-control) and a platform admin configuring
// any org (/admin/organizations/[id]/access-control). Ported from
// SmartAppt's WebMenuPage.tsx: the item catalogue comes straight from
// NAV_GROUPS (the same array the sidebar renders from), so this screen can
// never drift out of sync with what's actually in the app, and only cells
// that depart from a role's default visibility are ever stored.
//
// A role's "default" (before any override) differs by kind: a fixed role's
// default is item.roles.includes(role) (navGroups.ts's baked-in list); a
// custom role's default is item.permission === undefined (universal item)
// or the role holds that permission — the same formula AppShell uses to
// decide what a custom-role user sees absent an explicit override, so the
// two stay consistent.
export default function AccessControlMatrix({ organizationId }: { organizationId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editableRoles, setEditableRoles] = useState<EditableRoleOption[]>([]);
  const [draft, setDraft] = useState<MenuConfigMap>({});
  const [dirty, setDirty] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  const items = useMemo(() => NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label }))), []);
  const selected = editableRoles.find((o) => o.value === role) ?? null;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await getMenuConfigForOrg(organizationId);
      setDraft(res.data ?? {});
      setEditableRoles(res.editableRoles);
      setDirty(false);
      if (res.editableRoles.length && (!role || !res.editableRoles.some((o) => o.value === role))) {
        const preferred = FIXED_ORDER.map((v) => res.editableRoles.find((o) => o.value === v)).find(Boolean);
        setRole((preferred ?? res.editableRoles[0]).value);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load access control settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [organizationId]);

  const defaultFor = (item: NavItem) => {
    if (!selected) return false;
    if (selected.permissions === null) return item.roles.includes(selected.value as any);
    return item.permission === undefined || selected.permissions.includes(item.permission);
  };

  const isOn = (item: NavItem) => {
    if (!role) return false;
    const stored = draft[role]?.[item.id];
    if (stored !== undefined) return stored;
    return defaultFor(item);
  };
  const isOverridden = (itemId: string) => (role ? draft[role]?.[itemId] !== undefined : false);

  const toggle = (item: NavItem) => {
    if (!role) return;
    const current = isOn(item);
    const next = !current;
    const isDefault = next === defaultFor(item);
    setDraft((prev) => {
      const forRole = { ...(prev[role] ?? {}) };
      if (isDefault) delete forRole[item.id];
      else forRole[item.id] = next;
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
        editableRoles.some((o) => o.value === r)
          ? Object.entries(cells).map(([itemId, enabled]) => ({ itemId, role: r, enabled }))
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

      <div className="ent-toolbar" style={{ gap: 6, flexWrap: "wrap" }}>
        {editableRoles.map((o) => (
          <button
            key={o.value}
            className="ent-ia ent-ia-edit"
            style={role === o.value ? { background: "var(--color-navy-800, #1e3a5f)", color: "#fff" } : undefined}
            onClick={() => setRole(o.value)}
          >
            {o.label}
            {o.permissions !== null && <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>(custom)</span>}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="ent-ia ent-ia-del" onClick={resetRole}>Reset {selected?.label ?? ""} to defaults</button>
        <button className="ent-btn-save" disabled={saving || !dirty} onClick={handleSave}>{saving ? "Saving…" : "Save"}</button>
      </div>

      <div className="ent-page-table">
        <table>
          <thead><tr><th>Item</th><th>Group</th><th style={{ textAlign: "right" }}>Visible to {selected?.label ?? ""}</th></tr></thead>
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
                      checked={isOn(item)}
                      onChange={() => toggle(item)}
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
