"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { ApiError, createJournalEntry, getAccounts, getBusinessPartners, getJournalEntries } from "@/lib/api";
import type { Account, BusinessPartner, JournalEntry, JournalLineInput } from "@/lib/types";

const emptyLine = (): JournalLineInput => ({ accountId: "", businessPartnerId: null, debit: 0, credit: 0 });

export default function JournalEntriesPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [partners, setPartners] = useState<BusinessPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [voucherType, setVoucherType] = useState<"BV" | "CV" | "JV">("JV");
  const [lines, setLines] = useState<JournalLineInput[]>([emptyLine(), emptyLine()]);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const totals = useMemo(() => {
    const debit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const credit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.01 && debit > 0 };
  }, [lines]);

  async function loadAll() {
    setLoading(true);
    try {
      const [entriesRes, accountsRes, partnersRes] = await Promise.all([
        getJournalEntries(), getAccounts(), getBusinessPartners(),
      ]);
      setEntries(entriesRes.data);
      setAccounts(accountsRes.data);
      setPartners(partnersRes.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load journal entries.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  function updateLine(i: number, patch: Partial<JournalLineInput>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!totals.balanced) { setError("Entry isn't balanced — total debit must equal total credit."); return; }
    setSaving(true);
    setError(null);
    try {
      await createJournalEntry({ entryDate, narration, voucherType, lines: lines.filter((l) => l.accountId) });
      setShowForm(false);
      setNarration("");
      setLines([emptyLine(), emptyLine()]);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post entry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Journal Entries</h1>
        <p>Every posted transaction, double-entry.</p>
      </div>

      <div className="ent-toolbar">
        <div style={{ flex: 1 }} />
        <button className="ent-btn-add" onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "+ New Entry"}</button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="ent-section">
          <div className="ent-section-hdr"><span className="ent-section-title">New Journal Entry</span></div>
          <div className="ent-form-grid" style={{ gridTemplateColumns: "1fr 1fr 2fr" }}>
            <div className="ent-fg">
              <label className="ent-fl">Entry Date</label>
              <input type="date" className="ent-fc" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Voucher Type</label>
              <select className="ent-fc" value={voucherType} onChange={(e) => setVoucherType(e.target.value as any)}>
                <option value="JV">Journal Voucher</option>
                <option value="BV">Bank Voucher</option>
                <option value="CV">Cash Voucher</option>
              </select>
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Narration</label>
              <input className="ent-fc" value={narration} onChange={(e) => setNarration(e.target.value)} required />
            </div>
          </div>

          <div style={{ padding: "0 14px" }}>
            <table className="ent-table">
              <thead>
                <tr><th style={{ width: "34%" }}>Account</th><th style={{ width: "26%" }}>Partner</th><th>Debit</th><th>Credit</th><th /></tr>
              </thead>
              <tbody>
                {lines.map((line, i) => {
                  const account = line.accountId ? accountById.get(line.accountId) : undefined;
                  return (
                    <tr key={i}>
                      <td>
                        <select className="ent-fc" value={line.accountId} onChange={(e) => updateLine(i, { accountId: e.target.value, businessPartnerId: null })}>
                          <option value="">Select account…</option>
                          {accounts.filter((a) => a.isActive && !a.isGroup).map((a) => (
                            <option key={a.id} value={a.id}>{a.accountCode} — {a.accountName}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select className="ent-fc" value={line.businessPartnerId ?? ""} disabled={!account?.isControlAccount} onChange={(e) => updateLine(i, { businessPartnerId: e.target.value || null })}>
                          <option value="">{account?.isControlAccount ? "Select…" : "—"}</option>
                          {partners.filter((p) => p.bpType === account?.defaultBpType).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </td>
                      <td>
                        <input type="number" min={0} step="0.01" className="ent-fc" value={line.debit || ""} onChange={(e) => updateLine(i, { debit: Number(e.target.value), credit: 0 })} />
                      </td>
                      <td>
                        <input type="number" min={0} step="0.01" className="ent-fc" value={line.credit || ""} onChange={(e) => updateLine(i, { credit: Number(e.target.value), debit: 0 })} />
                      </td>
                      <td>
                        <button type="button" className="ent-ia ent-ia-del" disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button type="button" className="ent-add-row" style={{ margin: "10px 0" }} onClick={() => setLines((ls) => [...ls, emptyLine()])}>+ Add line</button>

            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              background: "#f8fafd", border: "1px solid var(--color-border)", borderRadius: 6,
              padding: "8px 14px", fontSize: 13, marginBottom: 12,
            }}>
              <span>Total Debit: <strong>{totals.debit.toFixed(2)}</strong></span>
              <span>Total Credit: <strong>{totals.credit.toFixed(2)}</strong></span>
              <span style={{ color: totals.balanced ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
                {totals.balanced ? "Balanced" : "Not balanced"}
              </span>
            </div>
          </div>

          {error && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 10px" }}>{error}</p>}
          <div style={{ padding: "0 14px 14px" }}>
            <button type="submit" className="ent-btn-save" disabled={saving || !totals.balanced}>{saving ? "Posting…" : "Post Entry"}</button>
          </div>
        </form>
      )}

      {error && !showForm && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="ent-page-table">
        <table>
          <thead><tr><th>Date</th><th>Narration</th><th>Type</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={4} className="ent-empty">Loading…</td></tr>}
            {!loading && entries.length === 0 && <tr><td colSpan={4} className="ent-empty">No entries yet.</td></tr>}
            {entries.map((e) => {
              const amount = e.journalLines.reduce((s, l) => s + Number(l.debit || 0), 0);
              return (
                <tr key={e.id}>
                  <td style={{ color: "var(--color-muted)" }}>{new Date(e.entryDate).toLocaleDateString()}</td>
                  <td style={{ fontWeight: 500 }}>{e.narration}</td>
                  <td><span className="badge badge-blue">{e.voucherType || "JV"}</span></td>
                  <td style={{ textAlign: "right" }}>{amount.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
