"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { ApiError, getPnL } from "@/lib/api";
import type { PnLResponse } from "@/lib/types";

function firstOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export default function PnLPage() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<PnLResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getPnL({ from, to })
      .then((res) => setData(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load P&L."))
      .finally(() => setLoading(false));
  }, [from, to]);

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Profit &amp; Loss</h1>
        <p>Income and expenses for a period.</p>
      </div>

      <div className="ent-toolbar">
        <input type="date" className="ent-fc" style={{ width: 150, height: 34 }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <span style={{ color: "var(--color-muted)", fontSize: 13 }}>to</span>
        <input type="date" className="ent-fc" style={{ width: 150, height: 34 }} value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {loading && <p style={{ fontSize: 13, color: "var(--color-muted)" }}>Loading…</p>}

      {data && (
        <>
          <div className="ent-section">
            <div className="ent-section-hdr"><span className="ent-section-title">Income</span></div>
            <table className="ent-table">
              <tbody>
                {data.income.length === 0 && <tr><td className="ent-empty">No income posted this period.</td></tr>}
                {data.income.map((r) => (
                  <tr key={r.account.id}><td>{r.account.accountName}</td><td style={{ textAlign: "right" }}>{r.amount.toFixed(2)}</td></tr>
                ))}
                <tr style={{ fontWeight: 700, background: "#f8fafd" }}>
                  <td>Total Income</td><td style={{ textAlign: "right" }}>{data.totalIncome.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="ent-section">
            <div className="ent-section-hdr"><span className="ent-section-title">Expense</span></div>
            <table className="ent-table">
              <tbody>
                {data.expense.length === 0 && <tr><td className="ent-empty">No expense posted this period.</td></tr>}
                {data.expense.map((r) => (
                  <tr key={r.account.id}><td>{r.account.accountName}</td><td style={{ textAlign: "right" }}>{r.amount.toFixed(2)}</td></tr>
                ))}
                <tr style={{ fontWeight: 700, background: "#f8fafd" }}>
                  <td>Total Expense</td><td style={{ textAlign: "right" }}>{data.totalExpense.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="stat-card">
            <div className="label">Net Profit</div>
            <div className="value" style={{ color: data.netProfit >= 0 ? "#16a34a" : "#dc2626" }}>
              {data.netProfit.toFixed(2)}
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
