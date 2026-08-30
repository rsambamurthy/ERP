import { randomUUID } from "crypto";
import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { consumeStock, InsufficientStockError } from "../lib/costing";
import { computeDiscountedLines, isInterState, round2, type DiscountType } from "../lib/discountGst";
import { isSupportedCurrency } from "../lib/currencies";
import { buildSalesInvoicePdf } from "../lib/salesInvoicePdf";

const TRADE_RECEIVABLES_CODE = "1005";
// Exported because routes/chargeTypes.ts refuses a charge type that credits
// it, and that refusal has to be the same account as the one the invoice
// refuses. Two copies of "5001" is exactly the drift the Charge Master was
// built to stop, so there is one.
export const SALES_REVENUE_CODE = "5001";
const DISCOUNT_ALLOWED_CODE = "4003";
const CGST_OUTPUT_CODE = "2102";
const SGST_OUTPUT_CODE = "2103";
const IGST_OUTPUT_CODE = "2104";
const COGS_CODE = "4001";

const router = Router();
router.use(authenticate, requireActiveSubscription);
const canPost = requirePermission("sales.post");

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

interface LineInput {
  itemId: string;
  quantity: number;
  rate: number;
  // Foreign-currency invoices only — the unit rate as entered, in the
  // invoice's currency. When present, it (not `rate`) is authoritative:
  // rate gets overwritten server-side as round2(rateFc * exchangeRate)
  // before anything else runs. See the currency handling note in POST /.
  rateFc?: number;
  taxRate?: number;
  discountType?: DiscountType | null;
  discountValue?: number;
  // Only meaningful when the invoice itself is linked to a salesOrderId —
  // which DeliveryNoteLine this line invoices against (3-way match:
  // SO -> DN -> Invoice, see routes/deliveryNotes.ts). Required on every
  // line whenever the invoice has a salesOrderId; the SalesOrderLine it
  // fulfills is derived server-side from this DN line, never taken
  // directly from the request. This line's own quantity can never exceed
  // what's still unbilled on that DN line (delivered − already billed).
  // Stock is never re-consumed for a line like this — the Delivery Note it
  // references already moved that stock out, and its captured unitCost is
  // reused for this line's COGS instead of calling consumeStock again.
  deliveryNoteLineId?: string;
}

router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const invoices = await prisma.salesInvoice.findMany({
    where: { organizationId },
    include: { businessPartner: { select: { id: true, name: true } }, lines: { include: { item: { select: { id: true, sku: true, name: true } } } } },
    orderBy: { invoiceDate: "desc" },
    take: 200,
  });
  res.json({ data: invoices });
});

router.get("/:id", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id: req.params.id, organizationId },
    include: {
      businessPartner: true, lines: { include: { item: true } }, journalEntry: { include: { journalLines: true } },
      charges: { include: { account: { select: { accountCode: true, accountName: true } } }, orderBy: { sortOrder: "asc" } },
      salesOrder: { select: { id: true, soNumber: true } },
    },
  });
  if (!invoice) return res.status(404).json({ message: "Sales invoice not found." });
  res.json({ data: invoice });
});

// GET /sales-invoices/:id/pdf — the same information already on the detail
// screen, rendered as a downloadable GST Tax Invoice to actually send to
// the customer. No extra permission beyond viewing the invoice itself
// (this is a read/export action). See lib/salesInvoicePdf.ts.
router.get("/:id/pdf", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id: req.params.id, organizationId },
    include: {
      businessPartner: { select: { name: true, gstin: true, address: true, phone: true, email: true } },
      branch: { select: { name: true, gstin: true, address: true, phone: true, email: true } },
      lines: { include: { item: { select: { sku: true, name: true, hsnCode: true, uom: true } } } },
      charges: { orderBy: { sortOrder: "asc" } },
      salesOrder: { select: { soNumber: true } },
    },
  });
  if (!invoice) return res.status(404).json({ message: "Sales invoice not found." });

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, registeredOfficeAddress: true, cin: true },
  });
  if (!organization) return res.status(404).json({ message: "Organization not found." });

  // Same "is this an inter-state / export supply" determination the
  // detail screen uses — an export is always inter-state, otherwise go by
  // whether any IGST actually posted (see the note on POST / above).
  const isForeign = invoice.currency !== "INR";
  const interState = isForeign || Number(invoice.igstTotal) > 0;

  const buffer = await buildSalesInvoicePdf({
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    narration: invoice.narration,
    subtotal: Number(invoice.subtotal),
    discountTotal: Number(invoice.discountTotal),
    taxTotal: Number(invoice.taxTotal),
    cgstTotal: Number(invoice.cgstTotal),
    sgstTotal: Number(invoice.sgstTotal),
    igstTotal: Number(invoice.igstTotal),
    grandTotal: Number(invoice.grandTotal),
    interState,
    currency: invoice.currency,
    exchangeRate: Number(invoice.exchangeRate),
    grandTotalFc: invoice.grandTotalFc !== null ? Number(invoice.grandTotalFc) : null,
    exportType: invoice.exportType,
    lutBondNumber: invoice.lutBondNumber,
    lutBondDate: invoice.lutBondDate,
    shippingBillNumber: invoice.shippingBillNumber,
    shippingBillDate: invoice.shippingBillDate,
    portCode: invoice.portCode,
    salesOrderNumber: invoice.salesOrder?.soNumber ?? null,
    organization: {
      name: organization.name,
      registeredOfficeAddress: organization.registeredOfficeAddress as string | null,
      cin: organization.cin,
    },
    branch: invoice.branch
      ? { name: invoice.branch.name, gstin: invoice.branch.gstin, address: invoice.branch.address, phone: invoice.branch.phone, email: invoice.branch.email }
      : null,
    customer: {
      name: invoice.businessPartner.name, gstin: invoice.businessPartner.gstin,
      address: invoice.businessPartner.address, phone: invoice.businessPartner.phone, email: invoice.businessPartner.email,
    },
    lines: invoice.lines.map((l) => ({
      itemSku: l.item.sku, itemName: l.item.name, hsnCode: l.item.hsnCode, uom: l.item.uom,
      quantity: Number(l.quantity), rate: Number(l.rate), taxableValue: Number(l.taxableValue),
      cgstAmount: Number(l.cgstAmount), sgstAmount: Number(l.sgstAmount), igstAmount: Number(l.igstAmount),
      lineTotal: Number(l.lineTotal),
    })),
    // Shown as their own lines under the goods, with a note that the tax
    // is already in the figures above. A customer reading the invoice has
    // to be able to see what the freight was; a customer reading a tax
    // column beside it would reasonably expect that tax to be additional,
    // and it is not - it is inside the goods lines, which is where the Act
    // puts it.
    charges: invoice.charges.map((c) => ({ label: c.label, amount: Number(c.amount) })),
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${invoice.invoiceNumber}.pdf"`);
  res.send(buffer);
});

// PATCH /sales-invoices/:id — reference-data-only edit, for the export
// paperwork (shipping bill, LUT/Bond ARN) that's almost never known yet at
// posting time and arrives later. Deliberately whitelisted to these five
// fields — nothing here touches an amount, a GST figure, or the journal
// entry, so there's no re-posting/reversal to do, unlike a real invoice
// edit (which this app doesn't support at all — see PATCH /journal/:id for
// the one document type that does, and why it's safe there: manual
// entries only, no downstream stock/COGS impact).
router.patch("/:id", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const invoice = await prisma.salesInvoice.findFirst({ where: { id: req.params.id, organizationId } });
  if (!invoice) return res.status(404).json({ message: "Sales invoice not found." });
  if (invoice.currency === "INR") {
    return res.status(400).json({ message: "Shipping bill / LUT-Bond fields only apply to a foreign-currency (export) invoice." });
  }

  const { shippingBillNumber, shippingBillDate, portCode, lutBondNumber, lutBondDate } = req.body ?? {};
  // Built as a typed literal (not a loosely-typed intermediate variable) so
  // it satisfies Prisma's generated update-input type exactly — a
  // Record<string, unknown> here would fail `tsc` (this repo's `npm run
  // build` is `prisma generate && tsc`), which is a hard build failure,
  // not a runtime one; a key omitted from the request body keeps the
  // invoice's existing value rather than being cleared.
  const updated = await prisma.salesInvoice.update({
    where: { id: invoice.id },
    data: {
      shippingBillNumber: shippingBillNumber !== undefined ? (shippingBillNumber ? String(shippingBillNumber) : null) : invoice.shippingBillNumber,
      shippingBillDate: shippingBillDate !== undefined ? (shippingBillDate ? new Date(shippingBillDate) : null) : invoice.shippingBillDate,
      portCode: portCode !== undefined ? (portCode ? String(portCode) : null) : invoice.portCode,
      lutBondNumber: lutBondNumber !== undefined ? (lutBondNumber ? String(lutBondNumber) : null) : invoice.lutBondNumber,
      lutBondDate: lutBondDate !== undefined ? (lutBondDate ? new Date(lutBondDate) : null) : invoice.lutBondDate,
    },
    // Same shape as GET /:id — the frontend sets its detail state straight
    // from this response and immediately re-renders the line table, so it
    // needs businessPartner/lines present, not just the updated scalars.
    include: { businessPartner: true, lines: { include: { item: true } } },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "sales_invoice", entityId: invoice.id,
    summary: `Updated export reference fields on ${invoice.invoiceNumber}`,
  });
  res.json({ data: updated });
});

// POST /sales-invoices — create and post in one step. Stock outward for
// every line (rejected if any line's branch stock can't cover it) UNLESS
// the invoice is linked to a Sales Order, in which case that stock already
// left via a Delivery Note (see the salesOrderId handling below) — one
// journal entry: Dr Trade Receivables (tagged the customer) / Cr Sales
// Revenue (gross, pre-discount) + Dr Discount Allowed (line + invoice-level
// discount combined) + Cr CGST/SGST/IGST Output (split by whether the
// branch and customer are in the same GST state), and Dr Cost of Goods
// Sold / Cr each item's stock account (tagged that item's own ITEM
// business partner). Discount never touches COGS — that's the item's
// actual cost, unrelated to what it sold for.
router.post("/", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const {
    businessPartnerId, invoiceDate, branchId, narration, lines, discountType, discountValue, charges,
    currency, exchangeRate, exportType, lutBondNumber, lutBondDate,
    shippingBillNumber, shippingBillDate, portCode, salesOrderId,
  } = req.body ?? {};
  if (!invoiceDate || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ message: "invoiceDate and at least one line are required." });
  }

  // Linked to a Sales Order — must be APPROVED (only an approved SO is a
  // real commitment), and the customer is *derived* from the SO rather
  // than taken from the request, so an invoice can never be posted against
  // a different customer than the one the SO was approved for. See
  // routes/salesOrders.ts for the approval workflow itself.
  let linkedSo: { id: string; businessPartnerId: string; status: string; currency: string; lines: { id: string; quantity: any; rate: any; billedQuantity: any }[] } | null = null;
  if (salesOrderId) {
    linkedSo = await prisma.salesOrder.findFirst({
      where: { id: salesOrderId, organizationId },
      include: { lines: { select: { id: true, quantity: true, rate: true, billedQuantity: true } } },
    });
    if (!linkedSo) return res.status(400).json({ message: "salesOrderId is not a valid Sales Order for this organization." });
    if (linkedSo.status !== "APPROVED") {
      return res.status(400).json({ message: `Sales Order ${salesOrderId} is ${linkedSo.status}, not Approved — only an approved SO can be invoiced.` });
    }
    if (businessPartnerId && businessPartnerId !== linkedSo.businessPartnerId) {
      return res.status(400).json({ message: "businessPartnerId doesn't match the customer on the linked Sales Order." });
    }
    if (currency && String(currency).toUpperCase() !== linkedSo.currency) {
      return res.status(400).json({ message: `currency doesn't match the currency on the linked Sales Order (${linkedSo.currency}).` });
    }
  }
  const effectiveBusinessPartnerId = linkedSo?.businessPartnerId ?? businessPartnerId;
  if (!effectiveBusinessPartnerId) {
    return res.status(400).json({ message: "businessPartnerId (or salesOrderId) is required." });
  }

  // Foreign currency (export invoices) — see lib/currencies.ts. Defaults
  // keep every domestic invoice byte-for-byte identical to before this
  // feature existed: currencyCode "INR", fxRate 1, isForeign false.
  // SO-linked: the currency *code* is derived from the SO (validated
  // above) — an invoice can't switch currencies mid-way through an SO's
  // billing history. exchangeRate is deliberately still the invoice's own
  // — the real market rate on the actual invoice date, not the SO's
  // (possibly stale) rate at approval time, same reasoning as the PO-linked
  // Purchase Bill (routes/purchaseBills.ts).
  const currencyCode = linkedSo ? linkedSo.currency : String(currency || "INR").toUpperCase();
  if (!isSupportedCurrency(currencyCode)) {
    return res.status(400).json({ message: `Unsupported currency "${currencyCode}".` });
  }
  const isForeign = currencyCode !== "INR";
  const fxRate = isForeign ? Number(exchangeRate) : 1;
  if (isForeign && !(fxRate > 0)) {
    return res.status(400).json({ message: "exchangeRate must be greater than 0 for a non-INR invoice." });
  }

  // LUT/Bond export classification — every export must declare which route
  // it's taking. LUT/BOND are zero-rated by law (no tax at all); WPAY (with
  // payment of IGST) may carry tax, later claimed back as a refund. Not
  // applicable to a domestic (INR) invoice — exportType stays null there.
  const EXPORT_TYPES = ["LUT", "BOND", "WPAY"];
  let exportTypeCode: string | null = null;
  let lutBondNumberVal: string | null = null;
  let lutBondDateVal: Date | null = null;
  if (isForeign) {
    exportTypeCode = String(exportType || "").toUpperCase();
    if (!EXPORT_TYPES.includes(exportTypeCode)) {
      return res.status(400).json({ message: "exportType must be LUT, BOND, or WPAY for a non-INR invoice." });
    }
    if (exportTypeCode === "LUT" || exportTypeCode === "BOND") {
      if (!lutBondNumber || !lutBondDate) {
        return res.status(400).json({ message: `lutBondNumber and lutBondDate are required for a ${exportTypeCode} export.` });
      }
      lutBondNumberVal = String(lutBondNumber);
      lutBondDateVal = new Date(lutBondDate);
      const hasTax = (lines as LineInput[]).some((l) => Number(l.taxRate ?? 0) > 0);
      if (hasTax) {
        return res.status(400).json({
          message: `A ${exportTypeCode} export is zero-rated — no line may carry a tax rate. Use "With Payment of IGST" instead if this export pays and reclaims IGST.`,
        });
      }
    }
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { costingMethod: true, allowNegativeStock: true },
  });
  if (!org?.costingMethod) return res.status(422).json({ message: "Set the organization's stock costing method first." });

  // THE NEGATIVE-STOCK OVERRIDE. Two locks, and both have to be open.
  //
  // The organisation has to permit it at all (migration_053, off by
  // default), and THIS invoice has to ask for it. An organisation with the
  // setting on still refuses every ordinary invoice that runs short,
  // because the setting grants the possibility rather than the behaviour -
  // otherwise turning it on would silently change what every existing
  // document does, which is the opposite of a deliberate decision.
  //
  // The reason is mandatory and is stored on the invoice. "Why did this go
  // negative" is the question somebody asks three months later, and a
  // boolean cannot answer it. Refusing without one here rather than
  // defaulting to "override" keeps the answer worth reading.
  const wantsOverride = req.body?.allowNegativeStock === true;
  const negativeStockReason = String(req.body?.negativeStockReason ?? "").trim();
  if (wantsOverride && !org.allowNegativeStock) {
    return res.status(403).json({
      message: "This organization does not allow invoicing stock it does not hold. " +
        "An administrator can enable it under Company Master.",
    });
  }
  if (wantsOverride && !negativeStockReason) {
    return res.status(400).json({ message: "negativeStockReason is required when overriding the stock check." });
  }
  if (negativeStockReason.length > 200) {
    return res.status(400).json({ message: "negativeStockReason must be 200 characters or fewer." });
  }
  const allowNegative = wantsOverride && org.allowNegativeStock;

  const customer = await prisma.businessPartner.findFirst({ where: { id: effectiveBusinessPartnerId, organizationId, bpType: "CUSTOMER" } });
  if (!customer) return res.status(400).json({ message: "businessPartnerId must be an existing customer." });

  let resolvedBranchId: string | null = branchId ?? null;
  if (!resolvedBranchId) {
    const ho = await prisma.branch.findFirst({ where: { organizationId, isHeadOffice: true } });
    resolvedBranchId = ho?.id ?? null;
  }
  if (!resolvedBranchId) return res.status(400).json({ message: "No branch found — provide branchId." });
  const branch = await prisma.branch.findFirst({ where: { id: resolvedBranchId, organizationId }, select: { stateCode: true } });

  const typedLines: LineInput[] = lines;
  const itemIds = [...new Set(typedLines.map((l) => l.itemId))];
  // SERVICE items are purchase-only (migration_029): they debit an expense
  // head and have no stock, so issuing, receiving or adjusting one is
  // meaningless. Filtering here rather than only in the picker means an
  // API-level call can't post one either — a sales line would otherwise
  // credit an expense account and try to issue stock that never existed.
  const items = await prisma.item.findMany({ where: { id: { in: itemIds }, organizationId, deletedAt: null, itemKind: "STOCK" } });
  if (items.length !== itemIds.length) return res.status(400).json({ message: "One or more items are invalid for this organization." });
  const itemById = new Map(items.map((i) => [i.id, i]));

  // Sales-Order-linked invoices: the 3-way match. Every line must
  // reference a deliveryNoteLineId (raised via a Delivery Note against
  // this same SO — see routes/deliveryNotes.ts), and can't invoice more
  // than what's still open on that DN line (delivered qty minus whatever's
  // already been invoiced against it, including by other Sales Invoices
  // raised earlier). Two lines on *this* invoice referencing the same DN
  // line are summed together before comparing. Each line's
  // salesOrderLineId is then derived from its DN line (never taken from
  // the request) so the SalesOrderLine.billedQuantity rollup / SO
  // auto-close logic below needs no other change. Runs before the
  // transaction (nothing here needs a DB write) — same timing
  // purchaseBills.ts uses for its GRN check.
  const dnLineById = new Map<string, { id: string; salesOrderLineId: string; quantityDelivered: any; billedQuantity: any; unitCost: any }>();
  if (linkedSo) {
    const typedWithLink = typedLines as (LineInput & { salesOrderLineId?: string })[];
    if (typedWithLink.some((l) => !l.deliveryNoteLineId)) {
      return res.status(400).json({ message: "Every line on a Sales-Order-linked invoice must reference a deliveryNoteLineId — raise a Delivery Note against this Sales Order first." });
    }
    const dnLineIds = [...new Set(typedWithLink.map((l) => l.deliveryNoteLineId!))];
    const dnLines = await prisma.deliveryNoteLine.findMany({
      where: { id: { in: dnLineIds }, deliveryNote: { organizationId, salesOrderId: linkedSo.id } },
      select: { id: true, salesOrderLineId: true, quantityDelivered: true, billedQuantity: true, unitCost: true },
    });
    if (dnLines.length !== dnLineIds.length) {
      return res.status(400).json({ message: "One or more lines reference a deliveryNoteLineId that isn't a Delivery Note against this Sales Order." });
    }
    for (const dl of dnLines) dnLineById.set(dl.id, dl);

    const billedOnThisInvoice = new Map<string, number>();
    for (const l of typedWithLink) {
      l.salesOrderLineId = dnLineById.get(l.deliveryNoteLineId!)!.salesOrderLineId;
      billedOnThisInvoice.set(l.deliveryNoteLineId!, (billedOnThisInvoice.get(l.deliveryNoteLineId!) ?? 0) + l.quantity);
    }
    for (const [dnLineId, qtyOnThisInvoice] of billedOnThisInvoice) {
      const dnLine = dnLineById.get(dnLineId)!;
      const alreadyBilled = Number(dnLine.billedQuantity);
      const delivered = Number(dnLine.quantityDelivered);
      if (round2(alreadyBilled + qtyOnThisInvoice) > delivered) {
        return res.status(400).json({
          message: `Invoicing ${qtyOnThisInvoice} against Delivery Note line ${dnLineId} would exceed the delivered quantity ` +
            `(${delivered} delivered, ${alreadyBilled} already invoiced, ${round2(delivered - alreadyBilled)} remaining).`,
        });
      }
    }
  }

  for (const l of typedLines) {
    if (isForeign) {
      if (!l.itemId || !(l.quantity > 0) || !(l.rateFc! >= 0)) {
        return res.status(400).json({ message: "Every line needs itemId, quantity > 0, and rateFc >= 0." });
      }
      // rateFc is authoritative for a foreign-currency invoice — overwrite
      // rate so every existing computation below (discount, tax, journal
      // posting) runs on the correct INR figure without any further change.
      l.rate = round2(l.rateFc! * fxRate);
    } else if (!l.itemId || !(l.quantity > 0) || !(l.rate >= 0)) {
      return res.status(400).json({ message: "Every line needs itemId, quantity > 0, and rate >= 0." });
    }
  }

  const [tradeReceivables, salesRevenue, discountAllowed, cgstOutput, sgstOutput, igstOutput, cogs] = await Promise.all([
    prisma.account.findFirst({ where: { organizationId, accountCode: TRADE_RECEIVABLES_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: SALES_REVENUE_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: DISCOUNT_ALLOWED_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: CGST_OUTPUT_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: SGST_OUTPUT_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: IGST_OUTPUT_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: COGS_CODE } }),
  ]);
  if (!tradeReceivables || !salesRevenue || !cogs) {
    return res.status(500).json({ message: "Core Sales accounts not found — re-run provisioning." });
  }

  // An export is always an inter-state (IGST) supply under GST law,
  // regardless of what stateCode (if any) is on file for the foreign
  // customer — never fall back to CGST+SGST just because a foreign
  // business partner has no Indian state code set.
  const interState = isForeign ? true : isInterState(branch?.stateCode, customer.stateCode);

  // FREIGHT, PACKING, INSURANCE. Document-level amounts, each with its own
  // income head, PRORATED across the lines below so that GST on them follows
  // the goods.
  //
  // Section 15(2)(c) puts incidental expenses inside the value of the supply
  // and section 8(a) taxes a composite supply at the rate of the principal
  // one, so freight on an invoice for 18% goods is taxed at 18% under the
  // goods' HSN - not at 5% under SAC 9965. Prorating makes that true by
  // construction: a charge never has a rate of its own to get wrong.
  //
  // THE LABEL AND THE ACCOUNT COME FROM THE CHARGE MASTER, NOT FROM THE
  // REQUEST. All an invoice sends is a chargeTypeId and an amount. That is
  // what makes "Delivery charges" the same three words on every document
  // and 5002 the same head every time - see migration_055 for why the free
  // text this replaced could not be left alone.
  //
  // The row is still written with its OWN copy of label and accountId,
  // snapshotted here, so renaming a charge type next year does not restate
  // an invoice issued today. chargeTypeId is stored alongside so a report
  // can group by type across such a rename.
  type ChargeInput = { chargeTypeId?: string; amount?: number };
  const chargeInputs: ChargeInput[] = Array.isArray(charges) ? charges : [];
  if (chargeInputs.length > 20) {
    return res.status(400).json({ message: "An invoice can carry at most 20 charges." });
  }
  const chargeTypeIds = [...new Set(chargeInputs.map((c) => String(c.chargeTypeId ?? "")))];
  const chargeTypes = chargeTypeIds.length
    ? await prisma.chargeType.findMany({
        where: { id: { in: chargeTypeIds }, organizationId, isActive: true },
        include: { account: { select: { id: true, accountCode: true, accountType: true, isGroup: true } } },
      })
    : [];
  const chargeTypeById = new Map(chargeTypes.map((t) => [t.id, t]));
  for (const c of chargeInputs) {
    const type = chargeTypeById.get(String(c.chargeTypeId ?? ""));
    if (!type) {
      return res.status(400).json({
        message: "Every charge must name an active charge type from the Charge Master.",
      });
    }
    if (!(Number(c.amount ?? 0) > 0)) {
      return res.status(400).json({ message: `Charge "${type.label}" must be a positive amount.` });
    }
    // The master refuses these at creation, so reaching them here means the
    // account was changed underneath a type that already existed. Checked
    // again rather than trusted, because the cost of being wrong is a
    // recovery buried in Sales Revenue where no report can find it again.
    if (type.account.accountType !== "INCOME" || type.account.isGroup) {
      return res.status(400).json({
        message: `Charge "${type.label}" points at an account that is no longer a postable income head.`,
      });
    }
    if (type.account.accountCode === SALES_REVENUE_CODE) {
      return res.status(400).json({
        message: `Charge "${type.label}" cannot post to Sales Revenue \u2014 use a separate head such as ` +
          `Freight & Delivery Recovered, so recovered charges can be read against what they cost.`,
      });
    }
  }
  const chargeRows = chargeInputs.map((c, i) => {
    const type = chargeTypeById.get(String(c.chargeTypeId))!;
    return {
      chargeTypeId: type.id,
      label: type.label,
      accountId: type.accountId,
      amount: round2(Number(c.amount)),
      sortOrder: i,
    };
  });
  const chargesTotal = round2(chargeRows.reduce((s, c) => s + c.amount, 0));

  const discountLines = computeDiscountedLines(
    typedLines.map((l) => ({ quantity: l.quantity, rate: l.rate, taxRate: l.taxRate ?? 0, discountType: l.discountType, discountValue: l.discountValue })),
    { type: discountType, value: discountValue },
    interState,
    chargesTotal
  );

  const count = await prisma.salesInvoice.count({ where: { organizationId } });
  const invoiceNumber = `SI-${String(count + 1).padStart(4, "0")}`;

  const invoiceId = randomUUID();

  try {
    const invoice = await prisma.$transaction(async (tx) => {
      // Consume stock first — need each line's real cost before the
      // journal entry can be built, and this is where insufficient stock
      // fails the whole transaction atomically. The invoice id is
      // generated upfront (rather than left blank and backfilled) so the
      // StockMovement rows created here can reference it directly.
      let subtotal = 0, discountTotal = 0, taxTotal = 0, cgstTotal = 0, sgstTotal = 0, igstTotal = 0, totalCogs = 0;
      const computed = [];
      let anyLineWentNegative = false;
      for (let i = 0; i < typedLines.length; i++) {
        const l = typedLines[i];
        const d = discountLines[i];
        let unitCost: number, totalCost: number;
        if (linkedSo) {
          // Stock already left via the referenced Delivery Note — reuse
          // its captured cost rather than calling consumeStock again,
          // which would double-consume stock (see the schema.prisma
          // comment on DeliveryNoteLine.unitCost).
          const dnLine = dnLineById.get((l as { deliveryNoteLineId?: string }).deliveryNoteLineId!)!;
          unitCost = Number(dnLine.unitCost);
          totalCost = round2(unitCost * l.quantity);
        } else {
          let wentNegative = false;
          ({ unitCost, totalCost, wentNegative } = await consumeStock(tx, {
            organizationId, branchId: resolvedBranchId!, itemId: l.itemId,
            quantity: l.quantity, costingMethod: org.costingMethod!,
            movementType: "SALE", referenceType: "sales_invoice", referenceId: invoiceId,
            movementDate: new Date(invoiceDate), narration: `Sales invoice ${invoiceNumber}`,
            allowNegative,
          }));
          if (wentNegative) anyLineWentNegative = true;
        }
        subtotal += d.lineSubtotal;
        discountTotal += round2(d.lineDiscountAmount + d.invoiceDiscountShare);
        taxTotal += d.taxAmount; cgstTotal += d.cgstAmount; sgstTotal += d.sgstAmount; igstTotal += d.igstAmount;
        totalCogs += totalCost;
        computed.push({ ...l, ...d, unitCost, lineCogs: round2(totalCost) });
      }
      const grandTotal = round2(computed.reduce((s, l) => s + l.lineTotal, 0));

      if (cgstTotal > 0 && !cgstOutput) throw Object.assign(new Error("CGST Output Payable account not found — re-run provisioning."), { status: 500 });
      if (sgstTotal > 0 && !sgstOutput) throw Object.assign(new Error("SGST Output Payable account not found — re-run provisioning."), { status: 500 });
      if (igstTotal > 0 && !igstOutput) throw Object.assign(new Error("IGST Output Payable account not found — re-run provisioning."), { status: 500 });
      if (discountTotal > 0 && !discountAllowed) throw Object.assign(new Error("Discount Allowed account not found — re-run provisioning."), { status: 500 });

      const journalEntry = await tx.journalEntry.create({
        data: {
          organizationId, branchId: resolvedBranchId, entryDate: new Date(invoiceDate),
          narration: narration || `Sales invoice ${invoiceNumber} — ${customer.name}`,
          voucherType: "SI", referenceType: "sales_invoice", createdBy: req.user!.userId,
        },
      });

      await tx.journalLine.createMany({
        data: [
          { journalEntryId: journalEntry.id, accountId: tradeReceivables.id, businessPartnerId: customer.id, debit: grandTotal, credit: 0, narration: `Receivable from ${customer.name}` },
          { journalEntryId: journalEntry.id, accountId: salesRevenue.id, businessPartnerId: null, debit: 0, credit: subtotal, narration: `Sales revenue — ${invoiceNumber}` },
          // Each charge to its OWN head, at its full amount - not prorated.
          // The proration is a GST device: it decides which line carries the
          // tax. The revenue itself belongs where somebody put it, whole, or
          // the P&L cannot answer "what did we recover on freight".
          ...chargeRows.map((c) => ({
            journalEntryId: journalEntry.id, accountId: c.accountId, businessPartnerId: null,
            debit: 0, credit: c.amount, narration: `${c.label} — ${invoiceNumber}`,
          })),
          ...(discountTotal > 0 ? [{ journalEntryId: journalEntry.id, accountId: discountAllowed!.id, businessPartnerId: null, debit: discountTotal, credit: 0, narration: "Discount allowed" }] : []),
          ...(cgstTotal > 0 ? [{ journalEntryId: journalEntry.id, accountId: cgstOutput!.id, businessPartnerId: null, debit: 0, credit: cgstTotal, narration: "CGST Output" }] : []),
          ...(sgstTotal > 0 ? [{ journalEntryId: journalEntry.id, accountId: sgstOutput!.id, businessPartnerId: null, debit: 0, credit: sgstTotal, narration: "SGST Output" }] : []),
          ...(igstTotal > 0 ? [{ journalEntryId: journalEntry.id, accountId: igstOutput!.id, businessPartnerId: null, debit: 0, credit: igstTotal, narration: "IGST Output" }] : []),
          { journalEntryId: journalEntry.id, accountId: cogs.id, businessPartnerId: null, debit: totalCogs, credit: 0, narration: `Cost of goods sold — ${invoiceNumber}` },
          ...computed.map((l) => ({
            journalEntryId: journalEntry.id,
            accountId: itemById.get(l.itemId)!.stockAccountId,
            businessPartnerId: itemById.get(l.itemId)!.businessPartnerId,
            debit: 0, credit: l.lineCogs,
            narration: `${itemById.get(l.itemId)!.sku} x ${l.quantity}`,
          })),
        ],
      });

      // Display-only FC derivatives — see the schema comment on
      // SalesInvoice.grandTotalFc. Not used anywhere else (GST reports,
      // ledgers, journal posting all read the INR fields above).
      const grandTotalFc = isForeign ? round2(grandTotal / fxRate) : null;

      const created = await tx.salesInvoice.create({
        data: {
          id: invoiceId,
          organizationId, branchId: resolvedBranchId, businessPartnerId: effectiveBusinessPartnerId,
          invoiceNumber, invoiceDate: new Date(invoiceDate), narration: narration ?? "",
          // Only where the override was actually used. An invoice that asked
          // for it and had enough stock anyway records nothing, because
          // nothing was overridden - the column is a list of the invoices
          // that really did sell what was not there.
          negativeStockReason: anyLineWentNegative ? negativeStockReason : null,
          journalEntryId: journalEntry.id, subtotal, taxTotal, grandTotal, totalCogs,
          discountType: discountType ?? null, discountValue: discountValue ?? 0, discountTotal,
          cgstTotal, sgstTotal, igstTotal,
          currency: currencyCode, exchangeRate: fxRate, grandTotalFc,
          exportType: exportTypeCode, lutBondNumber: lutBondNumberVal, lutBondDate: lutBondDateVal,
          // Almost never known yet at posting time — see the schema
          // comment on shippingBillNumber. Accepted here in case the org
          // happens to have it upfront, but PATCH /:id (below) is the
          // normal way this gets filled in.
          shippingBillNumber: isForeign && shippingBillNumber ? String(shippingBillNumber) : null,
          shippingBillDate: isForeign && shippingBillDate ? new Date(shippingBillDate) : null,
          portCode: isForeign && portCode ? String(portCode) : null,
          salesOrderId: linkedSo?.id ?? null,
          // The charges themselves. Their TAX is not stored here: it is
          // already in the lines, because that is where the proration put
          // it. Storing it twice would be two figures free to disagree.
          charges: chargeRows.length ? { create: chargeRows } : undefined,
          // Pin the customer's tax identity to this document. GSTR-1 reads
          // these and never the master, so editing a customer later can no
          // longer restate a period that has already been filed — see
          // migration_031. interState above was computed from exactly this
          // stateCode, so the split stored on the lines and the place of
          // supply reported can never disagree.
          partyGstin: customer.gstin ?? null,
          partyName: customer.name,
          partyStateCode: customer.stateCode ?? null,
          createdBy: req.user!.userId,
        },
      });

      await tx.salesInvoiceLine.createMany({
        data: computed.map((l) => ({
          salesInvoiceId: created.id, itemId: l.itemId, quantity: l.quantity, rate: l.rate,
          taxRate: l.taxRate ?? 0, lineSubtotal: l.lineSubtotal, taxAmount: l.taxAmount, lineTotal: l.lineTotal,
          unitCost: l.unitCost, lineCogs: l.lineCogs,
          discountType: l.discountType ?? null, discountValue: l.discountValue ?? 0,
          lineDiscountAmount: l.lineDiscountAmount, invoiceDiscountShare: l.invoiceDiscountShare, taxableValue: l.taxableValue,
          cgstAmount: l.cgstAmount, sgstAmount: l.sgstAmount, igstAmount: l.igstAmount,
          rateFc: isForeign ? l.rateFc : null, lineTotalFc: isForeign ? round2(l.lineTotal / fxRate) : null,
          // Item identity pinned for the HSN summary, same reason as
          // unitCost right above — migration_031.
          hsnCode: itemById.get(l.itemId)?.hsnCode ?? null,
          itemName: itemById.get(l.itemId)?.name ?? null,
          uom: itemById.get(l.itemId)?.uom ?? null,
          salesOrderLineId: (l as { salesOrderLineId?: string }).salesOrderLineId ?? null,
          deliveryNoteLineId: (l as { deliveryNoteLineId?: string }).deliveryNoteLineId ?? null,
        })),
      });

      // Roll the billed quantity forward on each referenced SO line and its
      // DN line, then close the SO out once every one of its lines is
      // fully billed — same transaction, so this can never drift out of
      // sync with the invoice that just posted. Mirrors the PO/GRN
      // rollup in routes/purchaseBills.ts exactly.
      if (linkedSo) {
        const billedBySoLine = new Map<string, number>();
        const billedByDnLine = new Map<string, number>();
        for (const l of computed as (typeof computed[number] & { salesOrderLineId?: string; deliveryNoteLineId?: string })[]) {
          if (!l.salesOrderLineId || !l.deliveryNoteLineId) continue;
          billedBySoLine.set(l.salesOrderLineId, (billedBySoLine.get(l.salesOrderLineId) ?? 0) + l.quantity);
          billedByDnLine.set(l.deliveryNoteLineId, (billedByDnLine.get(l.deliveryNoteLineId) ?? 0) + l.quantity);
        }
        for (const [soLineId, qty] of billedBySoLine) {
          await tx.salesOrderLine.update({
            where: { id: soLineId },
            data: { billedQuantity: { increment: qty } },
          });
        }
        for (const [dnLineId, qty] of billedByDnLine) {
          await tx.deliveryNoteLine.update({
            where: { id: dnLineId },
            data: { billedQuantity: { increment: qty } },
          });
        }
        const allLines = await tx.salesOrderLine.findMany({ where: { salesOrderId: linkedSo.id } });
        const fullyBilled = allLines.every((l) => Number(l.billedQuantity) >= Number(l.quantity));
        if (fullyBilled) {
          await tx.salesOrder.update({ where: { id: linkedSo.id }, data: { status: "CLOSED" } });
        }
      }

      return created;
    });

    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "CREATE", entityType: "sales_invoice", entityId: invoice.id,
      summary: `Posted sales invoice ${invoiceNumber} — ${customer.name} (${Number(invoice.grandTotal).toFixed(2)})`,
    });
    res.status(201).json({ data: invoice });
  } catch (err: any) {
    if (err instanceof InsufficientStockError) return res.status(409).json({ message: err.message });
    if (err?.status) return res.status(err.status).json({ message: err.message });
    throw err;
  }
});

export default router;
