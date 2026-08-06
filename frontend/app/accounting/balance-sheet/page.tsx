"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { ApiError, getBalanceSheet } from "@/lib/api";
import type { BalanceSheetResponse } from "@/lib/types";

export default function BalanceSheetPage() {
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<BalanceSheetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getBalanceSheet({ asOf })
      .then((res) => setData(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load balance sheet."))
      .finally(() => setLoading(false));
  }, [asOf]);

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Balance Sheet</h1>
        <p>Assets vs. liabilities &amp; equity, as of a date.</p>
      </div>

      <div className="ent-toolbar">
        <div style={{ flex: 1 }} />
        <label style={{ fontSize: 12, color: "var(--color-muted)", display: "flex", alignItems: "center", gap: 8 }}>
          As of
          <input type="date" className="ent-fc" style={{ width: 160, height: 34 }} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {loading && <p style={{ fontSize: 13, color: "var(--color-muted)" }}>Loading…</p>}

      {data && (
        <div className="grid-2">
          <div className="ent-section">
            <div className="ent-section-hdr"><span className="ent-section-title">Assets</span></div>
            <table className="ent-table">
              <tbody>
                {data.assets.length === 0 && <tr><td className="ent-empty">Nothing yet.</td></tr>}
                {data.assets.map((r) => (
                  <tr key={r.account.id}><td>{r.account.accountName}</td><td style={{ textAlign: "right" }}>{r.amount.toFixed(2)}</td></tr>
                ))}
                <tr style={{ fontWeight: 700, background: "#f8fafd" }}>
                  <td>Total Assets</td><td style={{ textAlign: "right" }}>{data.totalAssets.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="ent-section">
            <div className="ent-section-hdr"><span className="ent-section-title">Liabilities &amp; Equity</span></div>
            <table className="ent-table">
              <tbody>
                {data.liabilities.map((r) => (
                  <tr key={r.account.id}><td>{r.account.accountName}</td><td style={{ textAlign: "right" }}>{r.amount.toFixed(2)}</td></tr>
                ))}
                <tr style={{ fontWeight: 600 }}>
                  <td>Total Liabilities</td><td style={{ textAlign: "right" }}>{data.totalLiabilities.toFixed(2)}</td>
                </tr>
                {data.equity.map((r) => (
                  <tr key={r.account.id}><td>{r.account.accountName}</td><td style={{ textAlign: "right" }}>{r.amount.toFixed(2)}</td></tr>
                ))}
                <tr>
                  <td>Current Earnings</td><td style={{ textAlign: "right" }}>{data.netProfitToDate.toFixed(2)}</td>
                </tr>
                <tr style={{ fontWeight: 700, background: "#f8fafd" }}>
                  <td>Total Liabilities &amp; Equity</td>
                  <td style={{ textAlign: "right" }}>{(data.totalLiabilities + data.totalEquityAndProfit).toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && !data.balanced && (
        <p style={{ color: "#dc2626", fontSize: 13, marginTop: 12 }}>Warning: assets don&apos;t equal liabilities + equity — books are out of balance.</p>
      )}
    </AppShell>
  );
}
