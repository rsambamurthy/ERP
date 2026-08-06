"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import CostingMethodGate from "@/components/inventory/CostingMethodGate";
import { ApiError, createPurchaseReturn, getPurchaseBills, getPurchaseReturnableLines, getPurchaseReturns } from "@/lib/api";
import type { PurchaseBill, PurchaseReturn, ReturnableLine } from "@/lib/types";

function PurchaseReturnsInner() {
  const params = useSearchParams();
  const initialBillId = params.get("billId") ?? "";

  const [bills, setBills] = useState<PurchaseBill[]>([]);
  const [returns, setReturns] = useState<PurchaseReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedBillId, setSelectedBillId] = useState(initialBillId);
  const [returnDate, setReturnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [returnableLines, setReturnableLines] = useState<ReturnableLine[] | null>(null);
  const [vendorName, setVendorName] = useState("");
  const [qtyByLine, setQtyByLine] = useState<Record<string, number>>({});
  const [linesLoading, setLinesLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const [billsRes, retRes] = await Promise.all([getPurchaseBills(), getPurchaseReturns()]);
      setBills(billsRes.data);
      setReturns(retRes.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load purchase returns.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  async function loadReturnable(billId: string) {
    if (!billId) { setReturnableLines(null); return; }
    setLinesLoading(true);
    setError(null);
    try {
      const res = await getPurchaseReturnableLines(billId);
      setReturnableLines(res.data.lines);
      setVendorName(res.data.bill.businessPartner.name);
      setQtyByLine({});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load bill lines.");
      setReturnableLines(null);
    } finally {
      setLinesLoading(false);
    }
  }

  useEffect(() => {
    if (initialBillId) loadReturnable(initialBillId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBillId]);

  function handleBillChange(id: string) {
    setSelectedBillId(id);
    loadReturnable(id);
  }

  const totalToReturn = Object.values(qtyByLine).reduce((s, q) => s + (q || 0), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBillId || !returnableLines) return;
    const lines = returnableLines
      .filter((l) => (qtyByLine[l.id] || 0) > 0)
      .map((l) => ({ purchaseBillLineId: l.id, quantity: qtyByLine[l.id] }));
    if (lines.length === 0) { setError("Enter a quantity for at least one line."); return; }

    setSaving(true);
    setError(null);
    try {
      await createPurchaseReturn({ purchaseBillId: selectedBillId, returnDate, narration, lines });
      setSelectedBillId(""); setReturnableLines(null); setQtyByLine({}); setNarration("");
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
        <h1>Purchase Returns</h1>
        <p>Debit notes against a posted Purchase Bill — stock leaves back to the vendor, Trade Payables and GST Input are reduced.</p>
      </div>

      <div className="ent-section" style={{ marginBottom: 20 }}>
        <div className="ent-section-hdr"><span className="ent-section-title">New Return</span></div>
        <form onSubmit={handleSubmit}>
          <div className="ent-form-grid" style={{ gridTemplateColumns: "2fr 1fr 2fr" }}>
            <div className="ent-fg">
              <label className="ent-fl">Purchase Bill</label>
              <select className="ent-fc" value={selectedBillId} onChange={(e) => handleBillChange(e.target.value)} required>
                <option value="">Select…</option>
                {bills.map((b) => <option key={b.id} value={b.id}>{b.billNumber} — {b.businessPartner.name}</option>)}
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

          {linesLoading && <p style={{ padding: "0 14px", fontSize: 13, color: "var(--color-muted)" }}>Loading bill lines…</p>}

          {returnableLines && (
            <div style={{ padding: "0 14px" }}>
              <table className="ent-table">
                <thead>
                  <tr><th style={{ width: "36%" }}>Item</th><th>Billed</th><th>Returned</th><th>Remaining</th><th>Return Qty</th></tr>
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
                    </tr>
                  ))}
                </tbody>
              </table>
              {totalToReturn > 0 && (
                <p style={{ fontSize: 13, color: "var(--color-muted)", margin: "10px 0" }}>
                  Returning {totalToReturn} unit{totalToReturn === 1 ? "" : "s"} to {vendorName}.
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
          <thead><tr><th>Return #</th><th>Date</th><th>Vendor</th><th>Bill</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="ent-empty">Loading…</td></tr>}
            {!loading && returns.length === 0 && <tr><td colSpan={5} className="ent-empty">No returns yet.</td></tr>}
            {returns.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 500 }}>{r.returnNumber}</td>
                <td style={{ color: "var(--color-muted)" }}>{new Date(r.returnDate).toLocaleDateString()}</td>
                <td>{r.businessPartner.name}</td>
                <td style={{ color: "var(--color-muted)" }}>{r.purchaseBill.billNumber}</td>
                <td style={{ textAlign: "right" }}>{Number(r.grandTotal).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function PurchaseReturnsPage() {
  return (
    <AppShell>
      <CostingMethodGate>
        <Suspense fallback={null}>
          <PurchaseReturnsInner />
        </Suspense>
      </CostingMethodGate>
    </AppShell>
  );
}
