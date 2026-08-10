"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import CostingMethodGate from "@/components/inventory/CostingMethodGate";
import { ApiError, createPurchaseBill, getBranches, getBusinessPartners, getItems, getPurchaseBill, getPurchaseBills, updatePurchaseBillReference } from "@/lib/api";
import { isInterState, round2, splitGst } from "@/lib/discountGst";
import type { Branch, BusinessPartner, DocumentLineInput, Item, PurchaseBill } from "@/lib/types";
import { SUPPORTED_CURRENCIES, currencySymbol } from "@/lib/types";

const emptyLine = (): DocumentLineInput => ({ itemId: "", quantity: 0, rate: 0, rateFc: 0, taxRate: 0 });

function PurchaseBillsInner() {
  const [bills, setBills] = useState<PurchaseBill[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [vendors, setVendors] = useState<BusinessPartner[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [businessPartnerId, setBusinessPartnerId] = useState("");
  const [billDate, setBillDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<DocumentLineInput[]>([emptyLine()]);
  const [currency, setCurrency] = useState("INR");
  const [exchangeRate, setExchangeRate] = useState("1");
  const isForeign = currency !== "INR";
  // Optional at creation — the backend accepts these on POST too, for
  // whichever orgs already have the Bill of Entry before posting. Most
  // won't yet, which is why the detail view also offers PATCH-based entry
  // after the fact (see startEditBoe below).
  const [newBoeNumber, setNewBoeNumber] = useState("");
  const [newBoeDate, setNewBoeDate] = useState("");
  const [newPortCode, setNewPortCode] = useState("");

  const [detail, setDetail] = useState<PurchaseBill | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Editing Bill of Entry / port code on an already-posted import bill —
  // almost never known at posting time (customs clearance happens after),
  // so this is the normal way it gets filled in. See PATCH /purchase-bills/:id.
  const [editingBoe, setEditingBoe] = useState(false);
  const [boeNumber, setBoeNumber] = useState("");
  const [boeDate, setBoeDate] = useState("");
  const [boePort, setBoePort] = useState("");
  const [savingBoe, setSavingBoe] = useState(false);
  const [boeError, setBoeError] = useState<string | null>(null);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const selectedVendor = useMemo(() => vendors.find((v) => v.id === businessPartnerId), [vendors, businessPartnerId]);
  // No branch selector on this form yet — the server defaults to head
  // office when branchId isn't given, so the preview mirrors that here too.
  const headOffice = useMemo(() => branches.find((b) => b.isHeadOffice), [branches]);
  // An import is always inter-state (IGST) under GST law — see the same
  // note on POST /purchase-bills. Never fall back to CGST+SGST just
  // because a foreign vendor has no Indian state code on file.
  const interState = isForeign ? true : isInterState(headOffice?.stateCode, selectedVendor?.stateCode);

  const totals = useMemo(() => {
    let subtotal = 0, tax = 0, cgst = 0, sgst = 0, igst = 0;
    for (const l of lines) {
      const s = round2(Number(l.quantity || 0) * Number(l.rate || 0));
      const t = round2(s * Number(l.taxRate || 0) / 100);
      const split = splitGst(t, interState);
      subtotal += s; tax += t; cgst += split.cgst; sgst += split.sgst; igst += split.igst;
    }
    return { subtotal, tax, cgst, sgst, igst, grand: subtotal + tax };
  }, [lines, interState]);

  async function loadAll() {
    setLoading(true);
    try {
      const [billsRes, itemsRes, vendorsRes, branchRes] = await Promise.all([getPurchaseBills(), getItems(), getBusinessPartners("VENDOR"), getBranches()]);
      setBills(billsRes.data);
      setItems(itemsRes.data);
      setVendors(vendorsRes.data);
      setBranches(branchRes.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load purchase bills.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  async function openDetail(id: string) {
    setShowForm(false);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    setEditingBoe(false);
    setBoeError(null);
    try {
      const res = await getPurchaseBill(id);
      setDetail(res.data);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : "Could not load bill.");
    } finally {
      setDetailLoading(false);
    }
  }

  function startEditBoe(bill: PurchaseBill) {
    setBoeNumber(bill.billOfEntryNumber ?? "");
    setBoeDate(bill.billOfEntryDate ? bill.billOfEntryDate.slice(0, 10) : "");
    setBoePort(bill.portCode ?? "");
    setBoeError(null);
    setEditingBoe(true);
  }

  async function handleSaveBoe(id: string) {
    setSavingBoe(true);
    setBoeError(null);
    try {
      const res = await updatePurchaseBillReference(id, {
        billOfEntryNumber: boeNumber || null, billOfEntryDate: boeDate || null, portCode: boePort || null,
      });
      setDetail(res.data);
      setEditingBoe(false);
      await loadAll();
    } catch (err) {
      setBoeError(err instanceof ApiError ? err.message : "Could not save Bill of Entry details.");
    } finally {
      setSavingBoe(false);
    }
  }

  function updateLine(i: number, patch: Partial<DocumentLineInput>) {
    setLines((ls) => ls.map((l, idx) => {
      if (idx !== i) return l;
      const next = { ...l, ...patch };
      // rateFc is authoritative for a foreign-currency bill — rate (INR) is
      // always the derived figure the tax preview and item costing use,
      // kept in lockstep here so it matches what the server computes.
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

  function pickItem(i: number, itemId: string) {
    const item = itemById.get(itemId);
    updateLine(i, {
      itemId,
      // Item master rates are always INR — only useful as a default when
      // the bill itself is in INR. A foreign-currency line starts blank.
      rate: !isForeign && item?.purchaseRate ? Number(item.purchaseRate) : 0,
      rateFc: 0,
      taxRate: item?.taxRate ? Number(item.taxRate) : 0,
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createPurchaseBill({
        businessPartnerId, billDate, narration,
        lines: lines.filter((l) => l.itemId && l.quantity > 0),
        currency, exchangeRate: isForeign ? Number(exchangeRate) : undefined,
        billOfEntryNumber: isForeign ? newBoeNumber || undefined : undefined,
        billOfEntryDate: isForeign ? newBoeDate || undefined : undefined,
        portCode: isForeign ? newPortCode || undefined : undefined,
      });
      setShowForm(false);
      setBusinessPartnerId(""); setNarration(""); setLines([emptyLine()]);
      setCurrency("INR"); setExchangeRate("1");
      setNewBoeNumber(""); setNewBoeDate(""); setNewPortCode("");
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post bill.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="ent-page-hdr">
        <h1>Purchase Bills</h1>
        <p>Stock in, posted straight to the books — Trade Payables, GST Input, and each item's stock account.</p>
      </div>

      <div className="ent-toolbar">
        <div style={{ flex: 1 }} />
        <button className="ent-btn-add" onClick={() => { setShowForm((s) => !s); setDetail(null); setDetailError(null); }}>{showForm ? "Cancel" : "+ New Bill"}</button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="ent-section">
          <div className="ent-section-hdr"><span className="ent-section-title">New Purchase Bill</span></div>
          <div className="ent-form-grid" style={{ gridTemplateColumns: "1fr 1fr 2fr" }}>
            <div className="ent-fg">
              <label className="ent-fl">Vendor</label>
              <select className="ent-fc" value={businessPartnerId} onChange={(e) => setBusinessPartnerId(e.target.value)} required>
                <option value="">Select…</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Bill Date</label>
              <input type="date" className="ent-fc" value={billDate} onChange={(e) => setBillDate(e.target.value)} required />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Narration</label>
              <input className="ent-fc" value={narration} onChange={(e) => setNarration(e.target.value)} />
            </div>
          </div>

          <div className="ent-form-grid" style={{ gridTemplateColumns: isForeign ? "1fr 1fr 2fr" : "1fr 3fr" }}>
            <div className="ent-fg">
              <label className="ent-fl">Currency</label>
              <select className="ent-fc" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {SUPPORTED_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
              </select>
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
                  ? "Import bill — enter each line's rate in " + currency + "; everything else (GST, item costing, journal posting) is computed and posted in INR."
                  : "Domestic bill — INR only."}
              </span>
            </div>
          </div>

          {isForeign && (
            <div className="ent-form-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
              <div className="ent-fg">
                <label className="ent-fl">Bill of Entry Number <span style={{ fontWeight: 400, color: "var(--color-muted)" }}>(optional)</span></label>
                <input className="ent-fc" value={newBoeNumber} onChange={(e) => setNewBoeNumber(e.target.value)} placeholder="If already known" />
              </div>
              <div className="ent-fg">
                <label className="ent-fl">Bill of Entry Date <span style={{ fontWeight: 400, color: "var(--color-muted)" }}>(optional)</span></label>
                <input type="date" className="ent-fc" value={newBoeDate} onChange={(e) => setNewBoeDate(e.target.value)} />
              </div>
              <div className="ent-fg">
                <label className="ent-fl">Port Code <span style={{ fontWeight: 400, color: "var(--color-muted)" }}>(optional)</span></label>
                <input className="ent-fc" value={newPortCode} onChange={(e) => setNewPortCode(e.target.value)} placeholder="e.g. INNSA1" />
              </div>
            </div>
          )}

          <div style={{ padding: "0 14px" }}>
            <table className="ent-table">
              <thead><tr><th style={{ width: "36%" }}>Item</th><th>Qty</th><th>Rate{isForeign ? ` (${currency})` : ""}</th>{isForeign && <th>Rate (₹)</th>}<th>Tax %</th><th /></tr></thead>
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
              {interState ? (
                <span>IGST: <strong>{totals.igst.toFixed(2)}</strong></span>
              ) : (
                <>
                  <span>CGST: <strong>{totals.cgst.toFixed(2)}</strong></span>
                  <span>SGST: <strong>{totals.sgst.toFixed(2)}</strong></span>
                </>
              )}
              <span>Grand Total: <strong>{totals.grand.toFixed(2)}</strong></span>
              {isForeign && Number(exchangeRate) > 0 && (
                <span>≈ <strong>{currencySymbol(currency)}{round2(totals.grand / Number(exchangeRate)).toFixed(2)}</strong></span>
              )}
            </div>
          </div>

          {error && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 10px" }}>{error}</p>}
          <div style={{ padding: "0 14px 14px" }}>
            <button type="submit" className="ent-btn-save" disabled={saving || !businessPartnerId}>{saving ? "Posting…" : "Post Bill"}</button>
          </div>
        </form>
      )}

      {error && !showForm && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {(detailLoading || detail || detailError) && (
        <div className="ent-section">
          <div className="ent-section-hdr">
            <span className="ent-section-title">{detail ? `Bill ${detail.billNumber}` : "Loading…"}</span>
            <button type="button" className="ent-ia ent-ia-edit" onClick={() => { setDetail(null); setDetailError(null); }}>Close</button>
          </div>
          {detailLoading && <p style={{ padding: "0 14px 14px", fontSize: 13, color: "var(--color-muted)" }}>Loading…</p>}
          {detailError && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 14px" }}>{detailError}</p>}
          {detail && (() => {
            const docForeign = detail.currency !== "INR";
            // An import is always inter-state (IGST) — show that column
            // even at 0, matching what actually determined the split (see
            // the note on POST /purchase-bills).
            const docInterState = docForeign || Number(detail.igstTotal) > 0;
            return (
              <>
                <div style={{ padding: "0 14px 10px", fontSize: 13, color: "var(--color-muted)" }}>
                  {new Date(detail.billDate).toLocaleDateString()} · {detail.businessPartner.name}
                  {detail.narration ? ` · ${detail.narration}` : ""}
                  {docForeign && ` · ${detail.currency} @ ${Number(detail.exchangeRate).toFixed(4)}`}
                </div>

                {docForeign && (
                  <div style={{ padding: "0 14px 10px" }}>
                    {!editingBoe ? (
                      <div style={{
                        display: "flex", flexWrap: "wrap", gap: "6px 18px", alignItems: "center",
                        background: "#f8fafd", border: "1px solid var(--color-border)", borderRadius: 6,
                        padding: "8px 14px", fontSize: 13,
                      }}>
                        <span>Bill of Entry: <strong>{detail.billOfEntryNumber || "not added yet"}</strong>{detail.billOfEntryDate && ` (${new Date(detail.billOfEntryDate).toLocaleDateString()})`}</span>
                        <span>Port: <strong>{detail.portCode || "—"}</strong></span>
                        <button type="button" className="ent-ia ent-ia-edit" onClick={() => startEditBoe(detail)}>Edit</button>
                      </div>
                    ) : (
                      <div className="ent-form-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                        <div className="ent-fg">
                          <label className="ent-fl">Bill of Entry Number</label>
                          <input className="ent-fc" value={boeNumber} onChange={(e) => setBoeNumber(e.target.value)} />
                        </div>
                        <div className="ent-fg">
                          <label className="ent-fl">Bill of Entry Date</label>
                          <input type="date" className="ent-fc" value={boeDate} onChange={(e) => setBoeDate(e.target.value)} />
                        </div>
                        <div className="ent-fg">
                          <label className="ent-fl">Port Code</label>
                          <input className="ent-fc" value={boePort} onChange={(e) => setBoePort(e.target.value)} placeholder="e.g. INNSA1" />
                        </div>
                        <div className="ent-fg" style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                          <button type="button" className="ent-btn-save" disabled={savingBoe} onClick={() => handleSaveBoe(detail.id)}>{savingBoe ? "Saving…" : "Save"}</button>
                          <button type="button" className="ent-ia ent-ia-edit" onClick={() => setEditingBoe(false)}>Cancel</button>
                        </div>
                        {boeError && <p style={{ color: "#dc2626", fontSize: 13, gridColumn: "1 / -1" }}>{boeError}</p>}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ padding: "0 14px" }}>
                  <table className="ent-table">
                    <thead>
                      <tr>
                        <th>Item</th><th>Qty</th><th>Rate</th>{docForeign && <th>Rate ({detail.currency})</th>}<th>Subtotal</th>
                        {docInterState ? <th>IGST</th> : <><th>CGST</th><th>SGST</th></>}
                        <th style={{ textAlign: "right" }}>Line Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lines.map((l) => (
                        <tr key={l.id}>
                          <td>{l.item.sku} — {l.item.name}</td>
                          <td>{l.quantity}</td>
                          <td>{Number(l.rate).toFixed(2)}</td>
                          {docForeign && <td>{Number(l.rateFc ?? 0).toFixed(2)}</td>}
                          <td>{Number(l.lineSubtotal).toFixed(2)}</td>
                          {docInterState ? (
                            <td>{Number(l.igstAmount).toFixed(2)}</td>
                          ) : (
                            <>
                              <td>{Number(l.cgstAmount).toFixed(2)}</td>
                              <td>{Number(l.sgstAmount).toFixed(2)}</td>
                            </>
                          )}
                          <td style={{ textAlign: "right" }}>{Number(l.lineTotal).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{
                  display: "flex", flexWrap: "wrap", gap: "6px 18px", alignItems: "center",
                  background: "#f8fafd", border: "1px solid var(--color-border)", borderRadius: 6,
                  padding: "8px 14px", fontSize: 13, margin: "10px 14px 14px",
                }}>
                  <span>Subtotal: <strong>{Number(detail.subtotal).toFixed(2)}</strong></span>
                  {docInterState ? (
                    <span>IGST: <strong>{Number(detail.igstTotal).toFixed(2)}</strong></span>
                  ) : (
                    <>
                      <span>CGST: <strong>{Number(detail.cgstTotal).toFixed(2)}</strong></span>
                      <span>SGST: <strong>{Number(detail.sgstTotal).toFixed(2)}</strong></span>
                    </>
                  )}
                  <span>Grand Total: <strong>{Number(detail.grandTotal).toFixed(2)}</strong></span>
                  {docForeign && detail.grandTotalFc != null && (
                    <span>≈ <strong>{currencySymbol(detail.currency)}{Number(detail.grandTotalFc).toFixed(2)}</strong></span>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      )}

      <div className="ent-page-table">
        <table>
          <thead><tr><th>Bill #</th><th>Date</th><th>Vendor</th><th style={{ textAlign: "right" }}>Amount</th><th /></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="ent-empty">Loading…</td></tr>}
            {!loading && bills.length === 0 && <tr><td colSpan={5} className="ent-empty">No bills yet.</td></tr>}
            {bills.map((b) => (
              <tr key={b.id} style={{ cursor: "pointer" }} onClick={() => openDetail(b.id)}>
                <td style={{ fontWeight: 500 }}>{b.billNumber}</td>
                <td style={{ color: "var(--color-muted)" }}>{new Date(b.billDate).toLocaleDateString()}</td>
                <td>{b.businessPartner.name}</td>
                <td style={{ textAlign: "right" }}>
                  {Number(b.grandTotal).toFixed(2)}
                  {b.currency !== "INR" && b.grandTotalFc != null && (
                    <div style={{ fontSize: 11, color: "var(--color-muted)" }}>{currencySymbol(b.currency)}{Number(b.grandTotalFc).toFixed(2)}</div>
                  )}
                </td>
                <td style={{ textAlign: "right" }}>
                  <Link className="ent-ia ent-ia-edit" href={`/purchase/returns?billId=${b.id}`} onClick={(e) => e.stopPropagation()}>Return</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function PurchaseBillsPage() {
  return (
    <AppShell>
      <CostingMethodGate>
        <PurchaseBillsInner />
      </CostingMethodGate>
    </AppShell>
  );
}
