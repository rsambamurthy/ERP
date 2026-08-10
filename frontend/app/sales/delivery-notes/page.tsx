"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import CostingMethodGate from "@/components/inventory/CostingMethodGate";
import { ApiError, createDeliveryNote, getDeliveryNote, getDeliveryNotes, getSalesOrders } from "@/lib/api";
import { round2 } from "@/lib/discountGst";
import type { DeliveryNote, SalesOrder } from "@/lib/types";

interface DraftLine {
  salesOrderLineId: string;
  itemSku: string;
  itemName: string;
  ordered: number;
  delivered: number; // already delivered before this note, across every prior Delivery Note
  remaining: number;
  quantityDelivered: number;
}

function DeliveryNotesInner() {
  const searchParams = useSearchParams();
  const initialSoId = searchParams.get("salesOrderId") ?? "";

  const [notes, setNotes] = useState<DeliveryNote[]>([]);
  const [approvedSOs, setApprovedSOs] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [selectedSo, setSelectedSo] = useState<SalesOrder | null>(null);
  const [dnDate, setDnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);

  const [detail, setDetail] = useState<DeliveryNote | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Approved SOs that still have something open to deliver — a fully
  // delivered (or not-yet-approved) SO doesn't belong in the picker.
  const deliverableSOs = useMemo(
    () => approvedSOs.filter((so) => so.lines.some((l) => round2(Number(l.quantity) - Number(l.deliveredQuantity)) > 0)),
    [approvedSOs]
  );

  async function loadAll() {
    setLoading(true);
    try {
      const [dnRes, soRes] = await Promise.all([getDeliveryNotes(), getSalesOrders({ status: "APPROVED" })]);
      setNotes(dnRes.data);
      setApprovedSOs(soRes.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load Delivery Notes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  function selectSo(so: SalesOrder | null) {
    setSelectedSo(so);
    if (!so) { setDraftLines([]); return; }
    const open = so.lines
      .map((l) => {
        const ordered = Number(l.quantity);
        const delivered = Number(l.deliveredQuantity);
        const remaining = round2(ordered - delivered);
        return { salesOrderLineId: l.id, itemSku: l.item.sku, itemName: l.item.name, ordered, delivered, remaining, quantityDelivered: remaining };
      })
      .filter((l) => l.remaining > 0);
    setDraftLines(open);
  }

  function resetForm() {
    setSelectedSo(null);
    setDraftLines([]);
    setDnDate(new Date().toISOString().slice(0, 10));
    setNarration("");
  }

  function startCreate() {
    resetForm();
    setShowForm(true);
    setDetail(null); setDetailError(null);
  }

  // Deep link from the Sales Order detail screen ("Deliver Goods" link) —
  // ?salesOrderId=<id> opens the form pre-selected, once the approved SOs
  // have loaded.
  useEffect(() => {
    if (!initialSoId || approvedSOs.length === 0) return;
    const so = approvedSOs.find((s) => s.id === initialSoId);
    if (so) {
      selectSo(so);
      setShowForm(true);
    }
    // Only meant to run once, off the URL param present at first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSoId, approvedSOs]);

  function updateLineQty(i: number, qty: number) {
    setDraftLines((ls) => ls.map((l, idx) => idx === i ? { ...l, quantityDelivered: qty } : l));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSo) return;
    setSaving(true);
    setError(null);
    const lines = draftLines
      .filter((l) => l.quantityDelivered > 0)
      .map((l) => ({ salesOrderLineId: l.salesOrderLineId, quantityDelivered: l.quantityDelivered }));
    if (lines.length === 0) {
      setError("Enter a delivered quantity for at least one line.");
      setSaving(false);
      return;
    }
    try {
      await createDeliveryNote({ salesOrderId: selectedSo.id, dnDate, narration: narration || undefined, lines });
      setShowForm(false);
      resetForm();
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post Delivery Note.");
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
      const res = await getDeliveryNote(id);
      setDetail(res.data);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : "Could not load Delivery Note.");
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <>
      <div className="ent-page-hdr">
        <h1>Delivery Notes</h1>
        <p>Record what's physically dispatched against an approved Sales Order — this is what actually moves stock out. The customer's Sales Invoice is raised against what's delivered here, not directly against the order.</p>
      </div>

      <div className="ent-toolbar">
        <div style={{ flex: 1 }} />
        <button
          className="ent-btn-add"
          onClick={() => { if (showForm) { setShowForm(false); resetForm(); } else { startCreate(); } }}
        >
          {showForm ? "Cancel" : "+ New Delivery Note"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSave} className="ent-section">
          <div className="ent-section-hdr">
            <span className="ent-section-title">New Delivery Note</span>
          </div>
          <div className="ent-form-grid" style={{ gridTemplateColumns: "2fr 1fr 2fr" }}>
            <div className="ent-fg">
              <label className="ent-fl">Sales Order</label>
              <select
                className="ent-fc"
                value={selectedSo?.id ?? ""}
                onChange={(e) => selectSo(deliverableSOs.find((s) => s.id === e.target.value) ?? null)}
                required
              >
                <option value="">Select an approved order with open lines…</option>
                {deliverableSOs.map((so) => <option key={so.id} value={so.id}>{so.soNumber} — {so.businessPartner.name}</option>)}
              </select>
            </div>
            <div className="ent-fg">
              <label className="ent-fl">DN Date</label>
              <input type="date" className="ent-fc" value={dnDate} onChange={(e) => setDnDate(e.target.value)} required />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Narration <span style={{ fontWeight: 400, color: "var(--color-muted)" }}>(optional)</span></label>
              <input className="ent-fc" value={narration} onChange={(e) => setNarration(e.target.value)} />
            </div>
          </div>

          {selectedSo && (
            <div style={{ padding: "0 14px" }}>
              <table className="ent-table">
                <thead><tr><th>Item</th><th>Ordered</th><th>Delivered so far</th><th>Remaining</th><th>Qty to Deliver</th></tr></thead>
                <tbody>
                  {draftLines.map((l, i) => (
                    <tr key={l.salesOrderLineId}>
                      <td>{l.itemSku} — {l.itemName}</td>
                      <td>{l.ordered}</td>
                      <td>{l.delivered}</td>
                      <td>{l.remaining}</td>
                      <td>
                        <input
                          type="number" min={0} max={l.remaining} step="0.0001" className="ent-fc"
                          value={l.quantityDelivered || ""}
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
            <button type="submit" className="ent-btn-save" disabled={saving || !selectedSo}>
              {saving ? "Posting…" : "Post Delivery Note"}
            </button>
          </div>
        </form>
      )}

      {error && !showForm && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {(detailLoading || detail || detailError) && (
        <div className="ent-section">
          <div className="ent-section-hdr">
            <span className="ent-section-title">{detail ? detail.dnNumber : "Loading…"}</span>
            <button type="button" className="ent-ia ent-ia-edit" onClick={() => { setDetail(null); setDetailError(null); }}>Close</button>
          </div>
          {detailLoading && <p style={{ padding: "0 14px 14px", fontSize: 13, color: "var(--color-muted)" }}>Loading…</p>}
          {detailError && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 14px" }}>{detailError}</p>}
          {detail && (
            <>
              <div style={{ padding: "0 14px 10px", fontSize: 13, color: "var(--color-muted)" }}>
                {new Date(detail.dnDate).toLocaleDateString()} · {detail.businessPartner.name} · against {detail.salesOrder.soNumber}
                {detail.narration ? ` · ${detail.narration}` : ""}
              </div>
              <div style={{ padding: "0 14px" }}>
                <table className="ent-table">
                  <thead><tr><th>Item</th><th>Qty Delivered</th><th>Rate</th><th>Value</th><th>Invoiced</th></tr></thead>
                  <tbody>
                    {detail.lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.item.sku} — {l.item.name}</td>
                        <td>{Number(l.quantityDelivered)}</td>
                        <td>{Number(l.rate).toFixed(2)}</td>
                        <td>{(Number(l.quantityDelivered) * Number(l.rate)).toFixed(2)}</td>
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
          <thead><tr><th>DN #</th><th>Date</th><th>Sales Order</th><th>Customer</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={4} className="ent-empty">Loading…</td></tr>}
            {!loading && notes.length === 0 && <tr><td colSpan={4} className="ent-empty">No Delivery Notes yet.</td></tr>}
            {notes.map((n) => (
              <tr key={n.id} style={{ cursor: "pointer" }} onClick={() => openDetail(n.id)}>
                <td style={{ fontWeight: 500 }}>{n.dnNumber}</td>
                <td style={{ color: "var(--color-muted)" }}>{new Date(n.dnDate).toLocaleDateString()}</td>
                <td>{n.salesOrder.soNumber}</td>
                <td>{n.businessPartner.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function DeliveryNotesPage() {
  return (
    <AppShell>
      <CostingMethodGate>
        <Suspense fallback={null}>
          <DeliveryNotesInner />
        </Suspense>
      </CostingMethodGate>
    </AppShell>
  );
}
