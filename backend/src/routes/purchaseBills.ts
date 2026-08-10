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

const router = Router();
router.use(authenticate, requireActiveSubscription);
const canPost = requirePermission("purchase.post");

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
    include: { businessPartner: true, lines: { include: { item: true } }, journalEntry: { include: { journalLines: true } } },
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
    billOfEntryNumber, billOfEntryDate, portCode,
  } = req.body ?? {};
  if (!businessPartnerId || !billDate || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ message: "businessPartnerId, billDate, and at least one line are required." });
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

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true } });
  if (!org?.costingMethod) return res.status(422).json({ message: "Set the organization's stock costing method first." });

  const vendor = await prisma.businessPartner.findFirst({ where: { id: businessPartnerId, organizationId, bpType: "VENDOR" } });
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
  let subtotal = 0, taxTotal = 0, cgstTotal = 0, sgstTotal = 0, igstTotal = 0;
  const computed = typedLines.map((l) => {
    if (isForeign) {
      if (!l.itemId || !(l.quantity > 0) || !(l.rateFc! >= 0)) {
        throw Object.assign(new Error("Every line needs itemId, quantity > 0, and rateFc >= 0."), { status: 400 });
      }
      // rateFc is authoritative for a foreign-currency bill — overwrite
      // rate so tax/costing below (and receiveStock's unitCost) run on the
      // correct INR figure without any further change.
      l.rate = round2(l.rateFc! * fxRate);
    } else if (!l.itemId || !(l.quantity > 0) || !(l.rate >= 0)) {
      throw Object.assign(new Error("Every line needs itemId, quantity > 0, and rate >= 0."), { status: 400 });
    }
    const lineSubtotal = round2(l.quantity * l.rate);
    const taxAmount = round2(lineSubtotal * (l.taxRate ?? 0) / 100);
    const { cgst, sgst, igst } = splitGst(taxAmount, interState);
    subtotal += lineSubtotal; taxTotal += taxAmount; cgstTotal += cgst; sgstTotal += sgst; igstTotal += igst;
    return {
      ...l, lineSubtotal, taxAmount, lineTotal: lineSubtotal + taxAmount, cgstAmount: cgst, sgstAmount: sgst, igstAmount: igst,
      rateFc: isForeign ? l.rateFc : undefined,
    };
  });
  const grandTotal = subtotal + taxTotal;
  const grandTotalFc = isForeign ? round2(grandTotal / fxRate) : null;

  const [cgstInput, sgstInput, igstInput, tradePayables] = await Promise.all([
    prisma.account.findFirst({ where: { organizationId, accountCode: CGST_INPUT_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: SGST_INPUT_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: IGST_INPUT_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: TRADE_PAYABLES_CODE } }),
  ]);
  if (!tradePayables) return res.status(500).json({ message: "Trade Payables account not found — re-run provisioning." });
  if (cgstTotal > 0 && !cgstInput) return res.status(500).json({ message: "CGST Input Credit account not found — re-run provisioning." });
  if (sgstTotal > 0 && !sgstInput) return res.status(500).json({ message: "SGST Input Credit account not found — re-run provisioning." });
  if (igstTotal > 0 && !igstInput) return res.status(500).json({ message: "IGST Input Credit account not found — re-run provisioning." });

  const count = await prisma.purchaseBill.count({ where: { organizationId } });
  const billNumber = `PB-${String(count + 1).padStart(4, "0")}`;

  try {
    const bill = await prisma.$transaction(async (tx) => {
      const journalEntry = await tx.journalEntry.create({
        data: {
          organizationId, branchId: resolvedBranchId, entryDate: new Date(billDate),
          narration: narration || `Purchase bill ${billNumber} — ${vendor.name}`,
          voucherType: "PB", referenceType: "purchase_bill", createdBy: req.user!.userId,
        },
      });

      await tx.journalLine.createMany({
        data: [
          ...computed.map((l) => ({
            journalEntryId: journalEntry.id,
            accountId: itemById.get(l.itemId)!.stockAccountId,
            businessPartnerId: itemById.get(l.itemId)!.businessPartnerId,
            debit: l.lineSubtotal, credit: 0,
            narration: `${itemById.get(l.itemId)!.sku} x ${l.quantity}`,
          })),
          ...(cgstTotal > 0 ? [{ journalEntryId: journalEntry.id, accountId: cgstInput!.id, businessPartnerId: null, debit: cgstTotal, credit: 0, narration: "CGST Input" }] : []),
          ...(sgstTotal > 0 ? [{ journalEntryId: journalEntry.id, accountId: sgstInput!.id, businessPartnerId: null, debit: sgstTotal, credit: 0, narration: "SGST Input" }] : []),
          ...(igstTotal > 0 ? [{ journalEntryId: journalEntry.id, accountId: igstInput!.id, businessPartnerId: null, debit: igstTotal, credit: 0, narration: "IGST Input" }] : []),
          { journalEntryId: journalEntry.id, accountId: tradePayables.id, businessPartnerId: vendor.id, debit: 0, credit: grandTotal, narration: `Payable to ${vendor.name}` },
        ],
      });

      const created = await tx.purchaseBill.create({
        data: {
          organizationId, branchId: resolvedBranchId, businessPartnerId,
          billNumber, billDate: new Date(billDate), narration: narration ?? "",
          journalEntryId: journalEntry.id, subtotal, taxTotal, grandTotal,
          cgstTotal, sgstTotal, igstTotal,
          currency: currencyCode, exchangeRate: fxRate, grandTotalFc,
          // Almost never known yet at posting time — see the schema
          // comment on billOfEntryNumber. PATCH /:id is the normal way
          // this gets filled in once customs clearance actually happens.
          billOfEntryNumber: isForeign && billOfEntryNumber ? String(billOfEntryNumber) : null,
          billOfEntryDate: isForeign && billOfEntryDate ? new Date(billOfEntryDate) : null,
          portCode: isForeign && portCode ? String(portCode) : null,
          createdBy: req.user!.userId,
        },
      });

      await tx.purchaseBillLine.createMany({
        data: computed.map((l) => ({
          purchaseBillId: created.id, itemId: l.itemId, quantity: l.quantity, rate: l.rate,
          taxRate: l.taxRate ?? 0, lineSubtotal: l.lineSubtotal, taxAmount: l.taxAmount, lineTotal: l.lineTotal,
          cgstAmount: l.cgstAmount, sgstAmount: l.sgstAmount, igstAmount: l.igstAmount,
          rateFc: l.rateFc ?? null, lineTotalFc: isForeign ? round2(l.lineTotal / fxRate) : null,
        })),
      });

      for (const l of computed) {
        await receiveStock(tx, {
          organizationId, branchId: resolvedBranchId!, itemId: l.itemId,
          quantity: l.quantity, unitCost: l.rate, costingMethod: org.costingMethod!,
          movementType: "PURCHASE", referenceType: "purchase_bill", referenceId: created.id,
          movementDate: new Date(billDate), narration: `Purchase bill ${billNumber}`,
        });
      }

      return created;
    });

    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "CREATE", entityType: "purchase_bill", entityId: bill.id,
      summary: `Posted purchase bill ${billNumber} — ${vendor.name} (${grandTotal.toFixed(2)})`,
    });
    res.status(201).json({ data: bill });
  } catch (err: any) {
    if (err?.status === 400) return res.status(400).json({ message: err.message });
    throw err;
  }
});

export default router;
