"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { ApiError, getTrialBalance } from "@/lib/api";
import type { TrialBalanceResponse } from "@/lib/types";

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
      <div className="ent-page-hdr">
        <h1>Trial Balance</h1>
        <p>Every account&apos;s net position as of a date.</p>
      </div>

      <div className="ent-toolbar">
        <div style={{ flex: 1 }} />
        <label style={{ fontSize: 12, color: "var(--color-muted)", display: "flex", alignItems: "center", gap: 8 }}>
          As of
          <input type="date" className="ent-fc" style={{ width: 160, height: 34 }} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="ent-page-table">
        <table>
          <thead><tr><th>Code</th><th>Account</th><th>Type</th><th style={{ textAlign: "right" }}>Debit</th><th style={{ textAlign: "right" }}>Credit</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="ent-empty">Loading…</td></tr>}
            {!loading && data?.rows.length === 0 && <tr><td colSpan={5} className="ent-empty">Nothing posted yet.</td></tr>}
            {data?.rows.map((r) => (
              <tr key={r.account.id}>
                <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--color-muted)" }}>{r.account.accountCode}</td>
                <td style={{ fontWeight: 500 }}>{r.account.accountName}</td>
                <td style={{ color: "var(--color-muted)" }}>{r.account.accountType}</td>
                <td style={{ textAlign: "right" }}>{r.debit ? r.debit.toFixed(2) : ""}</td>
                <td style={{ textAlign: "right" }}>{r.credit ? r.credit.toFixed(2) : ""}</td>
              </tr>
            ))}
          </tbody>
          {data && (
            <tfoot>
              <tr>
                <td colSpan={3}>Total</td>
                <td style={{ textAlign: "right" }}>{data.totalDebit.toFixed(2)}</td>
                <td style={{ textAlign: "right" }}>{data.totalCredit.toFixed(2)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {data && Math.abs(data.totalDebit - data.totalCredit) > 0.01 && (
        <p style={{ color: "#dc2626", fontSize: 13, marginTop: 12 }}>Warning: totals don&apos;t match — books are out of balance.</p>
      )}
    </AppShell>
  );
}
