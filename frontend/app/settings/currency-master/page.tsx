"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import {
  ApiError, createCurrencyRate, deleteCurrencyRate, getCurrencyRates, updateCurrencyRate,
} from "@/lib/api";
import { useBulkUpload } from "@/components/shared/BulkUpload";
import { SUPPORTED_CURRENCIES } from "@/lib/types";
import type { CurrencyRate, CurrencyRateUploadRow } from "@/lib/types";

const CURRENCY_RATE_UPLOAD_COLUMNS: { key: keyof CurrencyRateUploadRow; label: string }[] = [
  { key: "currencyCode", label: "Currency" },
  { key: "effectiveFrom", label: "Effective From" },
  { key: "rate", label: "Rate" },
];

// INR is never a row here — it's always 1 by definition, not something
// anyone looks a rate up for. Same list the Sales Invoice/Purchase Bill
// currency dropdown already uses, just without the INR entry.
const FOREIGN_CURRENCIES = SUPPORTED_CURRENCIES.filter((c) => c.code !== "INR");

function CurrencyMasterInner() {
  const [rates, setRates] = useState<CurrencyRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [currencyCode, setCurrencyCode] = useState(FOREIGN_CURRENCIES[0]?.code ?? "");
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [rate, setRate] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState("");
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    try {
      const res = await getCurrencyRates();
      setRates(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load currency rates.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  const bulk = useBulkUpload<CurrencyRateUploadRow>(
    "currency-rates", "SmartERP_CurrencyRates_Template.xlsx", CURRENCY_RATE_UPLOAD_COLUMNS, loadAll
  );

  const symbolByCode = useMemo(() => new Map(SUPPORTED_CURRENCIES.map((c) => [c.code, c.symbol])), []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createCurrencyRate({ currencyCode, effectiveFrom, rate: Number(rate) });
      setShowForm(false);
      setRate("");
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the rate.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(r: CurrencyRate) {
    setEditingId(r.id);
    setEditRate(r.rate);
    setRowError(null);
  }

  async function handleSaveEdit(id: string) {
    setRowBusy(id);
    setRowError(null);
    try {
      await updateCurrencyRate(id, Number(editRate));
      setEditingId(null);
      await loadAll();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Could not update the rate.");
    } finally {
      setRowBusy(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this rate? This can't be undone.")) return;
    setRowBusy(id);
    setRowError(null);
    try {
      await deleteCurrencyRate(id);
      await loadAll();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Could not delete the rate.");
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <>
      <div className="ent-page-hdr">
        <h1>Currency Master</h1>
        <p>
          Effective-dated exchange rates for foreign-currency Sales Invoices and Purchase Bills — the same currency
          can have several entries, one per date it takes effect from. A create form picks up the rate that applies
          on the transaction's own date automatically (still freely editable).
        </p>
      </div>

      <div className="ent-toolbar">
        <div style={{ flex: 1 }} />
        {bulk.buttons}
        <button className="ent-btn-add" onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "+ New Rate"}</button>
      </div>

      {bulk.panel}

      {showForm && (
        <form onSubmit={handleCreate} className="ent-section">
          <div className="ent-section-hdr"><span className="ent-section-title">New Currency Rate</span></div>
          <div className="ent-form-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
            <div className="ent-fg">
              <label className="ent-fl">Currency</label>
              <select className="ent-fc" value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)} required>
                {FOREIGN_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Effective From</label>
              <input type="date" className="ent-fc" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Rate (1 {currencyCode} = ₹)</label>
              <input type="number" min={0} step="0.000001" className="ent-fc" value={rate} onChange={(e) => setRate(e.target.value)} required />
            </div>
          </div>
          {error && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 10px" }}>{error}</p>}
          <div style={{ padding: "0 14px 14px" }}>
            <button type="submit" className="ent-btn-save" disabled={saving || !rate}>{saving ? "Saving…" : "Save Rate"}</button>
          </div>
        </form>
      )}

      {error && !showForm && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {rowError && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{rowError}</p>}

      <div className="ent-page-table">
        <table>
          <thead>
            <tr>
              <th>Currency</th>
              <th>Effective From</th>
              <th style={{ textAlign: "right" }}>Rate (1 unit = ₹)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={4} className="ent-empty">Loading…</td></tr>}
            {!loading && rates.length === 0 && <tr><td colSpan={4} className="ent-empty">No currency rates yet.</td></tr>}
            {rates.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 500 }}>{r.currencyCode} {symbolByCode.get(r.currencyCode) ? `(${symbolByCode.get(r.currencyCode)})` : ""}</td>
                <td>{new Date(r.effectiveFrom).toLocaleDateString()}</td>
                <td style={{ textAlign: "right" }}>
                  {editingId === r.id ? (
                    <input
                      type="number" min={0} step="0.000001" className="ent-fc" style={{ width: 120, textAlign: "right" }}
                      value={editRate} onChange={(e) => setEditRate(e.target.value)}
                    />
                  ) : (
                    Number(r.rate).toFixed(6)
                  )}
                </td>
                <td style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  {editingId === r.id ? (
                    <>
                      <button type="button" className="ent-ia ent-ia-edit" disabled={rowBusy === r.id} onClick={() => handleSaveEdit(r.id)}>
                        {rowBusy === r.id ? "Saving…" : "Save"}
                      </button>
                      <button type="button" className="ent-ia ent-ia-edit" onClick={() => setEditingId(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="ent-ia ent-ia-edit" onClick={() => startEdit(r)}>Edit</button>
                      <button type="button" className="ent-ia ent-ia-del" disabled={rowBusy === r.id} onClick={() => handleDelete(r.id)}>
                        {rowBusy === r.id ? "…" : "Delete"}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function CurrencyMasterPage() {
  return (
    <AppShell>
      <CurrencyMasterInner />
    </AppShell>
  );
}
