"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import PartnerPicker from "@/components/shared/PartnerPicker";
import CurrencyPicker from "@/components/shared/CurrencyPicker";
import ItemPicker from "@/components/shared/ItemPicker";
import CostingMethodGate from "@/components/inventory/CostingMethodGate";
import {
  ApiError, createSalesInvoice, downloadSalesInvoicePdf, getBranches, getChargeTypes, getBusinessPartnerLookup, getCompanyMaster, getDeliveryNotes, getItems, getSalesInvoice,
  getSalesInvoices, getSalesOrder, getSalesOrders, lookupCurrencyRate, updateSalesInvoiceReference,
} from "@/lib/api";
import type { ChargeType } from "@/lib/api";
import { computeDiscountedLines, isInterState, round2 } from "@/lib/discountGst";
import type { Branch, BusinessPartnerLookup, DiscountType, ExportType, Item, SalesInvoice, SalesLineInput, SalesOrder } from "@/lib/types";
import { SUPPORTED_CURRENCIES, currencySymbol, EXPORT_TYPE_LABELS } from "@/lib/types";

const emptyLine = (): SalesLineInput => ({ itemId: "", quantity: 0, rate: 0, rateFc: 0, taxRate: 0, discountType: null, discountValue: 0 });

function SalesInvoicesInner() {
  const searchParams = useSearchParams();
  const initialSoId = searchParams.get("salesOrderId") ?? "";

  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [customers, setCustomers] = useState<BusinessPartnerLookup[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [businessPartnerId, setBusinessPartnerId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<SalesLineInput[]>([emptyLine()]);
  // FREIGHT, PACKING, INSURANCE. Document-level charges, each posting to its
  // own income head. They are NOT lines: a charge has no tax rate of its own,
  // because it is prorated across the goods lines and taxed at their rate -
  // section 15(2)(c) puts it inside the value of the supply and section 8(a)
  // taxes a composite supply at the rate of the principal one. Giving the
  // user a rate box for freight would be offering them a way to get that
  // wrong on every invoice.
  // The label and the account are NOT typed here - they come from the
  // Charge Master, and all this form carries is which type and how much.
  // See migration_055 for what free text did to reporting.
  const [charges, setCharges] = useState<{ chargeTypeId: string; amount: string }[]>([]);
  const [chargeTypes, setChargeTypes] = useState<ChargeType[]>([]);
  const chargesTotal = useMemo(
    () => round2(charges.reduce((s, c) => s + (Number(c.amount) || 0), 0)),
    [charges]
  );

  const [invoiceDiscountType, setInvoiceDiscountType] = useState<DiscountType | "">("");
  const [invoiceDiscountValue, setInvoiceDiscountValue] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [exchangeRate, setExchangeRate] = useState("1");
  const isForeign = currency !== "INR";
  const [exportType, setExportType] = useState<ExportType>("LUT");
  const [lutBondNumber, setLutBondNumber] = useState("");
  const [lutBondDate, setLutBondDate] = useState("");
  // Optional at creation — the backend accepts these on POST too, for
  // whichever orgs already know the shipping bill before invoicing. Most
  // won't yet, which is why the detail view also offers PATCH-based entry
  // after the fact (see startEditShipping below).
  const [newShippingBillNumber, setNewShippingBillNumber] = useState("");
  const [newShippingBillDate, setNewShippingBillDate] = useState("");
  const [newPortCode, setNewPortCode] = useState("");
  const isZeroRatedExport = isForeign && (exportType === "LUT" || exportType === "BOND");
  const hasLineTax = lines.some((l) => Number(l.taxRate || 0) > 0);

  // Optional — raising this invoice against an approved Sales Order. The
  // invoice's currency is locked to whatever currency the SO was raised in
  // (validated server-side too — see routes/salesInvoices.ts's salesOrderId
  // handling); the exchange rate stays independently editable, since the
  // invoice should use today's real market rate rather than whatever rate
  // applied when the SO was approved.
  const [linkedSO, setLinkedSO] = useState<SalesOrder | null>(null);
  const [availableSOs, setAvailableSOs] = useState<SalesOrder[]>([]);
  const [soLoadError, setSoLoadError] = useState<string | null>(null);

  const [detail, setDetail] = useState<SalesInvoice | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Editing shipping bill / LUT-Bond reference fields on an already-posted
  // export invoice — these are almost never known at the moment of
  // posting (goods ship after the invoice), so this is the normal way
  // they get filled in, not the create form. See PATCH /sales-invoices/:id.
  const [editingShipping, setEditingShipping] = useState(false);
  const [shipNumber, setShipNumber] = useState("");
  const [shipDate, setShipDate] = useState("");
  const [shipPort, setShipPort] = useState("");
  const [shipLutBondNumber, setShipLutBondNumber] = useState("");
  const [shipLutBondDate, setShipLutBondDate] = useState("");
  const [savingShipping, setSavingShipping] = useState(false);
  const [shippingError, setShippingError] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const selectedCustomer = useMemo(() => customers.find((c) => c.id === businessPartnerId), [customers, businessPartnerId]);
  // No branch selector on this form yet — the server defaults to head
  // office when branchId isn't given, so the preview mirrors that here too.
  const headOffice = useMemo(() => branches.find((b) => b.isHeadOffice), [branches]);
  // An export is always inter-state (IGST) under GST law — see the same
  // note on POST /sales-invoices. Never fall back to CGST+SGST just
  // because a foreign customer has no Indian state code on file.
  const interState = isForeign ? true : isInterState(headOffice?.stateCode, selectedCustomer?.stateCode);

  const discountLines = useMemo(
    () =>
      computeDiscountedLines(
        lines.map((l) => ({ quantity: Number(l.quantity || 0), rate: Number(l.rate || 0), taxRate: Number(l.taxRate || 0), discountType: l.discountType, discountValue: Number(l.discountValue || 0) })),
        { type: invoiceDiscountType || null, value: Number(invoiceDiscountValue || 0) },
        interState,
        chargesTotal
      ),
    [lines, invoiceDiscountType, invoiceDiscountValue, interState, chargesTotal]
  );

  const totals = useMemo(() => {
    let subtotal = 0, discountTotal = 0, tax = 0, cgst = 0, sgst = 0, igst = 0, grand = 0;
    for (const d of discountLines) {
      subtotal += d.lineSubtotal;
      discountTotal += round2(d.lineDiscountAmount + d.invoiceDiscountShare);
      tax += d.taxAmount; cgst += d.cgstAmount; sgst += d.sgstAmount; igst += d.igstAmount;
      grand += d.lineTotal;
    }
    return { subtotal, discountTotal, tax, cgst, sgst, igst, grand };
  }, [discountLines]);

  async function loadAll() {
    setLoading(true);
    try {
      const [invRes, itemsRes, custRes, branchRes, soRes] = await Promise.all([
        getSalesInvoices(), getItems(), getBusinessPartnerLookup("CUSTOMER"), getBranches(), getSalesOrders({ status: "APPROVED" }),
      ]);
      setInvoices(invRes.data);
      setItems(itemsRes.data);
      setCustomers(custRes.data);
      setBranches(branchRes.data);
      // Only orders with at least one line that's been delivered but not yet
      // fully invoiced are worth offering — a proxy for "has an open
      // Delivery Note line to invoice against" without fetching every
      // order's Delivery Notes just to populate the dropdown.
      setAvailableSOs(soRes.data.filter((so) => so.lines.some((l) => Number(l.billedQuantity) < Number(l.deliveredQuantity))));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load sales invoices.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  // Deep link from the Sales Order detail screen ("Create Sales Invoice"
  // button) — ?salesOrderId=<id> opens the form pre-linked.
  useEffect(() => {
    if (!initialSoId) return;
    (async () => {
      try {
        const res = await getSalesOrder(initialSoId);
        await linkSO(res.data);
        setShowForm(true);
      } catch (err) {
        setSoLoadError(err instanceof ApiError ? err.message : "Could not load the linked Sales Order.");
      }
    })();
    // Only meant to run once, off the URL param present at first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSoId]);

  // Lines are pre-filled from this SO's Delivery Notes, not the order
  // directly — the 3-way match means what's invoiceable is what's actually
  // been delivered (and not yet invoiced), which can lag behind what was
  // ordered. Each pre-filled line carries a deliveryNoteLineId, not a
  // salesOrderLineId — see DocumentLineInput and routes/salesInvoices.ts.
  async function linkSO(so: SalesOrder) {
    setLinkedSO(so);
    setBusinessPartnerId(so.businessPartner.id);
    setCurrency(so.currency);
    setSoLoadError(null);
    const soForeign = so.currency !== "INR";
    try {
      const dnRes = await getDeliveryNotes({ salesOrderId: so.id });
      const soLineById = new Map(so.lines.map((l) => [l.id, l]));
      const openLines = dnRes.data
        .flatMap((d) => d.lines)
        .map((dl) => ({
          dl,
          remaining: round2(Number(dl.quantityDelivered) - Number(dl.billedQuantity)),
          soLine: soLineById.get(dl.salesOrderLineId),
        }))
        .filter((x) => x.remaining > 0 && x.soLine);
      setLines(openLines.map(({ dl, remaining, soLine }) => ({
        itemId: dl.item.id,
        quantity: remaining,
        // Delivery Note rate is always INR — a fine starting display value
        // either way. For a foreign SO, rateFc defaults to the SO line's own
        // agreed unit price in that currency; it self-corrects once the
        // exchange-rate lookup below resolves, and stays freely editable if
        // the actual invoiced price differs from the SO.
        rate: Number(dl.rate),
        rateFc: soForeign && soLine!.rateFc != null ? Number(soLine!.rateFc) : 0,
        // Exports are zero-rated by default (see pickItem's note) — an SO
        // raised in a foreign currency is an export, so default to 0% here
        // too rather than the SO line's domestic-style tax rate.
        taxRate: soForeign ? 0 : Number(soLine!.taxRate),
        discountType: null,
        discountValue: 0,
        deliveryNoteLineId: dl.id,
      })));
    } catch (err) {
      setSoLoadError(err instanceof ApiError ? err.message : "Could not load Delivery Notes for this order.");
    }
  }

  function unlinkSO() {
    setLinkedSO(null);
    setCurrency("INR"); setExchangeRate("1");
    setLines([emptyLine()]);
  }

  async function openDetail(id: string) {
    setShowForm(false);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    setEditingShipping(false);
    setShippingError(null);
    try {
      const res = await getSalesInvoice(id);
      setDetail(res.data);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : "Could not load invoice.");
    } finally {
      setDetailLoading(false);
    }
  }

  function startEditShipping(inv: SalesInvoice) {
    setShipNumber(inv.shippingBillNumber ?? "");
    setShipDate(inv.shippingBillDate ? inv.shippingBillDate.slice(0, 10) : "");
    setShipPort(inv.portCode ?? "");
    setShipLutBondNumber(inv.lutBondNumber ?? "");
    setShipLutBondDate(inv.lutBondDate ? inv.lutBondDate.slice(0, 10) : "");
    setShippingError(null);
    setEditingShipping(true);
  }

  async function handleSaveShipping(id: string) {
    setSavingShipping(true);
    setShippingError(null);
    try {
      const res = await updateSalesInvoiceReference(id, {
        shippingBillNumber: shipNumber || null, shippingBillDate: shipDate || null, portCode: shipPort || null,
        lutBondNumber: shipLutBondNumber || null, lutBondDate: shipLutBondDate || null,
      });
      setDetail(res.data);
      setEditingShipping(false);
      await loadAll();
    } catch (err) {
      setShippingError(err instanceof ApiError ? err.message : "Could not save shipping details.");
    } finally {
      setSavingShipping(false);
    }
  }

  async function handleDownloadPdf(invoice: SalesInvoice) {
    setDownloadingPdf(true);
    setDownloadError(null);
    try {
      await downloadSalesInvoicePdf(invoice.id, invoice.invoiceNumber);
    } catch (err) {
      setDownloadError(err instanceof ApiError ? err.message : "Could not download the PDF.");
    } finally {
      setDownloadingPdf(false);
    }
  }

  function updateLine(i: number, patch: Partial<SalesLineInput>) {
    setLines((ls) => ls.map((l, idx) => {
      if (idx !== i) return l;
      const next = { ...l, ...patch };
      // rateFc is authoritative for a foreign-currency invoice — rate (INR)
      // is always the derived figure the discount/tax preview actually
      // uses, kept in lockstep here so it matches what the server computes.
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
  // currency and an invoice date selected — the most recent rate on or
  // before that date, same lookup the backend applies conceptually (see
  // routes/currencyRates.ts GET /lookup). Silently does nothing if no rate
  // has been entered for that currency/date yet — the field is still a
  // plain, freely-editable number either way, this just saves the lookup
  // most of the time.
  useEffect(() => {
    if (!isForeign || !invoiceDate) return;
    let cancelled = false;
    lookupCurrencyRate(currency, invoiceDate)
      .then((res) => {
        if (!cancelled && res.data) handleExchangeRateChange(String(res.data.rate));
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, invoiceDate, isForeign]);

  function handleCurrencyChange(code: string) {
    const wasForeign = isForeign;
    const nowForeign = code !== "INR";
    setCurrency(code);
    // Switching INR → foreign mid-form: any tax rate already on a line
    // came from the item's domestic default and no longer applies (see
    // pickItem's note on exports being zero-rated by default) — reset it
    // rather than silently keep taxing a zero-rated export.
    if (!wasForeign && nowForeign) {
      setLines((ls) => ls.map((l) => ({ ...l, taxRate: 0 })));
    }
  }

  function pickItem(i: number, itemId: string) {
    const item = itemById.get(itemId);
    const defaultDiscount = item?.defaultDiscountPct ? Number(item.defaultDiscountPct) : 0;
    updateLine(i, {
      itemId,
      // Item master rates are always INR — only useful as a default when
      // the invoice itself is in INR. A foreign-currency line starts blank.
      rate: !isForeign && item?.salesRate ? Number(item.salesRate) : 0,
      rateFc: 0,
      // Exports are zero-rated under GST (LUT/bond — the common case — or
      // IGST-paid-then-refunded). Default to 0% rather than the item's
      // domestic rate; override manually per line if this export is on the
      // pay-IGST-and-claim-refund route instead of LUT.
      taxRate: isForeign ? 0 : item?.taxRate ? Number(item.taxRate) : 0,
      discountType: defaultDiscount > 0 ? "PERCENT" : null,
      discountValue: defaultDiscount,
    });
  }

  // THE NEGATIVE-STOCK OVERRIDE, from the user's side.
  //
  // Nobody is offered this up front. The invoice is posted normally; only
  // when the server refuses it for want of stock, AND the company permits
  // the override, does the panel below appear with the server's own message
  // and a box for the reason. Then the same invoice is posted again with
  // the override attached.
  //
  // Asking afterwards rather than beforehand is the whole design. A tick-box
  // sitting on an empty form gets ticked out of habit by somebody who has
  // not yet been told anything is wrong; a panel that appears saying "only 4
  // in stock" is a decision taken in front of the fact.
  const [companyAllowsNegative, setCompanyAllowsNegative] = useState(false);
  const [shortfall, setShortfall] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  // Whether the company permits it at all. Read once; a user who cannot see
  // Company Master can still read this endpoint, and if the call fails the
  // answer stays false - the override simply is not offered, which is the
  // right way for this to break.
  useEffect(() => {
    getCompanyMaster()
      .then((res) => setCompanyAllowsNegative(res.data.allowNegativeStock === true))
      .catch(() => setCompanyAllowsNegative(false));
  }, []);

  // Active charge types only - a retired one must not be offered on a new
  // invoice, though every invoice that already used it keeps it.
  useEffect(() => {
    getChargeTypes()
      .then((res) => setChargeTypes(res.data))
      .catch(() => setChargeTypes([]));
  }, []);

  async function handleCreate(e: React.FormEvent, override = false) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createSalesInvoice({
        ...(override ? { allowNegativeStock: true, negativeStockReason: overrideReason.trim() } : {}),
        businessPartnerId: linkedSO ? undefined : businessPartnerId, invoiceDate, narration,
        lines: lines.filter((l) => l.itemId && l.quantity > 0),
        charges: charges
          .filter((c) => c.chargeTypeId && Number(c.amount) > 0)
          .map((c) => ({ chargeTypeId: c.chargeTypeId, amount: Number(c.amount) })),
        discountType: invoiceDiscountType || null,
        discountValue: invoiceDiscountValue ? Number(invoiceDiscountValue) : 0,
        currency, exchangeRate: isForeign ? Number(exchangeRate) : undefined,
        exportType: isForeign ? exportType : undefined,
        lutBondNumber: isForeign && exportType !== "WPAY" ? lutBondNumber : undefined,
        lutBondDate: isForeign && exportType !== "WPAY" ? lutBondDate : undefined,
        shippingBillNumber: isForeign ? newShippingBillNumber || undefined : undefined,
        shippingBillDate: isForeign ? newShippingBillDate || undefined : undefined,
        portCode: isForeign ? newPortCode || undefined : undefined,
        salesOrderId: linkedSO?.id,
      });
      setShowForm(false);
      setShortfall(null); setOverrideReason("");
      setBusinessPartnerId(""); setNarration(""); setLines([emptyLine()]);
      setInvoiceDiscountType(""); setInvoiceDiscountValue(""); setCharges([]);
      setCurrency("INR"); setExchangeRate("1");
      setExportType("LUT"); setLutBondNumber(""); setLutBondDate("");
      setNewShippingBillNumber(""); setNewShippingBillDate(""); setNewPortCode("");
      setLinkedSO(null);
      await loadAll();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not post invoice.";
      // Only a shortfall opens the panel, and only where the company allows
      // it. Matched on the phrase the server actually uses - see
      // consumeStock() in backend/src/lib/costing.ts. A FIFO organisation is
      // refused with a different message that says so, and is deliberately
      // NOT matched here: there is nothing the user could usefully confirm.
      const isShortfall = /in stock at this branch/i.test(message) && !/FIFO/i.test(message);
      if (isShortfall && companyAllowsNegative && !override) {
        setShortfall(message);
        setError(null);
      } else {
        setShortfall(null);
        setError(message);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="ent-page-hdr">
        <h1>Sales Invoices</h1>
        <p>Stock out, posted straight to the books — Trade Receivables, Sales Revenue, Discount Allowed, CGST/SGST/IGST, and Cost of Goods Sold.</p>
      </div>

      <div className="ent-toolbar">
        <div style={{ flex: 1 }} />
        <button className="ent-btn-add" onClick={() => { setShowForm((s) => !s); setDetail(null); setDetailError(null); }}>{showForm ? "Cancel" : "+ New Invoice"}</button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="ent-section">
          <div className="ent-section-hdr"><span className="ent-section-title">New Sales Invoice</span></div>

          {soLoadError && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 10px" }}>{soLoadError}</p>}

          <div style={{ padding: "0 14px 10px" }}>
            {!linkedSO ? (
              <div className="ent-fg" style={{ maxWidth: 420 }}>
                <label className="ent-fl">From Sales Order <span style={{ fontWeight: 400, color: "var(--color-muted)" }}>(optional)</span></label>
                <select
                  className="ent-fc"
                  value=""
                  onChange={(e) => {
                    const so = availableSOs.find((s) => s.id === e.target.value);
                    if (so) linkSO(so);
                  }}
                >
                  <option value="">Not linked to a Sales Order</option>
                  {availableSOs.map((so) => (
                    <option key={so.id} value={so.id}>
                      {so.soNumber} — {so.businessPartner.name} (₹{Number(so.grandTotal).toFixed(2)}
                      {so.currency !== "INR" && so.grandTotalFc != null ? ` · ${currencySymbol(so.currency)}${Number(so.grandTotalFc).toFixed(2)}` : ""})
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
                <span>Linked to <strong>{linkedSO.soNumber}</strong> — {linkedSO.businessPartner.name}. Lines pre-filled from what's been delivered (via Delivery Note) but not yet invoiced.</span>
                <button type="button" className="ent-ia ent-ia-edit" onClick={unlinkSO}>Unlink</button>
              </div>
            )}
          </div>

          <div className="ent-form-grid" style={{ gridTemplateColumns: "1fr 1fr 2fr" }}>
            <div className="ent-fg">
              <label className="ent-fl">Customer</label>
              <PartnerPicker
                partners={customers}
                value={businessPartnerId || null}
                onChange={(id) => setBusinessPartnerId(id ?? "")}
                required
                disabled={!!linkedSO}
              />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Invoice Date</label>
              <input type="date" className="ent-fc" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />
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
                onChange={(code) => handleCurrencyChange(code ?? "")}
                disabled={!!linkedSO}
              />
              {linkedSO && <span style={{ fontSize: 11, color: "var(--color-muted)" }}>Locked to the linked Sales Order's currency.</span>}
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
                  ? "Export invoice — tax rate reset to 0% on each line by default."
                  : "Domestic invoice — INR only."}
              </span>
            </div>
          </div>

          {isForeign && (
            <div className="ent-form-grid" style={{ gridTemplateColumns: isZeroRatedExport ? "1.5fr 1fr 1fr" : "1.5fr 2fr" }}>
              <div className="ent-fg">
                <label className="ent-fl">Export Type</label>
                <select className="ent-fc" value={exportType} onChange={(e) => setExportType(e.target.value as ExportType)}>
                  {(Object.keys(EXPORT_TYPE_LABELS) as ExportType[]).map((t) => <option key={t} value={t}>{EXPORT_TYPE_LABELS[t]}</option>)}
                </select>
              </div>
              {isZeroRatedExport ? (
                <>
                  <div className="ent-fg">
                    <label className="ent-fl">{exportType} ARN / Number</label>
                    <input className="ent-fc" value={lutBondNumber} onChange={(e) => setLutBondNumber(e.target.value)} required />
                  </div>
                  <div className="ent-fg">
                    <label className="ent-fl">{exportType} Date</label>
                    <input type="date" className="ent-fc" value={lutBondDate} onChange={(e) => setLutBondDate(e.target.value)} required />
                  </div>
                </>
              ) : (
                <div className="ent-fg">
                  <label className="ent-fl">&nbsp;</label>
                  <span style={{ fontSize: 12, color: "var(--color-muted)" }}>
                    Tax charged on this export is posted as IGST and expected to be claimed back as a refund — not zero-rated.
                  </span>
                </div>
              )}
            </div>
          )}

          {isForeign && (
            <div className="ent-form-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
              <div className="ent-fg">
                <label className="ent-fl">Shipping Bill Number <span style={{ fontWeight: 400, color: "var(--color-muted)" }}>(optional)</span></label>
                <input className="ent-fc" value={newShippingBillNumber} onChange={(e) => setNewShippingBillNumber(e.target.value)} placeholder="If already known" />
              </div>
              <div className="ent-fg">
                <label className="ent-fl">Shipping Bill Date <span style={{ fontWeight: 400, color: "var(--color-muted)" }}>(optional)</span></label>
                <input type="date" className="ent-fc" value={newShippingBillDate} onChange={(e) => setNewShippingBillDate(e.target.value)} />
              </div>
              <div className="ent-fg">
                <label className="ent-fl">Port Code <span style={{ fontWeight: 400, color: "var(--color-muted)" }}>(optional)</span></label>
                <input className="ent-fc" value={newPortCode} onChange={(e) => setNewPortCode(e.target.value)} placeholder="e.g. INNSA1" />
              </div>
            </div>
          )}

          <div style={{ padding: "0 14px" }}>
            <table className="ent-table">
              <thead><tr><th style={{ width: "30%" }}>Item</th><th>Qty</th><th>Rate{isForeign ? ` (${currency})` : ""}</th>{isForeign && <th>Rate (₹)</th>}<th>Discount</th><th>Tax %</th><th /></tr></thead>
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
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        <select className="ent-fc" style={{ width: 62 }} value={line.discountType ?? ""} onChange={(e) => updateLine(i, { discountType: (e.target.value || null) as DiscountType | null })}>
                          <option value="">—</option>
                          <option value="PERCENT">%</option>
                          <option value="FLAT">₹</option>
                        </select>
                        <input
                          type="number" min={0} step="0.01" className="ent-fc" style={{ width: 70 }}
                          value={line.discountValue || ""} disabled={!line.discountType}
                          onChange={(e) => updateLine(i, { discountValue: Number(e.target.value) })}
                        />
                      </div>
                    </td>
                    <td><input type="number" min={0} step="0.01" className="ent-fc" value={line.taxRate || ""} onChange={(e) => updateLine(i, { taxRate: Number(e.target.value) })} /></td>
                    <td><button type="button" className="ent-ia ent-ia-del" disabled={lines.length <= 1} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="ent-add-row" style={{ margin: "10px 0" }} onClick={() => setLines((ls) => [...ls, emptyLine()])}>+ Add line</button>

            {/* CHARGES. Deliberately not lines, and deliberately without a tax
                rate box. A charge is prorated across the goods above and taxed
                at their rate - section 15(2)(c) puts incidental expenses inside
                the value of the supply, and section 8(a) taxes a composite
                supply at the rate of the principal one. Offering a rate here
                would be offering a way to get that wrong on every invoice. */}
            {charges.length > 0 && (
              <table className="ent-table" style={{ marginBottom: 8 }}>
                <thead>
                  <tr>
                    <th style={{ width: "40%" }}>Charge</th>
                    <th style={{ width: "38%" }}>Credits</th>
                    <th style={{ width: "18%" }}>Amount</th>
                    <th style={{ width: "4%" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {charges.map((c, i) => {
                    // The account is shown, not chosen. It belongs to the
                    // charge type, and letting it be overridden here would
                    // reopen the drift the master was built to close.
                    const type = chargeTypes.find((t) => t.id === c.chargeTypeId);
                    return (
                    <tr key={i}>
                      <td>
                        <select
                          className="ent-fc" value={c.chargeTypeId}
                          onChange={(e) => setCharges((cs) => cs.map((x, idx) => idx === i ? { ...x, chargeTypeId: e.target.value } : x))}
                        >
                          <option value="">Select a charge…</option>
                          {chargeTypes.map((t) => (
                            <option key={t.id} value={t.id}>{t.label}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ fontSize: 12, color: "var(--color-muted)" }}>
                        {type ? `${type.account.accountCode} ${type.account.accountName}` : "—"}
                      </td>
                      <td>
                        <input
                          type="number" min={0} step="0.01" className="ent-fc" placeholder="0.00"
                          value={c.amount}
                          onChange={(e) => setCharges((cs) => cs.map((x, idx) => idx === i ? { ...x, amount: e.target.value } : x))}
                        />
                      </td>
                      <td>
                        <button type="button" className="ent-ia ent-ia-del" onClick={() => setCharges((cs) => cs.filter((_, idx) => idx !== i))}>✕</button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 12px" }}>
              {/* No button at all when the master is empty, and a sentence
                  saying where to go instead. An "Add charge" that can only
                  produce an empty dropdown is worse than no button. */}
              {chargeTypes.length > 0 ? (
                <button
                  type="button" className="ent-add-row" style={{ margin: 0 }}
                  onClick={() => setCharges((cs) => [...cs, { chargeTypeId: "", amount: "" }])}
                >
                  + Add charge (freight, packing, insurance)
                </button>
              ) : (
                <span style={{ fontSize: 11.5, color: "var(--color-muted)" }}>
                  To charge delivery, packing or insurance on an invoice, set the charges up once under
                  Configuration &rsaquo; Charge Master.
                </span>
              )}
              {charges.length > 0 && (
                <span style={{ fontSize: 11.5, color: "var(--color-muted)" }}>
                  Charges are spread across the lines above by value and taxed at the goods&rsquo; rate,
                  as a composite supply. They have no rate of their own.
                </span>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 12 }}>
              <div className="ent-fg" style={{ marginBottom: 0 }}>
                <label className="ent-fl">Invoice Discount</label>
                <select className="ent-fc" value={invoiceDiscountType} onChange={(e) => setInvoiceDiscountType(e.target.value as DiscountType | "")}>
                  <option value="">None</option>
                  <option value="PERCENT">Percent %</option>
                  <option value="FLAT">Flat ₹</option>
                </select>
              </div>
              <div className="ent-fg" style={{ marginBottom: 0 }}>
                <label className="ent-fl">&nbsp;</label>
                <input
                  type="number" min={0} step="0.01" className="ent-fc" disabled={!invoiceDiscountType}
                  value={invoiceDiscountValue} onChange={(e) => setInvoiceDiscountValue(e.target.value)}
                  placeholder={invoiceDiscountType === "PERCENT" ? "e.g. 5" : "e.g. 500"}
                />
              </div>
              <span style={{ fontSize: 12, color: "var(--color-muted)", paddingBottom: 8 }}>
                Applied on top of each line's own discount, spread proportionally across lines.
              </span>
            </div>

            <div style={{
              display: "flex", flexWrap: "wrap", gap: "6px 18px", alignItems: "center",
              background: "#f8fafd", border: "1px solid var(--color-border)", borderRadius: 6,
              padding: "8px 14px", fontSize: 13, marginBottom: 12,
            }}>
              <span>Gross Subtotal: <strong>{totals.subtotal.toFixed(2)}</strong></span>
              <span>Discount: <strong>-{totals.discountTotal.toFixed(2)}</strong></span>
              {chargesTotal > 0 && <span>Charges: <strong>+{chargesTotal.toFixed(2)}</strong></span>}
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

          {isZeroRatedExport && hasLineTax && (
            <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 10px" }}>
              A {exportType} export is zero-rated — remove the tax rate from every line, or switch Export Type to "With Payment of IGST".
            </p>
          )}
          {error && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 10px" }}>{error}</p>}

          {/* The shortfall panel. Appears only after the server has refused
              this invoice for want of stock, and only where the company
              permits the override - so the decision is taken in front of the
              actual number rather than pre-emptively on an empty form. */}
          {shortfall && (
            <div style={{
              margin: "0 14px 12px", padding: "10px 12px", borderRadius: 6,
              border: "1px solid #f59e0b", background: "#fffbeb",
            }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#92400e" }}>
                Not enough stock
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#92400e" }}>{shortfall}</p>
              <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--color-muted)" }}>
                This company allows an invoice to be posted anyway. Cost of goods sold will be taken at the
                current average for the whole quantity, including the part not held, so the margin on this
                invoice is an estimate. The item&rsquo;s stock balance goes negative until the goods are
                received. Give a reason — it is stored on the invoice.
              </p>
              <input
                className="ent-fc" maxLength={200} style={{ marginTop: 8 }}
                placeholder="Why is this being posted short? e.g. goods delivered, purchase bill not yet entered"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  type="button" className="ent-btn-save"
                  disabled={saving || !overrideReason.trim()}
                  onClick={(e) => handleCreate(e, true)}
                >
                  {saving ? "Posting…" : "Post anyway"}
                </button>
                <button
                  type="button" className="ent-btn"
                  onClick={() => { setShortfall(null); setOverrideReason(""); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div style={{ padding: "0 14px 14px" }}>
            <button type="submit" className="ent-btn-save" disabled={saving || !businessPartnerId || (isZeroRatedExport && hasLineTax)}>{saving ? "Posting…" : "Post Invoice"}</button>
          </div>
        </form>
      )}

      {error && !showForm && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {(detailLoading || detail || detailError) && (
        <div className="ent-section">
          <div className="ent-section-hdr">
            <span className="ent-section-title">{detail ? `Invoice ${detail.invoiceNumber}` : "Loading…"}</span>
            {detail && (
              <button type="button" className="ent-ia ent-ia-edit" disabled={downloadingPdf} onClick={() => handleDownloadPdf(detail)}>
                {downloadingPdf ? "Downloading…" : "Download PDF"}
              </button>
            )}
            <button type="button" className="ent-ia ent-ia-edit" onClick={() => { setDetail(null); setDetailError(null); }}>Close</button>
          </div>
          {detailLoading && <p style={{ padding: "0 14px 14px", fontSize: 13, color: "var(--color-muted)" }}>Loading…</p>}
          {detailError && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 14px" }}>{detailError}</p>}
          {downloadError && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 14px" }}>{downloadError}</p>}
          {detail && (() => {
            const docForeign = detail.currency !== "INR";
            // An export is always inter-state (IGST) — show that column even
            // when the amount is 0 (LUT/BOND), rather than only when tax
            // happened to be charged, so the layout matches what actually
            // determined the split (see the note on POST /sales-invoices).
            const docInterState = docForeign || Number(detail.igstTotal) > 0;
            return (
              <>
                <div style={{ padding: "0 14px 10px", fontSize: 13, color: "var(--color-muted)" }}>
                  {new Date(detail.invoiceDate).toLocaleDateString()} · {detail.businessPartner.name}
                  {detail.narration ? ` · ${detail.narration}` : ""}
                  {docForeign && ` · ${detail.currency} @ ${Number(detail.exchangeRate).toFixed(4)}`}
                  {detail.salesOrder && ` · from ${detail.salesOrder.soNumber}`}
                  {detail.exportType && ` · ${EXPORT_TYPE_LABELS[detail.exportType]}`}
                  {detail.lutBondNumber && ` (${detail.lutBondNumber}${detail.lutBondDate ? `, ${new Date(detail.lutBondDate).toLocaleDateString()}` : ""})`}
                </div>

                {docForeign && (
                  <div style={{ padding: "0 14px 10px" }}>
                    {!editingShipping ? (
                      <div style={{
                        display: "flex", flexWrap: "wrap", gap: "6px 18px", alignItems: "center",
                        background: "#f8fafd", border: "1px solid var(--color-border)", borderRadius: 6,
                        padding: "8px 14px", fontSize: 13,
                      }}>
                        <span>Shipping Bill: <strong>{detail.shippingBillNumber || "not added yet"}</strong>{detail.shippingBillDate && ` (${new Date(detail.shippingBillDate).toLocaleDateString()})`}</span>
                        <span>Port: <strong>{detail.portCode || "—"}</strong></span>
                        <button type="button" className="ent-ia ent-ia-edit" onClick={() => startEditShipping(detail)}>Edit</button>
                      </div>
                    ) : (
                      <div className="ent-form-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                        <div className="ent-fg">
                          <label className="ent-fl">Shipping Bill Number</label>
                          <input className="ent-fc" value={shipNumber} onChange={(e) => setShipNumber(e.target.value)} />
                        </div>
                        <div className="ent-fg">
                          <label className="ent-fl">Shipping Bill Date</label>
                          <input type="date" className="ent-fc" value={shipDate} onChange={(e) => setShipDate(e.target.value)} />
                        </div>
                        <div className="ent-fg">
                          <label className="ent-fl">Port Code</label>
                          <input className="ent-fc" value={shipPort} onChange={(e) => setShipPort(e.target.value)} placeholder="e.g. INNSA1" />
                        </div>
                        <div className="ent-fg">
                          <label className="ent-fl">LUT/Bond Number</label>
                          <input className="ent-fc" value={shipLutBondNumber} onChange={(e) => setShipLutBondNumber(e.target.value)} />
                        </div>
                        <div className="ent-fg">
                          <label className="ent-fl">LUT/Bond Date</label>
                          <input type="date" className="ent-fc" value={shipLutBondDate} onChange={(e) => setShipLutBondDate(e.target.value)} />
                        </div>
                        <div className="ent-fg" style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                          <button type="button" className="ent-btn-save" disabled={savingShipping} onClick={() => handleSaveShipping(detail.id)}>{savingShipping ? "Saving…" : "Save"}</button>
                          <button type="button" className="ent-ia ent-ia-edit" onClick={() => setEditingShipping(false)}>Cancel</button>
                        </div>
                        {shippingError && <p style={{ color: "#dc2626", fontSize: 13, gridColumn: "1 / -1" }}>{shippingError}</p>}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ padding: "0 14px" }}>
                  <table className="ent-table">
                    <thead>
                      <tr>
                        <th>Item</th><th>Qty</th><th>Rate</th>{docForeign && <th>Rate ({detail.currency})</th>}<th>Discount</th><th>Taxable Value</th>
                        {docInterState ? <th>IGST</th> : <><th>CGST</th><th>SGST</th></>}
                        <th style={{ textAlign: "right" }}>Line Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lines.map((l) => {
                        const lineDiscount = Number(l.lineDiscountAmount || 0) + Number(l.invoiceDiscountShare || 0);
                        return (
                          <tr key={l.id}>
                            <td>{l.item.sku} — {l.item.name}</td>
                            <td>{l.quantity}</td>
                            <td>{Number(l.rate).toFixed(2)}</td>
                            {docForeign && <td>{Number(l.rateFc ?? 0).toFixed(2)}</td>}
                            <td>{lineDiscount > 0 ? lineDiscount.toFixed(2) : "—"}</td>
                            <td>{Number(l.taxableValue).toFixed(2)}</td>
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
                  <span>Gross Subtotal: <strong>{Number(detail.subtotal).toFixed(2)}</strong></span>
                  <span>Discount: <strong>-{Number(detail.discountTotal).toFixed(2)}</strong></span>
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
          <thead><tr><th>Invoice #</th><th>Date</th><th>Customer</th><th style={{ textAlign: "right" }}>Amount</th><th /></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="ent-empty">Loading…</td></tr>}
            {!loading && invoices.length === 0 && <tr><td colSpan={5} className="ent-empty">No invoices yet.</td></tr>}
            {invoices.map((inv) => (
              <tr key={inv.id} style={{ cursor: "pointer" }} onClick={() => openDetail(inv.id)}>
                <td style={{ fontWeight: 500 }}>{inv.invoiceNumber}</td>
                <td style={{ color: "var(--color-muted)" }}>{new Date(inv.invoiceDate).toLocaleDateString()}</td>
                <td>{inv.businessPartner.name}</td>
                <td style={{ textAlign: "right" }}>
                  {Number(inv.grandTotal).toFixed(2)}
                  {inv.currency !== "INR" && inv.grandTotalFc != null && (
                    <div style={{ fontSize: 11, color: "var(--color-muted)" }}>{currencySymbol(inv.currency)}{Number(inv.grandTotalFc).toFixed(2)}</div>
                  )}
                </td>
                <td style={{ textAlign: "right" }}>
                  <Link className="ent-ia ent-ia-edit" href={`/sales/returns?invoiceId=${inv.id}`} onClick={(e) => e.stopPropagation()}>Return</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function SalesInvoicesPage() {
  return (
    <AppShell>
      <CostingMethodGate>
        <Suspense fallback={null}>
          <SalesInvoicesInner />
        </Suspense>
      </CostingMethodGate>
    </AppShell>
  );
}
