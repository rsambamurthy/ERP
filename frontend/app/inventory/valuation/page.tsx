"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import CostingMethodGate from "@/components/inventory/CostingMethodGate";
import { ApiError, getValuation } from "@/lib/api";
import type { ValuationResponse } from "@/lib/types";

function ItemValuationInner() {
  const [data, setData] = useState<ValuationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getValuation()
      .then((res) => setData(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load item valuation."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <div className="ent-page-hdr">
        <h1>Item Valuation</h1>
        <p>What every item currently on hand is worth, under {data?.costingMethod === "FIFO" ? "FIFO" : "weighted-average"} costing.</p>
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {data && (
        <div className="grid-4" style={{ marginBottom: 20 }}>
          <div className="stat-card">
            <div className="value">{data.totalValue.toFixed(2)}</div>
            <div className="label">Total Inventory Value</div>
          </div>
        </div>
      )}

      <div className="ent-page-table">
        <table>
          <thead>
            <tr><th>Item</th><th>Stock Account</th><th style={{ textAlign: "right" }}>Qty on Hand</th><th style={{ textAlign: "right" }}>Avg Cost</th><th style={{ textAlign: "right" }}>Value</th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="ent-empty">Loading…</td></tr>}
            {!loading && data?.rows.length === 0 && <tr><td colSpan={5} className="ent-empty">No stock on hand.</td></tr>}
            {data?.rows.map((r) => (
              <tr key={r.item.id}>
                <td style={{ fontWeight: 500 }}>{r.item.sku} — {r.item.name}</td>
                <td style={{ color: "var(--color-muted)" }}>{r.stockAccount.accountName}</td>
                <td style={{ textAlign: "right" }}>{r.quantityOnHand} {r.item.uom}</td>
                <td style={{ textAlign: "right" }}>{r.averageCost.toFixed(2)}</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{r.value.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function ItemValuationPage() {
  return (
    <AppShell>
      <CostingMethodGate>
        <ItemValuationInner />
      </CostingMethodGate>
    </AppShell>
  );
}
