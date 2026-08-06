"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import CostingMethodGate from "@/components/inventory/CostingMethodGate";
import { ApiError, createSalesReturn, getSalesInvoices, getSalesReturnableLines, getSalesReturns } from "@/lib/api";
import type { ReturnableLine, SalesInvoice, SalesReturn } from "@/lib/types";

function SalesReturnsInner() {
  const params = useSearchParams();
  const initialInvoiceId = params.get("invoiceId") ?? "";

  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [returns, setReturns] = useState<SalesReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedInvoiceId, setSelectedInvoiceId] = useState(initialInvoiceId);
  const [returnDate, setReturnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [returnableLines, setReturnableLines] = useState<ReturnableLine[] | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [qtyByLine, setQtyByLine] = useState<Record<string, number>>({});
  const [conditionByLine, setConditionByLine] = useState<Record<string, "GOOD" | "DAMAGED">>({});
  const [linesLoading, setLinesLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const [invRes, retRes] = await Promise.all([getSalesInvoices(), getSalesReturns()]);
      setInvoices(invRes.data);
      setReturns(retRes.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load sales returns.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  async function loadReturnable(invoiceId: string) {
    if (!invoiceId) { setReturnableLines(null); return; }
    setLinesLoading(true);
    setError(null);
    try {
      const res = await getSalesReturnableLines(invoiceId);
      setReturnableLines(res.data.lines);
      setCustomerName(res.data.invoice.businessPartner.name);
      setQtyByLine({});
      setConditionByLine(Object.fromEntries(res.data.lines.map((l) => [l.id, "GOOD" as const])));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load invoice lines.");
      setReturnableLines(null);
    } finally {
      setLinesLoading(false);
    }
  }

  useEffect(() => {
    if (initialInvoiceId) loadReturnable(initialInvoiceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialInvoiceId]);

  function handleInvoiceChange(id: string) {
    setSelectedInvoiceId(id);
    loadReturnable(id);
  }

  const totalToReturn = Object.values(qtyByLine).reduce((s, q) => s + (q || 0), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedInvoiceId || !returnableLines) return;
    const lines = returnableLines
      .filter((l) => (qtyByLine[l.id] || 0) > 0)
      .map((l) => ({ salesInvoiceLineId: l.id, quantity: qtyByLine[l.id], condition: conditionByLine[l.id] ?? ("GOOD" as const) }));
    if (lines.length === 0) { setError("Enter a quantity for at least one line."); return; }

    setSaving(true);
    setError(null);
    try {
      await createSalesReturn({ salesInvoiceId: selectedInvoiceId, returnDate, narration, lines });
      setSelectedInvoiceId(""); setReturnableLines(null); setQtyByLine({}); setNarration("");
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post return.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="ent-page-hdr">
        <h1>Sales Returns</h1>
        <p>Credit notes against a posted Sales Invoice — good-condition stock returns to sellable inventory, damaged stock writes off instead.</p>
      </div>

      <div className="ent-section" style={{ marginBottom: 20 }}>
        <div className="ent-section-hdr"><span className="ent-section-title">New Return</span></div>
        <form onSubmit={handleSubmit}>
          <div className="ent-form-grid" style={{ gridTemplateColumns: "2fr 1fr 2fr" }}>
            <div className="ent-fg">
              <label className="ent-fl">Sales Invoice</label>
              <select className="ent-fc" value={selectedInvoiceId} onChange={(e) => handleInvoiceChange(e.target.value)} required>
                <option value="">Select…</option>
                {invoices.map((inv) => <option key={inv.id} value={inv.id}>{inv.invoiceNumber} — {inv.businessPartner.name}</option>)}
              </select>
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Return Date</label>
              <input type="date" className="ent-fc" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} required />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Narration</label>
              <input className="ent-fc" value={narration} onChange={(e) => setNarration(e.target.value)} />
            </div>
          </div>

          {linesLoading && <p style={{ padding: "0 14px", fontSize: 13, color: "var(--color-muted)" }}>Loading invoice lines…</p>}

          {returnableLines && (
            <div style={{ padding: "0 14px" }}>
              <table className="ent-table">
                <thead>
                  <tr><th style={{ width: "30%" }}>Item</th><th>Invoiced</th><th>Returned</th><th>Remaining</th><th>Return Qty</th><th>Condition</th></tr>
                </thead>
                <tbody>
                  {returnableLines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.item.sku} — {l.item.name}</td>
                      <td>{l.quantity} {l.item.uom}</td>
                      <td>{l.alreadyReturned}</td>
                      <td>{l.remaining}</td>
                      <td>
                        <input
                          type="number" min={0} max={l.remaining} step="0.0001" className="ent-fc"
                          value={qtyByLine[l.id] || ""} disabled={l.remaining <= 0}
                          onChange={(e) => setQtyByLine((q) => ({ ...q, [l.id]: Math.min(Number(e.target.value), l.remaining) }))}
                        />
                      </td>
                      <td>
                        <select
                          className="ent-fc" value={conditionByLine[l.id] ?? "GOOD"} disabled={l.remaining <= 0}
                          onChange={(e) => setConditionByLine((c) => ({ ...c, [l.id]: e.target.value as "GOOD" | "DAMAGED" }))}
                        >
                          <option value="GOOD">Good</option>
                          <option value="DAMAGED">Damaged</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {totalToReturn > 0 && (
                <p style={{ fontSize: 13, color: "var(--color-muted)", margin: "10px 0" }}>
                  Returning {totalToReturn} unit{totalToReturn === 1 ? "" : "s"} from {customerName}.
                </p>
              )}
            </div>
          )}

          {error && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 10px" }}>{error}</p>}
          <div style={{ padding: "0 14px 14px" }}>
            <button type="submit" className="ent-btn-save" disabled={saving || !returnableLines || totalToReturn <= 0}>
              {saving ? "Posting…" : "Post Return"}
            </button>
          </div>
        </form>
      </div>

      {error && !returnableLines && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="ent-page-table">
        <table>
          <thead><tr><th>Return #</th><th>Date</th><th>Customer</th><th>Invoice</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="ent-empty">Loading…</td></tr>}
            {!loading && returns.length === 0 && <tr><td colSpan={5} className="ent-empty">No returns yet.</td></tr>}
            {returns.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 500 }}>{r.returnNumber}</td>
                <td style={{ color: "var(--color-muted)" }}>{new Date(r.returnDate).toLocaleDateString()}</td>
                <td>{r.businessPartner.name}</td>
                <td style={{ color: "var(--color-muted)" }}>{r.salesInvoice.invoiceNumber}</td>
                <td style={{ textAlign: "right" }}>{Number(r.grandTotal).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function SalesReturnsPage() {
  return (
    <AppShell>
      <CostingMethodGate>
        <Suspense fallback={null}>
          <SalesReturnsInner />
        </Suspense>
      </CostingMethodGate>
    </AppShell>
  );
}
