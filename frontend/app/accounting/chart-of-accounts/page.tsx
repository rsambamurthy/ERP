"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { ApiError, createAccount, getAccounts, toggleAccount } from "@/lib/api";
import type { Account, AccountType } from "@/lib/types";

const ACCOUNT_TYPES: AccountType[] = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];

export default function ChartOfAccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    accountCode: "",
    accountName: "",
    accountType: "ASSET" as AccountType,
    subType: "",
    isControlAccount: false,
    defaultBpType: "CUSTOMER" as "CUSTOMER" | "VENDOR" | "ITEM",
  });

  async function load() {
    setLoading(true);
    try {
      const res = await getAccounts();
      setAccounts(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load chart of accounts.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createAccount({
        accountCode: form.accountCode,
        accountName: form.accountName,
        accountType: form.accountType,
        subType: form.subType || null,
        isControlAccount: form.isControlAccount,
        defaultBpType: form.isControlAccount ? form.defaultBpType : null,
      });
      setShowForm(false);
      setForm({ accountCode: "", accountName: "", accountType: "ASSET", subType: "", isControlAccount: false, defaultBpType: "CUSTOMER" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create account.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: string) {
    await toggleAccount(id);
    await load();
  }

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Chart of Accounts</h1>
        <p>Every account your organization posts to.</p>
      </div>

      <div className="ent-toolbar">
        <div style={{ flex: 1 }} />
        <button className="ent-btn-add" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "+ Add Account"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="ent-section">
          <div className="ent-section-hdr"><span className="ent-section-title">New Account</span></div>
          <div className="ent-form-grid">
            <div className="ent-fg">
              <label className="ent-fl">Account Code</label>
              <input className="ent-fc" value={form.accountCode} onChange={(e) => setForm((f) => ({ ...f, accountCode: e.target.value }))} required />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Account Name</label>
              <input className="ent-fc" value={form.accountName} onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))} required />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Account Type</label>
              <select className="ent-fc" value={form.accountType} onChange={(e) => setForm((f) => ({ ...f, accountType: e.target.value as AccountType }))}>
                {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Sub-type (optional)</label>
              <input className="ent-fc" value={form.subType} onChange={(e) => setForm((f) => ({ ...f, subType: e.target.value }))} />
            </div>
            <div className="ent-fg" style={{ gridColumn: "1 / -1" }}>
              <label className="ent-fl" style={{ textTransform: "none" }}>
                <input
                  type="checkbox"
                  checked={form.isControlAccount}
                  onChange={(e) => setForm((f) => ({ ...f, isControlAccount: e.target.checked }))}
                  style={{ marginRight: 6 }}
                />
                Control account (has a sub-ledger of customers/vendors/items)
              </label>
            </div>
            {form.isControlAccount && (
              <div className="ent-fg">
                <label className="ent-fl">Sub-ledger type</label>
                <select className="ent-fc" value={form.defaultBpType} onChange={(e) => setForm((f) => ({ ...f, defaultBpType: e.target.value as any }))}>
                  <option value="CUSTOMER">Customer</option>
                  <option value="VENDOR">Vendor</option>
                  <option value="ITEM">Item</option>
                </select>
              </div>
            )}
          </div>
          {error && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 10px" }}>{error}</p>}
          <div style={{ display: "flex", gap: 8, padding: "0 14px 14px" }}>
            <button type="submit" className="ent-btn-save" disabled={saving}>{saving ? "Saving…" : "Save Account"}</button>
          </div>
        </form>
      )}

      {error && !showForm && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="ent-page-table">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Type</th>
              <th>Control?</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="ent-empty">Loading…</td></tr>}
            {!loading && accounts.length === 0 && <tr><td colSpan={6} className="ent-empty">No accounts yet.</td></tr>}
            {accounts.map((a) => (
              <tr key={a.id}>
                <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--color-muted)" }}>{a.accountCode}</td>
                <td style={{ fontWeight: 500 }}>
                  {a.accountName}
                  {a.isSystem && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--color-muted)" }}>(system)</span>}
                </td>
                <td>{a.accountType}</td>
                <td>{a.isControlAccount ? a.defaultBpType : "—"}</td>
                <td>
                  <span className={a.isActive ? "badge badge-green" : "badge badge-gray"}>
                    {a.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>
                  {!a.isSystem && (
                    <button className="ent-ia ent-ia-edit" onClick={() => handleToggle(a.id)}>
                      {a.isActive ? "Deactivate" : "Activate"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
