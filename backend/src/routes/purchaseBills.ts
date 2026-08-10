import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { receiveStock } from "../lib/costing";
import { isInterState, round2, splitGst } from "../lib/discountGst";
import { isSupportedCurrency } from "../lib/currencies";

// Every org's core COA (seed.ts) always includes these — same convention
// journal.ts uses for CASH_BANK_CODES.
const TRADE_PAYABLES_CODE = "2001";
const CGST_INPUT_CODE = "1102";
const SGST_INPUT_CODE = "1103";
const IGST_INPUT_CODE = "1104";
// Import bills only — customs duty + import IGST both credit here instead
// of Trade Payables, since neither is actually owed to the foreign vendor.
// See the posting split in POST / below.
const CUSTOMS_DUTY_PAYABLE_CODE = "2105";

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
}

// Shared by POST / (immediate posting) and POST /:id/approve (deferred
// posting of a bill that was held for a price variance) — the same
// journal shape either way: Dr each item's stock account, Dr GST Input
// (split), Cr Customs Duty Payable (import only), Cr Trade Payables.
function buildBillJournalLineRows(args: {
  journalEntryId: string;
  computed: { itemId: string; quantity: number; lineSubtotal: number; customsDutyAmount: number }[];
  itemById: Map<string, { stockAccountId: string; businessPartnerId: string; sku: string }>;
  cgstTotal: number; sgstTotal: number; igstTotal: number;
  cgstInput: { id: string } | null; sgstInput: { id: string } | null; igstInput: { id: string } | null;
  customsDutyPayableCredit: number; customsDutyPayable: { id: string } | null;
  tradePayables: { id: string }; tradePayablesCredit: number;
  vendor: { id: string; name: string };
}) {
  const {
    journalEntryId, computed, itemById, cgstTotal, sgstTotal, igstTotal,
    cgstInput, sgstInput, igstInput, customsDutyPayableCredit, customsDutyPayable,
    tradePayables, tradePayablesCredit, vendor,
  } = args;
  return [
    ...computed.map((l) => ({
      journalEntryId,
      accountId: itemById.get(l.itemId)!.stockAccountId,
      businessPartnerId: itemById.get(l.itemId)!.businessPartnerId,
      debit: l.lineSubtotal + l.customsDutyAmount, credit: 0,
      narration: `${itemById.get(l.itemId)!.sku} x ${l.quantity}`,
    })),
    ...(cgstTotal > 0 ? [{ journalEntryId, accountId: cgstInput!.id, businessPartnerId: null, debit: cgstTotal, credit: 0, narration: "CGST Input" }] : []),
    ...(sgstTotal > 0 ? [{ journalEntryId, accountId: sgstInput!.id, businessPartnerId: null, debit: sgstTotal, credit: 0, narration: "SGST Input" }] : []),
    ...(igstTotal > 0 ? [{ journalEntryId, accountId: igstInput!.id, businessPartnerId: null, debit: igstTotal, credit: 0, narration: "IGST Input" }] : []),
    ...(customsDutyPayableCredit > 0 ? [{ journalEntryId, accountId: customsDutyPayable!.id, businessPartnerId: null, debit: 0, credit: customsDutyPayableCredit, narration: "Customs duty + import IGST payable" }] : []),
    { journalEntryId, accountId: tradePayables.id, businessPartnerId: vendor.id, debit: 0, credit: tradePayablesCredit, narration: `Payable to ${vendor.name}` },
  ];
}

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
  let linkedPo: { id: string; businessPartnerId: string; status: string; lines: { id: string; quantity: any; rate: any; billedQuantity: any }[] } | null = null;
  if (purchaseOrderId) {
    linkedPo = await prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, organizationId },
      include: { lines: { select: { id: true, quantity: true, rate: true, billedQuantity: true } } },
    });
    if (!linkedPo) return res.status(400).json({ message: "purchaseOrderId is not a valid Purchase Order for this organization." });
    if (linkedPo.status !== "APPROVED") {
      return res.status(400).json({ message: `Purchase Order ${purchaseOrderId} is ${linkedPo.status}, not Approved — only an approved PO can be billed.` });
    }
    if (businessPartnerId && businessPartnerId !== linkedPo.businessPartnerId) {
      return res.status(400).json({ message: "businessPartnerId doesn't match the vendor on the linked Purchase Order." });
    }
  }
  const effectiveBusinessPartnerId = linkedPo?.businessPartnerId ?? businessPartnerId;
  if (!effectiveBusinessPartnerId) {
    return res.status(400).json({ message: "businessPartnerId (or purchaseOrderId) is required." });
  }

  // Foreign currency (import bills) — see lib/currencies.ts and the matching
  // note in salesInvoices.ts; same semantics, same INR-is-authoritative rule.
  const currencyCode = String(currency || "INR").toUpperCase();
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
  const tolerancePct = org.priceVarianceTolerancePct != null ? Number(org.priceVarianceTolerancePct) : 0;
  let varianceNote: string | null = null;
  if (linkedPo) {
    const poLineById = new Map(linkedPo.lines.map((l) => [l.id, l]));
    const typedComputed = computed as (typeof computed[number] & { purchaseOrderLineId?: string })[];
    const varianceDescriptions: string[] = [];
    for (const l of typedComputed) {
      const poLine = poLineById.get(l.purchaseOrderLineId!);
      if (!poLine) continue; // already validated above; unreachable in practice
      const poRate = Number(poLine.rate);
      const billRate = Number(l.rate);
      const diffPct = poRate === 0 ? (billRate === 0 ? 0 : 100) : round2((Math.abs(billRate - poRate) / poRate) * 100);
      if (diffPct > tolerancePct) {
        varianceDescriptions.push(`${itemById.get(l.itemId)!.sku}: PO ₹${poRate.toFixed(2)} vs bill ₹${billRate.toFixed(2)} (${diffPct.toFixed(2)}%)`);
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

      await tx.purchaseBillLine.createMany({
        data: computed.map((l) => ({
          purchaseBillId: created.id, itemId: l.itemId, quantity: l.quantity, rate: l.rate,
          taxRate: l.taxRate ?? 0, lineSubtotal: l.lineSubtotal, taxAmount: l.taxAmount, lineTotal: l.lineTotal,
          cgstAmount: l.cgstAmount, sgstAmount: l.sgstAmount, igstAmount: l.igstAmount,
          rateFc: l.rateFc ?? null, lineTotalFc: isForeign ? round2(l.lineTotal / fxRate) : null,
          customsDutyRate: isForeign && l.customsDutyRate ? l.customsDutyRate : null,
          customsDutyAmount: l.customsDutyAmount,
          purchaseOrderLineId: (l as { purchaseOrderLineId?: string }).purchaseOrderLineId ?? null,
          goodsReceiptNoteLineId: (l as { goodsReceiptNoteLineId?: string }).goodsReceiptNoteLineId ?? null,
        })),
      });

      // Stock inward only for ad-hoc (non-PO) lines — a PO-linked bill's
      // stock was already received via its Goods Receipt Note(s), so
      // calling receiveStock again here would double-count it. (A
      // requiresApproval bill is always PO-linked — see above — so this
      // never runs for one either way.)
      if (!linkedPo) {
        for (const l of computed) {
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
