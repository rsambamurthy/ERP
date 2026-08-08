"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { ApiError, createAccount, getAccounts, syncAccountTemplates, toggleAccount, updateAccount } from "@/lib/api";
import { useBulkUpload } from "@/components/shared/BulkUpload";
import { SCHEDULE_III_HEADS } from "@/lib/types";
import type { Account, AccountType, CoaUploadRow } from "@/lib/types";

const ACCOUNT_TYPES: AccountType[] = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];

const COA_UPLOAD_COLUMNS: { key: keyof CoaUploadRow; label: string }[] = [
  { key: "accountCode", label: "Code" },
  { key: "accountName", label: "Name" },
  { key: "accountType", label: "Type" },
  { key: "openingBalance", label: "Opening Balance" },
  { key: "openingBalanceType", label: "DR/CR" },
];

export default function ChartOfAccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const emptyForm = () => ({
    accountCode: "",
    accountName: "",
    accountType: "ASSET" as AccountType,
    subType: "",
    isControlAccount: false,
    defaultBpType: "CUSTOMER" as "CUSTOMER" | "VENDOR" | "ITEM",
    scheduleIiiHead: "",
  });
  const [form, setForm] = useState(emptyForm());

  // Schedule III heads only make sense for ASSET/LIABILITY/EQUITY, and only
  // the ones defined for the form's current account type.
  const availableHeads = SCHEDULE_III_HEADS.filter((h) => (h.accountTypes as string[]).includes(form.accountType));

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

  const bulk = useBulkUpload<CoaUploadRow>("accounts", "SmartERP_ChartOfAccounts_Template.xlsx", COA_UPLOAD_COLUMNS, load);

  function startNew() {
    setEditingId(null);
    setForm(emptyForm());
    setError(null);
    setShowForm(true);
  }

  function startEdit(a: Account) {
    setEditingId(a.id);
    setForm({
      accountCode: a.accountCode, accountName: a.accountName, accountType: a.accountType,
      subType: a.subType ?? "", isControlAccount: a.isControlAccount,
      defaultBpType: (a.defaultBpType ?? "CUSTOMER") as "CUSTOMER" | "VENDOR" | "ITEM",
      scheduleIiiHead: a.scheduleIiiHead ?? "",
    });
    setError(null);
    setShowForm(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = {
        accountName: form.accountName,
        subType: form.subType || null,
        isControlAccount: form.isControlAccount,
        defaultBpType: form.isControlAccount ? form.defaultBpType : null,
        scheduleIiiHead: form.scheduleIiiHead || null,
      };
      if (editingId) {
        await updateAccount(editingId, body);
      } else {
        await createAccount({ ...body, accountCode: form.accountCode, accountType: form.accountType });
      }
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm());
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save account.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: string) {
    await toggleAccount(id);
    await load();
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMessage(null);
    setError(null);
    try {
      const res = await syncAccountTemplates();
      setSyncMessage(
        res.data.added > 0
          ? `Added ${res.data.added} account${res.data.added === 1 ? "" : "s"} from the latest templates.`
          : "Already up to date — nothing to add."
      );
      if (res.data.added > 0) await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sync chart of accounts.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Chart of Accounts</h1>
        <p>Every account your organization posts to.</p>
      </div>

      <div className="ent-toolbar">
        <div style={{ flex: 1 }} />
        <button
          className="ent-btn-add"
          style={{ background: "#fff", color: "var(--color-navy, #1e3a5f)", border: "1px solid var(--color-border, #e2e8f0)" }}
          onClick={handleSync}
          disabled={syncing}
          title="Pick up any account added to the standard templates since this org was set up (e.g. GST Input/Output, COGS, Sales Revenue)"
        >
          {syncing ? "Syncing…" : "⟳ Sync from Templates"}
        </button>
        {bulk.buttons}
        <button className="ent-btn-add" onClick={() => (showForm ? setShowForm(false) : startNew())}>
          {showForm ? "Cancel" : "+ Add Account"}
        </button>
      </div>

      {bulk.panel}

      {showForm && (
        <form onSubmit={handleSave} className="ent-section">
          <div className="ent-section-hdr"><span className="ent-section-title">{editingId ? "Edit Account" : "New Account"}</span></div>
          <div className="ent-form-grid">
            <div className="ent-fg">
              <label className="ent-fl">Account Code</label>
              <input
                className="ent-fc" value={form.accountCode} disabled={!!editingId}
                onChange={(e) => setForm((f) => ({ ...f, accountCode: e.target.value }))} required
              />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Account Name</label>
              <input className="ent-fc" value={form.accountName} onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))} required />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Account Type</label>
              <select
                className="ent-fc" value={form.accountType} disabled={!!editingId}
                onChange={(e) => setForm((f) => ({ ...f, accountType: e.target.value as AccountType, scheduleIiiHead: "" }))}
              >
                {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Sub-type (optional)</label>
              <input className="ent-fc" value={form.subType} onChange={(e) => setForm((f) => ({ ...f, subType: e.target.value }))} />
            </div>
            {availableHeads.length > 0 && (
              <div className="ent-fg">
                <label className="ent-fl">Schedule III Head</label>
                <select className="ent-fc" value={form.scheduleIiiHead} onChange={(e) => setForm((f) => ({ ...f, scheduleIiiHead: e.target.value }))}>
                  <option value="">Not classified yet</option>
                  {availableHeads.map((h) => <option key={h.code} value={h.code}>{h.groupLabel} — {h.label}</option>)}
                </select>
              </div>
            )}
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
            <button type="submit" className="ent-btn-save" disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save Changes" : "Save Account"}
            </button>
          </div>
        </form>
      )}

      {error && !showForm && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {syncMessage && <p style={{ color: "#15803d", fontSize: 13, marginBottom: 12 }}>{syncMessage}</p>}

      <div className="ent-page-table">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Type</th>
              <th>Control?</th>
              <th>Schedule III Head</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="ent-empty">Loading…</td></tr>}
            {!loading && accounts.length === 0 && <tr><td colSpan={7} className="ent-empty">No accounts yet.</td></tr>}
            {accounts.map((a) => {
              const head = SCHEDULE_III_HEADS.find((h) => h.code === a.scheduleIiiHead);
              const needsHead = ["ASSET", "LIABILITY", "EQUITY"].includes(a.accountType);
              return (
                <tr key={a.id}>
                  <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--color-muted)" }}>{a.accountCode}</td>
                  <td style={{ fontWeight: 500 }}>
                    {a.accountName}
                    {a.isSystem && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--color-muted)" }}>(system)</span>}
                  </td>
                  <td>{a.accountType}</td>
                  <td>{a.isControlAccount ? a.defaultBpType : "—"}</td>
                  <td>
                    {head ? head.label : needsHead ? <span style={{ color: "#a16207", fontSize: 11 }}>⚠ not classified</span> : "—"}
                  </td>
                  <td>
                    <span className={a.isActive ? "badge badge-green" : "badge badge-gray"}>
                      {a.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="ent-ia ent-ia-edit" onClick={() => startEdit(a)}>Edit</button>
                    {!a.isSystem && (
                      <button className="ent-ia ent-ia-edit" onClick={() => handleToggle(a.id)}>
                        {a.isActive ? "Deactivate" : "Activate"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
