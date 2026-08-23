$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Stock transfers: the route...' -ForegroundColor Cyan

function Set-FileText($rel, $text) {
  $p = Join-Path $repo $rel
  $dir = Split-Path $p -Parent
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::WriteAllText($p, $text.Replace([string][char]13, ''), (New-Object Text.UTF8Encoding $false))
  Write-Host "  wrote  $rel"
}

Set-FileText 'backend/src/routes/stockTransfers.ts' 'import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { consumeStock, receiveStock, InsufficientStockError } from "../lib/costing";

// Stock transfers between branches.
//
// Goods leave one branch and arrive at another, and those are two events
// rather than one. Dispatched on Monday and received on Thursday, the goods
// are at neither branch in between — they are in transit, and 1304 Stock in
// Transit is where the balance sheet says so. When nothing is on a lorry that
// account is zero, which makes it a control worth checking at a month end.
//
// TWO JOURNAL ENTRIES, ALWAYS
//
// A journal entry carries a single branch_id, so a movement between two
// branches cannot be one entry. It is one at each end, and each balances on
// its own through 1304:
//
//   Dispatch, on the SENDING branch     Dr 1304   Cr the item''s stock account
//   Receipt,  on the RECEIVING branch   Dr the item''s stock account   Cr 1304
//
// WHAT THIS PHASE DOES NOT DO
//
// Section 25(4) makes two registrations of one company DISTINCT PERSONS, and
// Schedule I paragraph 2 makes a supply between distinct persons taxable even
// without consideration. So a transfer between branches with different GSTINs
// is a supply: tax invoice, GST on a Rule 28 value, and reporting as an
// outward supply in the sending branch''s GSTR-1.
//
// None of that is built. This route REFUSES a transfer between branches whose
// GSTINs differ rather than posting one without the tax, because a silently
// unreported outward supply is a compliance problem, not a missing feature.
// A same-GSTIN transfer is not a supply at all and needs only a delivery
// challan under Rule 55, which is what this handles.

const router = Router();
router.use(authenticate, requireActiveSubscription);
// Moves stock and writes journal entries — the same gate as a Stock
// Adjustment and a production posting.
const canPost = requirePermission("inventory.post");

const IN_TRANSIT_CODE = "1304";

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function dayOrNull(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}

// Whether moving goods between these two branches is a supply.
//
// Equal GSTINs — including both blank, which is one unregistered person —
// means one registration, so nothing is supplied to anybody. Anything else
// means two distinct persons under section 25(4).
function taxTreatmentFor(from: { gstin: string | null }, to: { gstin: string | null }): "NONE" | "TAXABLE" {
  const a = (from.gstin ?? "").trim().toUpperCase();
  const b = (to.gstin ?? "").trim().toUpperCase();
  return a === b ? "NONE" : "TAXABLE";
}

async function inTransitAccountOr400(organizationId: string, res: import("express").Response) {
  const acc = await prisma.account.findFirst({
    where: { organizationId, accountCode: IN_TRANSIT_CODE },
    select: { id: true },
  });
  if (!acc) {
    res.status(400).json({
      message: "This organisation has no 1304 Stock in Transit account. Sync from templates first — a transfer has nowhere to sit while the goods are on the road.",
    });
    return null;
  }
  return acc;
}

async function loadTransfer(organizationId: string, id: string) {
  return prisma.stockTransfer.findFirst({
    where: { id, organizationId },
    include: {
      fromBranch: { select: { id: true, name: true, gstin: true } },
      toBranch: { select: { id: true, name: true, gstin: true } },
      lines: {
        include: {
          item: { select: { id: true, sku: true, name: true, uom: true, stockAccountId: true, businessPartnerId: true } },
        },
      },
    },
  });
}

function transferJson(t: NonNullable<Awaited<ReturnType<typeof loadTransfer>>>) {
  const lines = t.lines.map((l) => ({
    id: l.id,
    item: { id: l.item.id, sku: l.item.sku, name: l.item.name, uom: l.item.uom },
    quantity: Number(l.quantity),
    unitCost: Number(l.unitCost),
    lineValue: Number(l.lineValue),
  }));
  return {
    id: t.id,
    transferNumber: t.transferNumber,
    transferDate: isoDay(t.transferDate),
    receivedDate: t.receivedDate ? isoDay(t.receivedDate) : null,
    fromBranch: { id: t.fromBranch.id, name: t.fromBranch.name },
    toBranch: { id: t.toBranch.id, name: t.toBranch.name },
    status: t.status,
    taxTreatment: t.taxTreatment,
    documentNumber: t.documentNumber,
    ewayBillNumber: t.ewayBillNumber,
    dispatchJournalEntryId: t.dispatchJournalEntryId,
    receiptJournalEntryId: t.receiptJournalEntryId,
    lines,
    totalValue: round2(lines.reduce((s, l) => s + l.lineValue, 0)),
  };
}

// GET /stock-transfers
router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const status = typeof req.query.status === "string" ? req.query.status : null;

  const rows = await prisma.stockTransfer.findMany({
    where: { organizationId, ...(status && status !== "ALL" ? { status } : {}) },
    include: {
      fromBranch: { select: { id: true, name: true } },
      toBranch: { select: { id: true, name: true } },
      lines: { select: { lineValue: true, quantity: true } },
    },
    orderBy: [{ transferDate: "desc" }, { createdAt: "desc" }],
    take: 300,
  });

  res.json({
    data: rows.map((t) => ({
      id: t.id,
      transferNumber: t.transferNumber,
      transferDate: isoDay(t.transferDate),
      receivedDate: t.receivedDate ? isoDay(t.receivedDate) : null,
      fromBranch: t.fromBranch,
      toBranch: t.toBranch,
      status: t.status,
      taxTreatment: t.taxTreatment,
      documentNumber: t.documentNumber,
      lineCount: t.lines.length,
      totalValue: round2(t.lines.reduce((s, l) => s + Number(l.lineValue), 0)),
    })),
  });
});

// GET /stock-transfers/:id
router.get("/:id", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const t = await loadTransfer(organizationId, req.params.id);
  if (!t) return res.status(404).json({ message: "Transfer not found." });
  res.json({ data: transferJson(t) });
});

// POST /stock-transfers
//   { fromBranchId, toBranchId, transferDate, documentNumber?, ewayBillNumber?,
//     lines: [{ itemId, quantity }] }
//
// Creating a transfer DISPATCHES it. There is no draft state: a transfer that
// has not been dispatched is a list of items somebody is thinking about, and
// the system has no use for that.
//
//   Dr 1304 Stock in Transit
//   Cr each item''s stock account, tagged to that item''s own card
router.post("/", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const transit = await inTransitAccountOr400(organizationId, res);
  if (!transit) return;

  const { fromBranchId, toBranchId, documentNumber, ewayBillNumber } = req.body ?? {};
  const transferDate = dayOrNull(req.body?.transferDate);

  if (!transferDate) return res.status(400).json({ message: "transferDate is required, as YYYY-MM-DD." });
  if (typeof fromBranchId !== "string" || !fromBranchId) return res.status(400).json({ message: "Pick the branch the goods are leaving." });
  if (typeof toBranchId !== "string" || !toBranchId) return res.status(400).json({ message: "Pick the branch the goods are going to." });
  if (fromBranchId === toBranchId) return res.status(400).json({ message: "The two branches must be different — nothing moves otherwise." });

  const branches = await prisma.branch.findMany({
    where: { id: { in: [fromBranchId, toBranchId] }, organizationId, deletedAt: null },
    select: { id: true, name: true, gstin: true },
  });
  type Br = { id: string; name: string; gstin: string | null };
  const from = (branches as Br[]).find((b) => b.id === fromBranchId);
  const to = (branches as Br[]).find((b) => b.id === toBranchId);
  if (!from || !to) return res.status(400).json({ message: "One of those branches is not in this organisation." });

  // The refusal that matters. See the header note: an unreported outward
  // supply is a compliance problem, so this stops rather than posting a
  // transfer without the tax leg.
  const taxTreatment = taxTreatmentFor(from, to);
  if (taxTreatment !== "NONE") {
    return res.status(400).json({
      message: `${from.name} and ${to.name} have different GSTINs, which makes them distinct persons under section 25(4) — moving goods between them is a taxable supply needing a tax invoice and GST, not a delivery challan. Taxable branch transfers are not built yet, so this is refused rather than posted without the tax.`,
    });
  }

  const raw = Array.isArray(req.body?.lines) ? req.body.lines : null;
  if (!raw || raw.length === 0) return res.status(400).json({ message: "Add at least one item to transfer." });

  const parsed: { itemId: string; quantity: number }[] = [];
  const seen = new Set<string>();
  for (const l of raw as { itemId?: unknown; quantity?: unknown }[]) {
    const itemId = typeof l?.itemId === "string" ? l.itemId : "";
    const quantity = Number(l?.quantity);
    if (!itemId) return res.status(400).json({ message: "Every line needs an item." });
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ message: "Every quantity must be more than zero." });
    }
    if (seen.has(itemId)) return res.status(400).json({ message: "The same item is listed twice." });
    seen.add(itemId);
    parsed.push({ itemId, quantity });
  }

  const items = await prisma.item.findMany({
    where: { id: { in: parsed.map((l) => l.itemId) }, organizationId, deletedAt: null },
    select: { id: true, sku: true, name: true, itemKind: true, stockAccountId: true, businessPartnerId: true },
  });
  type It = { id: string; sku: string; name: string; itemKind: string; stockAccountId: string; businessPartnerId: string };
  const byId = new Map<string, It>((items as It[]).map((x) => [x.id, x]));
  for (const l of parsed) {
    const it = byId.get(l.itemId);
    if (!it) return res.status(400).json({ message: "An item on this transfer is not in this organisation." });
    if (it.itemKind !== "STOCK") {
      return res.status(400).json({ message: `${it.sku} is a service item — it has no stock to move.` });
    }
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId }, select: { costingMethod: true },
  });
  const costingMethod = org?.costingMethod ?? "WEIGHTED_AVG";

  const count = await prisma.stockTransfer.count({ where: { organizationId } });
  const transferNumber = `TR-${String(count + 1).padStart(4, "0")}`;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const journalEntry = await tx.journalEntry.create({
        data: {
          organizationId, branchId: fromBranchId, entryDate: transferDate,
          narration: `${transferNumber} — dispatched to ${to.name}`.slice(0, 255),
          voucherType: "JV",
          referenceType: "stock_transfer_dispatch",
          createdBy: req.user!.userId,
        },
      });

      const transfer = await tx.stockTransfer.create({
        data: {
          organizationId, transferNumber,
          fromBranchId, toBranchId, transferDate,
          status: "DISPATCHED", taxTreatment: "NONE",
          documentNumber: typeof documentNumber === "string" && documentNumber.trim() ? documentNumber.trim().slice(0, 30) : null,
          ewayBillNumber: typeof ewayBillNumber === "string" && ewayBillNumber.trim() ? ewayBillNumber.trim().slice(0, 20) : null,
          dispatchJournalEntryId: journalEntry.id,
          createdBy: req.user!.userId,
        },
      });

      let total = 0;
      const credits: { accountId: string; businessPartnerId: string; amount: number; narration: string }[] = [];

      for (const l of parsed) {
        const it = byId.get(l.itemId)!;
        // The cost the receiving branch will receive at. Taken from what the
        // stock is actually worth at the sending branch on the day, not typed.
        const { unitCost, totalCost } = await consumeStock(tx, {
          organizationId, branchId: fromBranchId, itemId: l.itemId,
          quantity: l.quantity, costingMethod,
          movementType: "TRANSFER_OUT",
          referenceType: "stock_transfer", referenceId: transfer.id,
          movementDate: transferDate,
          narration: `${transferNumber} — to ${to.name}`,
        });

        total = round2(total + totalCost);
        credits.push({
          accountId: it.stockAccountId, businessPartnerId: it.businessPartnerId,
          amount: round2(totalCost), narration: `${it.sku} — ${it.name}`.slice(0, 255),
        });

        await tx.stockTransferLine.create({
          data: {
            stockTransferId: transfer.id, itemId: l.itemId,
            quantity: l.quantity, unitCost: round4(unitCost), lineValue: round2(totalCost),
          },
        });
      }

      await tx.journalLine.createMany({
        data: [
          {
            journalEntryId: journalEntry.id, accountId: transit.id,
            businessPartnerId: null, debit: total, credit: 0,
            narration: `${transferNumber} — in transit to ${to.name}`.slice(0, 255),
          },
          ...credits.map((c) => ({
            journalEntryId: journalEntry.id, accountId: c.accountId,
            businessPartnerId: c.businessPartnerId, debit: 0, credit: c.amount,
            narration: c.narration,
          })),
        ],
      });

      return { id: transfer.id, transferNumber, total };
    });

    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "CREATE", entityType: "stock_transfer", entityId: created.id,
      summary: `${transferNumber} — ${from.name} to ${to.name}, ${parsed.length} item${parsed.length === 1 ? "" : "s"}, ${created.total.toFixed(2)}`,
    });

    res.status(201).json({ data: created });
  } catch (err: unknown) {
    if (err instanceof InsufficientStockError) {
      return res.status(400).json({ message: err.message });
    }
    console.error("stock transfer dispatch failed", err);
    return res.status(500).json({ message: "Could not dispatch the transfer. Nothing was written." });
  }
});

// POST /stock-transfers/:id/receive   { receivedDate }
//
//   Dr each item''s stock account at the RECEIVING branch, tagged to its card
//   Cr 1304 Stock in Transit
//
// The receiving branch receives at the sending branch''s cost — the unit cost
// recorded on the line at dispatch. Nothing is re-valued in transit.
router.post("/:id/receive", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const transit = await inTransitAccountOr400(organizationId, res);
  if (!transit) return;

  const t = await loadTransfer(organizationId, req.params.id);
  if (!t) return res.status(404).json({ message: "Transfer not found." });
  if (t.status !== "DISPATCHED") {
    return res.status(409).json({ message: `${t.transferNumber} is ${t.status.toLowerCase()} — it cannot be received.` });
  }

  const receivedDate = dayOrNull(req.body?.receivedDate) ?? t.transferDate;
  if (receivedDate < t.transferDate) {
    return res.status(400).json({
      message: `Goods cannot arrive before they leave. ${t.transferNumber} was dispatched on ${isoDay(t.transferDate)}.`,
    });
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId }, select: { costingMethod: true },
  });
  const costingMethod = org?.costingMethod ?? "WEIGHTED_AVG";

  const result = await prisma.$transaction(async (tx) => {
    const journalEntry = await tx.journalEntry.create({
      data: {
        organizationId, branchId: t.toBranchId, entryDate: receivedDate,
        narration: `${t.transferNumber} — received from ${t.fromBranch.name}`.slice(0, 255),
        voucherType: "JV",
        referenceType: "stock_transfer_receipt",
        createdBy: req.user!.userId,
      },
    });

    let total = 0;
    const debits: { accountId: string; businessPartnerId: string; amount: number; narration: string }[] = [];

    for (const l of t.lines) {
      const value = round2(Number(l.lineValue));
      total = round2(total + value);

      await receiveStock(tx, {
        organizationId, branchId: t.toBranchId, itemId: l.itemId,
        quantity: Number(l.quantity), unitCost: Number(l.unitCost), costingMethod,
        movementType: "TRANSFER_IN",
        referenceType: "stock_transfer", referenceId: t.id,
        movementDate: receivedDate,
        narration: `${t.transferNumber} — from ${t.fromBranch.name}`,
      });

      debits.push({
        accountId: l.item.stockAccountId, businessPartnerId: l.item.businessPartnerId,
        amount: value, narration: `${l.item.sku} — ${l.item.name}`.slice(0, 255),
      });
    }

    await tx.journalLine.createMany({
      data: [
        ...debits.map((d) => ({
          journalEntryId: journalEntry.id, accountId: d.accountId,
          businessPartnerId: d.businessPartnerId, debit: d.amount, credit: 0,
          narration: d.narration,
        })),
        {
          journalEntryId: journalEntry.id, accountId: transit.id,
          businessPartnerId: null, debit: 0, credit: total,
          narration: `${t.transferNumber} — received at ${t.toBranch.name}`.slice(0, 255),
        },
      ],
    });

    await tx.stockTransfer.update({
      where: { id: t.id },
      data: { status: "RECEIVED", receivedDate, receiptJournalEntryId: journalEntry.id },
    });

    return { received: true, total };
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "stock_transfer", entityId: t.id,
    summary: `${t.transferNumber} received at ${t.toBranch.name} — ${result.total.toFixed(2)}`,
  });

  res.json({ data: result });
});

// POST /stock-transfers/:id/cancel   { entryDate? }
//
// Brings the goods back to the sending branch. Only while they are still in
// transit — once received they are somewhere, and the way to move them back
// is a transfer the other way.
//
// This posts a RETURN entry rather than deleting the dispatch. The dispatch
// consumed stock through the FIFO lots or the weighted average; deleting the
// entry would leave the stock ledger showing goods that went out with no
// accounting record of it. A return keeps the two in step:
//
//   Dr each item''s stock account at the SENDING branch
//   Cr 1304 Stock in Transit
//
// It is stored in receipt_journal_entry_id — the column means "the second
// journal entry of this transfer", and for a cancelled one that is the
// return.
router.post("/:id/cancel", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const transit = await inTransitAccountOr400(organizationId, res);
  if (!transit) return;

  const t = await loadTransfer(organizationId, req.params.id);
  if (!t) return res.status(404).json({ message: "Transfer not found." });
  if (t.status !== "DISPATCHED") {
    return res.status(409).json({
      message: t.status === "RECEIVED"
        ? `${t.transferNumber} has already been received at ${t.toBranch.name}. Send the goods back with a transfer the other way — cancelling now would take stock off a branch that is holding it.`
        : `${t.transferNumber} is already cancelled.`,
    });
  }

  const entryDate = dayOrNull(req.body?.entryDate) ?? t.transferDate;
  if (entryDate < t.transferDate) {
    return res.status(400).json({ message: `The return cannot predate the dispatch on ${isoDay(t.transferDate)}.` });
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId }, select: { costingMethod: true },
  });
  const costingMethod = org?.costingMethod ?? "WEIGHTED_AVG";

  const result = await prisma.$transaction(async (tx) => {
    const journalEntry = await tx.journalEntry.create({
      data: {
        organizationId, branchId: t.fromBranchId, entryDate,
        narration: `${t.transferNumber} cancelled — returned to ${t.fromBranch.name}`.slice(0, 255),
        voucherType: "JV",
        referenceType: "stock_transfer_cancel",
        createdBy: req.user!.userId,
      },
    });

    let total = 0;
    const debits: { accountId: string; businessPartnerId: string; amount: number; narration: string }[] = [];

    for (const l of t.lines) {
      const value = round2(Number(l.lineValue));
      total = round2(total + value);

      await receiveStock(tx, {
        organizationId, branchId: t.fromBranchId, itemId: l.itemId,
        quantity: Number(l.quantity), unitCost: Number(l.unitCost), costingMethod,
        movementType: "TRANSFER_IN",
        referenceType: "stock_transfer", referenceId: t.id,
        movementDate: entryDate,
        narration: `${t.transferNumber} cancelled — returned`,
      });

      debits.push({
        accountId: l.item.stockAccountId, businessPartnerId: l.item.businessPartnerId,
        amount: value, narration: `${l.item.sku} — ${l.item.name}`.slice(0, 255),
      });
    }

    await tx.journalLine.createMany({
      data: [
        ...debits.map((d) => ({
          journalEntryId: journalEntry.id, accountId: d.accountId,
          businessPartnerId: d.businessPartnerId, debit: d.amount, credit: 0,
          narration: d.narration,
        })),
        {
          journalEntryId: journalEntry.id, accountId: transit.id,
          businessPartnerId: null, debit: 0, credit: total,
          narration: `${t.transferNumber} cancelled`.slice(0, 255),
        },
      ],
    });

    await tx.stockTransfer.update({
      where: { id: t.id },
      data: { status: "CANCELLED", receiptJournalEntryId: journalEntry.id },
    });

    return { cancelled: true, total };
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "stock_transfer", entityId: t.id,
    summary: `${t.transferNumber} cancelled — ${result.total.toFixed(2)} returned to ${t.fromBranch.name}`,
  });

  res.json({ data: result });
});

export default router;
'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green