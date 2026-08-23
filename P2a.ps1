$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Production orders: route, part 1 of 2...' -ForegroundColor Cyan

function Set-FileText($rel, $text) {
  $p = Join-Path $repo $rel
  $dir = Split-Path $p -Parent
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::WriteAllText($p, $text.Replace([string][char]13, ''), (New-Object Text.UTF8Encoding $false))
  Write-Host "  wrote  $rel"
}

Set-FileText 'backend/src/routes/productionOrders.ts' 'import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { consumeStock, receiveStock, InsufficientStockError } from "../lib/costing";

// Production orders — raw material in, finished goods out.
//
// One document with four kinds of posting against it:
//
//   ISSUE     material leaves stock, its cost enters work in progress
//   COST      labour or overhead is absorbed from an expense head into WIP
//   RECEIPT   WIP value leaves, finished goods enter stock at a DERIVED cost
//   WRITEOFF  WIP value leaves with no product to carry it — an abandoned
//             order. AS 2 excludes abnormal waste from the cost of
//             inventories, so it is an expense of the period.
//
// The order exists to make work in progress explicable. 1302 is deliberately
// not a control account — a half-made thing is not an item, it has no SKU and
// no unit of measure that means anything — so the balance of 1302 is answered
// not by a stock report but by "these are the open orders, and this is what
// went into each".
//
// THE COST OF THE FINISHED GOOD IS NEVER TYPED
//
// It is the WIP absorbed divided by the quantity received. An issue''s cost is
// whatever consumeStock actually consumed at FIFO or weighted average; a cost
// line is what the accountant entered; and the receipt divides the pool. That
// chain — purchase price, through issue, through receipt, into cost of goods
// sold when the thing is finally sold — is unbroken, and every link is a
// posted document.
//
// AS 2 requires cost of conversion (direct labour plus a systematic
// allocation of production overheads) to sit in inventory, which is why a
// COST line exists at all. Absorption rates are not built: the accountant
// enters the figure rather than trusting a rate table nobody maintains.

const router = Router();
router.use(authenticate, requireActiveSubscription);
// Every posting here writes a journal entry and moves stock, which is the
// same gate a Stock Adjustment uses.
const canPost = requirePermission("inventory.post");

const WIP_CODE = "1302";
const ABNORMAL_LOSS_CODE = "4003";

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

// An order''s position, summed from its postings. Neither figure is stored:
// the same reasoning as accumulated depreciation, which is summed from the
// runs rather than held on the asset.
type Entryish = {
  entryType: string;
  totalValue: unknown;
  lines: { quantity: unknown; itemId: string | null }[];
};

function positionOf(entries: Entryish[]) {
  let issued = 0, costed = 0, absorbed = 0, writtenOff = 0, receivedQty = 0;
  for (const e of entries) {
    const v = Number(e.totalValue);
    if (e.entryType === "ISSUE") issued += v;
    else if (e.entryType === "COST") costed += v;
    else if (e.entryType === "RECEIPT") {
      absorbed += v;
      for (const l of e.lines) if (l.itemId) receivedQty += Number(l.quantity ?? 0);
    } else if (e.entryType === "WRITEOFF") {
      // Leaves WIP like a receipt does, but carried by no product. Kept
      // separate so "what did this order cost to make" and "what was thrown
      // away" never get added together.
      writtenOff += v;
    }
  }
  return {
    issued: round2(issued),
    costed: round2(costed),
    absorbed: round2(absorbed),
    writtenOff: round2(writtenOff),
    wipBalance: round2(issued + costed - absorbed - writtenOff),
    receivedQuantity: round4(receivedQty),
  };
}

async function loadOrder(organizationId: string, id: string) {
  return prisma.productionOrder.findFirst({
    where: { id, organizationId },
    include: {
      finishedItem: { select: { id: true, sku: true, name: true, uom: true, stockAccountId: true, businessPartnerId: true } },
      branch: { select: { id: true, name: true } },
      entries: {
        orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
        include: {
          lines: {
            include: {
              item: { select: { id: true, sku: true, name: true, uom: true } },
              account: { select: { id: true, accountCode: true, accountName: true } },
            },
          },
        },
      },
    },
  });
}

// The WIP account, and a sentence rather than a stack trace when an
// organisation does not have one. A trading-only chart has 1201 Inventory and
// no 1302, and cannot run production until it does.
async function wipAccountOr400(organizationId: string, res: import("express").Response) {
  const wip = await prisma.account.findFirst({
    where: { organizationId, accountCode: WIP_CODE },
    select: { id: true },
  });
  if (!wip) {
    res.status(400).json({
      message: "This organisation has no 1302 Work in Progress account. Production needs the manufacturing chart of accounts — sync from templates first.",
    });
    return null;
  }
  return wip;
}

// GET /production-orders
router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const status = typeof req.query.status === "string" ? req.query.status : null;

  const orders = await prisma.productionOrder.findMany({
    where: { organizationId, ...(status && status !== "ALL" ? { status } : {}) },
    include: {
      finishedItem: { select: { id: true, sku: true, name: true, uom: true } },
      branch: { select: { id: true, name: true } },
      entries: { select: { entryType: true, totalValue: true, lines: { select: { quantity: true, itemId: true } } } },
    },
    orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
    take: 300,
  });

  res.json({
    data: orders.map((o) => {
      const pos = positionOf(o.entries);
      return {
        id: o.id, orderNumber: o.orderNumber, orderDate: isoDay(o.orderDate),
        finishedItem: o.finishedItem, branch: o.branch,
        plannedQuantity: Number(o.plannedQuantity),
        status: o.status,
        ...pos,
        unitCostSoFar: pos.receivedQuantity > 0 ? round4(pos.absorbed / pos.receivedQuantity) : null,
      };
    }),
  });
});

// GET /production-orders/:id
//
// Includes a SUGGESTED issue exploded from the bill of materials, so the
// screen can prefill the first issue. It is a suggestion and nothing more —
// the quantities are corrected against what was actually taken to the shop
// floor, and an order with no bill of materials simply gets an empty one.
router.get("/:id", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const order = await loadOrder(organizationId, req.params.id);
  if (!order) return res.status(404).json({ message: "Production order not found." });

  const bom = await prisma.bomLine.findMany({
    where: { organizationId, finishedItemId: order.finishedItemId },
    include: { componentItem: { select: { id: true, sku: true, name: true, uom: true, isActive: true } } },
  });

  const planned = Number(order.plannedQuantity);
  const pos = positionOf(order.entries);

  res.json({
    data: {
      id: order.id, orderNumber: order.orderNumber, orderDate: isoDay(order.orderDate),
      finishedItem: {
        id: order.finishedItem.id, sku: order.finishedItem.sku,
        name: order.finishedItem.name, uom: order.finishedItem.uom,
      },
      branch: order.branch,
      plannedQuantity: planned,
      status: order.status,
      notes: order.notes,
      ...pos,
      unitCostSoFar: pos.receivedQuantity > 0 ? round4(pos.absorbed / pos.receivedQuantity) : null,
      suggestedIssue: bom.map((b) => ({
        itemId: b.componentItem.id,
        sku: b.componentItem.sku,
        name: b.componentItem.name,
        uom: b.componentItem.uom,
        isActive: b.componentItem.isActive,
        qtyPerUnit: Number(b.qtyPerUnit),
        quantity: round4(Number(b.qtyPerUnit) * planned),
      })).sort((a, b) => a.sku.localeCompare(b.sku)),
      entries: order.entries.map((e) => ({
        id: e.id, entryType: e.entryType, entryDate: isoDay(e.entryDate),
        totalValue: Number(e.totalValue), narration: e.narration,
        journalEntryId: e.journalEntryId,
        lines: e.lines.map((l) => ({
          id: l.id,
          item: l.item, account: l.account,
          quantity: l.quantity === null ? null : Number(l.quantity),
          unitCost: l.unitCost === null ? null : Number(l.unitCost),
          lineValue: Number(l.lineValue),
        })),
      })),
    },
  });
});

// POST /production-orders   { branchId, orderDate, finishedItemId, plannedQuantity, notes? }
router.post("/", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const { branchId, finishedItemId, notes } = req.body ?? {};
  const orderDate = dayOrNull(req.body?.orderDate);
  const plannedQuantity = Number(req.body?.plannedQuantity);

  if (!orderDate) return res.status(400).json({ message: "orderDate is required, as YYYY-MM-DD." });
  if (!Number.isFinite(plannedQuantity) || plannedQuantity <= 0) {
    return res.status(400).json({ message: "Planned quantity must be more than zero." });
  }
  if (typeof branchId !== "string" || !branchId) return res.status(400).json({ message: "Pick a branch." });
  if (typeof finishedItemId !== "string" || !finishedItemId) return res.status(400).json({ message: "Pick what is being made." });

  if (!(await wipAccountOr400(organizationId, res))) return;

  const [branch, item] = await Promise.all([
    prisma.branch.findFirst({ where: { id: branchId, organizationId, deletedAt: null }, select: { id: true } }),
    prisma.item.findFirst({
      where: { id: finishedItemId, organizationId, deletedAt: null },
      select: { id: true, sku: true, itemKind: true, isActive: true },
    }),
  ]);
  if (!branch) return res.status(400).json({ message: "That branch is not in this organisation." });
  if (!item) return res.status(400).json({ message: "That item is not in this organisation." });
  if (item.itemKind !== "STOCK") {
    return res.status(400).json({ message: `${item.sku} is a service item — only a stock item can be manufactured.` });
  }
  if (!item.isActive) return res.status(400).json({ message: `${item.sku} is inactive.` });

  const count = await prisma.productionOrder.count({ where: { organizationId } });
  const orderNumber = `PO-${String(count + 1).padStart(4, "0")}`;

  const created = await prisma.productionOrder.create({
    data: {
      organizationId, branchId, orderDate,
      finishedItemId, plannedQuantity, orderNumber,
      notes: typeof notes === "string" && notes.trim() ? notes.trim().slice(0, 255) : null,
      createdBy: req.user!.userId,
    },
    select: { id: true, orderNumber: true },
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "CREATE", entityType: "production_order", entityId: created.id,
    summary: `${created.orderNumber} — ${plannedQuantity} × ${item.sku}`,
  });

  res.status(201).json({ data: created });
});

// Guard shared by every posting: the order must exist, be open, and the
// posting must not predate it.
async function openOrderOr400(
  organizationId: string, id: string, entryDate: Date | null,
  res: import("express").Response,
) {
  if (!entryDate) {
    res.status(400).json({ message: "entryDate is required, as YYYY-MM-DD." });
    return null;
  }
  const order = await loadOrder(organizationId, id);
  if (!order) {
    res.status(404).json({ message: "Production order not found." });
    return null;
  }
  if (order.status !== "OPEN") {
    res.status(409).json({ message: `${order.orderNumber} is ${order.status.toLowerCase()} — nothing more can be posted to it.` });
    return null;
  }
  if (entryDate < order.orderDate) {
    res.status(400).json({ message: `Material cannot be consumed by a job that had not started. ${order.orderNumber} opened on ${isoDay(order.orderDate)}.` });
    return null;
  }
  return order;
}

// POST /production-orders/:id/issue   { entryDate, lines: [{ itemId, quantity }], narration? }
//
//   Dr 1302 Work in Progress          total
//   Cr each component''s stock account, tagged to that item''s own card
router.post("/:id/issue", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const wip = await wipAccountOr400(organizationId, res);
  if (!wip) return;

  const entryDate = dayOrNull(req.body?.entryDate);
  const order = await openOrderOr400(organizationId, req.params.id, entryDate, res);
  if (!order) return;

  const raw = Array.isArray(req.body?.lines) ? req.body.lines : null;
  if (!raw || raw.length === 0) return res.status(400).json({ message: "Add at least one component to issue." });

  const parsed: { itemId: string; quantity: number }[] = [];
  const seen = new Set<string>();
  for (const l of raw as { itemId?: unknown; quantity?: unknown }[]) {
    const itemId = typeof l?.itemId === "string" ? l.itemId : "";
    const quantity = Number(l?.quantity);
    if (!itemId) return res.status(400).json({ message: "Every line needs a component." });
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ message: "Every quantity must be more than zero." });
    }
    if (seen.has(itemId)) return res.status(400).json({ message: "The same component is issued twice on one entry." });
    seen.add(itemId);
    parsed.push({ itemId, quantity });
  }

  const items = await prisma.item.findMany({
    where: { id: { in: parsed.map((l) => l.itemId) }, organizationId, deletedAt: null },
    select: { id: true, sku: true, name: true, itemKind: true, stockAccountId: true, businessPartnerId: true },
  });
  type Comp = { id: string; sku: string; name: string; itemKind: string; stockAccountId: string; businessPartnerId: string };
  const byId = new Map<string, Comp>((items as Comp[]).map((x) => [x.id, x]));
  for (const l of parsed) {
    const it = byId.get(l.itemId);
    if (!it) return res.status(400).json({ message: "A component is not an item in this organisation." });
    if (it.itemKind !== "STOCK") {
      return res.status(400).json({ message: `${it.sku} is a service item — it has no stock to consume. Labour and overhead go on the order as cost, not as an issue.` });
    }
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId }, select: { costingMethod: true },
  });
  const costingMethod = org?.costingMethod ?? "WEIGHTED_AVG";

  try {
    const result = await prisma.$transaction(async (tx) => {
      const journalEntry = await tx.journalEntry.create({
        data: {
          organizationId, branchId: order.branchId, entryDate: entryDate!,
          narration: `Material issued to ${order.orderNumber}`.slice(0, 255),
          voucherType: "JV",
          referenceType: "production_issue",
          createdBy: req.user!.userId,
        },
      });

      const entry = await tx.productionEntry.create({
        data: {
          productionOrderId: order.id, entryType: "ISSUE", entryDate: entryDate!,
          totalValue: 0, journalEntryId: journalEntry.id,
          narration: typeof req.body?.narration === "string" ? req.body.narration.slice(0, 255) : null,
          createdBy: req.user!.userId,
        },
      });

      let total = 0;
      const credits: { accountId: string; businessPartnerId: string; amount: number; narration: string }[] = [];

      for (const l of parsed) {
        const it = byId.get(l.itemId)!;
        // consumeStock enforces available quantity, walks the FIFO lots or
        // applies the weighted average, and returns what was ACTUALLY
        // consumed. That return value is the whole point — it is what makes
        // the finished good''s cost derived rather than typed.
        const { unitCost, totalCost } = await consumeStock(tx, {
          organizationId, branchId: order.branchId, itemId: l.itemId,
          quantity: l.quantity, costingMethod,
          movementType: "PRODUCTION_OUT",
          referenceType: "production_issue", referenceId: entry.id,
          movementDate: entryDate!,
          narration: `Issued to ${order.orderNumber}`,
        });

        total = round2(total + totalCost);
        credits.push({
          accountId: it.stockAccountId, businessPartnerId: it.businessPartnerId,
          amount: round2(totalCost), narration: `${it.sku} — ${it.name}`.slice(0, 255),
        });

        await tx.productionEntryLine.create({
          data: {
            productionEntryId: entry.id, itemId: l.itemId,
            quantity: l.quantity, unitCost: round4(unitCost), lineValue: round2(totalCost),
          },
        });
      }

      await tx.journalLine.createMany({
        data: [
          {
            journalEntryId: journalEntry.id, accountId: wip.id,
            businessPartnerId: null, debit: total, credit: 0,
            narration: `Material issued to ${order.orderNumber}`.slice(0, 255),
          },
          ...credits.map((c) => ({
            journalEntryId: journalEntry.id, accountId: c.accountId,
            businessPartnerId: c.businessPartnerId, debit: 0, credit: c.amount,
            narration: c.narration,
          })),
        ],
      });

      await tx.productionEntry.update({ where: { id: entry.id }, data: { totalValue: total } });
      return { entryId: entry.id, total };
    });

    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "CREATE", entityType: "production_issue", entityId: order.id,
      summary: `${order.orderNumber} — issued ${parsed.length} component${parsed.length === 1 ? "" : "s"}, ${result.total.toFixed(2)}`,
    });

    res.json({ data: result });
  } catch (err: unknown) {
    if (err instanceof InsufficientStockError) {
      return res.status(400).json({ message: err.message });
    }
    console.error("production issue failed", err);
    return res.status(500).json({ message: "Could not post the issue. Nothing was written." });
  }
});

'

Write-Host ''
Write-Host 'Part 1 done — now run P2b.ps1.' -ForegroundColor Green