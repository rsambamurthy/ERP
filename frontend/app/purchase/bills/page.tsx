"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import PartnerPicker from "@/components/shared/PartnerPicker";
import CostingMethodGate from "@/components/inventory/CostingMethodGate";
import {
  ApiError, approvePurchaseBill, createPurchaseBill, extractInvoice, getBranches, getBusinessPartnerLookup, getGoodsReceiptNotes, getItems,
  getPurchaseBill, getPurchaseBills, getPurchaseOrder, getPurchaseOrders, lookupCurrencyRate, rejectPurchaseBill, updatePurchaseBillReference,
} from "@/lib/api";
import { canApprovePurchaseOrders } from "@/lib/auth";
import { isInterState, round2, splitGst } from "@/lib/discountGst";
import type { Branch, BusinessPartnerLookup, DocumentLineInput, ExtractedInvoice, ExtractedInvoiceLine, Item, PurchaseBill, PurchaseBillStatus, PurchaseOrder } from "@/lib/types";
import { PURCHASE_BILL_STATUS_LABELS, SUPPORTED_CURRENCIES, currencySymbol } from "@/lib/types";

// Best-effort word-overlap match between an extracted invoice line's free-
// text description and an item's name/SKU — used only to build the
// read-only comparison table below, never to auto-post a line.
function normalizeWords(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}
function matchScore(a: string, b: string): number {
  const wa = new Set(normalizeWords(a));
  const wb = new Set(normalizeWords(b));
  if (wa.size === 0 || wb.size === 0) return 0;
  let overlap = 0;
  wa.forEach((w) => { if (wb.has(w)) overlap++; });
  return overlap / Math.max(wa.size, wb.size);
}

interface LineComparisonRow {
  key: string;
  itemLabel: string;
  invoiceQty: number | null;
  invoiceRate: number | null;
  invoiceAmount: number | null;
  billableQty: number | null;
  billableRate: number | null;
  billableAmount: number | null;
  diff: number | null;
  note: string;
}

function buildComparison(
  billLines: DocumentLineInput[],
  extractedLines: ExtractedInvoiceLine[],
  itemById: Map<string, Item>
): LineComparisonRow[] {
  const used = new Set<number>();
  const rows: LineComparisonRow[] = [];

  billLines.forEach((l, i) => {
    if (!l.itemId) return;
    const item = itemById.get(l.itemId);
    const label = item ? `${item.name} (${item.sku})` : "Item";
    let bestIdx = -1, bestScore = 0;
    extractedLines.forEach((el, ei) => {
      if (used.has(ei)) return;
      const score = matchScore(el.description, item ? `${item.name} ${item.sku}` : "");
      if (score > bestScore) { bestScore = score; bestIdx = ei; }
    });
    const matched = bestScore >= 0.25 ? extractedLines[bestIdx] : null;
    if (matched) used.add(bestIdx);

    const billableAmount = round2(Number(l.quantity) * Number(l.rate));
    const invoiceAmount = matched ? round2(matched.quantity * matched.rate) : null;
    rows.push({
      key: `bill-${i}`,
      itemLabel: label,
      invoiceQty: matched ? matched.quantity : null,
      invoiceRate: matched ? matched.rate : null,
      invoiceAmount,
      billableQty: Number(l.quantity),
      billableRate: Number(l.rate),
      billableAmount,
      diff: invoiceAmount != null ? round2(invoiceAmount - billableAmount) : null,
      note: matched ? "" : "Not found on the invoice",
    });
  });

  extractedLines.forEach((el, ei) => {
    if (used.has(ei)) return;
    const amount = round2(el.amount || el.quantity * el.rate || 0);
    rows.push({
      key: `extra-${ei}`,
      itemLabel: el.description || "Unmatched line",
      invoiceQty: el.quantity,
      invoiceRate: el.rate,
      invoiceAmount: amount,
      billableQty: null,
      billableRate: null,
      billableAmount: null,
      diff: amount,
      note: "Not on this Goods Receipt",
    });
  });

  return rows;
}

const emptyLine = (): DocumentLineInput => ({ itemId: "", quantity: 0, rate: 0, rateFc: 0, taxRate: 0, customsDutyRate: 0 });

const BILL_STATUS_COLORS: Record<PurchaseBillStatus, { bg: string; fg: string }> = {
  POSTED: { bg: "#dcfce7", fg: "#166534" },
  PENDING_APPROVAL: { bg: "#fef3c7", fg: "#92400e" },
  REJECTED: { bg: "#fee2e2", fg: "#991b1b" },
};

function BillStatusBadge({ status }: { status: PurchaseBillStatus }) {
  const c = BILL_STATUS_COLORS[status];
  return (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 600,
      background: c.bg, color: c.fg,
    }}>
      {PURCHASE_BILL_STATUS_LABELS[status]}
    </span>
  );
}

function PurchaseBillsInner() {
  const searchParams = useSearchParams();
  const initialPoId = searchParams.get("purchaseOrderId") ?? "";

  const [bills, setBills] = useState<PurchaseBill[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [vendors, setVendors] = useState<BusinessPartnerLookup[]>([]);
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

  // Optional — raising this bill against an approved Purchase Order. The
  // bill's currency is locked to whatever currency the PO was raised in
  // (validated server-side too — see routes/purchaseBills.ts's
  // purchaseOrderId handling); the exchange rate stays independently
  // editable, since the bill should use today's real market rate rather
  // than whatever rate applied when the PO was approved.
  const [linkedPO, setLinkedPO] = useState<PurchaseOrder | null>(null);
  const [availablePOs, setAvailablePOs] = useState<PurchaseOrder[]>([]);
  const [poLoadError, setPoLoadError] = useState<string | null>(null);
  // Optional at creation — the backend accepts these on POST too, for
  // whichever orgs already have the Bill of Entry before posting. Most
  // won't yet, which is why the detail view also offers PATCH-based entry
  // after the fact (see startEditBoe below).
  const [newBoeNumber, setNewBoeNumber] = useState("");
  const [newBoeDate, setNewBoeDate] = useState("");
  const [newPortCode, setNewPortCode] = useState("");

  // AI invoice read — attaching a file does nothing on its own; extraction
  // only fires when "Extract data" is clicked. Manual-entry bills get
  // header fields auto-filled; PO-linked bills instead get a read-only
  // comparison against the GRN-derived lines (see comparisonRows below).
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedInvoice | null>(null);

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

  // 3-way match approval — Pending Approval bills only (see PurchaseBill.status).
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const canApprove = canApprovePurchaseOrders();

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // Extracted-vs-GRN comparison — PO-linked bills only. Manual-entry bills
  // use the extraction to auto-fill fields instead (see handleExtract).
  const comparisonRows = useMemo(
    () => (linkedPO && extracted ? buildComparison(lines, extracted.lines, itemById) : null),
    [linkedPO, extracted, lines, itemById]
  );
  const comparisonTotalDiff = useMemo(
    () => (comparisonRows ? round2(comparisonRows.reduce((s, r) => s + (r.diff ?? 0), 0)) : 0),
    [comparisonRows]
  );
  const comparisonHasMismatch = comparisonRows != null && Math.abs(comparisonTotalDiff) > 0.5;

  const selectedVendor = useMemo(() => vendors.find((v) => v.id === businessPartnerId), [vendors, businessPartnerId]);
  // No branch selector on this form yet — the server defaults to head
  // office when branchId isn't given, so the preview mirrors that here too.
  const headOffice = useMemo(() => branches.find((b) => b.isHeadOffice), [branches]);
  // An import is always inter-state (IGST) under GST law — see the same
  // note on POST /purchase-bills. Never fall back to CGST+SGST just
  // because a foreign vendor has no Indian state code on file.
  const interState = isForeign ? true : isInterState(headOffice?.stateCode, selectedVendor?.stateCode);

  const totals = useMemo(() => {
    let subtotal = 0, tax = 0, cgst = 0, sgst = 0, igst = 0, customsDuty = 0;
    for (const l of lines) {
      const s = round2(Number(l.quantity || 0) * Number(l.rate || 0));
      // Duty is non-creditable and folds into landed cost; import IGST is
      // charged on (goods value + duty), not goods value alone — same
      // formula as POST /purchase-bills. customsDutyRate is 0 on a
      // domestic bill, so this collapses to the previous behavior there.
      const d = isForeign ? round2(s * Number(l.customsDutyRate || 0) / 100) : 0;
      const t = round2((s + d) * Number(l.taxRate || 0) / 100);
      const split = splitGst(t, interState);
      subtotal += s; tax += t; cgst += split.cgst; sgst += split.sgst; igst += split.igst; customsDuty += d;
    }
    return { subtotal, tax, cgst, sgst, igst, customsDuty, grand: subtotal + tax + customsDuty };
  }, [lines, interState, isForeign]);

  async function loadAll() {
    setLoading(true);
    try {
      const [billsRes, itemsRes, vendorsRes, branchRes, poRes] = await Promise.all([
        getPurchaseBills(), getItems(), getBusinessPartnerLookup("VENDOR"), getBranches(), getPurchaseOrders({ status: "APPROVED" }),
      ]);
      setBills(billsRes.data);
      setItems(itemsRes.data);
      setVendors(vendorsRes.data);
      setBranches(branchRes.data);
      // Only orders with at least one line that's been received but not yet
      // fully billed are worth offering — this is a proxy for "has an open
      // GRN line to bill against" without fetching every order's Goods
      // Receipt Notes just to populate the dropdown.
      setAvailablePOs(poRes.data.filter((po) => po.lines.some((l) => Number(l.billedQuantity) < Number(l.receivedQuantity))));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load purchase bills.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  // Deep link from the Purchase Order detail screen ("Create Purchase
  // Bill" button) — ?purchaseOrderId=<id> opens the form pre-linked.
  useEffect(() => {
    if (!initialPoId) return;
    (async () => {
      try {
        const res = await getPurchaseOrder(initialPoId);
        await linkPO(res.data);
        setShowForm(true);
      } catch (err) {
        setPoLoadError(err instanceof ApiError ? err.message : "Could not load the linked Purchase Order.");
      }
    })();
    // Only meant to run once, off the URL param present at first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPoId]);

  // Lines are pre-filled from this PO's Goods Receipt Notes, not the order
  // directly — the 3-way match means what's billable is what's actually
  // been received (and not yet billed), which can lag behind what was
  // ordered. Each pre-filled line carries a goodsReceiptNoteLineId, not a
  // purchaseOrderLineId — see DocumentLineInput and routes/purchaseBills.ts.
  async function linkPO(po: PurchaseOrder) {
    setLinkedPO(po);
    setBusinessPartnerId(po.businessPartner.id);
    setCurrency(po.currency);
    setPoLoadError(null);
    const poForeign = po.currency !== "INR";
    try {
      const grnRes = await getGoodsReceiptNotes({ purchaseOrderId: po.id });
      const poLineById = new Map(po.lines.map((l) => [l.id, l]));
      const openLines = grnRes.data
        .flatMap((g) => g.lines)
        .map((gl) => ({
          gl,
          remaining: round2(Number(gl.quantityReceived) - Number(gl.billedQuantity)),
          poLine: poLineById.get(gl.purchaseOrderLineId),
        }))
        .filter((x) => x.remaining > 0 && x.poLine);
      setLines(openLines.map(({ gl, remaining, poLine }) => ({
        itemId: gl.item.id,
        quantity: remaining,
        // GRN unitCost is always INR (received at the PO's rate on that
        // date) — a fine starting display value either way. For a foreign
        // PO, rateFc defaults to the PO line's own agreed unit price in
        // that currency; it self-corrects to the bill's actual rate once
        // the exchange-rate lookup below resolves, and stays freely
        // editable if the vendor's invoiced price differs from the PO.
        rate: Number(gl.unitCost),
        rateFc: poForeign && poLine!.rateFc != null ? Number(poLine!.rateFc) : 0,
        taxRate: Number(poLine!.taxRate),
        customsDutyRate: 0,
        goodsReceiptNoteLineId: gl.id,
      })));
    } catch (err) {
      setPoLoadError(err instanceof ApiError ? err.message : "Could not load Goods Receipt Notes for this order.");
    }
  }

  function unlinkPO() {
    setLinkedPO(null);
    setCurrency("INR"); setExchangeRate("1");
    setLines([emptyLine()]);
  }

  function clearInvoiceFile() {
    setInvoiceFile(null);
    setExtracted(null);
    setExtractError(null);
  }

  // Fires only on the "Extract data" click, never on file attach — the
  // extraction call has a real cost, so it's opt-in per invoice. On a
  // manual-entry bill this auto-fills header fields (never line items —
  // see buildComparison's note on why item-matching stays read-only). On a
  // PO-linked bill it changes nothing; comparisonRows above does the work.
  async function handleExtract() {
    if (!invoiceFile) return;
    setExtracting(true);
    setExtractError(null);
    try {
      const res = await extractInvoice(invoiceFile);
      const data = res.data;
      setExtracted(data);
      if (!linkedPO) {
        if (data.invoiceDate) setBillDate(data.invoiceDate);
        if (data.invoiceNumber && !narration) setNarration(`Invoice ${data.invoiceNumber}`);
        if (data.currency && SUPPORTED_CURRENCIES.some((c) => c.code === data.currency)) setCurrency(data.currency);
        if (data.vendorName) {
          const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
          const target = norm(data.vendorName);
          const match =
            vendors.find((v) => norm(v.name) === target) ??
            vendors.find((v) => norm(v.name).includes(target) || target.includes(norm(v.name)));
          if (match) setBusinessPartnerId(match.id);
        }
      }
    } catch (err) {
      setExtractError(err instanceof ApiError ? err.message : "Could not extract the invoice.");
    } finally {
      setExtracting(false);
    }
  }

  async function openDetail(id: string) {
    setShowForm(false);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    setEditingBoe(false);
    setBoeError(null);
    setActionError(null);
    setRejecting(false);
    setRejectReason("");
    try {
      const res = await getPurchaseBill(id);
      setDetail(res.data);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : "Could not load bill.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function refreshDetail(id: string) {
    const res = await getPurchaseBill(id);
    setDetail(res.data);
    await loadAll();
  }

  // Returns whether it succeeded, so the reject form knows whether to
  // close itself — same pattern as app/purchase/orders/page.tsx.
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

  // Pre-fill the Exchange Rate field from Currency Master (see
  // app/settings/currency-master) the moment the user has a foreign
  // currency and a bill date selected — same lookup/rationale as the
  // Sales Invoice form (app/sales/invoices/page.tsx). Does nothing if no
  // rate has been entered for that currency/date yet — the field stays a
  // plain, freely-editable number either way.
  useEffect(() => {
    if (!isForeign || !billDate) return;
    let cancelled = false;
    lookupCurrencyRate(currency, billDate)
      .then((res) => {
        if (!cancelled && res.data) handleExchangeRateChange(String(res.data.rate));
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, billDate, isForeign]);

  function pickItem(i: number, itemId: string) {
    const item = itemById.get(itemId);
    updateLine(i, {
      itemId,
      // Item master rates are always INR — only useful as a default when
      // the bill itself is in INR. A foreign-currency line starts blank.
      rate: !isForeign && item?.purchaseRate ? Number(item.purchaseRate) : 0,
      rateFc: 0,
      taxRate: item?.taxRate ? Number(item.taxRate) : 0,
      customsDutyRate: 0,
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createPurchaseBill({
        businessPartnerId: linkedPO ? undefined : businessPartnerId, billDate, narration,
        lines: lines
          .filter((l) => l.itemId && l.quantity > 0)
          .map((l) => (isForeign ? l : { ...l, customsDutyRate: undefined })),
        currency, exchangeRate: isForeign ? Number(exchangeRate) : undefined,
        billOfEntryNumber: isForeign ? newBoeNumber || undefined : undefined,
        billOfEntryDate: isForeign ? newBoeDate || undefined : undefined,
        portCode: isForeign ? newPortCode || undefined : undefined,
        purchaseOrderId: linkedPO?.id,
      });
      setShowForm(false);
      setBusinessPartnerId(""); setNarration(""); setLines([emptyLine()]);
      setCurrency("INR"); setExchangeRate("1");
      setNewBoeNumber(""); setNewBoeDate(""); setNewPortCode("");
      setLinkedPO(null);
      clearInvoiceFile();
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

          {poLoadError && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 10px" }}>{poLoadError}</p>}

          <div style={{ padding: "0 14px 10px" }}>
            {!linkedPO ? (
              <div className="ent-fg" style={{ maxWidth: 420 }}>
                <label className="ent-fl">From Purchase Order <span style={{ fontWeight: 400, color: "var(--color-muted)" }}>(optional)</span></label>
                <select
                  className="ent-fc"
                  value=""
                  onChange={(e) => {
                    const po = availablePOs.find((p) => p.id === e.target.value);
                    if (po) linkPO(po);
                  }}
                >
                  <option value="">Not linked to a Purchase Order</option>
                  {availablePOs.map((po) => (
                    <option key={po.id} value={po.id}>
                      {po.poNumber} — {po.businessPartner.name} (₹{Number(po.grandTotal).toFixed(2)}
                      {po.currency !== "INR" && po.grandTotalFc != null ? ` · ${currencySymbol(po.currency)}${Number(po.grandTotalFc).toFixed(2)}` : ""})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div style={{
                display: "flex", flexWrap: "wrap", gap: "6px 18px", alignItems: "center",
                background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 6,
                padding: "8px 14px", fontSize: 13,
              }}>
                <span>Linked to <strong>{linkedPO.poNumber}</strong> — {linkedPO.businessPartner.name}. Lines pre-filled from what's been received (via Goods Receipt Note) but not yet billed.</span>
                <button type="button" className="ent-ia ent-ia-edit" onClick={unlinkPO}>Unlink</button>
              </div>
            )}
          </div>

          <div style={{ padding: "0 14px 10px" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 10, background: "#fff",
              border: "1px solid var(--color-border)", borderRadius: 6, padding: "10px 14px",
            }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--color-muted)", cursor: "pointer" }}>
                📎
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  style={{ display: "none" }}
                  onChange={(e) => { setInvoiceFile(e.target.files?.[0] ?? null); setExtracted(null); setExtractError(null); }}
                />
                {invoiceFile ? invoiceFile.name : "Attach vendor invoice (optional)"}
              </label>
              <div style={{ flex: 1 }} />
              {invoiceFile && (
                <>
                  <button type="button" className="ent-btn-add" disabled={extracting} onClick={handleExtract}>
                    {extracting ? "Extracting…" : "✨ Extract data"}
                  </button>
                  <button type="button" className="ent-ia ent-ia-edit" onClick={clearInvoiceFile}>Remove</button>
                </>
              )}
            </div>
            {extractError && <p style={{ color: "#dc2626", fontSize: 13, marginTop: 8 }}>{extractError}</p>}

            {extracted && !linkedPO && (
              <div style={{ marginTop: 8 }}>
                <p style={{ fontSize: 12.5, color: "var(--color-muted)", marginBottom: extracted.lines.length > 0 ? 6 : 0 }}>
                  Extracted{extracted.vendorName ? ` — ${extracted.vendorName}` : ""}.
                  {extracted.vendorName && !businessPartnerId && " Couldn't match a vendor — please select one below."}
                  {extracted.lines.length > 0 && " Line items below are for reference — add matching lines to the table yourself."}
                </p>
                {extracted.lines.length > 0 && (
                  <div style={{ border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden" }}>
                    <table className="ent-table">
                      <thead>
                        <tr><th>Extracted line (reference only)</th><th>Qty</th><th>Rate</th><th style={{ textAlign: "right" }}>Amount</th></tr>
                      </thead>
                      <tbody>
                        {extracted.lines.map((l, i) => (
                          <tr key={i}>
                            <td>{l.description}</td>
                            <td>{l.quantity}</td>
                            <td>{l.rate.toFixed(2)}</td>
                            <td style={{ textAlign: "right" }}>{l.amount.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                      {extracted.grandTotal != null && (
                        <tfoot>
                          <tr>
                            <td colSpan={3} style={{ fontWeight: 700 }}>Extracted grand total</td>
                            <td style={{ textAlign: "right", fontWeight: 700 }}>{extracted.grandTotal.toFixed(2)}</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}
              </div>
            )}

            {linkedPO && comparisonRows && (
              <div className="ent-section" style={{ marginTop: 8, marginBottom: 0 }}>
                <div className="ent-section-hdr"><span className="ent-section-title">Invoice vs. Goods Receipt</span></div>
                <table className="ent-table">
                  <thead>
                    <tr>
                      <th>Item</th><th>Invoice Qty × Rate</th><th style={{ textAlign: "right" }}>Invoice Amt</th>
                      <th>Billable Qty × Rate</th><th style={{ textAlign: "right" }}>Billable Amt</th><th style={{ textAlign: "right" }}>Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonRows.map((r) => {
                      const flagged = r.diff != null && Math.abs(r.diff) > 0.5;
                      return (
                        <tr key={r.key} style={flagged ? { background: r.billableAmount == null ? "#fef2f2" : "#fff7ed" } : undefined}>
                          <td>
                            {r.itemLabel}
                            {r.note && <div style={{ fontSize: 10.5, color: "#dc2626" }}>{r.note}</div>}
                          </td>
                          <td>{r.invoiceQty != null ? `${r.invoiceQty} × ${(r.invoiceRate ?? 0).toFixed(2)}` : "—"}</td>
                          <td style={{ textAlign: "right" }}>{r.invoiceAmount != null ? r.invoiceAmount.toFixed(2) : "—"}</td>
                          <td>{r.billableQty != null ? `${r.billableQty} × ${(r.billableRate ?? 0).toFixed(2)}` : "—"}</td>
                          <td style={{ textAlign: "right" }}>{r.billableAmount != null ? r.billableAmount.toFixed(2) : "—"}</td>
                          <td style={{ textAlign: "right", color: flagged ? "#c2410c" : "#16a34a", fontWeight: flagged ? 600 : 400 }}>
                            {flagged ? `+${r.diff!.toFixed(2)}` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ fontWeight: 700 }}>Totals</td>
                      <td />
                      <td style={{ textAlign: "right", fontWeight: 700 }}>
                        {comparisonRows.reduce((s, r) => s + (r.invoiceAmount ?? 0), 0).toFixed(2)}
                      </td>
                      <td />
                      <td style={{ textAlign: "right", fontWeight: 700 }}>
                        {comparisonRows.reduce((s, r) => s + (r.billableAmount ?? 0), 0).toFixed(2)}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: comparisonHasMismatch ? "#c2410c" : "#16a34a" }}>
                        {comparisonTotalDiff.toFixed(2)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
                {comparisonHasMismatch && (
                  <div style={{
                    display: "flex", gap: 10, padding: "10px 14px", background: "#fffbeb",
                    borderTop: "1px solid #fde68a", fontSize: 12.5, color: "#92400e",
                  }}>
                    ⚠ Invoice total is {currencySymbol(currency)}{comparisonTotalDiff.toFixed(2)} higher than what's billable per this
                    Goods Receipt. Check whether returned or short-received quantity is still being billed before posting.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="ent-form-grid" style={{ gridTemplateColumns: "1fr 1fr 2fr" }}>
            <div className="ent-fg">
              <label className="ent-fl">Vendor</label>
              <PartnerPicker
                partners={vendors}
                value={businessPartnerId || null}
                onChange={(id) => setBusinessPartnerId(id ?? "")}
                required
                disabled={!!linkedPO}
              />
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
              <select className="ent-fc" value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={!!linkedPO}>
                {SUPPORTED_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
              </select>
              {linkedPO && <span style={{ fontSize: 11, color: "var(--color-muted)" }}>Locked to the linked Purchase Order's currency.</span>}
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
              <thead><tr><th style={{ width: "32%" }}>Item</th><th>Qty</th><th>Rate{isForeign ? ` (${currency})` : ""}</th>{isForeign && <th>Rate (₹)</th>}<th>Tax %</th>{isForeign && <th>Duty %</th>}<th /></tr></thead>
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
                    {isForeign && (
                      <td><input type="number" min={0} step="0.01" className="ent-fc" value={line.customsDutyRate || ""} onChange={(e) => updateLine(i, { customsDutyRate: Number(e.target.value) })} /></td>
                    )}
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
              {isForeign && totals.customsDuty > 0 && (
                <span>Customs Duty: <strong>{totals.customsDuty.toFixed(2)}</strong></span>
              )}
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
            {isForeign && totals.customsDuty + totals.tax > 0 && (
              <p style={{ fontSize: 11.5, color: "var(--color-muted)", marginTop: -6, marginBottom: 12 }}>
                Trade Payables to the vendor will be {totals.subtotal.toFixed(2)} (goods value only) — Customs Duty +
                IGST ({(totals.customsDuty + totals.tax).toFixed(2)}) posts to Customs Duty Payable instead, since
                neither is owed to the vendor.
              </p>
            )}
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
            <span className="ent-section-title">
              {detail ? `Bill ${detail.billNumber} ` : "Loading…"}
              {detail && <BillStatusBadge status={detail.status} />}
            </span>
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
                  {detail.purchaseOrder && ` · from ${detail.purchaseOrder.poNumber}`}
                </div>

                {detail.status === "PENDING_APPROVAL" && (
                  <div style={{ padding: "0 14px 10px" }}>
                    <div style={{
                      background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6,
                      padding: "8px 14px", fontSize: 13, color: "#92400e", marginBottom: 8,
                    }}>
                      Held for approval — no journal entry or stock impact yet. {detail.varianceNote}
                    </div>
                    {actionError && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 8 }}>{actionError}</p>}
                    {canApprove ? (
                      !rejecting ? (
                        <div style={{ display: "flex", gap: 8 }}>
                          <button type="button" className="ent-btn-save" disabled={actionBusy} onClick={() => runAction(detail.id, () => approvePurchaseBill(detail.id))}>
                            {actionBusy ? "Approving…" : "Approve & Post"}
                          </button>
                          <button type="button" className="ent-ia ent-ia-del" disabled={actionBusy} onClick={() => setRejecting(true)}>Reject</button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", width: "100%" }}>
                          <input
                            className="ent-fc" style={{ flex: 1 }} placeholder="Reason for rejection"
                            value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                          />
                          <button
                            type="button" className="ent-btn-save" disabled={actionBusy || !rejectReason.trim()}
                            onClick={async () => {
                              const ok = await runAction(detail.id, () => rejectPurchaseBill(detail.id, rejectReason.trim()));
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
                    )}
                  </div>
                )}

                {detail.status === "REJECTED" && (
                  <p style={{ padding: "0 14px 10px", fontSize: 13, color: "#991b1b" }}>
                    Rejected{detail.rejectedAt ? ` on ${new Date(detail.rejectedAt).toLocaleDateString()}` : ""}: {detail.rejectionReason}
                  </p>
                )}

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
                        {docForeign && <th>Duty</th>}
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
                          {docForeign && <td>{Number(l.customsDutyAmount ?? 0).toFixed(2)}</td>}
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
                  {docForeign && Number(detail.customsDutyTotal) > 0 && (
                    <span>Customs Duty: <strong>{Number(detail.customsDutyTotal).toFixed(2)}</strong></span>
                  )}
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
                {docForeign && (Number(detail.customsDutyTotal) + Number(detail.igstTotal) + Number(detail.cgstTotal) + Number(detail.sgstTotal)) > 0 && (
                  <p style={{ fontSize: 11.5, color: "var(--color-muted)", margin: "-6px 14px 14px" }}>
                    Trade Payables to {detail.businessPartner.name} is {Number(detail.subtotal).toFixed(2)} (goods value
                    only) — Customs Duty + import tax posted to Customs Duty Payable instead.
                  </p>
                )}
              </>
            );
          })()}
        </div>
      )}

      <div className="ent-page-table">
        <table>
          <thead><tr><th>Bill #</th><th>Date</th><th>Vendor</th><th>Status</th><th style={{ textAlign: "right" }}>Amount</th><th /></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="ent-empty">Loading…</td></tr>}
            {!loading && bills.length === 0 && <tr><td colSpan={6} className="ent-empty">No bills yet.</td></tr>}
            {bills.map((b) => (
              <tr key={b.id} style={{ cursor: "pointer" }} onClick={() => openDetail(b.id)}>
                <td style={{ fontWeight: 500 }}>{b.billNumber}</td>
                <td style={{ color: "var(--color-muted)" }}>{new Date(b.billDate).toLocaleDateString()}</td>
                <td>{b.businessPartner.name}</td>
                <td><BillStatusBadge status={b.status} /></td>
                <td style={{ textAlign: "right" }}>
                  {Number(b.grandTotal).toFixed(2)}
                  {b.currency !== "INR" && b.grandTotalFc != null && (
                    <div style={{ fontSize: 11, color: "var(--color-muted)" }}>{currencySymbol(b.currency)}{Number(b.grandTotalFc).toFixed(2)}</div>
                  )}
                </td>
                <td style={{ textAlign: "right" }}>
                  {b.status === "POSTED" && (
                    <Link className="ent-ia ent-ia-edit" href={`/purchase/returns?billId=${b.id}`} onClick={(e) => e.stopPropagation()}>Return</Link>
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

export default function PurchaseBillsPage() {
  return (
    <AppShell>
      <CostingMethodGate>
        <Suspense fallback={null}>
          <PurchaseBillsInner />
        </Suspense>
      </CostingMethodGate>
    </AppShell>
  );
}
