"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { ApiError, createJournalEntry, getAccounts, getBusinessPartners, getJournalEntries } from "@/lib/api";
import type { Account, BusinessPartner, JournalEntry, JournalLineInput } from "@/lib/types";

const selectClass =
  "rounded-lg border border-cream-200 bg-cream-50 px-3 py-2.5 text-sm outline-none focus:border-terracotta-400 focus:ring-1 focus:ring-terracotta-400";

const emptyLine = (): JournalLineInput => ({ accountId: "", businessPartnerId: null, debit: 0, credit: 0 });

export default function JournalEntriesPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [partners, setPartners] = useState<BusinessPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [voucherType, setVoucherType] = useState<"BV" | "CV" | "JV">("JV");
  const [lines, setLines] = useState<JournalLineInput[]>([emptyLine(), emptyLine()]);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const totals = useMemo(() => {
    const debit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const credit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.01 && debit > 0 };
  }, [lines]);

  async function loadAll() {
    setLoading(true);
    try {
      const [entriesRes, accountsRes, partnersRes] = await Promise.all([
        getJournalEntries(),
        getAccounts(),
        getBusinessPartners(),
      ]);
      setEntries(entriesRes.data);
      setAccounts(accountsRes.data);
      setPartners(partnersRes.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load journal entries.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  function updateLine(i: number, patch: Partial<JournalLineInput>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!totals.balanced) {
      setError("Entry isn't balanced — total debit must equal total credit.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createJournalEntry({
        entryDate,
        narration,
        voucherType,
        lines: lines.filter((l) => l.accountId),
      });
      setShowForm(false);
      setNarration("");
      setLines([emptyLine(), emptyLine()]);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post entry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-navy-800">Journal Entries</h1>
            <p className="text-sm text-gray-500">Every posted transaction, double-entry.</p>
          </div>
          <Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "New Entry"}</Button>
        </div>

        {showForm && (
          <form onSubmit={handleCreate} className="flex flex-col gap-4 rounded-2xl border border-cream-200 bg-white p-5 shadow-sm">
            <div className="grid gap-4 sm:grid-cols-3">
              <Input label="Entry Date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
              <div className="flex flex-col gap-1 text-left">
                <label className="text-xs font-semibold uppercase tracking-wide text-terracotta-600">Voucher Type</label>
                <select className={selectClass} value={voucherType} onChange={(e) => setVoucherType(e.target.value as any)}>
                  <option value="JV">Journal Voucher</option>
                  <option value="BV">Bank Voucher</option>
                  <option value="CV">Cash Voucher</option>
                </select>
              </div>
              <Input label="Narration" value={narration} onChange={(e) => setNarration(e.target.value)} required />
            </div>

            <div className="flex flex-col gap-2">
              {lines.map((line, i) => {
                const account = line.accountId ? accountById.get(line.accountId) : undefined;
                return (
                  <div key={i} className="grid items-end gap-2 sm:grid-cols-[2fr_1.5fr_1fr_1fr_auto]">
                    <div className="flex flex-col gap-1 text-left">
                      {i === 0 && <label className="text-xs font-semibold uppercase tracking-wide text-terracotta-600">Account</label>}
                      <select
                        className={selectClass}
                        value={line.accountId}
                        onChange={(e) => updateLine(i, { accountId: e.target.value, businessPartnerId: null })}
                      >
                        <option value="">Select account…</option>
                        {accounts.filter((a) => a.isActive && !a.isGroup).map((a) => (
                          <option key={a.id} value={a.id}>{a.accountCode} — {a.accountName}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1 text-left">
                      {i === 0 && <label className="text-xs font-semibold uppercase tracking-wide text-terracotta-600">Partner</label>}
                      <select
                        className={selectClass}
                        value={line.businessPartnerId ?? ""}
                        disabled={!account?.isControlAccount}
                        onChange={(e) => updateLine(i, { businessPartnerId: e.target.value || null })}
                      >
                        <option value="">{account?.isControlAccount ? "Select…" : "—"}</option>
                        {partners
                          .filter((p) => p.bpType === account?.defaultBpType)
                          .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1 text-left">
                      {i === 0 && <label className="text-xs font-semibold uppercase tracking-wide text-terracotta-600">Debit</label>}
                      <input
                        type="number" min={0} step="0.01" className={selectClass}
                        value={line.debit || ""}
                        onChange={(e) => updateLine(i, { debit: Number(e.target.value), credit: 0 })}
                      />
                    </div>
                    <div className="flex flex-col gap-1 text-left">
                      {i === 0 && <label className="text-xs font-semibold uppercase tracking-wide text-terracotta-600">Credit</label>}
                      <input
                        type="number" min={0} step="0.01" className={selectClass}
                        value={line.credit || ""}
                        onChange={(e) => updateLine(i, { credit: Number(e.target.value), debit: 0 })}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                      disabled={lines.length <= 2}
                      className="h-10 text-xs text-gray-400 hover:text-red-600 disabled:opacity-30"
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => setLines((ls) => [...ls, emptyLine()])}
                className="self-start text-sm font-medium text-terracotta-600 hover:underline"
              >
                + Add line
              </button>
            </div>

            <div className="flex items-center justify-between rounded-lg bg-cream-50 px-4 py-2 text-sm">
              <span>Total Debit: <strong>{totals.debit.toFixed(2)}</strong></span>
              <span>Total Credit: <strong>{totals.credit.toFixed(2)}</strong></span>
              <span className={totals.balanced ? "text-green-600" : "text-red-600"}>
                {totals.balanced ? "Balanced" : "Not balanced"}
              </span>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            <div><Button type="submit" loading={saving} disabled={!totals.balanced}>Post Entry</Button></div>
          </form>
        )}

        {error && !showForm && <p className="text-sm text-red-600">{error}</p>}

        <div className="overflow-hidden rounded-2xl border border-cream-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-cream-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Narration</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">Loading…</td></tr>}
              {!loading && entries.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">No entries yet.</td></tr>
              )}
              {entries.map((e) => {
                const amount = e.journalLines.reduce((s, l) => s + Number(l.debit || 0), 0);
                return (
                  <tr key={e.id} className="border-t border-cream-100">
                    <td className="px-4 py-2.5 text-gray-500">{new Date(e.entryDate).toLocaleDateString()}</td>
                    <td className="px-4 py-2.5 font-medium text-navy-800">{e.narration}</td>
                    <td className="px-4 py-2.5 text-gray-500">{e.voucherType || "JV"}</td>
                    <td className="px-4 py-2.5 text-right">{amount.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
