"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import CostingMethodGate from "@/components/inventory/CostingMethodGate";
import { ApiError, createStockAdjustment, getItems, getStockAdjustments } from "@/lib/api";
import type { Item, StockAdjustment, StockAdjustmentLineInput } from "@/lib/types";

const emptyLine = (): StockAdjustmentLineInput => ({ itemId: "", direction: "OUT", quantity: 0, unitCost: undefined });

function StockAdjustmentsInner() {
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [adjustmentDate, setAdjustmentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<StockAdjustmentLineInput[]>([emptyLine()]);

  async function loadAll() {
    setLoading(true);
    try {
      const [adjRes, itemsRes] = await Promise.all([getStockAdjustments(), getItems()]);
      setAdjustments(adjRes.data);
      setItems(itemsRes.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load stock adjustments.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  function updateLine(i: number, patch: Partial<StockAdjustmentLineInput>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createStockAdjustment({
        adjustmentDate, narration,
        lines: lines.filter((l) => l.itemId && l.quantity > 0),
      });
      setShowForm(false);
      setNarration(""); setLines([emptyLine()]);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post adjustment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="ent-page-hdr">
        <h1>Stock Adjustments</h1>
        <p>Found stock, write-offs, and corrections — both directions, one document. Posts to Inventory Adjustments.</p>
      </div>

      <div className="ent-toolbar">
        <div style={{ flex: 1 }} />
        <button className="ent-btn-add" onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "+ New Adjustment"}</button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="ent-section">
          <div className="ent-section-hdr"><span className="ent-section-title">New Stock Adjustment</span></div>
          <div className="ent-form-grid" style={{ gridTemplateColumns: "1fr 2fr" }}>
            <div className="ent-fg">
              <label className="ent-fl">Date</label>
              <input type="date" className="ent-fc" value={adjustmentDate} onChange={(e) => setAdjustmentDate(e.target.value)} required />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Narration</label>
              <input className="ent-fc" value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="e.g. physical count correction, damaged stock" />
            </div>
          </div>

          <div style={{ padding: "0 14px" }}>
            <table className="ent-table">
              <thead><tr><th style={{ width: "32%" }}>Item</th><th>Direction</th><th>Qty</th><th>Unit Cost</th><th /></tr></thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i}>
                    <td>
                      <select className="ent-fc" value={line.itemId} onChange={(e) => updateLine(i, { itemId: e.target.value })}>
                        <option value="">Select item…</option>
                        {items.filter((it) => it.isActive && it.itemKind === "STOCK").map((it) => <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="ent-fc" value={line.direction} onChange={(e) => updateLine(i, { direction: e.target.value as "IN" | "OUT", unitCost: e.target.value === "OUT" ? undefined : line.unitCost })}>
                        <option value="OUT">Out (write-off / shrinkage)</option>
                        <option value="IN">In (found stock / opening)</option>
                      </select>
                    </td>
                    <td><input type="number" min={0} step="0.0001" className="ent-fc" value={line.quantity || ""} onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })} /></td>
                    <td>
                      {line.direction === "IN" ? (
                        <input type="number" min={0} step="0.01" className="ent-fc" value={line.unitCost || ""} onChange={(e) => updateLine(i, { unitCost: Number(e.target.value) })} required />
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--color-muted)" }}>auto (current cost)</span>
                      )}
                    </td>
                    <td><button type="button" className="ent-ia ent-ia-del" disabled={lines.length <= 1} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="ent-add-row" style={{ margin: "10px 0" }} onClick={() => setLines((ls) => [...ls, emptyLine()])}>+ Add line</button>
          </div>

          {error && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 10px" }}>{error}</p>}
          <div style={{ padding: "0 14px 14px" }}>
            <button type="submit" className="ent-btn-save" disabled={saving}>{saving ? "Posting…" : "Post Adjustment"}</button>
          </div>
        </form>
      )}

      {error && !showForm && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="ent-page-table">
        <table>
          <thead><tr><th>Date</th><th>Narration</th><th>Lines</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={3} className="ent-empty">Loading…</td></tr>}
            {!loading && adjustments.length === 0 && <tr><td colSpan={3} className="ent-empty">No adjustments yet.</td></tr>}
            {adjustments.map((a) => (
              <tr key={a.id}>
                <td style={{ color: "var(--color-muted)" }}>{new Date(a.adjustmentDate).toLocaleDateString()}</td>
                <td style={{ fontWeight: 500 }}>{a.narration || "—"}</td>
                <td>
                  {a.lines.map((l) => (
                    <span key={l.id} className={l.direction === "IN" ? "badge badge-green" : "badge badge-red"} style={{ marginRight: 6 }}>
                      {l.item.sku} {l.direction} {l.quantity}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function StockAdjustmentsPage() {
  return (
    <AppShell>
      <CostingMethodGate>
        <StockAdjustmentsInner />
      </CostingMethodGate>
    </AppShell>
  );
}
