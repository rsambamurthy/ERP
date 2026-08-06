"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { ApiError, getReceiptsPayments } from "@/lib/api";
import type { ReceiptsPaymentsResponse } from "@/lib/types";

export default function ReceiptsPaymentsPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<ReceiptsPaymentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getReceiptsPayments({ from: from || undefined, to: to || undefined })
      .then((res) => setData(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load receipts & payments."))
      .finally(() => setLoading(false));
  }, [from, to]);

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Receipts &amp; Payments</h1>
        <p>Cash + Bank movement, split by direction.</p>
      </div>

      <div className="ent-toolbar">
        <input type="date" className="ent-fc" style={{ width: 150, height: 34 }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <span style={{ color: "var(--color-muted)", fontSize: 13 }}>to</span>
        <input type="date" className="ent-fc" style={{ width: 150, height: 34 }} value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {loading && <p style={{ fontSize: 13, color: "var(--color-muted)" }}>Loading…</p>}

      {data && (
        <div className="grid-2">
          <div className="ent-section">
            <div className="ent-section-hdr"><span className="ent-section-title">Receipts (money in)</span></div>
            <table className="ent-table">
              <tbody>
                {data.receipts.length === 0 && <tr><td className="ent-empty">None in this range.</td></tr>}
                {data.receipts.map((r, i) => (
                  <tr key={i}>
                    <td style={{ color: "var(--color-muted)" }}>{new Date(r.date).toLocaleDateString()}</td>
                    <td>{r.narration}{r.partner ? ` — ${r.partner}` : ""}</td>
                    <td style={{ textAlign: "right" }}>{r.amount.toFixed(2)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700, background: "#f8fafd" }}>
                  <td colSpan={2}>Total Receipts</td><td style={{ textAlign: "right" }}>{data.totalReceipts.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="ent-section">
            <div className="ent-section-hdr"><span className="ent-section-title">Payments (money out)</span></div>
            <table className="ent-table">
              <tbody>
                {data.payments.length === 0 && <tr><td className="ent-empty">None in this range.</td></tr>}
                {data.payments.map((p, i) => (
                  <tr key={i}>
                    <td style={{ color: "var(--color-muted)" }}>{new Date(p.date).toLocaleDateString()}</td>
                    <td>{p.narration}{p.partner ? ` — ${p.partner}` : ""}</td>
                    <td style={{ textAlign: "right" }}>{p.amount.toFixed(2)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700, background: "#f8fafd" }}>
                  <td colSpan={2}>Total Payments</td><td style={{ textAlign: "right" }}>{data.totalPayments.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}
