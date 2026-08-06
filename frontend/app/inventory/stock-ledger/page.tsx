"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import CostingMethodGate from "@/components/inventory/CostingMethodGate";
import { ApiError, getItems, getStockLedger } from "@/lib/api";
import type { Item, StockLedgerResponse } from "@/lib/types";

function StockLedgerInner() {
  const [items, setItems] = useState<Item[]>([]);
  const [itemId, setItemId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [ledger, setLedger] = useState<StockLedgerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { getItems().then((res) => setItems(res.data)); }, []);

  useEffect(() => {
    if (!itemId) { setLedger(null); return; }
    setLoading(true);
    setError(null);
    getStockLedger({ itemId, from: from || undefined, to: to || undefined })
      .then((res) => setLedger(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load stock ledger."))
      .finally(() => setLoading(false));
  }, [itemId, from, to]);

  return (
    <>
      <div className="ent-page-hdr">
        <h1>Stock Ledger</h1>
        <p>Running quantity balance for one item.</p>
      </div>

      <div className="ent-toolbar">
        <select className="ent-fc" style={{ flex: "1 1 240px", height: 34 }} value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">Select item…</option>
          {items.map((i) => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}
        </select>
        <input type="date" className="ent-fc" style={{ width: 150, height: 34 }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="ent-fc" style={{ width: 150, height: 34 }} value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {!itemId && <p style={{ fontSize: 13, color: "var(--color-muted)" }}>Pick an item to see its stock ledger.</p>}

      {itemId && (
        <div className="ent-page-table">
          <table>
            <thead>
              <tr><th>Date</th><th>Type</th><th>Branch</th><th>Narration</th><th style={{ textAlign: "right" }}>Qty</th><th style={{ textAlign: "right" }}>Unit Cost</th><th style={{ textAlign: "right" }}>Balance</th></tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="ent-empty">Loading…</td></tr>}
              {ledger && (
                <tr style={{ background: "#f8fafd" }}>
                  <td colSpan={6} style={{ color: "var(--color-muted)" }}>Opening Quantity</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{ledger.openingQuantity}</td>
                </tr>
              )}
              {ledger?.rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ color: "var(--color-muted)" }}>{new Date(r.date).toLocaleDateString()}</td>
                  <td><span className={r.quantity >= 0 ? "badge badge-green" : "badge badge-red"}>{r.movementType}</span></td>
                  <td style={{ color: "var(--color-muted)" }}>{r.branch}</td>
                  <td>{r.narration || "—"}</td>
                  <td style={{ textAlign: "right" }}>{r.quantity > 0 ? `+${r.quantity}` : r.quantity}</td>
                  <td style={{ textAlign: "right" }}>{r.unitCost.toFixed(2)}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{r.balance}</td>
                </tr>
              ))}
              {ledger && ledger.rows.length === 0 && <tr><td colSpan={7} className="ent-empty">No movement in this range.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function StockLedgerPage() {
  return (
    <AppShell>
      <CostingMethodGate>
        <StockLedgerInner />
      </CostingMethodGate>
    </AppShell>
  );
}
