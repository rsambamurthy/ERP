"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { ApiError, getTrialBalance } from "@/lib/api";
import type { TrialBalanceResponse } from "@/lib/types";

const selectClass =
  "rounded-lg border border-cream-200 bg-cream-50 px-3 py-2.5 text-sm outline-none focus:border-terracotta-400 focus:ring-1 focus:ring-terracotta-400";

export default function TrialBalancePage() {
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<TrialBalanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getTrialBalance({ asOf })
      .then((res) => setData(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load trial balance."))
      .finally(() => setLoading(false));
  }, [asOf]);

  return (
    <AppShell>
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-navy-800">Trial Balance</h1>
            <p className="text-sm text-gray-500">Every account's net position as of a date.</p>
          </div>
          <div className="flex flex-col gap-1 text-left">
            <label className="text-xs font-semibold uppercase tracking-wide text-terracotta-600">As of</label>
            <input type="date" className={selectClass} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="overflow-hidden rounded-2xl border border-cream-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-cream-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Debit</th>
                <th className="px-4 py-3 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">Loading…</td></tr>}
              {!loading && data?.rows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">Nothing posted yet.</td></tr>
              )}
              {data?.rows.map((r) => (
                <tr key={r.account.id} className="border-t border-cream-100">
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{r.account.accountCode}</td>
                  <td className="px-4 py-2.5 font-medium text-navy-800">{r.account.accountName}</td>
                  <td className="px-4 py-2.5 text-gray-500">{r.account.accountType}</td>
                  <td className="px-4 py-2.5 text-right">{r.debit ? r.debit.toFixed(2) : ""}</td>
                  <td className="px-4 py-2.5 text-right">{r.credit ? r.credit.toFixed(2) : ""}</td>
                </tr>
              ))}
            </tbody>
            {data && (
              <tfoot>
                <tr className="border-t-2 border-cream-200 font-semibold text-navy-800">
                  <td className="px-4 py-3" colSpan={3}>Total</td>
                  <td className="px-4 py-3 text-right">{data.totalDebit.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right">{data.totalCredit.toFixed(2)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {data && Math.abs(data.totalDebit - data.totalCredit) > 0.01 && (
          <p className="text-sm text-red-600">Warning: totals don&apos;t match — books are out of balance.</p>
        )}
      </div>
    </AppShell>
  );
}
