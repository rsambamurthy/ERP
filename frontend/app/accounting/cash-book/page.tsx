"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { ApiError, getCashBook } from "@/lib/api";
import type { CashBookResponse } from "@/lib/types";

export default function CashBookPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<CashBookResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getCashBook({ from: from || undefined, to: to || undefined })
      .then((res) => setData(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load cash book."))
      .finally(() => setLoading(false));
  }, [from, to]);

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Cash / Bank Book</h1>
        <p>Combined running balance for Cash in Hand + Bank Account.</p>
      </div>

      <div className="ent-toolbar">
        <input type="date" className="ent-fc" style={{ width: 150, height: 34 }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <span style={{ color: "var(--color-muted)", fontSize: 13 }}>to</span>
        <input type="date" className="ent-fc" style={{ width: 150, height: 34 }} value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="ent-page-table">
        <table>
          <thead>
            <tr><th>Date</th><th>Narration</th><th>Account</th><th style={{ textAlign: "right" }}>Debit</th><th style={{ textAlign: "right" }}>Credit</th><th style={{ textAlign: "right" }}>Balance</th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="ent-empty">Loading…</td></tr>}
            {data && (
              <tr style={{ background: "#f8fafd" }}>
                <td colSpan={5} style={{ color: "var(--color-muted)" }}>Opening Balance</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{data.openingBalance.toFixed(2)}</td>
              </tr>
            )}
            {data?.rows.map((r, i) => (
              <tr key={i}>
                <td style={{ color: "var(--color-muted)" }}>{new Date(r.date).toLocaleDateString()}</td>
                <td>{r.narration}</td>
                <td style={{ color: "var(--color-muted)" }}>{r.account}</td>
                <td style={{ textAlign: "right" }}>{r.debit ? r.debit.toFixed(2) : ""}</td>
                <td style={{ textAlign: "right" }}>{r.credit ? r.credit.toFixed(2) : ""}</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{r.balance.toFixed(2)}</td>
              </tr>
            ))}
            {data && data.rows.length === 0 && <tr><td colSpan={6} className="ent-empty">No cash/bank movement in this range.</td></tr>}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
