"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { ApiError, createProductionOrder, getBranches, getItems, getProductionOrders } from "@/lib/api";
import { canPostTransactions } from "@/lib/auth";
import type { Branch, Item, ProductionOrderSummary } from "@/lib/types";

// Production orders.
//
// An order is opened for a quantity of a finished item; material is issued to
// it, conversion cost is added, and output is received from it. What is left
// in between is work in progress — and the whole reason the order exists is
// so that the balance of 1302 can be answered asset by asset rather than as
// one unexplained number.

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const STATUS_BADGE: Record<string, string> = {
  OPEN: "badge badge-yellow",
  COMPLETED: "badge badge-green",
  CANCELLED: "badge badge-gray",
};

export default function ProductionOrdersPage() {
  const router = useRouter();
  const canPost = canPostTransactions();

  const [rows, setRows] = useState<ProductionOrderSummary[]>([]);
  const [status, setStatus] = useState("OPEN");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [form, setForm] = useState({
    branchId: "", finishedItemId: "", orderDate: today(), plannedQuantity: "", notes: "",
  });

  const load = useCallback(async (s: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getProductionOrders(s);
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load production orders.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(status); }, [status, load]);

  async function beginCreate() {
    setCreating(true);
    setError(null);
    try {
      const [b, i] = await Promise.all([getBranches(), getItems()]);
      setBranches(b.data.filter((x) => x.status !== "INACTIVE"));
      setItems(i.data);
      setForm((f) => ({ ...f, branchId: f.branchId || (b.data[0]?.id ?? "") }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the pickers.");
    }
  }

  // Only a finished good can be the subject of an order. The flag on the item
  // master is what says which items those are, and it is the same flag that
  // reveals the Bill of Materials panel.
  const makeable = items.filter((i) => i.isFinishedGood && i.itemKind !== "SERVICE" && i.isActive);

  async function handleCreate() {
    const qty = Number(form.plannedQuantity);
    if (!form.branchId) { setError("Pick a branch."); return; }
    if (!form.finishedItemId) { setError("Pick what is being made."); return; }
    if (!Number.isFinite(qty) || qty <= 0) { setError("Planned quantity must be more than zero."); return; }

    setSaving(true);
    setError(null);
    try {
      const res = await createProductionOrder({
        branchId: form.branchId,
        orderDate: form.orderDate,
        finishedItemId: form.finishedItemId,
        plannedQuantity: qty,
        notes: form.notes.trim() || undefined,
      });
      router.push(`/manufacturing/production-orders/${res.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open the order.");
      setSaving(false);
    }
  }

  const muted = { color: "var(--color-muted)", fontSize: 12 } as const;
  const num = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Production Orders</h1>
        <p>
          Material issued to an order becomes work in progress; output received from it becomes finished goods at a
          cost the system derives rather than one anybody types.
        </p>
      </div>

      <div className="ent-toolbar">
        <label className="ent-fl" style={{ margin: 0 }}>Status</label>
        <select className="ent-fc" style={{ width: 160, height: 34 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="OPEN">Open</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="ALL">All</option>
        </select>
        <span style={muted}>{loading ? "Loading…" : `${rows.length} order${rows.length === 1 ? "" : "s"}`}</span>
        <div style={{ flex: 1 }} />
        {canPost && !creating && (
          <button className="ent-btn-add" onClick={beginCreate}>New Order</button>
        )}
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {creating && (
        <div className="ent-section" style={{ marginBottom: 16 }}>
          <div className="ent-section-hdr"><span className="ent-section-title">New production order</span></div>
          <div style={{ padding: 14 }}>
            <div className="ent-form-grid">
              <div className="ent-fg">
                <span className="ent-fl">Branch</span>
                <select className="ent-fc" value={form.branchId} onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}>
                  <option value="">Pick a branch…</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <span style={muted}>Where the job runs. Components are consumed and output received here.</span>
              </div>
              <div className="ent-fg">
                <span className="ent-fl">Making</span>
                <select className="ent-fc" value={form.finishedItemId} onChange={(e) => setForm((f) => ({ ...f, finishedItemId: e.target.value }))}>
                  <option value="">Pick a finished good…</option>
                  {makeable.map((i) => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}
                </select>
                <span style={muted}>
                  {makeable.length === 0
                    ? "No items are flagged as a finished good yet — tick that on the item master first."
                    : "Only items flagged as a finished good."}
                </span>
              </div>
              <div className="ent-fg">
                <span className="ent-fl">Planned quantity</span>
                <input type="number" min={0} step="0.0001" className="ent-fc" value={form.plannedQuantity}
                  onChange={(e) => setForm((f) => ({ ...f, plannedQuantity: e.target.value }))} />
                <span style={muted}>Explodes the bill of materials. Output may exceed it.</span>
              </div>
              <div className="ent-fg">
                <span className="ent-fl">Order date</span>
                <input type="date" className="ent-fc" value={form.orderDate}
                  onChange={(e) => setForm((f) => ({ ...f, orderDate: e.target.value }))} />
              </div>
            </div>
            <div className="ent-fg" style={{ marginTop: 10 }}>
              <span className="ent-fl">Notes</span>
              <input type="text" className="ent-fc" maxLength={255} value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button className="ent-btn-add" disabled={saving} onClick={handleCreate}>
                {saving ? "Opening…" : "Open the order"}
              </button>
              <button className="ent-btn-cancel" onClick={() => { setCreating(false); setError(null); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="ent-page-table">
        <table>
          <thead>
            <tr>
              <th style={{ width: 110 }}>Order</th>
              <th style={{ width: 110 }}>Date</th>
              <th>Making</th>
              <th style={{ width: 110, ...num }}>Planned</th>
              <th style={{ width: 110, ...num }}>Received</th>
              <th style={{ width: 130, ...num }}>Work in progress</th>
              <th style={{ width: 120, ...num }}>Unit cost</th>
              <th style={{ width: 110 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="ent-empty">Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="ent-empty">No production orders.</td></tr>
            )}
            {!loading && rows.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 500 }}>
                  <Link href={`/manufacturing/production-orders/${r.id}`} style={{ color: "inherit", textDecoration: "none" }}>
                    {r.orderNumber}
                  </Link>
                </td>
                <td>{r.orderDate}</td>
                <td>
                  {r.finishedItem.sku} — {r.finishedItem.name}
                  {r.branch && <div style={muted}>{r.branch.name}</div>}
                </td>
                <td style={num}>{r.plannedQuantity} {r.finishedItem.uom}</td>
                <td style={num}>{r.receivedQuantity}</td>
                <td style={{ ...num, fontWeight: r.wipBalance > 0 ? 600 : 400 }}>{money(r.wipBalance)}</td>
                <td style={{ ...num, color: "var(--color-muted)" }}>
                  {r.unitCostSoFar === null ? "—" : money(r.unitCostSoFar)}
                </td>
                <td>
                  <span className={STATUS_BADGE[r.status] ?? "badge badge-gray"}>
                    {r.status === "OPEN" ? "Open" : r.status === "COMPLETED" ? "Completed" : "Cancelled"}
                  </span>
                  {r.writtenOff > 0 && <div style={{ ...muted, color: "#b45309" }}>{money(r.writtenOff)} written off</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
