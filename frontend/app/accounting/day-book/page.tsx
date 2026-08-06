"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { ApiError, getDayBook } from "@/lib/api";
import type { JournalEntry } from "@/lib/types";

export default function DayBookPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getDayBook({ from: date, to: date })
      .then((res) => setEntries(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load day book."))
      .finally(() => setLoading(false));
  }, [date]);

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Day Book</h1>
        <p>Every voucher posted on a given day.</p>
      </div>

      <div className="ent-toolbar">
        <div style={{ flex: 1 }} />
        <input type="date" className="ent-fc" style={{ width: 160, height: 34 }} value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {loading && <p style={{ fontSize: 13, color: "var(--color-muted)" }}>Loading…</p>}
      {!loading && entries.length === 0 && <p style={{ fontSize: 13, color: "var(--color-muted)" }}>Nothing posted on this date.</p>}

      {entries.map((e) => {
        const total = e.journalLines.reduce((s, l) => s + Number(l.debit || 0), 0);
        return (
          <div key={e.id} className="ent-section">
            <div className="ent-section-hdr">
              <span className="ent-section-title">{e.narration}</span>
              <span className="badge badge-blue">{e.voucherType || "JV"}</span>
            </div>
            <table className="ent-table">
              <thead><tr><th>Account</th><th>Partner</th><th style={{ textAlign: "right" }}>Debit</th><th style={{ textAlign: "right" }}>Credit</th></tr></thead>
              <tbody>
                {e.journalLines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.account.accountName}</td>
                    <td style={{ color: "var(--color-muted)" }}>{l.businessPartner?.name ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>{Number(l.debit) ? Number(l.debit).toFixed(2) : ""}</td>
                    <td style={{ textAlign: "right" }}>{Number(l.credit) ? Number(l.credit).toFixed(2) : ""}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700, background: "#f8fafd" }}>
                  <td colSpan={2}>Total</td><td style={{ textAlign: "right" }} colSpan={2}>{total.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
    </AppShell>
  );
}
