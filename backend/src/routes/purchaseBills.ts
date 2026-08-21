import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { receiveStock } from "../lib/costing";
import {
  buildBillJournalLineRows, loadPostingAccounts,
  TRADE_PAYABLES_CODE, CGST_INPUT_CODE, SGST_INPUT_CODE, IGST_INPUT_CODE, CUSTOMS_DUTY_PAYABLE_CODE,
} from "../lib/billPosting";
import { isInterState, round2, splitGst } from "../lib/discountGst";
import { isSupportedCurrency } from "../lib/currencies";
import { upload } from "../lib/upload";
import { extractInvoiceData } from "../lib/invoiceExtraction";

// Leaves room for the " — FA-0001" suffix the sub-ledger card adds, inside
// the VarChar(200) that business_partners.name and fixed_assets.name both
// carry.
const MAX_ASSET_NAME_LEN = 150;

// What the asset is called, in the register and on its sub-ledger card.
// Truncated rather than rejected when it is derived rather than typed: an
// item name long enough to overflow is not something the person entering
// this bill can do anything about. A name they typed themselves is length-
// checked and refused instead, so it is never silently shortened.
function assetNameFor(
  l: { quantity: number; assetName?: string },
  item: { name: string },
): string {
  const typed = String(l.assetName ?? "").trim();
  if (typed) return typed.slice(0, MAX_ASSET_NAME_LEN);
  const derived = l.quantity > 1 ? `${item.name} (${l.quantity} nos)` : item.name;
  return derived.slice(0, MAX_ASSET_NAME_LEN);
}

const router = Router();
router.use(authenticate, requireActiveSubscription);
const canPost = requirePermission("purchase.post");
const canApprove = requirePermission("purchase.approve");

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
  // Foreign-currency bills only — same semantics as salesInvoices.ts.
  rateFc?: number;
  taxRate?: number;
  // Foreign-currency bills only — Basic Customs Duty, as a % of this
  // line's INR taxable value. See the schema comment on
  // PurchaseBillLine.customsDutyRate for the full design.
  customsDutyRate?: number;
  // Only meaningful when the bill itself is linked to a purchaseOrderId —
  // which GoodsReceiptNoteLine this line bills against (3-way match:
  // PO -> GRN -> Bill, see routes/goodsReceiptNotes.ts). Required on every
  // line whenever the bill has a purchaseOrderId; the PurchaseOrderLine it
  // fulfills is derived server-side from this GRN line, never taken
  // directly from the request. This line's own quantity can never exceed
  // what's still unbilled on that GRN line (received − already billed).
  // Stock is never re-received for a line like this — the GRN it
  // references already moved that stock in.
  goodsReceiptNoteLineId?: string;
  // ── Prepaid expense (migration_032) ──────────────────────────────────
  // Set only on a SERVICE line the buyer wants spread over time — annual
  // insurance, a 12-month AMC, a software licence. The line then debits
  // Prepaid Expenses (1105) instead of the item's own expense head, and a
  // schedule releases it to that head one month at a time.
  //
  // Tax is untouched: ITC attaches to the tax invoice date, so the whole
  // GST is still claimed in the month this bill is booked. Only the net
  // line value is scheduled.
  prepaid?: boolean;
  // "YYYY-MM". The month the first instalment belongs to.
  prepaidStartMonth?: string;
  // How many monthly instalments, 1..600.
  prepaidMonths?: number;
  // ── Capital asset (migration_034) ────────────────────────────────────
  // Set on a line that buys a fixed asset rather than an expense. The line
  // then debits the asset class's cost account instead of the item's own
  // head, gets its own sub-ledger card, and opens a row in the fixed asset
  // register that depreciation runs against.
  //
  // ONE LINE IS ONE ASSET, whatever the quantity — fixed_assets carries a
  // unique index on purchase_bill_line_id. Three laptops that need three
  // register entries (because they will be disposed of separately) go on
  // three lines. Ten identical chairs bought and retired together are
  // legitimately one asset, and the quantity is carried into its name.
  capitalise?: boolean;
  // Which asset class — supplies the accounts, useful life, method and
  // residual percentage. All of them are copied onto the asset, never read
  // from the class again.
  assetClassId?: string;
  // Defaults to the item's name. Worth setting when the item is generic
  // ("Server") and the asset is not ("Rack server — Chennai DC").
  assetName?: string;
  // "YYYY-MM-DD". When the asset was put to use, which is what Schedule II
  // charges from — not the purchase date. Cannot precede the bill date.
  inUseDate?: string;
  // Schedule II prescribes lives, not methods: Part A never names one and
  // Part C's Notes ask only that the method used be disclosed. Omitted means
  // the class's default. WDV requires a residual value — its rate is
  // 1 - (residual/cost)^(1/n), which at zero residual is 1.
  method?: string;
  // Schedule II permits a different life where a company can justify one.
  // Omitted means the class's default.
  usefulLifeMonths?: number;
  // Part A paragraph 3(i): where the life differs from the one PRESCRIBED —
  // longer or shorter, the 2014 amendment made the two symmetric — the
  // financial statements must disclose the difference and justify it "duly
  // supported by technical advice". Required whenever the effective life
  // differs from the class's schedule_ii_life_months, and enforced by
  // fixed_assets_life_note_ck as well as here.
  usefulLifeNote?: string;
}


// POST /purchase-bills/extract-invoice — reads an uploaded vendor invoice
// (PDF or image) and returns structured data (vendor, date, currency,
// grand total, line items). Read-only: never creates or modifies anything.
// The frontend decides what to do with the result — auto-fill on a manual
// bill, or a comparison against GRN-derived lines on a PO-linked one.
// Fires only when the user explicitly clicks "Extract data", not on upload.
router.post("/extract-invoice", canPost, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded." });
  const allowed = ["application/pdf", "image/jpeg", "image/jpg", "image/png", "image/webp"];
  if (!allowed.includes(req.file.mimetype)) {
    return res.status(400).json({ message: "Upload a PDF, JPEG, PNG, or WEBP file." });
  }
  try {
    const data = await extractInvoiceData(req.file.buffer, req.file.mimetype);
    res.json({ data });
  } catch (err) {
    res.status(502).json({ message: err instanceof Error ? err.message : "Invoice extraction failed." });
  }
});

router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const bills = await prisma.purchaseBill.findMany({
    where: { organizationId },
    include: { businessPartner: { select: { id: true, name: true } }, lines: { include: { item: { select: { id: true, sku: true, name: true } } } } },
    orderBy: { billDate: "desc" },
    take: 200,
  });
  res.json({ data: bills });
});

router.get("/:id", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const bill = await prisma.purchaseBill.findFirst({
    where: { id: req.params.id, organizationId },
    include: {
      businessPartner: true, lines: { include: { item: true } }, journalEntry: { include: { journalLines: true } },
      purchaseOrder: { select: { id: true, poNumber: true } },
    },
  });
  if (!bill) return res.status(404).json({ message: "Purchase bill not found." });
  res.json({ data: bill });
});

// PATCH /purchase-bills/:id — reference-data-only edit for the Bill of
// Entry (customs clearance doc), same rationale as
// salesInvoices.ts PATCH /:id: almost never known at posting time, filled
// in later, and none of these three fields touch an amount or the journal
// entry, so no re-posting is needed.
router.patch("/:id", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const bill = await prisma.purchaseBill.findFirst({ where: { id: req.params.id, organizationId } });
  if (!bill) return res.status(404).json({ message: "Purchase bill not found." });
  if (bill.currency === "INR") {
    return res.status(400).json({ message: "Bill of Entry fields only apply to a foreign-currency (import) bill." });
  }

  const { billOfEntryNumber, billOfEntryDate, portCode } = req.body ?? {};
  // Typed literal, not a loosely-typed intermediate — see the matching
  // note in salesInvoices.ts PATCH /:id (Record<string, unknown> here
  // would fail `tsc`, i.e. fail the Railway build outright).
  const updated = await prisma.purchaseBill.update({
    where: { id: bill.id },
    data: {
      billOfEntryNumber: billOfEntryNumber !== undefined ? (billOfEntryNumber ? String(billOfEntryNumber) : null) : bill.billOfEntryNumber,
      billOfEntryDate: billOfEntryDate !== undefined ? (billOfEntryDate ? new Date(billOfEntryDate) : null) : bill.billOfEntryDate,
      portCode: portCode !== undefined ? (portCode ? String(portCode) : null) : bill.portCode,
    },
    // Same shape as GET /:id — the frontend sets its detail state straight
    // from this response and immediately re-renders the line table, so it
    // needs businessPartner/lines present, not just the updated scalars.
    include: { businessPartner: true, lines: { include: { item: true } } },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "purchase_bill", entityId: bill.id,
    summary: `Updated Bill of Entry fields on ${bill.billNumber}`,
  });
  res.json({ data: updated });
});

// POST /purchase-bills — create and post in one step, same UX as journal
// entries. Stock inward for every line, one journal entry: Dr each item's
// stock account (tagged that item's own ITEM business partner) + Dr
// CGST/SGST/IGST Input Credit (split by whether the branch and vendor are
// in the same GST state), Cr Trade Payables (tagged the vendor).
router.post("/", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const {
    businessPartnerId, billDate, branchId, narration, lines, currency, exchangeRate,
    billOfEntryNumber, billOfEntryDate, portCode, purchaseOrderId,
  } = req.body ?? {};
  if (!billDate || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ message: "billDate and at least one line are required." });
  }

  // Linked to a Purchase Order — must be APPROVED (only an approved PO is a
  // real commitment), and the vendor is *derived* from the PO rather than
  // taken from the request, so a bill can never be posted against a
  // different vendor than the one the PO was approved for. See
  // routes/purchaseOrders.ts for the approval workflow itself.
  let linkedPo: { id: string; businessPartnerId: string; status: string; currency: string; exchangeRate: any; lines: { id: string; quantity: any; rate: any; rateFc: any; billedQuantity: any }[] } | null = null;
  if (purchaseOrderId) {
    linkedPo = await prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, organizationId },
      include: { lines: { select: { id: true, quantity: true, rate: true, rateFc: true, billedQuantity: true } } },
    });
    if (!linkedPo) return res.status(400).json({ message: "purchaseOrderId is not a valid Purchase Order for this organization." });
    if (linkedPo.status !== "APPROVED") {
      return res.status(400).json({ message: `Purchase Order ${purchaseOrderId} is ${linkedPo.status}, not Approved — only an approved PO can be billed.` });
    }
    if (businessPartnerId && businessPartnerId !== linkedPo.businessPartnerId) {
      return res.status(400).json({ message: "businessPartnerId doesn't match the vendor on the linked Purchase Order." });
    }
    if (currency && String(currency).toUpperCase() !== linkedPo.currency) {
      return res.status(400).json({ message: `currency doesn't match the currency on the linked Purchase Order (${linkedPo.currency}).` });
    }
  }
  const effectiveBusinessPartnerId = linkedPo?.businessPartnerId ?? businessPartnerId;
  if (!effectiveBusinessPartnerId) {
    return res.status(400).json({ message: "businessPartnerId (or purchaseOrderId) is required." });
  }

  // Foreign currency (import bills) — see lib/currencies.ts and the matching
  // note in salesInvoices.ts; same semantics, same INR-is-authoritative rule.
  // PO-linked: the currency *code* is derived from the PO (validated above,
  // e.g. "USD") — a bill can't switch currencies mid-way through a PO's
  // billing history. exchangeRate, though, is deliberately still the
  // bill's own — the real market rate on the actual billing date, not the
  // PO's (possibly weeks-stale) rate at approval time; forcing the PO's
  // rate here would misstate what's actually posted to Trade Payables
  // today. This is exactly why the price-variance check below compares in
  // FC terms rather than INR: it isolates a genuine vendor price change
  // from FX movement between the PO date and this bill's date, which an
  // INR-only comparison would otherwise conflate.
  const currencyCode = linkedPo ? linkedPo.currency : String(currency || "INR").toUpperCase();
  if (!isSupportedCurrency(currencyCode)) {
    return res.status(400).json({ message: `Unsupported currency "${currencyCode}".` });
  }
  const isForeign = currencyCode !== "INR";
  const fxRate = isForeign ? Number(exchangeRate) : 1;
  if (isForeign && !(fxRate > 0)) {
    return res.status(400).json({ message: "exchangeRate must be greater than 0 for a non-INR bill." });
  }

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true, priceVarianceTolerancePct: true } });
  if (!org?.costingMethod) return res.status(422).json({ message: "Set the organization's stock costing method first." });

  const vendor = await prisma.businessPartner.findFirst({ where: { id: effectiveBusinessPartnerId, organizationId, bpType: "VENDOR" } });
  if (!vendor) return res.status(400).json({ message: "businessPartnerId must be an existing vendor." });
  if (vendor.approvalStatus !== "APPROVED") {
    return res.status(400).json({ message: `This vendor is ${vendor.approvalStatus === "PENDING_APPROVAL" ? "pending approval" : "rejected"} — approve it under Business Partners before posting a Purchase Bill.` });
  }

  let resolvedBranchId: string | null = branchId ?? null;
  if (!resolvedBranchId) {
    const ho = await prisma.branch.findFirst({ where: { organizationId, isHeadOffice: true } });
    resolvedBranchId = ho?.id ?? null;
  }
  if (!resolvedBranchId) return res.status(400).json({ message: "No branch found — provide branchId." });
  const branch = await prisma.branch.findFirst({ where: { id: resolvedBranchId, organizationId }, select: { stateCode: true } });

  const typedLines: LineInput[] = lines;
  const itemIds = [...new Set(typedLines.map((l) => l.itemId))];
  const items = await prisma.item.findMany({ where: { id: { in: itemIds }, organizationId, deletedAt: null } });
  if (items.length !== itemIds.length) return res.status(400).json({ message: "One or more items are invalid for this organization." });
  const itemById = new Map(items.map((i) => [i.id, i]));

  // An import is always an inter-state (IGST) supply under GST law — same
  // reasoning as the fix on the Sales Invoice side (see the note there).
  // IGST paid on an import is what's actually creditable, never CGST+SGST,
  // regardless of whether the foreign vendor has an Indian state code.
  const interState = isForeign ? true : isInterState(branch?.stateCode, vendor.stateCode);
  let subtotal = 0, taxTotal = 0, cgstTotal = 0, sgstTotal = 0, igstTotal = 0, customsDutyTotal = 0;
  // Line validation below can reject with a {status:400} throw (from
  // inside .map(), where an early `return res...` isn't possible) — caught
  // right here and turned into a real 400. Pre-existing pattern in this
  // route; wrapping it properly rather than letting it fall through to the
  // generic 500 handler in index.ts, which is what happened before this
  // fix for any line-validation failure, PO-linked or not.
  let computed;
  try {
    computed = typedLines.map((l) => {
      if (isForeign) {
        if (!l.itemId || !(l.quantity > 0) || !(l.rateFc! >= 0)) {
          throw Object.assign(new Error("Every line needs itemId, quantity > 0, and rateFc >= 0."), { status: 400 });
        }
        // rateFc is authoritative for a foreign-currency bill — overwrite
        // rate so tax/costing below (and receiveStock's unitCost) run on
        // the correct INR figure without any further change.
        l.rate = round2(l.rateFc! * fxRate);
      } else if (!l.itemId || !(l.quantity > 0) || !(l.rate >= 0)) {
        throw Object.assign(new Error("Every line needs itemId, quantity > 0, and rate >= 0."), { status: 400 });
      }
      const lineSubtotal = round2(l.quantity * l.rate);
      // Basic Customs Duty — non-creditable, folds into landed cost.
      // Always 0 on a domestic bill. Computed on goods value only (never
      // on itself).
      const customsDutyAmount = isForeign ? round2(lineSubtotal * (l.customsDutyRate ?? 0) / 100) : 0;
      // Import IGST is charged on (goods value + duty), not goods value
      // alone — customsDutyAmount is 0 on a domestic bill, so this taxBase
      // collapses to lineSubtotal there, leaving domestic tax computation
      // byte-for-byte unchanged.
      const taxBase = lineSubtotal + customsDutyAmount;
      const taxAmount = round2(taxBase * (l.taxRate ?? 0) / 100);
      const { cgst, sgst, igst } = splitGst(taxAmount, interState);
      subtotal += lineSubtotal; taxTotal += taxAmount; cgstTotal += cgst; sgstTotal += sgst; igstTotal += igst;
      customsDutyTotal += customsDutyAmount;
      return {
        ...l, lineSubtotal, customsDutyAmount, taxAmount,
        lineTotal: lineSubtotal + customsDutyAmount + taxAmount,
        cgstAmount: cgst, sgstAmount: sgst, igstAmount: igst,
        rateFc: isForeign ? l.rateFc : undefined,
        // Landed unit cost (goods value + duty, per unit) feeds
        // receiveStock below. Only diverges from l.rate when duty is
        // actually entered — a domestic bill, or a foreign bill with 0%
        // duty, keeps the exact same unitCost as before this feature.
        unitCost: customsDutyAmount > 0 ? round2(taxBase / l.quantity) : l.rate,
      };
    });
  } catch (err: any) {
    if (err?.status === 400) return res.status(400).json({ message: err.message });
    throw err;
  }
  const grandTotal = subtotal + taxTotal + customsDutyTotal;
  const grandTotalFc = isForeign ? round2(grandTotal / fxRate) : null;

  // Purchase-Order-linked bills: the 3-way match. Every line must
  // reference a goodsReceiptNoteLineId (raised via a Goods Receipt Note
  // against this same PO — see routes/goodsReceiptNotes.ts), and can't
  // bill more than what's still open on that GRN line (received qty minus
  // whatever's already been billed against it, including by other
  // Purchase Bills raised earlier). Two lines on *this* bill referencing
  // the same GRN line are summed together before comparing. Each
  // computed line's purchaseOrderLineId is then derived from its GRN line
  // (never taken from the request) so the existing PurchaseOrderLine
  // billedQuantity rollup / PO auto-close logic below needs no other
  // change.
  const grnLineById = new Map<string, { id: string; purchaseOrderLineId: string; quantityReceived: any; billedQuantity: any }>();
  if (linkedPo) {
    const typedComputed = computed as (typeof computed[number] & { goodsReceiptNoteLineId?: string; purchaseOrderLineId?: string })[];
    if (typedComputed.some((l) => !l.goodsReceiptNoteLineId)) {
      return res.status(400).json({ message: "Every line on a Purchase-Order-linked bill must reference a goodsReceiptNoteLineId — raise a Goods Receipt Note against this Purchase Order first." });
    }
    const grnLineIds = [...new Set(typedComputed.map((l) => l.goodsReceiptNoteLineId!))];
    const grnLines = await prisma.goodsReceiptNoteLine.findMany({
      where: { id: { in: grnLineIds }, goodsReceiptNote: { organizationId, purchaseOrderId: linkedPo.id } },
      select: { id: true, purchaseOrderLineId: true, quantityReceived: true, billedQuantity: true },
    });
    if (grnLines.length !== grnLineIds.length) {
      return res.status(400).json({ message: "One or more lines reference a goodsReceiptNoteLineId that isn't a Goods Receipt Note against this Purchase Order." });
    }
    for (const gl of grnLines) grnLineById.set(gl.id, gl);

    const billedOnThisBill = new Map<string, number>();
    for (const l of typedComputed) {
      l.purchaseOrderLineId = grnLineById.get(l.goodsReceiptNoteLineId!)!.purchaseOrderLineId;
      billedOnThisBill.set(l.goodsReceiptNoteLineId!, (billedOnThisBill.get(l.goodsReceiptNoteLineId!) ?? 0) + l.quantity);
    }
    for (const [grnLineId, qtyOnThisBill] of billedOnThisBill) {
      const grnLine = grnLineById.get(grnLineId)!;
      const alreadyBilled = Number(grnLine.billedQuantity);
      const received = Number(grnLine.quantityReceived);
      if (round2(alreadyBilled + qtyOnThisBill) > received) {
        return res.status(400).json({
          message: `Billing ${qtyOnThisBill} against Goods Receipt Note line ${grnLineId} would exceed the received quantity ` +
            `(${received} received, ${alreadyBilled} already billed, ${round2(received - alreadyBilled)} remaining).`,
        });
      }
    }
  }

  // 3-way match, price side (quantity side is the hard GRN-qty check
  // above, which always applies regardless of approval). A PO-linked
  // line whose rate differs from the PO line's own rate by more than the
  // org's tolerance holds the *whole* bill at PENDING_APPROVAL instead of
  // posting it immediately — nothing partially posts. Tolerance null
  // means 0%: any variance at all requires approval. Not applicable to
  // ad-hoc (non-PO) bills, which have no PO rate to compare against.
  //
  // Foreign-currency PO: compare in FC terms (rateFc-to-rateFc), not INR.
  // currency is now locked to match the PO's (see above), but exchangeRate
  // is deliberately still independent — the bill uses today's real rate,
  // the PO used whatever rate applied when it was raised. Comparing the
  // converted INR figures would flag a bill for approval purely because
  // the rupee moved between those two dates, even when the vendor's actual
  // USD/EUR/etc. price never changed — comparing the original foreign
  // amounts isolates a genuine price change from FX drift.
  const tolerancePct = org.priceVarianceTolerancePct != null ? Number(org.priceVarianceTolerancePct) : 0;
  let varianceNote: string | null = null;
  if (linkedPo) {
    const poLineById = new Map(linkedPo.lines.map((l) => [l.id, l]));
    const typedComputed = computed as (typeof computed[number] & { purchaseOrderLineId?: string; rateFc?: number })[];
    const varianceDescriptions: string[] = [];
    const compareFc = isForeign; // currency is guaranteed to match the PO's when linked — see currencyCode above
    for (const l of typedComputed) {
      const poLine = poLineById.get(l.purchaseOrderLineId!);
      if (!poLine) continue; // already validated above; unreachable in practice
      const usePoFc = compareFc && poLine.rateFc != null && l.rateFc != null;
      const poCompare = usePoFc ? Number(poLine.rateFc) : Number(poLine.rate);
      const billCompare = usePoFc ? Number(l.rateFc) : Number(l.rate);
      const unit = usePoFc ? `${currencyCode} ` : "₹";
      const diffPct = poCompare === 0 ? (billCompare === 0 ? 0 : 100) : round2((Math.abs(billCompare - poCompare) / poCompare) * 100);
      if (diffPct > tolerancePct) {
        varianceDescriptions.push(`${itemById.get(l.itemId)!.sku}: PO ${unit}${poCompare.toFixed(2)} vs bill ${unit}${billCompare.toFixed(2)} (${diffPct.toFixed(2)}%)`);
      }
    }
    if (varianceDescriptions.length > 0) {
      varianceNote = `Exceeds ${tolerancePct}% price tolerance — ${varianceDescriptions.join("; ")}`.slice(0, 500);
    }
  }
  const requiresApproval = varianceNote !== null;

  const [cgstInput, sgstInput, igstInput, tradePayables, customsDutyPayable] = await Promise.all([
    prisma.account.findFirst({ where: { organizationId, accountCode: CGST_INPUT_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: SGST_INPUT_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: IGST_INPUT_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: TRADE_PAYABLES_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: CUSTOMS_DUTY_PAYABLE_CODE } }),
  ]);
  if (!tradePayables) return res.status(500).json({ message: "Trade Payables account not found — re-run provisioning." });
  if (cgstTotal > 0 && !cgstInput) return res.status(500).json({ message: "CGST Input Credit account not found — re-run provisioning." });
  if (sgstTotal > 0 && !sgstInput) return res.status(500).json({ message: "SGST Input Credit account not found — re-run provisioning." });
  if (igstTotal > 0 && !igstInput) return res.status(500).json({ message: "IGST Input Credit account not found — re-run provisioning." });
  // Only a foreign bill ever needs this account — customsDutyTotal + tax
  // (never owed to the vendor) is the only thing that credits it.
  const customsDutyPayableCredit = isForeign ? round2(customsDutyTotal + taxTotal) : 0;
  if (customsDutyPayableCredit > 0 && !customsDutyPayable) {
    return res.status(500).json({ message: "Customs Duty Payable account not found — re-run provisioning (npx prisma db seed, then Sync from Templates)." });
  }
  const tradePayablesCredit = isForeign ? subtotal : grandTotal;

  // ── Prepaid lines ────────────────────────────────────────────────────
  // Validated here, before anything is written, so a bad prepaid input can
  // never leave a bill posted with a broken schedule beside it.
  //
  // A prepaid line can only ever be a SERVICE item, and PO lines are
  // STOCK-only (routes/purchaseOrders.ts), so a prepaid line can never
  // appear on a PO-linked bill — and price-variance approval only happens
  // on PO-linked bills. That is why nothing below has to deal with a bill
  // held at PENDING_APPROVAL: the two states are mutually exclusive. The
  // explicit rejection is there to keep it that way if PO lines ever open
  // up to service items.
  const prepaidIdx: number[] = [];
  computed.forEach((l, i) => {
    if ((l as { prepaid?: boolean }).prepaid) prepaidIdx.push(i);
  });

  let prepaidAccountId: string | null = null;
  if (prepaidIdx.length > 0) {
    if (linkedPo) {
      return res.status(400).json({ message: "A Purchase-Order-linked bill can't carry a prepaid line." });
    }
    if (isForeign) {
      // Whether a prepaid asset is a monetary item to be retranslated at
      // each balance-sheet date is a real question with a real answer, and
      // it is not one to settle silently inside a bill-posting route.
      return res.status(400).json({ message: "Prepaid scheduling isn't supported on a foreign-currency bill yet." });
    }
    for (const i of prepaidIdx) {
      const l = computed[i] as { itemId: string; prepaidStartMonth?: string; prepaidMonths?: number; lineSubtotal: number };
      const item = itemById.get(l.itemId)!;
      if (item.itemKind !== "SERVICE") {
        return res.status(400).json({ message: `Only a service item can be prepaid — ${item.sku} is a stock item.` });
      }
      const months = Number(l.prepaidMonths);
      if (!Number.isInteger(months) || months < 1 || months > 600) {
        return res.status(400).json({ message: `${item.sku}: prepaidMonths must be a whole number between 1 and 600.` });
      }
      if (!/^\d{4}-\d{2}$/.test(String(l.prepaidStartMonth ?? ""))) {
        return res.status(400).json({ message: `${item.sku}: prepaidStartMonth is required, as YYYY-MM.` });
      }
      if (!(l.lineSubtotal > 0)) {
        return res.status(400).json({ message: `${item.sku}: a prepaid line needs an amount greater than zero.` });
      }
    }
    const prepaidAccount = await prisma.account.findFirst({
      where: { organizationId, accountCode: "1105", deletedAt: null },
      select: { id: true },
    });
    if (!prepaidAccount) {
      return res.status(500).json({ message: "Prepaid Expenses account (1105) not found — re-run provisioning." });
    }
    prepaidAccountId = prepaidAccount.id;
  }

  // ── Capital asset lines ──────────────────────────────────────────────
  // Same shape as the prepaid block above and validated for the same
  // reason: everything that can be rejected is rejected before a single
  // row is written, so a bill can never post with a broken asset beside it.
  const capitalIdx: number[] = [];
  computed.forEach((l, i) => {
    if ((l as { capitalise?: boolean }).capitalise) capitalIdx.push(i);
  });

  // The day the bill lands on once Prisma has written it to a DATE column,
  // which is the UTC day of the parsed instant. purchaseDate below is
  // new Date(billDate), so deriving the guard from the same instant is what
  // makes the route's check and fixed_assets_dates_ck agree. Comparing the
  // raw request string instead would disagree with the database whenever
  // billDate carries a timezone offset or an unpadded month.
  const billInstant = new Date(billDate);
  const billDay = isNaN(billInstant.getTime()) ? null : billInstant.toISOString().slice(0, 10);


  // The rows as Prisma returns them, so the Decimal columns keep their own
  // type and go back onto the asset without a cast.
  type AssetClassRow = Awaited<ReturnType<typeof prisma.assetClass.findMany>>[number];
  const assetClassById = new Map<string, AssetClassRow>();

  if (capitalIdx.length > 0) {
    if (!billDay) {
      return res.status(400).json({ message: "billDate isn't a date I can read." });
    }
    if (linkedPo) {
      return res.status(400).json({ message: "A Purchase-Order-linked bill can't carry a capital asset line." });
    }
    if (isForeign) {
      // An imported asset's cost includes customs duty and depends on which
      // exchange rate the standard says to capitalise at. Both are real
      // questions and neither gets answered silently inside this route.
      return res.status(400).json({ message: "Capitalising isn't supported on a foreign-currency bill yet." });
    }

    const classIds = Array.from(new Set(capitalIdx.map((i) => String((computed[i] as { assetClassId?: string }).assetClassId ?? ""))));
    const classes = await prisma.assetClass.findMany({
      // isActive matters here, not just in the picker: GET /asset-classes
      // hides a retired class from the UI, which does nothing to stop an
      // API caller naming its id directly.
      where: { id: { in: classIds.filter(Boolean) }, organizationId, isActive: true },
    });
    for (const c of classes) assetClassById.set(c.id, c);

    for (const i of capitalIdx) {
      const l = computed[i] as {
        itemId: string; quantity: number; lineSubtotal: number;
        capitalise?: boolean; prepaid?: boolean; assetClassId?: string;
        assetName?: string; inUseDate?: string; usefulLifeMonths?: number;
        method?: string; usefulLifeNote?: string; capitaliseGst?: boolean;
      };
      const item = itemById.get(l.itemId)!;

      if (String(l.assetName ?? "").trim().length > MAX_ASSET_NAME_LEN) {
        return res.status(400).json({ message: `${item.sku}: an asset name can be at most ${MAX_ASSET_NAME_LEN} characters.` });
      }

      if (l.prepaid) {
        return res.status(400).json({ message: `${item.sku}: a line is either prepaid or capitalised, not both.` });
      }
      // A stock item's line already debits a stock control account and moves
      // inventory. Capitalising it would put the same purchase in two places
      // at once — the register and the stock ledger.
      if (item.itemKind !== "SERVICE") {
        return res.status(400).json({ message: `Only a non-stock item can be capitalised — ${item.sku} is a stock item.` });
      }
      if (l.capitaliseGst) {
        // Section 17(5) blocked credits genuinely need this. It also means
        // the tax must be excluded from GSTR-3B's input credit, which
        // reaches into the GST returns — so it is refused outright rather
        // than accepted and quietly ignored.
        return res.status(400).json({ message: "Capitalising GST isn't supported yet — the input credit is claimed instead." });
      }
      const cls = assetClassById.get(String(l.assetClassId ?? ""));
      if (!cls) {
        return res.status(400).json({ message: `${item.sku}: pick an asset class to capitalise against.` });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(l.inUseDate ?? ""))) {
        return res.status(400).json({ message: `${item.sku}: a "put to use" date is required, as YYYY-MM-DD.` });
      }
      // fixed_assets_dates_ck enforces this at the database too. Catching it
      // here turns a 23514 into a sentence someone can act on.
      if (String(l.inUseDate) < billDay) {
        return res.status(400).json({ message: `${item.sku}: an asset can't be in use before the bill date.` });
      }
      if (!(l.lineSubtotal > 0)) {
        return res.status(400).json({ message: `${item.sku}: a capitalised line needs an amount greater than zero.` });
      }
      // Writing a zero residual here instead would depreciate the asset all
      // the way down over its whole life — the opposite of what the class
      // says — and nothing would ever surface it. Refuse instead.
      if (Number(cls.defaultResidualPct) >= 100) {
        return res.status(400).json({ message: `${cls.name}: the class's residual percentage is ${Number(cls.defaultResidualPct)}% — fix the asset class before capitalising against it.` });
      }
      if (l.usefulLifeMonths !== undefined && l.usefulLifeMonths !== null) {
        const life = Number(l.usefulLifeMonths);
        if (!Number.isInteger(life) || life < 1 || life > 1200) {
          return res.status(400).json({ message: `${item.sku}: useful life must be a whole number of months between 1 and 1200.` });
        }
      }

      const method = String(l.method ?? cls.defaultMethod).toUpperCase();
      if (method !== "SLM" && method !== "WDV") {
        return res.status(400).json({ message: `${item.sku}: depreciation method must be SLM or WDV.` });
      }
      // fixed_assets_wdv_residual_ck says the same thing. The reason it is
      // said twice is that the consequence of it being wrong — the entire
      // cost written off in the first period — is not something to discover
      // from a constraint violation.
      if (method === "WDV" && !(Number(cls.defaultResidualPct) > 0)) {
        return res.status(400).json({ message: `${cls.name}: written-down value needs a residual percentage above zero — its rate is derived from the residual, and at zero the whole cost would be written off at once.` });
      }

      // The deviation is measured against what Schedule II PRESCRIBES, not
      // against this org's class default. Those are the same today, but a
      // class is editable and the statute is not — so if a class has been
      // moved off the prescribed life, an asset taking that class's default
      // is still a deviation and still needs its justification.
      const effectiveLife = Number(l.usefulLifeMonths ?? cls.defaultUsefulLifeMonths);
      const note = String(l.usefulLifeNote ?? "").trim();
      if (note.length > 500) {
        return res.status(400).json({ message: `${item.sku}: the justification can be at most 500 characters.` });
      }
      if (effectiveLife !== cls.scheduleIiLifeMonths && !note) {
        const direction = effectiveLife > cls.scheduleIiLifeMonths ? "longer" : "shorter";
        return res.status(400).json({
          message: `${item.sku}: ${effectiveLife} months is ${direction} than the ${cls.scheduleIiLifeMonths} months Schedule II prescribes for ${cls.name}. Part A paragraph 3(i) requires the difference to be disclosed and justified, supported by technical advice — record that justification against the asset.`,
        });
      }
    }
  }

  const count = await prisma.purchaseBill.count({ where: { organizationId } });
  const billNumber = `PB-${String(count + 1).padStart(4, "0")}`;

  try {
    const bill = await prisma.$transaction(async (tx) => {
      // Held for a price variance — no journal entry, no stock movement,
      // no billedQuantity impact anywhere until someone with
      // purchase.approve reviews it (POST /:id/approve/reject). The bill
      // and its lines are still fully created below so the record exists
      // and is visible on the Pending Approval list — only the posting
      // side effects are deferred.
      // Each prepaid line gets its own card in the 1105 sub-ledger before the
      // journal is written, because the journal line has to be tagged to it.
      // The card is what makes Prepaid Expenses break down schedule by
      // schedule: this bill debits it for the full amount, and each monthly
      // instalment credits the same card back down to zero.
      const prepaidCard = new Map<number, string>();
      for (const i of prepaidIdx) {
        const l = computed[i] as { itemId: string } & Record<string, unknown>;
        const card = await tx.businessPartner.create({
          data: {
            organizationId, bpType: "PREPAID",
            name: `${itemById.get(l.itemId)!.name} — ${billNumber}`,
          },
        });
        prepaidCard.set(i, card.id);
        l.debitAccountIdOverride = prepaidAccountId!;
        l.debitPartnerIdOverride = card.id;
      }

      // Each capitalised line gets its own card too, for the same reason and
      // in the same place: the journal line has to be tagged to it. The card
      // is tagged on the cost account here and on the accumulated
      // depreciation account by every monthly charge, so one asset's gross
      // block, accumulated depreciation and net book value are all readable
      // from the ledger itself.
      //
      // A capitalised line can only be on a non-PO bill, and only a PO-linked
      // bill is ever held for approval, so these are mutually exclusive
      // today. The guard is here because the cost of being wrong is an asset
      // depreciating against a gross block no journal entry ever debited.
      const capitalNow = requiresApproval ? [] : capitalIdx;
      const assetCard = new Map<number, string>();
      const assetCode = new Map<number, string>();
      let assetSeq = capitalNow.length > 0 ? await tx.fixedAsset.count({ where: { organizationId } }) : 0;
      for (const i of capitalNow) {
        const l = computed[i] as { itemId: string; quantity: number; assetClassId?: string; assetName?: string } & Record<string, unknown>;
        const item = itemById.get(l.itemId)!;
        const cls = assetClassById.get(String(l.assetClassId))!;
        const name = assetNameFor(l, item);
        assetSeq += 1;
        const code = `FA-${String(assetSeq).padStart(4, "0")}`;
        assetCode.set(i, code);
        const card = await tx.businessPartner.create({
          data: { organizationId, bpType: "ASSET", name: `${name} — ${code}` },
        });
        assetCard.set(i, card.id);
        // Overwriting a prepaid override would post the debit to 1401 while
        // leaving a schedule pointing at a 1105 card that was never debited
        // — wrong, and silent. The prepaid/capitalise check above already
        // prevents it; this is what makes a regression there loud.
        if (l.debitAccountIdOverride) {
          throw Object.assign(new Error(`${item.sku}: a line is either prepaid or capitalised, not both.`), { status: 400 });
        }
        l.debitAccountIdOverride = cls.assetAccountId;
        l.debitPartnerIdOverride = card.id;
      }

      const journalEntry = requiresApproval ? null : await tx.journalEntry.create({
        data: {
          organizationId, branchId: resolvedBranchId, entryDate: new Date(billDate),
          narration: narration || `Purchase bill ${billNumber} — ${vendor.name}`,
          voucherType: "PB", referenceType: "purchase_bill", createdBy: req.user!.userId,
        },
      });

      if (journalEntry) {
        await tx.journalLine.createMany({
          data: buildBillJournalLineRows({
            journalEntryId: journalEntry.id, computed, itemById, cgstTotal, sgstTotal, igstTotal,
            cgstInput, sgstInput, igstInput, customsDutyPayableCredit, customsDutyPayable,
            tradePayables, tradePayablesCredit, vendor,
          }),
        });
      }

      const created = await tx.purchaseBill.create({
        data: {
          organizationId, branchId: resolvedBranchId, businessPartnerId: effectiveBusinessPartnerId,
          billNumber, billDate: new Date(billDate), narration: narration ?? "",
          journalEntryId: journalEntry?.id ?? null,
          status: requiresApproval ? "PENDING_APPROVAL" : "POSTED",
          varianceNote,
          subtotal, taxTotal, grandTotal,
          cgstTotal, sgstTotal, igstTotal, customsDutyTotal,
          currency: currencyCode, exchangeRate: fxRate, grandTotalFc,
          // Almost never known yet at posting time — see the schema
          // comment on billOfEntryNumber. PATCH /:id is the normal way
          // this gets filled in once customs clearance actually happens.
          billOfEntryNumber: isForeign && billOfEntryNumber ? String(billOfEntryNumber) : null,
          billOfEntryDate: isForeign && billOfEntryDate ? new Date(billOfEntryDate) : null,
          portCode: isForeign && portCode ? String(portCode) : null,
          purchaseOrderId: linkedPo?.id ?? null,
          createdBy: req.user!.userId,
        },
      });

      // Created one at a time rather than with createMany, because a prepaid
      // schedule has to point at the exact line that created it and
      // createMany returns no ids. Matching them back up by itemId afterwards
      // would be ambiguous the moment a bill carries the same service item on
      // two lines. Bills have a handful of lines, and this is inside the
      // transaction either way.
      const lineIds: string[] = [];
      for (const l of computed) {
        const row = await tx.purchaseBillLine.create({
          data: {
            purchaseBillId: created.id, itemId: l.itemId, quantity: l.quantity, rate: l.rate,
            taxRate: l.taxRate ?? 0, lineSubtotal: l.lineSubtotal, taxAmount: l.taxAmount, lineTotal: l.lineTotal,
            cgstAmount: l.cgstAmount, sgstAmount: l.sgstAmount, igstAmount: l.igstAmount,
            rateFc: l.rateFc ?? null, lineTotalFc: isForeign ? round2(l.lineTotal / fxRate) : null,
            customsDutyRate: isForeign && l.customsDutyRate ? l.customsDutyRate : null,
            customsDutyAmount: l.customsDutyAmount,
            purchaseOrderLineId: (l as { purchaseOrderLineId?: string }).purchaseOrderLineId ?? null,
            goodsReceiptNoteLineId: (l as { goodsReceiptNoteLineId?: string }).goodsReceiptNoteLineId ?? null,
          },
          select: { id: true },
        });
        lineIds.push(row.id);
      }

      // The schedules themselves. Nothing is released here — this only
      // records what is to be released, and by which month. The instalment
      // amounts are derived when they are posted, so a schedule is a
      // statement of intent rather than a pre-written set of entries.
      for (const i of prepaidIdx) {
        const l = computed[i] as { itemId: string; lineSubtotal: number; prepaidStartMonth?: string; prepaidMonths?: number };
        const item = itemById.get(l.itemId)!;
        await tx.prepaidSchedule.create({
          data: {
            organizationId, branchId: resolvedBranchId,
            purchaseBillId: created.id, purchaseBillLineId: lineIds[i],
            businessPartnerId: prepaidCard.get(i)!,
            name: `${item.name} — ${billNumber}`,
            prepaidAccountId: prepaidAccountId!,
            // Snapshot, not a live read: re-pointing the service item later
            // must change what future bills do, never redirect the remaining
            // instalments of a schedule already part-released.
            expenseAccountId: item.stockAccountId,
            totalAmount: l.lineSubtotal,
            startMonth: new Date(`${l.prepaidStartMonth}-01T00:00:00.000Z`),
            months: Number(l.prepaidMonths),
            createdBy: req.user!.userId,
          },
        });
      }

      // The register rows. Every account, life, method and rate is copied
      // off the class rather than referenced: re-pointing a class later must
      // change what future assets do, never redirect the remaining charges
      // of an asset already part-depreciated. Same reasoning as the expense
      // account on a prepaid schedule.
      for (const i of capitalNow) {
        const l = computed[i] as {
          itemId: string; quantity: number; lineSubtotal: number;
          assetClassId?: string; assetName?: string; inUseDate?: string;
          usefulLifeMonths?: number; method?: string; usefulLifeNote?: string;
        };
        const item = itemById.get(l.itemId)!;
        const cls = assetClassById.get(String(l.assetClassId))!;
        const code = assetCode.get(i)!;
        const name = assetNameFor(l, item);
        // Residual is a percentage of cost, floored to two decimals so
        // gross - residual is always an exact rupee amount to spread.
        const residual = round2(l.lineSubtotal * Number(cls.defaultResidualPct) / 100);
        await tx.fixedAsset.create({
          data: {
            organizationId, branchId: resolvedBranchId,
            assetClassId: cls.id,
            purchaseBillId: created.id, purchaseBillLineId: lineIds[i],
            businessPartnerId: assetCard.get(i)!,
            assetCode: code, name,
            assetAccountId: cls.assetAccountId,
            accumDepAccountId: cls.accumDepAccountId,
            depExpenseAccountId: cls.depExpenseAccountId,
            grossCost: l.lineSubtotal,
            // fixed_assets_residual_ck requires residual < gross. A class at
            // 100% is refused above, so this can only bite on a rounding
            // edge at a very small line value.
            residualValue: residual < l.lineSubtotal ? residual : 0,
            // The input credit was claimed on this bill, so the GST is not
            // in the cost. See the capitaliseGst rejection above.
            gstCapitalised: false,
            purchaseDate: new Date(billDate),
            inUseDate: new Date(`${l.inUseDate}T00:00:00.000Z`),
            method: String(l.method ?? cls.defaultMethod).toUpperCase(),
            usefulLifeMonths: Number(l.usefulLifeMonths ?? cls.defaultUsefulLifeMonths),
            // Snapshot, so "does this asset depart from Schedule II" stays
            // answerable after the class is edited.
            scheduleIiLifeMonths: cls.scheduleIiLifeMonths,
            usefulLifeNote: String(l.usefulLifeNote ?? "").trim() || null,
            // Pinned but unused: income tax depreciation is out of scope, and
            // these columns are NOT NULL. Nothing reads them today.
            itBlockCode: cls.defaultItBlockCode,
            itRate: cls.defaultItRate,
            createdBy: req.user!.userId,
          },
        });
      }

      // Stock inward only for ad-hoc (non-PO) lines — a PO-linked bill's
      // stock was already received via its Goods Receipt Note(s), so
      // calling receiveStock again here would double-count it. (A
      // requiresApproval bill is always PO-linked — see above — so this
      // never runs for one either way.)
      if (!linkedPo) {
        for (const l of computed) {
          // SERVICE items have no stock to receive — their line already
          // debited an expense account rather than a stock control account
          // (see migration_029). Everything else about the bill is
          // identical, which is the whole point: GST input, Trade Payables
          // and therefore GSTR-3B's ITC all work unchanged.
          if (itemById.get(l.itemId)!.itemKind === "SERVICE") continue;
          await receiveStock(tx, {
            organizationId, branchId: resolvedBranchId!, itemId: l.itemId,
            quantity: l.quantity, unitCost: l.unitCost, costingMethod: org.costingMethod!,
            movementType: "PURCHASE", referenceType: "purchase_bill", referenceId: created.id,
            movementDate: new Date(billDate), narration: `Purchase bill ${billNumber}`,
          });
        }
      }

      // Roll the billed quantity forward on each referenced PO line and its
      // GRN line, then close the PO out once every one of its lines is
      // fully billed — same transaction, so this can never drift out of
      // sync with the bill that just posted. Deferred entirely for a
      // requiresApproval bill — nothing's actually billed yet until
      // POST /:id/approve does this same increment.
      if (linkedPo && !requiresApproval) {
        const billedByPoLine = new Map<string, number>();
        const billedByGrnLine = new Map<string, number>();
        for (const l of computed as (typeof computed[number] & { purchaseOrderLineId?: string; goodsReceiptNoteLineId?: string })[]) {
          if (!l.purchaseOrderLineId || !l.goodsReceiptNoteLineId) continue;
          billedByPoLine.set(l.purchaseOrderLineId, (billedByPoLine.get(l.purchaseOrderLineId) ?? 0) + l.quantity);
          billedByGrnLine.set(l.goodsReceiptNoteLineId, (billedByGrnLine.get(l.goodsReceiptNoteLineId) ?? 0) + l.quantity);
        }
        for (const [poLineId, qty] of billedByPoLine) {
          await tx.purchaseOrderLine.update({
            where: { id: poLineId },
            data: { billedQuantity: { increment: qty } },
          });
        }
        for (const [grnLineId, qty] of billedByGrnLine) {
          await tx.goodsReceiptNoteLine.update({
            where: { id: grnLineId },
            data: { billedQuantity: { increment: qty } },
          });
        }
        const allLines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: linkedPo.id } });
        const fullyBilled = allLines.every((l) => Number(l.billedQuantity) >= Number(l.quantity));
        if (fullyBilled) {
          await tx.purchaseOrder.update({ where: { id: linkedPo.id }, data: { status: "CLOSED" } });
        }
      }

      return created;
    });

    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "CREATE", entityType: "purchase_bill", entityId: bill.id,
      summary: requiresApproval
        ? `Created purchase bill ${billNumber} — ${vendor.name} (${grandTotal.toFixed(2)}) — held Pending Approval: ${varianceNote}`
        : `Posted purchase bill ${billNumber} — ${vendor.name} (${grandTotal.toFixed(2)})`,
    });
    res.status(201).json({ data: bill });
  } catch (err: any) {
    if (err?.status === 400) return res.status(400).json({ message: err.message });
    throw err;
  }
});

const APPROVE_DETAIL_INCLUDE = {
  businessPartner: true,
  lines: { include: { item: true } },
  purchaseOrder: { select: { id: true, poNumber: true } },
} as const;

// POST /purchase-bills/:id/approve — the deferred half of posting for a
// bill that was held at PENDING_APPROVAL (price variance beyond the org's
// tolerance). Reconstructs the exact same journal entry POST / would have
// created immediately if the bill had matched, from the bill/line data
// already stored — nothing is recomputed from the original request body.
router.post("/:id/approve", canApprove, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const bill = await prisma.purchaseBill.findFirst({
    where: { id: req.params.id, organizationId },
    include: APPROVE_DETAIL_INCLUDE,
  });
  if (!bill) return res.status(404).json({ message: "Purchase bill not found." });
  if (bill.status !== "PENDING_APPROVAL") {
    return res.status(400).json({ message: `Only a Pending Approval bill can be approved (this one is ${bill.status}).` });
  }

  // Re-validate the GRN quantity limits — another bill against the same
  // GRN line(s) may have been approved since this one was created, so the
  // headroom it assumed back then might no longer hold. This is the only
  // hard constraint approval can't override; a price variance can be
  // approved through, an over-received quantity can't.
  const grnLineIds = [...new Set(bill.lines.map((l) => l.goodsReceiptNoteLineId).filter((x): x is string => !!x))];
  const grnLines = await prisma.goodsReceiptNoteLine.findMany({
    where: { id: { in: grnLineIds } },
    select: { id: true, quantityReceived: true, billedQuantity: true },
  });
  const grnLineById = new Map(grnLines.map((l) => [l.id, l]));
  const billedByGrnLine = new Map<string, number>();
  for (const l of bill.lines) {
    if (!l.goodsReceiptNoteLineId) continue;
    billedByGrnLine.set(l.goodsReceiptNoteLineId, (billedByGrnLine.get(l.goodsReceiptNoteLineId) ?? 0) + Number(l.quantity));
  }
  for (const [grnLineId, qty] of billedByGrnLine) {
    const grnLine = grnLineById.get(grnLineId);
    if (!grnLine) continue; // shouldn't happen — the line existed when this bill was created
    const alreadyBilled = Number(grnLine.billedQuantity);
    const received = Number(grnLine.quantityReceived);
    if (round2(alreadyBilled + qty) > received) {
      return res.status(400).json({
        message: `Can't approve — billing ${qty} against Goods Receipt Note line ${grnLineId} would now exceed the received quantity ` +
          `(${received} received, ${alreadyBilled} already billed by other approved bills since this one was created, ${round2(received - alreadyBilled)} remaining). ` +
          `Reject this bill and raise a corrected one.`,
      });
    }
  }

  const isForeign = bill.currency !== "INR";
  const itemById = new Map(bill.lines.map((l) => [l.itemId, l.item]));
  const cgstTotal = Number(bill.cgstTotal), sgstTotal = Number(bill.sgstTotal), igstTotal = Number(bill.igstTotal);
  const customsDutyTotal = Number(bill.customsDutyTotal), taxTotal = Number(bill.taxTotal);

  const [cgstInput, sgstInput, igstInput, tradePayables, customsDutyPayable] = await Promise.all([
    prisma.account.findFirst({ where: { organizationId, accountCode: CGST_INPUT_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: SGST_INPUT_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: IGST_INPUT_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: TRADE_PAYABLES_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: CUSTOMS_DUTY_PAYABLE_CODE } }),
  ]);
  if (!tradePayables) return res.status(500).json({ message: "Trade Payables account not found — re-run provisioning." });
  if (cgstTotal > 0 && !cgstInput) return res.status(500).json({ message: "CGST Input Credit account not found — re-run provisioning." });
  if (sgstTotal > 0 && !sgstInput) return res.status(500).json({ message: "SGST Input Credit account not found — re-run provisioning." });
  if (igstTotal > 0 && !igstInput) return res.status(500).json({ message: "IGST Input Credit account not found — re-run provisioning." });
  const customsDutyPayableCredit = isForeign ? round2(customsDutyTotal + taxTotal) : 0;
  if (customsDutyPayableCredit > 0 && !customsDutyPayable) {
    return res.status(500).json({ message: "Customs Duty Payable account not found — re-run provisioning (npx prisma db seed, then Sync from Templates)." });
  }
  const tradePayablesCredit = isForeign ? Number(bill.subtotal) : Number(bill.grandTotal);

  const updated = await prisma.$transaction(async (tx) => {
    const journalEntry = await tx.journalEntry.create({
      data: {
        organizationId, branchId: bill.branchId, entryDate: bill.billDate,
        narration: bill.narration || `Purchase bill ${bill.billNumber} — ${bill.businessPartner.name}`,
        voucherType: "PB", referenceType: "purchase_bill", createdBy: req.user!.userId,
      },
    });
    await tx.journalLine.createMany({
      data: buildBillJournalLineRows({
        journalEntryId: journalEntry.id,
        computed: bill.lines.map((l) => ({
          itemId: l.itemId, quantity: Number(l.quantity),
          lineSubtotal: Number(l.lineSubtotal), customsDutyAmount: Number(l.customsDutyAmount),
        })),
        itemById, cgstTotal, sgstTotal, igstTotal,
        cgstInput, sgstInput, igstInput, customsDutyPayableCredit, customsDutyPayable,
        tradePayables, tradePayablesCredit, vendor: bill.businessPartner,
      }),
    });

    // Same billedQuantity rollup / PO auto-close POST / does immediately
    // for a matched bill — deferred until now for one that needed approval.
    const billedByPoLine = new Map<string, number>();
    for (const l of bill.lines) {
      if (!l.purchaseOrderLineId || !l.goodsReceiptNoteLineId) continue;
      billedByPoLine.set(l.purchaseOrderLineId, (billedByPoLine.get(l.purchaseOrderLineId) ?? 0) + Number(l.quantity));
    }
    for (const [poLineId, qty] of billedByPoLine) {
      await tx.purchaseOrderLine.update({ where: { id: poLineId }, data: { billedQuantity: { increment: qty } } });
    }
    for (const [grnLineId, qty] of billedByGrnLine) {
      await tx.goodsReceiptNoteLine.update({ where: { id: grnLineId }, data: { billedQuantity: { increment: qty } } });
    }
    if (bill.purchaseOrderId) {
      const allLines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: bill.purchaseOrderId } });
      const fullyBilled = allLines.every((l) => Number(l.billedQuantity) >= Number(l.quantity));
      if (fullyBilled) {
        await tx.purchaseOrder.update({ where: { id: bill.purchaseOrderId }, data: { status: "CLOSED" } });
      }
    }

    return tx.purchaseBill.update({
      where: { id: bill.id },
      data: { status: "POSTED", journalEntryId: journalEntry.id, approvedBy: req.user!.userId, approvedAt: new Date() },
      include: APPROVE_DETAIL_INCLUDE,
    });
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "purchase_bill", entityId: bill.id,
    summary: `Approved and posted purchase bill ${bill.billNumber} — ${bill.businessPartner.name} (${Number(bill.grandTotal).toFixed(2)})`,
  });
  res.json({ data: updated });
});

// POST /purchase-bills/:id/reject — PENDING_APPROVAL only, terminal (no
// reopen — this app has no bill-edit capability at all; correct the
// numbers on a fresh bill instead). Nothing to undo, since a pending
// bill never posted anything in the first place.
router.post("/:id/reject", canApprove, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const bill = await prisma.purchaseBill.findFirst({ where: { id: req.params.id, organizationId } });
  if (!bill) return res.status(404).json({ message: "Purchase bill not found." });
  if (bill.status !== "PENDING_APPROVAL") {
    return res.status(400).json({ message: `Only a Pending Approval bill can be rejected (this one is ${bill.status}).` });
  }
  const { reason } = req.body ?? {};
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ message: "A rejection reason is required." });
  }

  const updated = await prisma.purchaseBill.update({
    where: { id: bill.id },
    data: { status: "REJECTED", rejectedBy: req.user!.userId, rejectedAt: new Date(), rejectionReason: String(reason).trim() },
    include: APPROVE_DETAIL_INCLUDE,
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "purchase_bill", entityId: bill.id,
    summary: `Rejected purchase bill ${bill.billNumber}: ${String(reason).trim()}`,
  });
  res.json({ data: updated });
});

export default router;
