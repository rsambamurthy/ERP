"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { ApiError, getAccounts, getBusinessPartners, getLedger } from "@/lib/api";
import type { Account, BusinessPartner, LedgerResponse } from "@/lib/types";

const selectClass =
  "rounded-lg border border-cream-200 bg-cream-50 px-3 py-2.5 text-sm outline-none focus:border-terracotta-400 focus:ring-1 focus:ring-terracotta-400";

export default function LedgerPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [partners, setPartners] = useState<BusinessPartner[]>([]);
  const [accountId, setAccountId] = useState("");
  const [businessPartnerId, setBusinessPartnerId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [ledger, setLedger] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const account = useMemo(() => accounts.find((a) => a.id === accountId), [accounts, accountId]);

  useEffect(() => {
    Promise.all([getAccounts(), getBusinessPartners()]).then(([a, p]) => {
      setAccounts(a.data);
      setPartners(p.data);
    });
  }, []);

  useEffect(() => {
    if (!accountId) { setLedger(null); return; }
    setLoading(true);
    setError(null);
    getLedger({ accountId, businessPartnerId: businessPartnerId || undefined, from: from || undefined, to: to || undefined })
      .then((res) => setLedger(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load ledger."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, businessPartnerId, from, to]);

  return (
    <AppShell>
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold text-navy-800">Ledger</h1>
          <p className="text-sm text-gray-500">Running balance for one account.</p>
        </div>

        <div className="grid gap-4 rounded-2xl border border-cream-200 bg-white p-5 shadow-sm sm:grid-cols-4">
          <div className="flex flex-col gap-1 text-left">
            <label className="text-xs font-semibold uppercase tracking-wide text-terracotta-600">Account</label>
            <select className={selectClass} value={accountId} onChange={(e) => { setAccountId(e.target.value); setBusinessPartnerId(""); }}>
              <option value="">Select account…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.accountCode} — {a.accountName}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1 text-left">
            <label className="text-xs font-semibold uppercase tracking-wide text-terracotta-600">Partner (optional)</label>
            <select
              className={selectClass}
              value={businessPartnerId}
              disabled={!account?.isControlAccount}
              onChange={(e) => setBusinessPartnerId(e.target.value)}
            >
              <option value="">All</option>
              {partners.filter((p) => p.bpType === account?.defaultBpType).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 text-left">
            <label className="text-xs font-semibold uppercase tracking-wide text-terracotta-600">From</label>
            <input type="date" className={selectClass} value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1 text-left">
            <label className="text-xs font-semibold uppercase tracking-wide text-terracotta-600">To</label>
            <input type="date" className={selectClass} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {!accountId && <p className="text-sm text-gray-500">Pick an account to see its ledger.</p>}

        {accountId && (
          <div className="overflow-hidden rounded-2xl border border-cream-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-cream-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Narration</th>
                  <th className="px-4 py-3">Partner</th>
                  <th className="px-4 py-3 text-right">Debit</th>
                  <th className="px-4 py-3 text-right">Credit</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Loading…</td></tr>}
                {ledger && (
                  <tr className="border-t border-cream-100 bg-cream-50/50">
                    <td className="px-4 py-2.5 text-gray-500" colSpan={5}>Opening Balance</td>
                    <td className="px-4 py-2.5 text-right font-medium">{ledger.openingBalance.toFixed(2)}</td>
                  </tr>
                )}
                {ledger?.rows.map((r, i) => (
                  <tr key={i} className="border-t border-cream-100">
                    <td className="px-4 py-2.5 text-gray-500">{new Date(r.date).toLocaleDateString()}</td>
                    <td className="px-4 py-2.5 text-navy-800">{r.narration}</td>
                    <td className="px-4 py-2.5 text-gray-500">{r.businessPartner || "—"}</td>
                    <td className="px-4 py-2.5 text-right">{r.debit ? r.debit.toFixed(2) : ""}</td>
                    <td className="px-4 py-2.5 text-right">{r.credit ? r.credit.toFixed(2) : ""}</td>
                    <td className="px-4 py-2.5 text-right font-medium">{r.balance.toFixed(2)}</td>
                  </tr>
                ))}
                {ledger && ledger.rows.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">No movement in this range.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
