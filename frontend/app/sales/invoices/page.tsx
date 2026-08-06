"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import CostingMethodGate from "@/components/inventory/CostingMethodGate";
import { ApiError, createSalesInvoice, getBusinessPartners, getItems, getSalesInvoices } from "@/lib/api";
import type { BusinessPartner, DocumentLineInput, Item, SalesInvoice } from "@/lib/types";

const emptyLine = (): DocumentLineInput => ({ itemId: "", quantity: 0, rate: 0, taxRate: 0 });

function SalesInvoicesInner() {
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [customers, setCustomers] = useState<BusinessPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [businessPartnerId, setBusinessPartnerId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<DocumentLineInput[]>([emptyLine()]);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const totals = useMemo(() => {
    let subtotal = 0, tax = 0;
    for (const l of lines) {
      const s = Number(l.quantity || 0) * Number(l.rate || 0);
      subtotal += s;
      tax += s * Number(l.taxRate || 0) / 100;
    }
    return { subtotal, tax, grand: subtotal + tax };
  }, [lines]);

  async function loadAll() {
    setLoading(true);
    try {
      const [invRes, itemsRes, custRes] = await Promise.all([getSalesInvoices(), getItems(), getBusinessPartners("CUSTOMER")]);
      setInvoices(invRes.data);
      setItems(itemsRes.data);
      setCustomers(custRes.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load sales invoices.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  function updateLine(i: number, patch: Partial<DocumentLineInput>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function pickItem(i: number, itemId: string) {
    const item = itemById.get(itemId);
    updateLine(i, {
      itemId,
      rate: item?.salesRate ? Number(item.salesRate) : 0,
      taxRate: item?.taxRate ? Number(item.taxRate) : 0,
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createSalesInvoice({
        businessPartnerId, invoiceDate, narration,
        lines: lines.filter((l) => l.itemId && l.quantity > 0),
      });
      setShowForm(false);
      setBusinessPartnerId(""); setNarration(""); setLines([emptyLine()]);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post invoice.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="ent-page-hdr">
        <h1>Sales Invoices</h1>
        <p>Stock out, posted straight to the books — Trade Receivables, Sales Revenue, GST, and Cost of Goods Sold.</p>
      </div>

      <div className="ent-toolbar">
        <div style={{ flex: 1 }} />
        <button className="ent-btn-add" onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "+ New Invoice"}</button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="ent-section">
          <div className="ent-section-hdr"><span className="ent-section-title">New Sales Invoice</span></div>
          <div className="ent-form-grid" style={{ gridTemplateColumns: "1fr 1fr 2fr" }}>
            <div className="ent-fg">
              <label className="ent-fl">Customer</label>
              <select className="ent-fc" value={businessPartnerId} onChange={(e) => setBusinessPartnerId(e.target.value)} required>
                <option value="">Select…</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Invoice Date</label>
              <input type="date" className="ent-fc" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Narration</label>
              <input className="ent-fc" value={narration} onChange={(e) => setNarration(e.target.value)} />
            </div>
          </div>

          <div style={{ padding: "0 14px" }}>
            <table className="ent-table">
              <thead><tr><th style={{ width: "36%" }}>Item</th><th>Qty</th><th>Rate</th><th>Tax %</th><th /></tr></thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i}>
                    <td>
                      <select className="ent-fc" value={line.itemId} onChange={(e) => pickItem(i, e.target.value)}>
                        <option value="">Select item…</option>
                        {items.filter((it) => it.isActive).map((it) => <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>)}
                      </select>
                    </td>
                    <td><input type="number" min={0} step="0.0001" className="ent-fc" value={line.quantity || ""} onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })} /></td>
                    <td><input type="number" min={0} step="0.01" className="ent-fc" value={line.rate || ""} onChange={(e) => updateLine(i, { rate: Number(e.target.value) })} /></td>
                    <td><input type="number" min={0} step="0.01" className="ent-fc" value={line.taxRate || ""} onChange={(e) => updateLine(i, { taxRate: Number(e.target.value) })} /></td>
                    <td><button type="button" className="ent-ia ent-ia-del" disabled={lines.length <= 1} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="ent-add-row" style={{ margin: "10px 0" }} onClick={() => setLines((ls) => [...ls, emptyLine()])}>+ Add line</button>

            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              background: "#f8fafd", border: "1px solid var(--color-border)", borderRadius: 6,
              padding: "8px 14px", fontSize: 13, marginBottom: 12,
            }}>
              <span>Subtotal: <strong>{totals.subtotal.toFixed(2)}</strong></span>
              <span>Tax: <strong>{totals.tax.toFixed(2)}</strong></span>
              <span>Grand Total: <strong>{totals.grand.toFixed(2)}</strong></span>
            </div>
          </div>

          {error && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 10px" }}>{error}</p>}
          <div style={{ padding: "0 14px 14px" }}>
            <button type="submit" className="ent-btn-save" disabled={saving || !businessPartnerId}>{saving ? "Posting…" : "Post Invoice"}</button>
          </div>
        </form>
      )}

      {error && !showForm && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="ent-page-table">
        <table>
          <thead><tr><th>Invoice #</th><th>Date</th><th>Customer</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={4} className="ent-empty">Loading…</td></tr>}
            {!loading && invoices.length === 0 && <tr><td colSpan={4} className="ent-empty">No invoices yet.</td></tr>}
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td style={{ fontWeight: 500 }}>{inv.invoiceNumber}</td>
                <td style={{ color: "var(--color-muted)" }}>{new Date(inv.invoiceDate).toLocaleDateString()}</td>
                <td>{inv.businessPartner.name}</td>
                <td style={{ textAlign: "right" }}>{Number(inv.grandTotal).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function SalesInvoicesPage() {
  return (
    <AppShell>
      <CostingMethodGate>
        <SalesInvoicesInner />
      </CostingMethodGate>
    </AppShell>
  );
}
