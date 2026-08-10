"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import {
  ApiError, approvePurchaseOrder, cancelPurchaseOrder, createPurchaseOrder, downloadPurchaseOrderPdf, getBranches,
  getBusinessPartners, getItems, getPurchaseOrder, getPurchaseOrders, rejectPurchaseOrder, reopenPurchaseOrder,
  submitPurchaseOrder, updatePurchaseOrder,
} from "@/lib/api";
import { round2 } from "@/lib/discountGst";
import { canApprovePurchaseOrders } from "@/lib/auth";
import type { Branch, BusinessPartner, Item, PurchaseOrder, PurchaseOrderLineInput, PurchaseOrderStatus } from "@/lib/types";
import { PURCHASE_ORDER_STATUS_LABELS } from "@/lib/types";

const emptyLine = (): PurchaseOrderLineInput => ({ itemId: "", quantity: 0, rate: 0, taxRate: 0 });

const STATUS_COLORS: Record<PurchaseOrderStatus, { bg: string; fg: string }> = {
  DRAFT: { bg: "#f1f5f9", fg: "#475569" },
  PENDING_APPROVAL: { bg: "#fef3c7", fg: "#92400e" },
  APPROVED: { bg: "#dcfce7", fg: "#166534" },
  REJECTED: { bg: "#fee2e2", fg: "#991b1b" },
  CANCELLED: { bg: "#f1f5f9", fg: "#64748b" },
  CLOSED: { bg: "#e0e7ff", fg: "#3730a3" },
};

function StatusBadge({ status }: { status: PurchaseOrderStatus }) {
  const c = STATUS_COLORS[status];
  return (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 600,
      background: c.bg, color: c.fg,
    }}>
      {PURCHASE_ORDER_STATUS_LABELS[status]}
    </span>
  );
}

function PurchaseOrdersInner() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [vendors, setVendors] = useState<BusinessPartner[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [businessPartnerId, setBusinessPartnerId] = useState("");
  const [poDate, setPoDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<PurchaseOrderLineInput[]>([emptyLine()]);

  const [detail, setDetail] = useState<PurchaseOrder | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const canApprove = canApprovePurchaseOrders();

  const totals = useMemo(() => {
    let subtotal = 0, tax = 0;
    for (const l of lines) {
      const s = round2(Number(l.quantity || 0) * Number(l.rate || 0));
      const t = round2(s * Number(l.taxRate || 0) / 100);
      subtotal += s; tax += t;
    }
    return { subtotal, tax, grand: round2(subtotal + tax) };
  }, [lines]);

  async function loadAll() {
    setLoading(true);
    try {
      const [ordersRes, itemsRes, vendorsRes, branchRes] = await Promise.all([
        getPurchaseOrders(), getItems(), getBusinessPartners("VENDOR"), getBranches(),
      ]);
      setOrders(ordersRes.data);
      setItems(itemsRes.data);
      setVendors(vendorsRes.data);
      setBranches(branchRes.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load purchase orders.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  function resetForm() {
    setBusinessPartnerId(""); setPoDate(new Date().toISOString().slice(0, 10));
    setExpectedDeliveryDate(""); setNarration(""); setLines([emptyLine()]);
    setEditingId(null);
  }

  function startCreate() {
    resetForm();
    setShowForm(true);
    setDetail(null); setDetailError(null);
  }

  function startEdit(order: PurchaseOrder) {
    setBusinessPartnerId(order.businessPartner.id);
    setPoDate(order.poDate.slice(0, 10));
    setExpectedDeliveryDate(order.expectedDeliveryDate ? order.expectedDeliveryDate.slice(0, 10) : "");
    setNarration(order.narration);
    setLines(order.lines.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity), rate: Number(l.rate), taxRate: Number(l.taxRate) })));
    setEditingId(order.id);
    setShowForm(true);
  }

  function pickItem(i: number, itemId: string) {
    const item = itemById.get(itemId);
    setLines((ls) => ls.map((l, idx) => idx !== i ? l : {
      ...l, itemId,
      rate: item?.purchaseRate ? Number(item.purchaseRate) : 0,
      taxRate: item?.taxRate ? Number(item.taxRate) : 0,
    }));
  }

  function updateLine(i: number, patch: Partial<PurchaseOrderLineInput>) {
    setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }

  async function handleSaveDraft(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      businessPartnerId, poDate,
      expectedDeliveryDate: expectedDeliveryDate || undefined,
      narration,
      lines: lines.filter((l) => l.itemId && l.quantity > 0),
    };
    try {
      if (editingId) {
        await updatePurchaseOrder(editingId, body);
      } else {
        await createPurchaseOrder(body);
      }
      setShowForm(false);
      resetForm();
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save Purchase Order.");
    } finally {
      setSaving(false);
    }
  }

  async function openDetail(id: string) {
    setShowForm(false);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    setActionError(null);
    setRejecting(false);
    setRejectReason("");
    try {
      const res = await getPurchaseOrder(id);
      setDetail(res.data);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : "Could not load Purchase Order.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function refreshDetail(id: string) {
    const res = await getPurchaseOrder(id);
    setDetail(res.data);
    await loadAll();
  }

  // Returns whether it succeeded, so callers (like the reject form) can
  // decide whether to also reset their own local state.
  async function runAction(id: string, fn: () => Promise<unknown>): Promise<boolean> {
    setActionBusy(true);
    setActionError(null);
    try {
      await fn();
      await refreshDetail(id);
      return true;
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Action failed.");
      return false;
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDownloadPdf(order: PurchaseOrder) {
    setDownloadingPdf(true);
    setActionError(null);
    try {
      await downloadPurchaseOrderPdf(order.id, order.poNumber);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not download the PDF.");
    } finally {
      setDownloadingPdf(false);
    }
  }

  return (
    <>
      <div className="ent-page-hdr">
        <h1>Purchase Orders</h1>
        <p>Draft, submit, and approve orders before they're billed — a Purchase Order never posts to the books; only an approved order can be turned into a Purchase Bill.</p>
      </div>

      <div className="ent-toolbar">
        <div style={{ flex: 1 }} />
        <button
          className="ent-btn-add"
          onClick={() => {
            if (showForm) { setShowForm(false); resetForm(); } else { startCreate(); }
          }}
        >
          {showForm ? "Cancel" : "+ New Purchase Order"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSaveDraft} className="ent-section">
          <div className="ent-section-hdr">
            <span className="ent-section-title">{editingId ? "Edit Purchase Order (Draft)" : "New Purchase Order"}</span>
          </div>
          <div className="ent-form-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr 2fr" }}>
            <div className="ent-fg">
              <label className="ent-fl">Vendor</label>
              <select className="ent-fc" value={businessPartnerId} onChange={(e) => setBusinessPartnerId(e.target.value)} required>
                <option value="">Select…</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div className="ent-fg">
              <label className="ent-fl">PO Date</label>
              <input type="date" className="ent-fc" value={poDate} onChange={(e) => setPoDate(e.target.value)} required />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Expected Delivery <span style={{ fontWeight: 400, color: "var(--color-muted)" }}>(optional)</span></label>
              <input type="date" className="ent-fc" value={expectedDeliveryDate} onChange={(e) => setExpectedDeliveryDate(e.target.value)} />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Narration</label>
              <input className="ent-fc" value={narration} onChange={(e) => setNarration(e.target.value)} />
            </div>
          </div>

          <div style={{ padding: "0 14px" }}>
            <table className="ent-table">
              <thead><tr><th style={{ width: "40%" }}>Item</th><th>Qty</th><th>Rate (₹)</th><th>Tax %</th><th /></tr></thead>
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
              display: "flex", flexWrap: "wrap", gap: "6px 18px", alignItems: "center",
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
            <button type="submit" className="ent-btn-save" disabled={saving || !businessPartnerId}>
              {saving ? "Saving…" : editingId ? "Save Draft" : "Create Draft"}
            </button>
          </div>
        </form>
      )}

      {error && !showForm && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {(detailLoading || detail || detailError) && (
        <div className="ent-section">
          <div className="ent-section-hdr">
            <span className="ent-section-title">
              {detail ? `${detail.poNumber} ` : "Loading…"}
              {detail && <StatusBadge status={detail.status} />}
            </span>
            {detail && (
              <button type="button" className="ent-ia ent-ia-edit" disabled={downloadingPdf} onClick={() => handleDownloadPdf(detail)}>
                {downloadingPdf ? "Downloading…" : "Download PDF"}
              </button>
            )}
            <button type="button" className="ent-ia ent-ia-edit" onClick={() => { setDetail(null); setDetailError(null); }}>Close</button>
          </div>
          {detailLoading && <p style={{ padding: "0 14px 14px", fontSize: 13, color: "var(--color-muted)" }}>Loading…</p>}
          {detailError && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 14px" }}>{detailError}</p>}
          {detail && (
            <>
              <div style={{ padding: "0 14px 10px", fontSize: 13, color: "var(--color-muted)" }}>
                {new Date(detail.poDate).toLocaleDateString()} · {detail.businessPartner.name}
                {detail.expectedDeliveryDate && ` · Expected ${new Date(detail.expectedDeliveryDate).toLocaleDateString()}`}
                {detail.narration ? ` · ${detail.narration}` : ""}
              </div>

              {detail.status === "REJECTED" && (
                <p style={{ padding: "0 14px 10px", fontSize: 13, color: "#991b1b" }}>
                  Rejected{detail.rejectedAt ? ` on ${new Date(detail.rejectedAt).toLocaleDateString()}` : ""}: {detail.rejectionReason}
                </p>
              )}
              {detail.status === "APPROVED" && detail.autoApproved && (
                <p style={{ padding: "0 14px 10px", fontSize: 13, color: "#166534" }}>
                  Auto-approved on submission — below the organization's Purchase Order threshold.
                </p>
              )}
              {detail.status === "CANCELLED" && (
                <p style={{ padding: "0 14px 10px", fontSize: 13, color: "var(--color-muted)" }}>
                  Cancelled{detail.cancelledAt ? ` on ${new Date(detail.cancelledAt).toLocaleDateString()}` : ""}.
                </p>
              )}

              <div style={{ padding: "0 14px" }}>
                <table className="ent-table">
                  <thead>
                    <tr>
                      <th>Item</th><th>Qty Ordered</th><th>Rate</th><th>Tax %</th><th>Line Total</th>
                      <th>Billed</th><th>Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((l) => {
                      const ordered = Number(l.quantity);
                      const billed = Number(l.billedQuantity);
                      return (
                        <tr key={l.id}>
                          <td>{l.item.sku} — {l.item.name}</td>
                          <td>{ordered}</td>
                          <td>{Number(l.rate).toFixed(2)}</td>
                          <td>{Number(l.taxRate).toFixed(2)}</td>
                          <td>{Number(l.lineTotal).toFixed(2)}</td>
                          <td style={{ color: billed > 0 ? "#166534" : "var(--color-muted)" }}>{billed}</td>
                          <td>{round2(ordered - billed)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{
                display: "flex", flexWrap: "wrap", gap: "6px 18px", alignItems: "center",
                background: "#f8fafd", border: "1px solid var(--color-border)", borderRadius: 6,
                padding: "8px 14px", fontSize: 13, margin: "10px 14px 14px",
              }}>
                <span>Subtotal: <strong>{Number(detail.subtotal).toFixed(2)}</strong></span>
                <span>Tax: <strong>{Number(detail.taxTotal).toFixed(2)}</strong></span>
                <span>Grand Total: <strong>{Number(detail.grandTotal).toFixed(2)}</strong></span>
              </div>

              {detail.purchaseBills && detail.purchaseBills.length > 0 && (
                <div style={{ padding: "0 14px 14px" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-muted)", marginBottom: 6 }}>
                    Purchase Bills raised against this order
                  </div>
                  <table className="ent-table">
                    <thead><tr><th>Bill #</th><th>Date</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
                    <tbody>
                      {detail.purchaseBills.map((b) => (
                        <tr key={b.id}>
                          <td>{b.billNumber}</td>
                          <td>{new Date(b.billDate).toLocaleDateString()}</td>
                          <td style={{ textAlign: "right" }}>{Number(b.grandTotal).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {actionError && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 10px" }}>{actionError}</p>}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "0 14px 14px" }}>
                {detail.status === "DRAFT" && (
                  <>
                    <button type="button" className="ent-ia ent-ia-edit" onClick={() => startEdit(detail)}>Edit</button>
                    <button type="button" className="ent-btn-save" disabled={actionBusy} onClick={() => runAction(detail.id, () => submitPurchaseOrder(detail.id))}>
                      {actionBusy ? "Submitting…" : "Submit for Approval"}
                    </button>
                    <button type="button" className="ent-ia ent-ia-del" disabled={actionBusy} onClick={() => runAction(detail.id, () => cancelPurchaseOrder(detail.id))}>Cancel Order</button>
                  </>
                )}

                {detail.status === "PENDING_APPROVAL" && (
                  canApprove ? (
                    !rejecting ? (
                      <>
                        <button type="button" className="ent-btn-save" disabled={actionBusy} onClick={() => runAction(detail.id, () => approvePurchaseOrder(detail.id))}>
                          {actionBusy ? "Approving…" : "Approve"}
                        </button>
                        <button type="button" className="ent-ia ent-ia-del" disabled={actionBusy} onClick={() => setRejecting(true)}>Reject</button>
                        <button type="button" className="ent-ia ent-ia-del" disabled={actionBusy} onClick={() => runAction(detail.id, () => cancelPurchaseOrder(detail.id))}>Cancel Order</button>
                      </>
                    ) : (
                      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", width: "100%" }}>
                        <input
                          className="ent-fc" style={{ flex: 1 }} placeholder="Reason for rejection"
                          value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                        />
                        <button
                          type="button" className="ent-btn-save" disabled={actionBusy || !rejectReason.trim()}
                          onClick={async () => {
                            const ok = await runAction(detail.id, () => rejectPurchaseOrder(detail.id, rejectReason.trim()));
                            if (ok) { setRejecting(false); setRejectReason(""); }
                          }}
                        >
                          {actionBusy ? "Rejecting…" : "Confirm Reject"}
                        </button>
                        <button type="button" className="ent-ia ent-ia-edit" onClick={() => { setRejecting(false); setRejectReason(""); }}>Cancel</button>
                      </div>
                    )
                  ) : (
                    <p style={{ fontSize: 13, color: "var(--color-muted)" }}>Awaiting approval from someone with approval authority.</p>
                  )
                )}

                {detail.status === "APPROVED" && (
                  <>
                    <Link className="ent-btn-save" style={{ textDecoration: "none" }} href={`/purchase/bills?purchaseOrderId=${detail.id}`}>
                      Create Purchase Bill
                    </Link>
                    <button type="button" className="ent-ia ent-ia-del" disabled={actionBusy} onClick={() => runAction(detail.id, () => cancelPurchaseOrder(detail.id))}>
                      Cancel Order
                    </button>
                  </>
                )}

                {detail.status === "REJECTED" && (
                  <button type="button" className="ent-btn-save" disabled={actionBusy} onClick={() => runAction(detail.id, () => reopenPurchaseOrder(detail.id))}>
                    {actionBusy ? "Reopening…" : "Reopen to Draft"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <div className="ent-page-table">
        <table>
          <thead><tr><th>PO #</th><th>Date</th><th>Vendor</th><th>Status</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="ent-empty">Loading…</td></tr>}
            {!loading && orders.length === 0 && <tr><td colSpan={5} className="ent-empty">No purchase orders yet.</td></tr>}
            {orders.map((o) => (
              <tr key={o.id} style={{ cursor: "pointer" }} onClick={() => openDetail(o.id)}>
                <td style={{ fontWeight: 500 }}>{o.poNumber}</td>
                <td style={{ color: "var(--color-muted)" }}>{new Date(o.poDate).toLocaleDateString()}</td>
                <td>{o.businessPartner.name}</td>
                <td><StatusBadge status={o.status} /></td>
                <td style={{ textAlign: "right" }}>{Number(o.grandTotal).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function PurchaseOrdersPage() {
  return (
    <AppShell>
      <PurchaseOrdersInner />
    </AppShell>
  );
}
