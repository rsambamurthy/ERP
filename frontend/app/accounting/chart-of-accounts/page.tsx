"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { ApiError, createAccount, getAccounts, toggleAccount } from "@/lib/api";
import type { Account, AccountType } from "@/lib/types";

const ACCOUNT_TYPES: AccountType[] = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];
const selectClass =
  "rounded-lg border border-cream-200 bg-cream-50 px-3 py-2.5 text-sm outline-none focus:border-terracotta-400 focus:ring-1 focus:ring-terracotta-400";

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

  useEffect(() => {
    load();
  }, []);

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
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-navy-800">Chart of Accounts</h1>
            <p className="text-sm text-gray-500">Every account your organization posts to.</p>
          </div>
          <Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "Add Account"}</Button>
        </div>

        {showForm && (
          <form
            onSubmit={handleCreate}
            className="flex flex-col gap-4 rounded-2xl border border-cream-200 bg-white p-5 shadow-sm"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Account Code"
                value={form.accountCode}
                onChange={(e) => setForm((f) => ({ ...f, accountCode: e.target.value }))}
                required
              />
              <Input
                label="Account Name"
                value={form.accountName}
                onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))}
                required
              />
              <div className="flex flex-col gap-1 text-left">
                <label className="text-xs font-semibold uppercase tracking-wide text-terracotta-600">
                  Account Type
                </label>
                <select
                  className={selectClass}
                  value={form.accountType}
                  onChange={(e) => setForm((f) => ({ ...f, accountType: e.target.value as AccountType }))}
                >
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <Input
                label="Sub-type (optional)"
                value={form.subType}
                onChange={(e) => setForm((f) => ({ ...f, subType: e.target.value }))}
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-navy-800">
              <input
                type="checkbox"
                checked={form.isControlAccount}
                onChange={(e) => setForm((f) => ({ ...f, isControlAccount: e.target.checked }))}
              />
              Control account (has a sub-ledger of customers/vendors/items)
            </label>

            {form.isControlAccount && (
              <div className="flex flex-col gap-1 text-left sm:w-64">
                <label className="text-xs font-semibold uppercase tracking-wide text-terracotta-600">
                  Sub-ledger type
                </label>
                <select
                  className={selectClass}
                  value={form.defaultBpType}
                  onChange={(e) => setForm((f) => ({ ...f, defaultBpType: e.target.value as any }))}
                >
                  <option value="CUSTOMER">Customer</option>
                  <option value="VENDOR">Vendor</option>
                  <option value="ITEM">Item</option>
                </select>
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
            <div>
              <Button type="submit" loading={saving}>Save Account</Button>
            </div>
          </form>
        )}

        {error && !showForm && <p className="text-sm text-red-600">{error}</p>}

        <div className="overflow-hidden rounded-2xl border border-cream-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-cream-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Control?</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Loading…</td></tr>
              )}
              {!loading && accounts.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">No accounts yet.</td></tr>
              )}
              {accounts.map((a) => (
                <tr key={a.id} className="border-t border-cream-100">
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{a.accountCode}</td>
                  <td className="px-4 py-2.5 font-medium text-navy-800">
                    {a.accountName}
                    {a.isSystem && <span className="ml-2 text-xs text-gray-400">(system)</span>}
                  </td>
                  <td className="px-4 py-2.5">{a.accountType}</td>
                  <td className="px-4 py-2.5">{a.isControlAccount ? a.defaultBpType : "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className={a.isActive ? "text-green-600" : "text-gray-400"}>
                      {a.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {!a.isSystem && (
                      <button
                        onClick={() => handleToggle(a.id)}
                        className="text-xs font-medium text-terracotta-600 hover:underline"
                      >
                        {a.isActive ? "Deactivate" : "Activate"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
