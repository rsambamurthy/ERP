"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { ApiError, getAccounts, getBusinessPartners, getLedger } from "@/lib/api";
import type { Account, BusinessPartner, LedgerResponse } from "@/lib/types";

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
      <div className="ent-page-hdr">
        <h1>Ledger</h1>
        <p>Running balance for one account.</p>
      </div>

      <div className="ent-toolbar">
        <select className="ent-fc" style={{ flex: "1 1 240px", height: 34 }} value={accountId} onChange={(e) => { setAccountId(e.target.value); setBusinessPartnerId(""); }}>
          <option value="">Select account…</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.accountCode} — {a.accountName}</option>)}
        </select>
        <select className="ent-fc" style={{ flex: "1 1 180px", height: 34 }} value={businessPartnerId} disabled={!account?.isControlAccount} onChange={(e) => setBusinessPartnerId(e.target.value)}>
          <option value="">All partners</option>
          {partners.filter((p) => p.bpType === account?.defaultBpType).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input type="date" className="ent-fc" style={{ width: 150, height: 34 }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="ent-fc" style={{ width: 150, height: 34 }} value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {!accountId && <p style={{ fontSize: 13, color: "var(--color-muted)" }}>Pick an account to see its ledger.</p>}

      {accountId && (
        <div className="ent-page-table">
          <table>
            <thead>
              <tr><th>Date</th><th>Narration</th><th>Partner</th><th style={{ textAlign: "right" }}>Debit</th><th style={{ textAlign: "right" }}>Credit</th><th style={{ textAlign: "right" }}>Balance</th></tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="ent-empty">Loading…</td></tr>}
              {ledger && (
                <tr style={{ background: "#f8fafd" }}>
                  <td colSpan={5} style={{ color: "var(--color-muted)" }}>Opening Balance</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{ledger.openingBalance.toFixed(2)}</td>
                </tr>
              )}
              {ledger?.rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ color: "var(--color-muted)" }}>{new Date(r.date).toLocaleDateString()}</td>
                  <td>{r.narration}</td>
                  <td style={{ color: "var(--color-muted)" }}>{r.businessPartner || "—"}</td>
                  <td style={{ textAlign: "right" }}>{r.debit ? r.debit.toFixed(2) : ""}</td>
                  <td style={{ textAlign: "right" }}>{r.credit ? r.credit.toFixed(2) : ""}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{r.balance.toFixed(2)}</td>
                </tr>
              ))}
              {ledger && ledger.rows.length === 0 && <tr><td colSpan={6} className="ent-empty">No movement in this range.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
