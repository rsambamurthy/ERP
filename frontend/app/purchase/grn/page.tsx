"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import CostingMethodGate from "@/components/inventory/CostingMethodGate";
import { ApiError, createGoodsReceiptNote, getGoodsReceiptNote, getGoodsReceiptNotes, getPurchaseOrders } from "@/lib/api";
import { round2 } from "@/lib/discountGst";
import type { GoodsReceiptNote, PurchaseOrder } from "@/lib/types";

interface DraftLine {
  purchaseOrderLineId: string;
  itemSku: string;
  itemName: string;
  ordered: number;
  received: number; // already received before this GRN, across every prior GRN
  remaining: number;
  quantityReceived: number;
}

function GoodsReceiptNotesInner() {
  const searchParams = useSearchParams();
  const initialPoId = searchParams.get("purchaseOrderId") ?? "";

  const [grns, setGrns] = useState<GoodsReceiptNote[]>([]);
  const [approvedPOs, setApprovedPOs] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [selectedPo, setSelectedPo] = useState<PurchaseOrder | null>(null);
  const [grnDate, setGrnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);

  const [detail, setDetail] = useState<GoodsReceiptNote | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Approved POs that still have something open to receive — a fully
  // received (or not-yet-approved) PO doesn't belong in the picker.
  const receivablePOs = useMemo(
    () => approvedPOs.filter((po) => po.lines.some((l) => round2(Number(l.quantity) - Number(l.receivedQuantity)) > 0)),
    [approvedPOs]
  );

  async function loadAll() {
    setLoading(true);
    try {
      const [grnRes, poRes] = await Promise.all([getGoodsReceiptNotes(), getPurchaseOrders({ status: "APPROVED" })]);
      setGrns(grnRes.data);
      setApprovedPOs(poRes.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load Goods Receipt Notes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  function selectPo(po: PurchaseOrder | null) {
    setSelectedPo(po);
    if (!po) { setDraftLines([]); return; }
    const open = po.lines
      .map((l) => {
        const ordered = Number(l.quantity);
        const received = Number(l.receivedQuantity);
        const remaining = round2(ordered - received);
        return { purchaseOrderLineId: l.id, itemSku: l.item.sku, itemName: l.item.name, ordered, received, remaining, quantityReceived: remaining };
      })
      .filter((l) => l.remaining > 0);
    setDraftLines(open);
  }

  function resetForm() {
    setSelectedPo(null);
    setDraftLines([]);
    setGrnDate(new Date().toISOString().slice(0, 10));
    setNarration("");
  }

  function startCreate() {
    resetForm();
    setShowForm(true);
    setDetail(null); setDetailError(null);
  }

  // Deep link from the Purchase Order detail screen ("Receive Goods" link)
  // — ?purchaseOrderId=<id> opens the form pre-selected, once the approved
  // POs have loaded.
  useEffect(() => {
    if (!initialPoId || approvedPOs.length === 0) return;
    const po = approvedPOs.find((p) => p.id === initialPoId);
    if (po) {
      selectPo(po);
      setShowForm(true);
    }
    // Only meant to run once, off the URL param present at first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPoId, approvedPOs]);

  function updateLineQty(i: number, qty: number) {
    setDraftLines((ls) => ls.map((l, idx) => idx === i ? { ...l, quantityReceived: qty } : l));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPo) return;
    setSaving(true);
    setError(null);
    const lines = draftLines
      .filter((l) => l.quantityReceived > 0)
      .map((l) => ({ purchaseOrderLineId: l.purchaseOrderLineId, quantityReceived: l.quantityReceived }));
    if (lines.length === 0) {
      setError("Enter a received quantity for at least one line.");
      setSaving(false);
      return;
    }
    try {
      await createGoodsReceiptNote({ purchaseOrderId: selectedPo.id, grnDate, narration: narration || undefined, lines });
      setShowForm(false);
      resetForm();
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post Goods Receipt Note.");
    } finally {
      setSaving(false);
    }
  }

  async function openDetail(id: string) {
    setShowForm(false);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await getGoodsReceiptNote(id);
      setDetail(res.data);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : "Could not load Goods Receipt Note.");
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <>
      <div className="ent-page-hdr">
        <h1>Goods Receipt Notes</h1>
        <p>Record what's physically received against an approved Purchase Order — this is what actually brings stock in. The vendor's Purchase Bill is raised against what's received here, not directly against the order.</p>
      </div>

      <div className="ent-toolbar">
        <div style={{ flex: 1 }} />
        <button
          className="ent-btn-add"
          onClick={() => { if (showForm) { setShowForm(false); resetForm(); } else { startCreate(); } }}
        >
          {showForm ? "Cancel" : "+ New Goods Receipt Note"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSave} className="ent-section">
          <div className="ent-section-hdr">
            <span className="ent-section-title">New Goods Receipt Note</span>
          </div>
          <div className="ent-form-grid" style={{ gridTemplateColumns: "2fr 1fr 2fr" }}>
            <div className="ent-fg">
              <label className="ent-fl">Purchase Order</label>
              <select
                className="ent-fc"
                value={selectedPo?.id ?? ""}
                onChange={(e) => selectPo(receivablePOs.find((p) => p.id === e.target.value) ?? null)}
                required
              >
                <option value="">Select an approved order with open lines…</option>
                {receivablePOs.map((po) => <option key={po.id} value={po.id}>{po.poNumber} — {po.businessPartner.name}</option>)}
              </select>
            </div>
            <div className="ent-fg">
              <label className="ent-fl">GRN Date</label>
              <input type="date" className="ent-fc" value={grnDate} onChange={(e) => setGrnDate(e.target.value)} required />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Narration <span style={{ fontWeight: 400, color: "var(--color-muted)" }}>(optional)</span></label>
              <input className="ent-fc" value={narration} onChange={(e) => setNarration(e.target.value)} />
            </div>
          </div>

          {selectedPo && (
            <div style={{ padding: "0 14px" }}>
              <table className="ent-table">
                <thead><tr><th>Item</th><th>Ordered</th><th>Received so far</th><th>Remaining</th><th>Qty to Receive</th></tr></thead>
                <tbody>
                  {draftLines.map((l, i) => (
                    <tr key={l.purchaseOrderLineId}>
                      <td>{l.itemSku} — {l.itemName}</td>
                      <td>{l.ordered}</td>
                      <td>{l.received}</td>
                      <td>{l.remaining}</td>
                      <td>
                        <input
                          type="number" min={0} max={l.remaining} step="0.0001" className="ent-fc"
                          value={l.quantityReceived || ""}
                          onChange={(e) => updateLineQty(i, Math.min(Number(e.target.value), l.remaining))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {error && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 10px" }}>{error}</p>}
          <div style={{ padding: "0 14px 14px" }}>
            <button type="submit" className="ent-btn-save" disabled={saving || !selectedPo}>
              {saving ? "Posting…" : "Post Goods Receipt Note"}
            </button>
          </div>
        </form>
      )}

      {error && !showForm && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {(detailLoading || detail || detailError) && (
        <div className="ent-section">
          <div className="ent-section-hdr">
            <span className="ent-section-title">{detail ? detail.grnNumber : "Loading…"}</span>
            <button type="button" className="ent-ia ent-ia-edit" onClick={() => { setDetail(null); setDetailError(null); }}>Close</button>
          </div>
          {detailLoading && <p style={{ padding: "0 14px 14px", fontSize: 13, color: "var(--color-muted)" }}>Loading…</p>}
          {detailError && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 14px" }}>{detailError}</p>}
          {detail && (
            <>
              <div style={{ padding: "0 14px 10px", fontSize: 13, color: "var(--color-muted)" }}>
                {new Date(detail.grnDate).toLocaleDateString()} · {detail.businessPartner.name} · against {detail.purchaseOrder.poNumber}
                {detail.narration ? ` · ${detail.narration}` : ""}
              </div>
              <div style={{ padding: "0 14px" }}>
                <table className="ent-table">
                  <thead><tr><th>Item</th><th>Qty Received</th><th>Unit Cost</th><th>Value</th><th>Billed</th></tr></thead>
                  <tbody>
                    {detail.lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.item.sku} — {l.item.name}</td>
                        <td>{Number(l.quantityReceived)}</td>
                        <td>{Number(l.unitCost).toFixed(2)}</td>
                        <td>{(Number(l.quantityReceived) * Number(l.unitCost)).toFixed(2)}</td>
                        <td style={{ color: Number(l.billedQuantity) > 0 ? "#166534" : "var(--color-muted)" }}>{Number(l.billedQuantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      <div className="ent-page-table">
        <table>
          <thead><tr><th>GRN #</th><th>Date</th><th>Purchase Order</th><th>Vendor</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={4} className="ent-empty">Loading…</td></tr>}
            {!loading && grns.length === 0 && <tr><td colSpan={4} className="ent-empty">No Goods Receipt Notes yet.</td></tr>}
            {grns.map((g) => (
              <tr key={g.id} style={{ cursor: "pointer" }} onClick={() => openDetail(g.id)}>
                <td style={{ fontWeight: 500 }}>{g.grnNumber}</td>
                <td style={{ color: "var(--color-muted)" }}>{new Date(g.grnDate).toLocaleDateString()}</td>
                <td>{g.purchaseOrder.poNumber}</td>
                <td>{g.businessPartner.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function GoodsReceiptNotesPage() {
  return (
    <AppShell>
      <CostingMethodGate>
        <Suspense fallback={null}>
          <GoodsReceiptNotesInner />
        </Suspense>
      </CostingMethodGate>
    </AppShell>
  );
}
