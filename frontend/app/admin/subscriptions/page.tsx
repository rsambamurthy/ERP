"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/layout/AdminShell";
import { ApiError, cancelModule, getAdminSubscriptions, grantModule } from "@/lib/api";
import type { ModuleCatalogItem, SubscriptionOrgRow } from "@/lib/types";

const FILTERS = ["ALL", "EXPIRING", "LAPSED", "TRIAL", "UNSUBSCRIBED"] as const;

// One row per org, one column per module — the platform-admin billing
// console, mirroring SmartAppt's /admin/subscriptions. Grant/renew opens an
// inline form for that org+module; cancel is one click (soft — sets the row
// to CANCELLED rather than deleting it).
export default function AdminSubscriptionsPage() {
  const [rows, setRows] = useState<SubscriptionOrgRow[]>([]);
  const [catalog, setCatalog] = useState<ModuleCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [grantTarget, setGrantTarget] = useState<{ orgId: string; orgName: string; moduleCode: string; moduleName: string } | null>(null);
  const [grantForm, setGrantForm] = useState<{ status: "ACTIVE" | "TRIAL"; expiresOn: string; perpetual: boolean; amount: string; reference: string; note: string }>({
    status: "ACTIVE", expiresOn: "", perpetual: true, amount: "", reference: "", note: "",
  });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await getAdminSubscriptions({ q: q || undefined, filter });
      setRows(res.data);
      setCatalog(res.catalog);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load subscriptions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [filter]);

  function statusFor(row: SubscriptionOrgRow, code: string) {
    return row.modules.find((m) => m.code === code);
  }

  function openGrant(orgId: string, orgName: string, moduleCode: string, moduleName: string) {
    const existing = rows.find((r) => r.id === orgId)?.modules.find((m) => m.code === moduleCode);
    setGrantForm({
      status: existing?.status === "TRIAL" ? "TRIAL" : "ACTIVE",
      expiresOn: existing?.expiresOn ? existing.expiresOn.slice(0, 10) : "",
      perpetual: !existing?.expiresOn,
      amount: existing?.amount != null ? String(existing.amount) : "",
      reference: "", note: "",
    });
    setGrantTarget({ orgId, orgName, moduleCode, moduleName });
  }

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault();
    if (!grantTarget) return;
    setSaving(true);
    try {
      await grantModule(grantTarget.orgId, grantTarget.moduleCode, {
        status: grantForm.status,
        expiresOn: grantForm.perpetual ? null : grantForm.expiresOn,
        amount: grantForm.amount ? Number(grantForm.amount) : null,
        reference: grantForm.reference || undefined,
        note: grantForm.note || undefined,
      });
      setGrantTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the module grant.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(orgId: string, moduleCode: string) {
    await cancelModule(orgId, moduleCode);
    await load();
  }

  return (
    <AdminShell>
      <div className="ent-page-hdr">
        <h1>Subscriptions</h1>
        <p>Grant, renew, or cancel a module for any organization.</p>
      </div>

      <div className="ent-toolbar" style={{ gap: 8, flexWrap: "wrap" }}>
        <form onSubmit={(e) => { e.preventDefault(); load(); }} style={{ display: "flex", gap: 8 }}>
          <input className="ent-fc" style={{ maxWidth: 240 }} placeholder="Search by org name…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit" className="ent-btn-add">Search</button>
        </form>
        <div style={{ flex: 1 }} />
        <select className="ent-fc" style={{ width: 160 }} value={filter} onChange={(e) => setFilter(e.target.value as (typeof FILTERS)[number])}>
          {FILTERS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="ent-page-table">
        <table>
          <thead>
            <tr>
              <th>Organization</th>
              {catalog.map((m) => <th key={m.code}>{m.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={catalog.length + 1} className="ent-empty">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={catalog.length + 1} className="ent-empty">No organizations match.</td></tr>}
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={{ fontWeight: 500 }}>{row.name}</td>
                {catalog.map((m) => {
                  const status = statusFor(row, m.code);
                  return (
                    <td key={m.code}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {status ? (
                          <span className={status.status === "ACTIVE" ? "badge badge-green" : status.status === "TRIAL" ? "badge badge-blue" : "badge badge-red"}>
                            {status.status}
                          </span>
                        ) : (
                          <span className="badge badge-gray">None</span>
                        )}
                        <button className="ent-ia ent-ia-edit" onClick={() => openGrant(row.id, row.name, m.code, m.name)}>
                          {status ? "Renew" : "Grant"}
                        </button>
                        {status && status.status !== "CANCELLED" && (
                          <button className="ent-ia ent-ia-del" onClick={() => handleCancel(row.id, m.code)}>Cancel</button>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {grantTarget && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
          <form onSubmit={handleGrant} className="ent-section" style={{ width: 380, padding: 16, background: "#fff" }}>
            <div className="ent-section-hdr">
              <span className="ent-section-title">{grantTarget.moduleName} — {grantTarget.orgName}</span>
            </div>
            <div className="ent-form-grid" style={{ gridTemplateColumns: "1fr", gap: 10, marginTop: 10 }}>
              <div className="ent-fg">
                <label className="ent-fl">Status</label>
                <select className="ent-fc" value={grantForm.status} onChange={(e) => setGrantForm((f) => ({ ...f, status: e.target.value as "ACTIVE" | "TRIAL" }))}>
                  <option value="ACTIVE">Active</option>
                  <option value="TRIAL">Trial</option>
                </select>
              </div>
              <div className="ent-fg">
                <label className="ent-fl">
                  <input type="checkbox" checked={grantForm.perpetual} onChange={(e) => setGrantForm((f) => ({ ...f, perpetual: e.target.checked }))} /> Perpetual (no expiry)
                </label>
              </div>
              {!grantForm.perpetual && (
                <div className="ent-fg">
                  <label className="ent-fl">Expires on</label>
                  <input type="date" className="ent-fc" value={grantForm.expiresOn} onChange={(e) => setGrantForm((f) => ({ ...f, expiresOn: e.target.value }))} required={!grantForm.perpetual} />
                </div>
              )}
              <div className="ent-fg">
                <label className="ent-fl">Amount (optional)</label>
                <input type="number" step="0.01" className="ent-fc" value={grantForm.amount} onChange={(e) => setGrantForm((f) => ({ ...f, amount: e.target.value }))} />
              </div>
              <div className="ent-fg">
                <label className="ent-fl">Reference (optional)</label>
                <input className="ent-fc" value={grantForm.reference} onChange={(e) => setGrantForm((f) => ({ ...f, reference: e.target.value }))} placeholder="Invoice / payment ref" />
              </div>
              <div className="ent-fg">
                <label className="ent-fl">Note (optional)</label>
                <input className="ent-fc" value={grantForm.note} onChange={(e) => setGrantForm((f) => ({ ...f, note: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button type="submit" className="ent-btn-save" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
              <button type="button" className="ent-ia ent-ia-del" onClick={() => setGrantTarget(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </AdminShell>
  );
}
