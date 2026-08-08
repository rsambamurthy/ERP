"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { ApiError, getScheduleIIIBalanceSheet } from "@/lib/api";
import type { ScheduleIIIBalanceSheet, ScheduleIIIGroupResult } from "@/lib/types";

function GroupTable({ groups }: { groups: ScheduleIIIGroupResult[] }) {
  return (
    <>
      {groups.map((g) => (
        <table key={g.group} className="ent-table" style={{ marginBottom: 10 }}>
          <thead>
            <tr><th colSpan={2}>{g.groupLabel}</th></tr>
          </thead>
          <tbody>
            {g.heads.length === 0 && (
              <tr><td className="ent-empty" colSpan={2}>Nothing posted here.</td></tr>
            )}
            {g.heads.map((h) => (
              <tr key={h.code}>
                <td>
                  {h.label}
                  <div style={{ fontSize: 11, color: "var(--color-muted)" }}>
                    {h.items.map((i) => `${i.accountCode} ${i.accountName}`).join(", ")}
                  </div>
                </td>
                <td style={{ textAlign: "right", fontWeight: 500 }}>{h.total.toFixed(2)}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 700, background: "#f8fafd" }}>
              <td>Total {g.groupLabel}</td>
              <td style={{ textAlign: "right" }}>{g.total.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      ))}
    </>
  );
}

export default function ScheduleIIIBalanceSheetPage() {
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<ScheduleIIIBalanceSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getScheduleIIIBalanceSheet({ asOf })
      .then((res) => setData(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the Schedule III Balance Sheet."))
      .finally(() => setLoading(false));
  }, [asOf]);

  const hasUnclassified = data && (data.unclassified.assets.length > 0 || data.unclassified.liabilities.length > 0 || data.unclassified.equity.length > 0);

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Schedule III Balance Sheet</h1>
        <p>Companies Act, 2013 (Division I) format — Shareholders' Funds, Non-Current/Current Liabilities, Non-Current/Current Assets.</p>
      </div>

      <div className="ent-toolbar">
        <label style={{ fontSize: 13, color: "var(--color-muted)" }}>As of</label>
        <input type="date" className="ent-fc" style={{ width: 150, height: 34 }} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
      </div>

      <p style={{ fontSize: 11.5, color: "var(--color-muted)", marginBottom: 14 }}>
        Balance Sheet only — the corresponding Statement of Profit and Loss (Schedule III Part II) format isn't built
        yet. Accounts with no Schedule III Head set yet appear under "Unclassified" below rather than being silently
        dropped — assign one from Chart of Accounts to move them into the right section.
      </p>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {loading && <p style={{ fontSize: 13, color: "var(--color-muted)" }}>Loading…</p>}

      {data && (
        <>
          <div className="grid-2" style={{ marginBottom: 20 }}>
            <div className="ent-section">
              <div className="ent-section-hdr"><span className="ent-section-title">Equity and Liabilities</span></div>
              <div style={{ padding: 14 }}>
                <GroupTable groups={data.equityAndLiabilities.groups} />
                {(data.unclassified.liabilities.length > 0 || data.unclassified.equity.length > 0) && (
                  <table className="ent-table" style={{ marginBottom: 10 }}>
                    <thead><tr><th colSpan={2} style={{ color: "#a16207" }}>⚠ Unclassified</th></tr></thead>
                    <tbody>
                      {[...data.unclassified.equity, ...data.unclassified.liabilities].map((i) => (
                        <tr key={i.accountId}>
                          <td>{i.accountCode} {i.accountName}</td>
                          <td style={{ textAlign: "right" }}>{i.amount.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, padding: "8px 0", borderTop: "2px solid var(--color-border)" }}>
                  <span>Total</span>
                  <span>
                    {(
                      data.equityAndLiabilities.total +
                      data.unclassified.liabilities.reduce((s, i) => s + i.amount, 0) +
                      data.unclassified.equity.reduce((s, i) => s + i.amount, 0)
                    ).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            <div className="ent-section">
              <div className="ent-section-hdr"><span className="ent-section-title">Assets</span></div>
              <div style={{ padding: 14 }}>
                <GroupTable groups={data.assets.groups} />
                {data.unclassified.assets.length > 0 && (
                  <table className="ent-table" style={{ marginBottom: 10 }}>
                    <thead><tr><th colSpan={2} style={{ color: "#a16207" }}>⚠ Unclassified</th></tr></thead>
                    <tbody>
                      {data.unclassified.assets.map((i) => (
                        <tr key={i.accountId}>
                          <td>{i.accountCode} {i.accountName}</td>
                          <td style={{ textAlign: "right" }}>{i.amount.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, padding: "8px 0", borderTop: "2px solid var(--color-border)" }}>
                  <span>Total</span>
                  <span>{(data.assets.total + data.unclassified.assets.reduce((s, i) => s + i.amount, 0)).toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="stat-card" style={{ display: "inline-block" }}>
            <div className="label">{data.balanced ? "✓ Balanced" : `⚠ Difference: ₹${Math.abs(data.difference).toFixed(2)}`}</div>
            <div className="value" style={{ fontSize: "1.1rem", color: data.balanced ? "#16a34a" : "#dc2626" }}>
              {data.balanced ? "Assets = Equity & Liabilities" : "Check unclassified/opening balances"}
            </div>
          </div>
          {hasUnclassified && (
            <p style={{ fontSize: 12, color: "#a16207", marginTop: 10 }}>
              Some accounts don't have a Schedule III Head assigned yet — classify them from Chart of Accounts for a
              complete statement.
            </p>
          )}
        </>
      )}
    </AppShell>
  );
}
