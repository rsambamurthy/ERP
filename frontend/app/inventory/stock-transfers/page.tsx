"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import {
  ApiError, cancelStockTransfer, createStockTransfer, getBranches, getItems,
  getStockTransfer, getStockTransfers, receiveStockTransfer,
} from "@/lib/api";
import { canPostTransactions } from "@/lib/auth";
import type { Branch, Item, StockTransferDetail, StockTransferSummary } from "@/lib/types";

// Stock transfers between branches.
//
// One screen rather than a list and a detail page, because a transfer has a
// short life: it is dispatched, and then it is received. Expanding a row
// shows what is on it and the two things that can still be done to it.
//
// The accounting worth knowing while reading this: dispatch debits 1304 Stock
// in Transit and credits the sending branch's stock; receipt does the
// reverse at the other end. Both entries balance on their own because a
// journal entry can only carry one branch — and 1304 is zero whenever
// nothing is on a lorry, which makes it a month-end control.

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const STATUS_BADGE: Record<string, string> = {
  DISPATCHED: "badge badge-yellow",
  RECEIVED: "badge badge-green",
  CANCELLED: "badge badge-gray",
};
const STATUS_LABEL: Record<string, string> = {
  DISPATCHED: "In transit",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

interface LineDraft { key: string; itemId: string; quantity: string }
let seq = 0;
const nextKey = () => `r${++seq}`;

export default function StockTransfersPage() {
  const canPost = canPostTransactions();

  const [rows, setRows] = useState<StockTransferSummary[]>([]);
  const [status, setStatus] = useState("DISPATCHED");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<StockTransferDetail | null>(null);

  const [creating, setCreating] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [form, setForm] = useState({
    fromBranchId: "", toBranchId: "", transferDate: today(),
    documentNumber: "", ewayBillNumber: "",
  });
  const [draft, setDraft] = useState<LineDraft[]>([]);

  const load = useCallback(async (s: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getStockTransfers(s);
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load transfers.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(status); }, [status, load]);

  async function toggleRow(id: string) {
    if (expanded === id) { setExpanded(null); setDetail(null); return; }
    setExpanded(id);
    setDetail(null);
    try {
      const res = await getStockTransfer(id);
      setDetail(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load that transfer.");
    }
  }

  async function beginCreate() {
    setCreating(true);
    setError(null);
    setDraft([{ key: nextKey(), itemId: "", quantity: "" }]);
    try {
      const [b, i] = await Promise.all([getBranches(), getItems()]);
      const live = b.data.filter((x) => x.status !== "INACTIVE");
      setBranches(live);
      setItems(i.data.filter((x) => x.itemKind !== "SERVICE" && x.isActive));
      setForm((f) => ({ ...f, fromBranchId: f.fromBranchId || (live[0]?.id ?? "") }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the pickers.");
    }
  }

  async function run(fn: () => Promise<string>) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const msg = await fn();
      setNotice(msg);
      setExpanded(null); setDetail(null);
      await load(status);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not post. Nothing was written.");
    } finally {
      setBusy(false);
    }
  }

  const muted = { color: "var(--color-muted)", fontSize: 12 } as const;
  const num = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

  const from = branches.find((b) => b.id === form.fromBranchId);
  const to = branches.find((b) => b.id === form.toBranchId);
  // Shown before anything is submitted, because the server will refuse it and
  // it is better to say so while the form is still being filled in.
  const differentGstin = !!from && !!to
    && (from.gstin ?? "").trim().toUpperCase() !== (to.gstin ?? "").trim().toUpperCase();

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Stock Transfers</h1>
        <p>
          Goods moving from one branch to another. Dispatched stock sits in 1304 Stock in Transit until the
          receiving branch confirms it — which is where it actually is.
        </p>
      </div>

      <div className="ent-toolbar">
        <label className="ent-fl" style={{ margin: 0 }}>Status</label>
        <select className="ent-fc" style={{ width: 160, height: 34 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="DISPATCHED">In transit</option>
          <option value="RECEIVED">Received</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="ALL">All</option>
        </select>
        <span style={muted}>{loading ? "Loading…" : `${rows.length} transfer${rows.length === 1 ? "" : "s"}`}</span>
        <div style={{ flex: 1 }} />
        {canPost && !creating && <button className="ent-btn-add" onClick={beginCreate}>New Transfer</button>}
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {notice && (
        <div className="ent-section" style={{ marginBottom: 16, padding: 14 }}>
          <p style={{ fontSize: 13, margin: 0 }}>
            {notice}{" "}
            <Link href="/accounting/journal" className="ent-ia ent-ia-edit" style={{ padding: 0 }}>View journal</Link>
          </p>
        </div>
      )}

      {creating && (
        <div className="ent-section" style={{ marginBottom: 16 }}>
          <div className="ent-section-hdr"><span className="ent-section-title">New transfer</span></div>
          <div style={{ padding: 14 }}>
            <div className="ent-form-grid">
              <div className="ent-fg">
                <span className="ent-fl">From</span>
                <select className="ent-fc" value={form.fromBranchId} onChange={(e) => setForm((f) => ({ ...f, fromBranchId: e.target.value }))}>
                  <option value="">Pick a branch…</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                {from && <span style={muted}>GSTIN {from.gstin || "not set"}</span>}
              </div>
              <div className="ent-fg">
                <span className="ent-fl">To</span>
                <select className="ent-fc" value={form.toBranchId} onChange={(e) => setForm((f) => ({ ...f, toBranchId: e.target.value }))}>
                  <option value="">Pick a branch…</option>
                  {branches.filter((b) => b.id !== form.fromBranchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                {to && <span style={muted}>GSTIN {to.gstin || "not set"}</span>}
              </div>
              <div className="ent-fg">
                <span className="ent-fl">Dispatch date</span>
                <input type="date" className="ent-fc" value={form.transferDate}
                  onChange={(e) => setForm((f) => ({ ...f, transferDate: e.target.value }))} />
              </div>
              <div className="ent-fg">
                <span className="ent-fl">Delivery challan no.</span>
                <input type="text" className="ent-fc" maxLength={30} value={form.documentNumber}
                  onChange={(e) => setForm((f) => ({ ...f, documentNumber: e.target.value }))} />
                <span style={muted}>Rule 55 requires the challan; the number here is for your record.</span>
              </div>
              <div className="ent-fg">
                <span className="ent-fl">E-way bill no.</span>
                <input type="text" className="ent-fc" maxLength={20} value={form.ewayBillNumber}
                  onChange={(e) => setForm((f) => ({ ...f, ewayBillNumber: e.target.value }))} />
                <span style={muted}>Needed above ₹50,000 under Rule 138; intra-state limits vary by state.</span>
              </div>
            </div>

            {/* Said here rather than after a failed submit. Two registrations
                are distinct persons under section 25(4), so this would be a
                taxable supply — which is not built. */}
            {differentGstin && (
              <div className="ent-section" style={{ marginTop: 12, padding: "10px 14px", borderLeft: "3px solid #b45309" }}>
                <p style={{ fontSize: 13, margin: 0 }}>
                  <strong>{from?.name}</strong> and <strong>{to?.name}</strong> have different GSTINs. Under section
                  25(4) they are distinct persons, so moving goods between them is a taxable supply — it needs a tax
                  invoice and GST, not a delivery challan. Taxable branch transfers are not built yet, so this will
                  be refused rather than posted without the tax.
                </p>
              </div>
            )}

            <table style={{ width: "100%", marginTop: 12 }}>
              <thead>
                <tr><th>Item</th><th style={{ width: 180 }}>Quantity</th><th style={{ width: 70 }} /></tr>
              </thead>
              <tbody>
                {draft.map((d, i) => (
                  <tr key={d.key}>
                    <td>
                      <select className="ent-fc" value={d.itemId}
                        onChange={(e) => setDraft((r) => r.map((x, j) => j === i ? { ...x, itemId: e.target.value } : x))}>
                        <option value="">Pick an item…</option>
                        {items.map((it) => <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <input type="number" min={0} step="0.0001" className="ent-fc" value={d.quantity}
                        onChange={(e) => setDraft((r) => r.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button className="ent-ia ent-ia-del" onClick={() => setDraft((r) => r.filter((_, j) => j !== i))}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="ent-ia ent-ia-edit"
                onClick={() => setDraft((d) => [...d, { key: nextKey(), itemId: "", quantity: "" }])}>
                Add item
              </button>
              <div style={{ flex: 1 }} />
              <button className="ent-btn-add" disabled={busy || differentGstin}
                onClick={() => run(async () => {
                  const lines = draft
                    .filter((d) => d.itemId && Number(d.quantity) > 0)
                    .map((d) => ({ itemId: d.itemId, quantity: Number(d.quantity) }));
                  if (lines.length === 0) throw new ApiError("Add at least one item with a quantity.", 400);
                  const r = await createStockTransfer({
                    fromBranchId: form.fromBranchId, toBranchId: form.toBranchId,
                    transferDate: form.transferDate,
                    documentNumber: form.documentNumber.trim() || undefined,
                    ewayBillNumber: form.ewayBillNumber.trim() || undefined,
                    lines,
                  });
                  setCreating(false);
                  return `${r.data.transferNumber} dispatched — ${money(r.data.total)} into stock in transit.`;
                })}>
                {busy ? "Dispatching…" : "Dispatch"}
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
              <th style={{ width: 110 }}>Transfer</th>
              <th style={{ width: 110 }}>Dispatched</th>
              <th>Route</th>
              <th style={{ width: 90, ...num }}>Items</th>
              <th style={{ width: 140, ...num }}>Value</th>
              <th style={{ width: 120 }}>Status</th>
              <th style={{ width: 80 }} />
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="ent-empty">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={7} className="ent-empty">No transfers.</td></tr>}
            {!loading && rows.map((t) => (
              // Fragment carries the key, not the rows inside it — a row and
              // its expanded detail are two <tr> for one transfer.
              <Fragment key={t.id}>
                <tr>
                  <td style={{ fontWeight: 500 }}>{t.transferNumber}</td>
                  <td>{t.transferDate}</td>
                  <td>
                    {t.fromBranch.name} → {t.toBranch.name}
                    {t.documentNumber && <div style={muted}>Challan {t.documentNumber}</div>}
                    {t.receivedDate && <div style={muted}>Received {t.receivedDate}</div>}
                  </td>
                  <td style={num}>{t.lineCount}</td>
                  <td style={num}>{money(t.totalValue)}</td>
                  <td><span className={STATUS_BADGE[t.status] ?? "badge badge-gray"}>{STATUS_LABEL[t.status] ?? t.status}</span></td>
                  <td style={{ textAlign: "right" }}>
                    <button className="ent-ia ent-ia-edit" onClick={() => toggleRow(t.id)}>
                      {expanded === t.id ? "Hide" : "Open"}
                    </button>
                  </td>
                </tr>
                {expanded === t.id && (
                  <tr>
                    <td colSpan={7} style={{ background: "#fafcff" }}>
                      {!detail && <p style={muted}>Loading…</p>}
                      {detail && (
                        <div style={{ padding: "4px 0 8px" }}>
                          <table style={{ width: "100%" }}>
                            <thead>
                              <tr>
                                <th>Item</th>
                                <th style={{ width: 130, ...num }}>Quantity</th>
                                <th style={{ width: 130, ...num }}>Cost each</th>
                                <th style={{ width: 140, ...num }}>Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.lines.map((l) => (
                                <tr key={l.id}>
                                  <td>{l.item.sku} — {l.item.name}</td>
                                  <td style={num}>{l.quantity} {l.item.uom}</td>
                                  <td style={num}>{money(l.unitCost)}</td>
                                  <td style={num}>{money(l.lineValue)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {canPost && detail.status === "DISPATCHED" && (
                            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                              <button className="ent-btn-add" disabled={busy}
                                onClick={() => run(async () => {
                                  const r = await receiveStockTransfer(detail.id, today());
                                  return `${detail.transferNumber} received at ${detail.toBranch.name} — ${money(r.data.total)}.`;
                                })}>
                                Receive at {detail.toBranch.name}
                              </button>
                              <button className="ent-ia ent-ia-del" disabled={busy}
                                onClick={() => {
                                  if (!window.confirm(
                                    `Cancel ${detail.transferNumber}?\n\nThe goods return to ${detail.fromBranch.name} `
                                    + "and a reversing entry is posted. Only possible while they are still in transit.",
                                  )) return;
                                  void run(async () => {
                                    const r = await cancelStockTransfer(detail.id, today());
                                    return `${detail.transferNumber} cancelled — ${money(r.data.total)} returned to ${detail.fromBranch.name}.`;
                                  });
                                }}>
                                Cancel and return
                              </button>
                            </div>
                          )}
                          {detail.status === "RECEIVED" && (
                            <p style={{ ...muted, marginTop: 10 }}>
                              Received at {detail.toBranch.name} on {detail.receivedDate}. To move it back, raise a
                              transfer the other way — cancelling now would take stock off a branch that is holding it.
                            </p>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
