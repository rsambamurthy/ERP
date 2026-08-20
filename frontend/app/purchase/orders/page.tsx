"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import PartnerPicker from "@/components/shared/PartnerPicker";
import CurrencyPicker from "@/components/shared/CurrencyPicker";
import ItemPicker from "@/components/shared/ItemPicker";
import {
  ApiError, approvePurchaseOrder, cancelPurchaseOrder, createPurchaseOrder, downloadPurchaseOrderPdf, getBranches,
  getBusinessPartnerLookup, getItems, getPurchaseOrder, getPurchaseOrders, lookupCurrencyRate, rejectPurchaseOrder, reopenPurchaseOrder,
  submitPurchaseOrder, updatePurchaseOrder,
} from "@/lib/api";
import { round2 } from "@/lib/discountGst";
import { canApprovePurchaseOrders, canReceiveGoods } from "@/lib/auth";
import type { Branch, BusinessPartnerLookup, Item, PurchaseOrder, PurchaseOrderLineInput, PurchaseOrderStatus } from "@/lib/types";
import { PURCHASE_ORDER_STATUS_LABELS, SUPPORTED_CURRENCIES } from "@/lib/types";

const emptyLine = (): PurchaseOrderLineInput => ({ itemId: "", quantity: 0, rate: 0, rateFc: 0, taxRate: 0 });

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
  const [vendors, setVendors] = useState<BusinessPartnerLookup[]>([]);
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
  const [currency, setCurrency] = useState("INR");
  const [exchangeRate, setExchangeRate] = useState("1");
  const isForeign = currency !== "INR";

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
  const canReceive = canReceiveGoods();

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
        getPurchaseOrders(), getItems(), getBusinessPartnerLookup("VENDOR"), getBranches(),
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
    setCurrency("INR"); setExchangeRate("1");
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
    setLines(order.lines.map((l) => ({
      itemId: l.itemId, quantity: Number(l.quantity), rate: Number(l.rate),
      rateFc: l.rateFc != null ? Number(l.rateFc) : 0, taxRate: Number(l.taxRate),
    })));
    setCurrency(order.currency); setExchangeRate(order.exchangeRate);
    setEditingId(order.id);
    setShowForm(true);
  }

  function pickItem(i: number, itemId: string) {
    const item = itemById.get(itemId);
    setLines((ls) => ls.map((l, idx) => idx !== i ? l : {
      ...l, itemId,
      // Item master rates are always INR — only useful as a default when
      // the PO itself is in INR. A foreign-currency line starts blank.
      rate: !isForeign && item?.purchaseRate ? Number(item.purchaseRate) : 0,
      rateFc: 0,
      taxRate: item?.taxRate ? Number(item.taxRate) : 0,
    }));
  }

  function updateLine(i: number, patch: Partial<PurchaseOrderLineInput>) {
    setLines((ls) => ls.map((l, idx) => {
      if (idx !== i) return l;
      const next = { ...l, ...patch };
      // rateFc is authoritative for a foreign-currency PO — rate (INR) is
      // always the derived figure the totals preview uses, kept in lockstep
      // here so it matches what the server computes. Same convention as
      // the Purchase Bill / Sales Invoice forms.
      if (isForeign && patch.rateFc !== undefined) {
        next.rate = round2(Number(next.rateFc || 0) * Number(exchangeRate || 0));
      }
      return next;
    }));
  }

  function handleExchangeRateChange(v: string) {
    setExchangeRate(v);
    const fx = Number(v || 0);
    setLines((ls) => ls.map((l) => ({ ...l, rate: round2(Number(l.rateFc || 0) * fx) })));
  }

  // Pre-fill the Exchange Rate field from Currency Master (see
  // app/settings/currency-master) the moment the user has a foreign
  // currency and a PO date selected — same lookup/rationale as the Sales
  // Invoice / Purchase Bill forms.
  useEffect(() => {
    if (!isForeign || !poDate) return;
    let cancelled = false;
    lookupCurrencyRate(currency, poDate)
      .then((res) => {
        if (!cancelled && res.data) handleExchangeRateChange(String(res.data.rate));
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, poDate, isForeign]);

  async function handleSaveDraft(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      businessPartnerId, poDate,
      expectedDeliveryDate: expectedDeliveryDate || undefined,
      narration,
      lines: lines.filter((l) => l.itemId && l.quantity > 0),
      currency, exchangeRate: isForeign ? Number(exchangeRate) : undefined,
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
              <PartnerPicker
                partners={vendors}
                value={businessPartnerId || null}
                onChange={(id) => setBusinessPartnerId(id ?? "")}
                required
              />
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

          <div className="ent-form-grid" style={{ gridTemplateColumns: isForeign ? "1fr 1fr 2fr" : "1fr 3fr" }}>
            <div className="ent-fg">
              <label className="ent-fl">Currency</label>
              <CurrencyPicker
                currencies={SUPPORTED_CURRENCIES}
                value={currency || null}
                onChange={(code) => setCurrency(code ?? "")}
              />
            </div>
            {isForeign && (
              <div className="ent-fg">
                <label className="ent-fl">Exchange Rate (1 {currency} = ₹)</label>
                <input type="number" min={0} step="0.000001" className="ent-fc" value={exchangeRate} onChange={(e) => handleExchangeRateChange(e.target.value)} required />
              </div>
            )}
            <div className="ent-fg">
              <label className="ent-fl">&nbsp;</label>
              <span style={{ fontSize: 12, color: "var(--color-muted)" }}>
                {isForeign
                  ? `Import PO — enter each line's rate in ${currency}. A Purchase Bill raised against this PO will bill in the same currency.`
                  : "Domestic PO — INR only."}
              </span>
            </div>
          </div>

          <div style={{ padding: "0 14px" }}>
            <table className="ent-table">
              <thead><tr><th style={{ width: "40%" }}>Item</th><th>Qty</th><th>Rate{isForeign ? ` (${currency})` : " (₹)"}</th>{isForeign && <th>Rate (₹)</th>}<th>Tax %</th><th /></tr></thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i}>
                    <td>
                      <ItemPicker
                        items={items.filter((it) => it.isActive && it.itemKind === "STOCK")}
                        value={line.itemId || null}
                        onChange={(id) => pickItem(i, id ?? "")}
                      />
                    </td>
                    <td><input type="number" min={0} step="0.0001" className="ent-fc" value={line.quantity || ""} onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })} /></td>
                    {isForeign ? (
                      <>
                        <td><input type="number" min={0} step="0.01" className="ent-fc" value={line.rateFc || ""} onChange={(e) => updateLine(i, { rateFc: Number(e.target.value) })} /></td>
                        <td style={{ color: "var(--color-muted)" }}>{(line.rate || 0).toFixed(2)}</td>
                      </>
                    ) : (
                      <td><input type="number" min={0} step="0.01" className="ent-fc" value={line.rate || ""} onChange={(e) => updateLine(i, { rate: Number(e.target.value) })} /></td>
                    )}
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
              {isForeign && Number(exchangeRate) > 0 && (
                <span>≈ <strong>{currency} {round2(totals.grand / Number(exchangeRate)).toFixed(2)}</strong></span>
              )}
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
                {detail.currency !== "INR" && ` · ${detail.currency} @ ${Number(detail.exchangeRate).toFixed(4)}`}
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
                      <th>Received</th><th>Billed</th><th>Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((l) => {
                      const ordered = Number(l.quantity);
                      const received = Number(l.receivedQuantity);
                      const billed = Number(l.billedQuantity);
                      return (
                        <tr key={l.id}>
                          <td>{l.item.sku} — {l.item.name}</td>
                          <td>{ordered}</td>
                          <td>{Number(l.rate).toFixed(2)}</td>
                          <td>{Number(l.taxRate).toFixed(2)}</td>
                          <td>{Number(l.lineTotal).toFixed(2)}</td>
                          <td style={{ color: received > 0 ? "#0e7490" : "var(--color-muted)" }}>{received}</td>
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
                {detail.currency !== "INR" && detail.grandTotalFc !== null && (
                  <span>≈ <strong>{detail.currency} {Number(detail.grandTotalFc).toFixed(2)}</strong></span>
                )}
              </div>

              {detail.goodsReceiptNotes && detail.goodsReceiptNotes.length > 0 && (
                <div style={{ padding: "0 14px 14px" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-muted)", marginBottom: 6 }}>
                    Goods Receipt Notes against this order
                  </div>
                  <table className="ent-table">
                    <thead><tr><th>GRN #</th><th>Date</th></tr></thead>
                    <tbody>
                      {detail.goodsReceiptNotes.map((g) => (
                        <tr key={g.id}>
                          <td>{g.grnNumber}</td>
                          <td>{new Date(g.grnDate).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

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
                    {canReceive && detail.lines.some((l) => round2(Number(l.quantity) - Number(l.receivedQuantity)) > 0) && (
                      <Link className="ent-btn-save" style={{ textDecoration: "none" }} href={`/purchase/grn?purchaseOrderId=${detail.id}`}>
                        Receive Goods
                      </Link>
                    )}
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
