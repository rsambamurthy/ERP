"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import CostingMethodGate from "@/components/inventory/CostingMethodGate";
import { ApiError, createItem, getItems, getStockAccounts } from "@/lib/api";
import { useBulkUpload } from "@/components/shared/BulkUpload";
import type { Account, Item, ItemUploadRow } from "@/lib/types";

const ITEM_UPLOAD_COLUMNS: { key: keyof ItemUploadRow; label: string }[] = [
  { key: "sku", label: "SKU" },
  { key: "name", label: "Name" },
  { key: "stockAccountCode", label: "Stock Account" },
  { key: "openingQuantity", label: "Opening Qty" },
  { key: "openingCost", label: "Opening Cost" },
];

const emptyForm = () => ({
  sku: "", name: "", description: "", uom: "EA", hsnCode: "", isFinishedGood: false,
  stockAccountId: "", salesRate: "", purchaseRate: "", taxRate: "0",
  openingQuantity: "", openingCost: "",
});

function ItemsPageInner() {
  const [items, setItems] = useState<Item[]>([]);
  const [stockAccounts, setStockAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm());

  async function loadAll() {
    setLoading(true);
    try {
      const [itemsRes, accountsRes] = await Promise.all([getItems(), getStockAccounts()]);
      setItems(itemsRes.data);
      setStockAccounts(accountsRes.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load items.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  const bulk = useBulkUpload<ItemUploadRow>("items", "SmartERP_Items_Template.xlsx", ITEM_UPLOAD_COLUMNS, loadAll);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createItem({
        sku: form.sku, name: form.name, description: form.description || undefined,
        uom: form.uom, hsnCode: form.hsnCode || undefined, isFinishedGood: form.isFinishedGood,
        stockAccountId: form.stockAccountId,
        salesRate: form.salesRate ? Number(form.salesRate) : undefined,
        purchaseRate: form.purchaseRate ? Number(form.purchaseRate) : undefined,
        taxRate: form.taxRate ? Number(form.taxRate) : undefined,
        openingQuantity: form.openingQuantity ? Number(form.openingQuantity) : undefined,
        openingCost: form.openingCost ? Number(form.openingCost) : undefined,
      });
      setShowForm(false);
      setForm(emptyForm());
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create item.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="ent-page-hdr">
        <h1>Items</h1>
        <p>Your product/material master — what Sales, Purchase, and Inventory all point at.</p>
      </div>

      <div className="ent-toolbar">
        <div style={{ flex: 1 }} />
        {bulk.buttons}
        <button className="ent-btn-add" onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "+ New Item"}</button>
      </div>

      {bulk.panel}

      {showForm && (
        <form onSubmit={handleCreate} className="ent-section">
          <div className="ent-section-hdr"><span className="ent-section-title">New Item</span></div>
          <div className="ent-form-grid">
            <div className="ent-fg">
              <label className="ent-fl">Item Code</label>
              <input className="ent-fc" value={form.sku} onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} required />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Name</label>
              <input className="ent-fc" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">UOM</label>
              <input className="ent-fc" value={form.uom} onChange={(e) => setForm((f) => ({ ...f, uom: e.target.value }))} />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">HSN/SAC Code</label>
              <input className="ent-fc" value={form.hsnCode} onChange={(e) => setForm((f) => ({ ...f, hsnCode: e.target.value }))} />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Stock Account</label>
              <select className="ent-fc" value={form.stockAccountId} onChange={(e) => setForm((f) => ({ ...f, stockAccountId: e.target.value }))} required>
                <option value="">Select…</option>
                {stockAccounts.map((a) => <option key={a.id} value={a.id}>{a.accountCode} — {a.accountName}</option>)}
              </select>
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Tax Rate %</label>
              <input type="number" min={0} step="0.01" className="ent-fc" value={form.taxRate} onChange={(e) => setForm((f) => ({ ...f, taxRate: e.target.value }))} />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Sales Rate</label>
              <input type="number" min={0} step="0.01" className="ent-fc" value={form.salesRate} onChange={(e) => setForm((f) => ({ ...f, salesRate: e.target.value }))} />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Purchase Rate</label>
              <input type="number" min={0} step="0.01" className="ent-fc" value={form.purchaseRate} onChange={(e) => setForm((f) => ({ ...f, purchaseRate: e.target.value }))} />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Opening Quantity (optional)</label>
              <input type="number" min={0} step="0.0001" className="ent-fc" value={form.openingQuantity} onChange={(e) => setForm((f) => ({ ...f, openingQuantity: e.target.value }))} />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Opening Cost / unit</label>
              <input type="number" min={0} step="0.01" className="ent-fc" value={form.openingCost} onChange={(e) => setForm((f) => ({ ...f, openingCost: e.target.value }))} />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">
                <input type="checkbox" checked={form.isFinishedGood} onChange={(e) => setForm((f) => ({ ...f, isFinishedGood: e.target.checked }))} /> Finished good
              </label>
            </div>
          </div>
          {error && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 10px" }}>{error}</p>}
          <div style={{ padding: "0 14px 14px" }}>
            <button type="submit" className="ent-btn-save" disabled={saving}>{saving ? "Saving…" : "Create Item"}</button>
          </div>
        </form>
      )}

      {error && !showForm && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="ent-page-table">
        <table>
          <thead><tr><th>Code</th><th>Name</th><th>Stock Account</th><th style={{ textAlign: "right" }}>On Hand</th><th>Status</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="ent-empty">Loading…</td></tr>}
            {!loading && items.length === 0 && <tr><td colSpan={5} className="ent-empty">No items yet.</td></tr>}
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.sku}</td>
                <td style={{ fontWeight: 500 }}>{i.name}</td>
                <td style={{ color: "var(--color-muted)" }}>{i.stockAccount.accountName}</td>
                <td style={{ textAlign: "right" }}>{i.totalQuantityOnHand} {i.uom}</td>
                <td><span className={i.isActive ? "badge badge-green" : "badge badge-gray"}>{i.isActive ? "Active" : "Inactive"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function ItemsPage() {
  return (
    <AppShell>
      <CostingMethodGate>
        <ItemsPageInner />
      </CostingMethodGate>
    </AppShell>
  );
}
