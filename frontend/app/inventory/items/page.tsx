"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import AccountPicker from "@/components/shared/AccountPicker";
import CostingMethodGate from "@/components/inventory/CostingMethodGate";
import { ApiError, createItem, getItems, getStockAccounts, getExpenseAccounts, toggleItem } from "@/lib/api";
import { canManageItems } from "@/lib/auth";
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
  // STOCK or SERVICE — see migration_029. Fixed at creation: it decides
  // which kind of account stockAccountId points at, and changing it later
  // would re-point whatever the item has already posted.
  itemKind: "STOCK" as "STOCK" | "SERVICE",
  stockAccountId: "", salesRate: "", purchaseRate: "", taxRate: "0", defaultDiscountPct: "0",
  openingQuantity: "", openingCost: "",
});

function ItemsPageInner() {
  const [items, setItems] = useState<Item[]>([]);
  const [stockAccounts, setStockAccounts] = useState<Account[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm());

  async function loadAll() {
    setLoading(true);
    try {
      const [itemsRes, accountsRes, expenseRes] = await Promise.all([
        getItems(), getStockAccounts(), getExpenseAccounts(),
      ]);
      setItems(itemsRes.data);
      setStockAccounts(accountsRes.data);
      setExpenseAccounts(expenseRes.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load items.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  const bulk = useBulkUpload<ItemUploadRow>("items", "SmartERP_Items_Template.xlsx", ITEM_UPLOAD_COLUMNS, loadAll);

  const canManage = canManageItems();

  // Same client-side filter as Business Partners: the list endpoint has no
  // pagination, so every item is already in memory and a round trip per
  // keystroke would buy nothing.
  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)
    );
  }, [items, search]);

  async function handleToggle(itemId: string) {
    try {
      await toggleItem(itemId);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change item status.");
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createItem({
        itemKind: form.itemKind,
        sku: form.sku, name: form.name, description: form.description || undefined,
        uom: form.uom, hsnCode: form.hsnCode || undefined, isFinishedGood: form.isFinishedGood,
        stockAccountId: form.stockAccountId,
        salesRate: form.salesRate ? Number(form.salesRate) : undefined,
        purchaseRate: form.purchaseRate ? Number(form.purchaseRate) : undefined,
        taxRate: form.taxRate ? Number(form.taxRate) : undefined,
        defaultDiscountPct: form.defaultDiscountPct ? Number(form.defaultDiscountPct) : undefined,
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
        <input
          className="ent-fc"
          style={{ flex: "1 1 300px", maxWidth: 400, height: 34 }}
          placeholder="Search by code or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <span style={{ fontSize: 12.5, color: "var(--color-muted)", whiteSpace: "nowrap" }}>
            {visibleItems.length} of {items.length}
            <button type="button" className="ent-ia ent-ia-edit" style={{ marginLeft: 8 }} onClick={() => setSearch("")}>
              Clear
            </button>
          </span>
        )}
        <div style={{ flex: 1 }} />
        {bulk.buttons}
        <button className="ent-btn-add" onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "+ New Item"}</button>
      </div>

      {bulk.panel}

      {showForm && (
        <form onSubmit={handleCreate} className="ent-section">
          <div className="ent-section-hdr"><span className="ent-section-title">New Item</span></div>
          <div className="ent-form-grid">
            <div className="ent-fg" style={{ gridColumn: "1 / -1" }}>
              <label className="ent-fl">Kind</label>
              <div style={{ display: "flex", gap: 16, alignItems: "center", minHeight: 34 }}>
                {(["STOCK", "SERVICE"] as const).map((k) => (
                  <label key={k} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="item-kind"
                      checked={form.itemKind === k}
                      // Clear the account: the two kinds draw from different
                      // lists, so a code carried over from the other one
                      // would fail validation server-side.
                      onChange={() => setForm((f) => ({ ...f, itemKind: k, stockAccountId: "" }))}
                    />
                    {k === "STOCK" ? "Stock item" : "Service / expense"}
                  </label>
                ))}
              </div>
              <span style={{ fontSize: 12, color: "var(--color-muted)" }}>
                {form.itemKind === "STOCK"
                  ? "Holds quantity and posts to a stock control account."
                  : "No stock. Posts to an expense account — use this for rent, telecom, subscriptions and other billed services so their GST still lands as input credit. Purchase-only: it can't be sold or stock-adjusted."}
              </span>
            </div>
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
              <label className="ent-fl">{form.itemKind === "SERVICE" ? "Expense Account" : "Stock Account"}</label>
              <AccountPicker
                accounts={form.itemKind === "SERVICE" ? expenseAccounts : stockAccounts}
                value={form.stockAccountId || null}
                onChange={(id) => setForm((f) => ({ ...f, stockAccountId: id ?? "" }))}
                required
              />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Tax Rate %</label>
              <input type="number" min={0} step="0.01" className="ent-fc" value={form.taxRate} onChange={(e) => setForm((f) => ({ ...f, taxRate: e.target.value }))} />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Default Discount %</label>
              <input type="number" min={0} step="0.01" className="ent-fc" value={form.defaultDiscountPct} onChange={(e) => setForm((f) => ({ ...f, defaultDiscountPct: e.target.value }))} />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Sales Rate</label>
              <input type="number" min={0} step="0.01" className="ent-fc" value={form.salesRate} onChange={(e) => setForm((f) => ({ ...f, salesRate: e.target.value }))} />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Purchase Rate</label>
              <input type="number" min={0} step="0.01" className="ent-fc" value={form.purchaseRate} onChange={(e) => setForm((f) => ({ ...f, purchaseRate: e.target.value }))} />
            </div>
            {form.itemKind === "STOCK" && (
              <>
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
              </>
            )}
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
          <thead><tr><th>Code</th><th>Name</th><th>Kind</th><th>Account</th><th style={{ textAlign: "right" }}>On Hand</th><th>Status</th><th /></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="ent-empty">Loading…</td></tr>}
            {!loading && items.length === 0 && <tr><td colSpan={7} className="ent-empty">No items yet.</td></tr>}
            {!loading && items.length > 0 && visibleItems.length === 0 && (
              <tr><td colSpan={7} className="ent-empty">No item matches “{search}”.</td></tr>
            )}
            {visibleItems.map((i) => (
              <tr key={i.id}>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>{i.sku}</td>
                <td style={{ fontWeight: 500 }}>
                  <Link href={`/inventory/items/${i.id}`} style={{ color: "inherit", textDecoration: "none" }}>
                    {i.name}
                  </Link>
                </td>
                <td>
                  <span className={i.itemKind === "SERVICE" ? "badge badge-purple" : "badge badge-gray"}>
                    {i.itemKind === "SERVICE" ? "Service" : "Stock"}
                  </span>
                </td>
                <td style={{ color: "var(--color-muted)" }}>{i.stockAccount.accountName}</td>
                <td style={{ textAlign: "right" }}>
                  {i.itemKind === "SERVICE" ? "—" : `${i.totalQuantityOnHand} ${i.uom}`}
                </td>
                <td><span className={i.isActive ? "badge badge-green" : "badge badge-gray"}>{i.isActive ? "Active" : "Inactive"}</span></td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <Link href={`/inventory/items/${i.id}`} className="ent-ia ent-ia-edit" style={{ marginRight: 6 }}>View</Link>
                  {canManage && (
                    <button className="ent-ia ent-ia-edit" onClick={() => handleToggle(i.id)}>
                      {i.isActive ? "Deactivate" : "Activate"}
                    </button>
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

export default function ItemsPage() {
  return (
    <AppShell>
      <CostingMethodGate>
        <ItemsPageInner />
      </CostingMethodGate>
    </AppShell>
  );
}
