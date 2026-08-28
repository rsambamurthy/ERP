import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { receiveStock } from "../lib/costing";
import { upload } from "../lib/upload";
import { buildTemplateWorkbook, loadUploadedWorksheet, cellText } from "../lib/xlsxTemplate";

// Posts an opening stock balance to the ledger.
//
// Dr the item's stock account on its own sub-ledger card, exactly as a Stock
// Adjustment IN would. Cr Opening Balance Equity - NOT an income or expense
// head: stock the business already owned on the day it started using this
// system is not a gain it made here. Crediting 4002 would have reported every
// rupee of opening stock as first-year profit.
//
// See migration_050. Once every opening balance is loaded, 3003 holds the
// opening net worth and is journalled into Reserves & Surplus, leaving nil.
// A non-zero 3003 after go-live means the load is unfinished.
const OPENING_BALANCE_EQUITY_CODE = "3003";

async function postOpeningStock(tx: any, a: {
  organizationId: string; branchId: string | null; accountId: string; cardId: string;
  sku: string; quantity: number; unitCost: number; when: Date; userId: string;
}) {
  const equity = await tx.account.findFirst({
    where: { organizationId: a.organizationId, accountCode: OPENING_BALANCE_EQUITY_CODE },
  });
  if (!equity) {
    throw Object.assign(new Error(
      `Account ${OPENING_BALANCE_EQUITY_CODE} Opening Balance Equity is missing, so an opening ` +
      `stock balance cannot be posted. Re-run provisioning for this organisation - it is ` +
      `idempotent - and try again.`), { status: 409 });
  }
  const entry = await tx.journalEntry.create({
    data: {
      organizationId: a.organizationId, branchId: a.branchId, entryDate: a.when,
      narration: `Opening stock \u2014 ${a.sku}`,
      // referenceType only: journal_entries has no referenceId column, and the
      // documents that need the link store journalEntryId on their own row.
      // Item has no such column, so the trail is the referenceType plus the SKU
      // in the narration - enough to find the entry, not to navigate to it.
      voucherType: "JV", referenceType: "item_opening_balance",
      createdBy: a.userId,
    },
  });
  const value = Math.round(a.quantity * a.unitCost * 100) / 100;
  await tx.journalLine.createMany({
    data: [
      { journalEntryId: entry.id, accountId: a.accountId, businessPartnerId: a.cardId,
        debit: value, credit: 0, narration: `Opening stock ${a.quantity} x ${a.unitCost}` },
      { journalEntryId: entry.id, accountId: equity.id, businessPartnerId: null,
        debit: 0, credit: value, narration: `Opening stock \u2014 ${a.sku}` },
    ],
  });
}

const router = Router();
router.use(authenticate, requireActiveSubscription);

// Same gate as Chart of Accounts — Items are master data, structurally the
// same kind of decision (what account does this post to) as an Account
// itself.
const canManageItems = requirePermission("items.manage");

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

// GET /items/costing-method — null until the org has chosen one.
router.get("/costing-method", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true } });
  res.json({ data: { costingMethod: org?.costingMethod ?? null } });
});

// POST /items/costing-method — { costingMethod: "WEIGHTED_AVG" | "FIFO" }.
// Succeeds exactly once per org: every ItemStock/StockLot row that follows
// is computed under this rule, so there's no well-defined way to migrate
// an org's existing stock history from one method to the other later.
router.post("/costing-method", canManageItems, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const { costingMethod } = req.body ?? {};
  if (!["WEIGHTED_AVG", "FIFO"].includes(costingMethod)) {
    return res.status(400).json({ message: "costingMethod must be WEIGHTED_AVG or FIFO." });
  }

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true } });
  if (org?.costingMethod) {
    return res.status(409).json({ message: `Costing method is already set to ${org.costingMethod} and cannot be changed.` });
  }

  await prisma.organization.update({ where: { id: organizationId }, data: { costingMethod } });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "organization", entityId: organizationId,
    summary: `Set stock costing method to ${costingMethod} (permanent)`,
  });
  res.json({ data: { costingMethod } });
});

// GET /items — full item master for the org.
router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const items = await prisma.item.findMany({
    where: { organizationId, deletedAt: null },
    include: {
      stockAccount: { select: { id: true, accountCode: true, accountName: true } },
      defaultAssetClass: { select: { id: true, name: true } },
      itemStocks: true,
    },
    orderBy: { name: "asc" },
  });
  res.json({
    data: items.map((i) => ({
      id: i.id, sku: i.sku, name: i.name, description: i.description, uom: i.uom, hsnCode: i.hsnCode,
      itemKind: i.itemKind,
      isFinishedGood: i.isFinishedGood, isActive: i.isActive,
      stockAccount: i.stockAccount,
      // Present means this item always becomes a fixed asset — the Purchase
      // Bill line arrives capitalised against this class.
      defaultAssetClass: i.defaultAssetClass,
      salesRate: i.salesRate, purchaseRate: i.purchaseRate, taxRate: i.taxRate,
      defaultDiscountPct: i.defaultDiscountPct,
      totalQuantityOnHand: i.itemStocks.reduce((s, st) => s + Number(st.quantityOnHand), 0),
    })),
  });
});

// GET /items/stock-accounts — the org's control accounts eligible as an
// item's stockAccountId (isControlAccount + defaultBpType = ITEM), for the
// create-item form's dropdown. Whatever the org's selected domain(s)
// seeded — Inventory (Trading), Raw Materials / Finished Goods
// (Manufacturing), or a custom one.
router.get("/stock-accounts", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const accounts = await prisma.account.findMany({
    where: { organizationId, deletedAt: null, isControlAccount: true, defaultBpType: "ITEM" },
    orderBy: { accountCode: "asc" },
  });
  res.json({ data: accounts });
});

// GET /items/expense-accounts — candidate accounts for a SERVICE item.
// Any active EXPENSE account, not the isControlAccount/defaultBpType=ITEM
// set that stock items draw from: an expense head has no sub-ledger and
// nothing posts a per-partner balance against it.
router.get("/expense-accounts", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const accounts = await prisma.account.findMany({
    where: { organizationId, deletedAt: null, accountType: "EXPENSE", isGroup: false, isActive: true },
    orderBy: { accountCode: "asc" },
  });
  res.json({ data: accounts });
});

// GET /items/:id — one item, same shape as a row from GET / above so the
// detail page and the list agree on field names.
//
// Declared after /costing-method and /stock-accounts deliberately: Express
// matches in order and "/:id" is a single path segment, so it would
// otherwise swallow both of those. Same shadowing trap as
// business-partners' /lookup route.
router.get("/:id", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const item = await prisma.item.findFirst({
    where: { id: req.params.id, organizationId, deletedAt: null },
    include: { stockAccount: { select: { id: true, accountCode: true, accountName: true } }, itemStocks: true },
  });
  if (!item) return res.status(404).json({ message: "Item not found." });
  res.json({
    data: {
      id: item.id, sku: item.sku, name: item.name, description: item.description, uom: item.uom,
      hsnCode: item.hsnCode, itemKind: item.itemKind,
      isFinishedGood: item.isFinishedGood, isActive: item.isActive,
      stockAccount: item.stockAccount,
      salesRate: item.salesRate, purchaseRate: item.purchaseRate, taxRate: item.taxRate,
      defaultDiscountPct: item.defaultDiscountPct,
      totalQuantityOnHand: item.itemStocks.reduce((s, st) => s + Number(st.quantityOnHand), 0),
    },
  });
});

// ── Bill of materials ────────────────────────────────────────────────
//
// What a finished item is made of: a component and a quantity per unit. A
// recipe, not an event — it moves nothing and posts nothing. Its only job is
// to be exploded when a production order is opened, so the components arrive
// on the issue already listed and the user corrects them against what was
// actually taken to the shop floor.
//
// bom_lines has existed since the original schema and until now nothing read
// or wrote it. migration_041 gave it the unique index and the positive
// quantity check it needed before anything could.

// The deepest a bill of materials may nest. A sub-assembly made of
// sub-assemblies is normal; a hundred levels of them is a mistake, and a
// bound means the cycle check below can never run away even if the data is
// worse than the checks allow.
const MAX_BOM_DEPTH = 20;

// True when `target` appears anywhere beneath `startId` in the existing
// bill-of-materials graph. Used to refuse a component that would make the
// finished item its own ancestor: A made of B, B made of A, and a production
// order that explodes for ever.
async function bomReaches(organizationId: string, startId: string, target: string): Promise<boolean> {
  let frontier = [startId];
  const seen = new Set<string>([startId]);
  for (let depth = 0; depth < MAX_BOM_DEPTH && frontier.length > 0; depth++) {
    const lines = await prisma.bomLine.findMany({
      where: { organizationId, finishedItemId: { in: frontier } },
      select: { componentItemId: true },
    });
    const next: string[] = [];
    for (const l of lines) {
      if (l.componentItemId === target) return true;
      if (!seen.has(l.componentItemId)) { seen.add(l.componentItemId); next.push(l.componentItemId); }
    }
    frontier = next;
  }
  return false;
}

// GET /items/:id/bom — the components, with what they cost today.
//
// The costs are indicative, not a valuation. They are read from the item's
// current weighted average (or the average of its remaining FIFO lots), so
// they answer "roughly what does one of these cost to make". What a
// production order actually charges is whatever consumeStock returns at the
// moment the material is issued, which is a different number on a different
// day. Saying so on the screen matters more than the figure itself.
router.get("/:id/bom", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const item = await prisma.item.findFirst({
    where: { id: req.params.id, organizationId, deletedAt: null },
    select: { id: true, sku: true, name: true, uom: true, isFinishedGood: true },
  });
  if (!item) return res.status(404).json({ message: "Item not found." });

  const lines = await prisma.bomLine.findMany({
    where: { organizationId, finishedItemId: item.id },
    include: {
      componentItem: {
        select: {
          id: true, sku: true, name: true, uom: true, isActive: true, itemKind: true,
          itemStocks: { select: { quantityOnHand: true, averageCost: true } },
        },
      },
    },
  });

  const rows = lines.map((l) => {
    const stocks = l.componentItem.itemStocks;
    const qty = stocks.reduce((s, x) => s + Number(x.quantityOnHand), 0);
    const value = stocks.reduce((s, x) => s + Number(x.quantityOnHand) * Number(x.averageCost), 0);
    // Weighted across branches. Zero when nothing is on hand anywhere, which
    // is honest — an unpriced component has no cost to show yet.
    const unitCost = qty > 0 ? Math.round((value / qty) * 10000) / 10000 : 0;
    const qtyPerUnit = Number(l.qtyPerUnit);
    return {
      id: l.id,
      component: {
        id: l.componentItem.id, sku: l.componentItem.sku, name: l.componentItem.name,
        uom: l.componentItem.uom, isActive: l.componentItem.isActive,
      },
      qtyPerUnit,
      unitCost,
      lineCost: Math.round(qtyPerUnit * unitCost * 100) / 100,
      quantityOnHand: qty,
    };
  }).sort((a, b) => a.component.sku.localeCompare(b.component.sku));

  res.json({
    data: {
      item: { id: item.id, sku: item.sku, name: item.name, uom: item.uom, isFinishedGood: item.isFinishedGood },
      lines: rows,
      materialCostPerUnit: Math.round(rows.reduce((s, r) => s + r.lineCost, 0) * 100) / 100,
      // True when at least one component has never been priced, so the total
      // above understates. Shown rather than hidden.
      incomplete: rows.some((r) => r.unitCost === 0),
    },
  });
});

// PUT /items/:id/bom — replace the whole bill of materials.
//
// Replace rather than add/edit/delete per line: a recipe is one thing, and
// editing it line by line invites a half-saved state where the components no
// longer make the product. The screen sends what the recipe now is.
//
// Nothing here is versioned. A production order explodes the BOM as it stands
// when the order is opened and then keeps its own component lines, so editing
// the recipe afterwards never reaches back into an order already running —
// the same snapshot rule the fixed asset register uses.
router.put("/:id/bom", canManageItems, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const item = await prisma.item.findFirst({
    where: { id: req.params.id, organizationId, deletedAt: null },
    select: { id: true, sku: true, name: true, itemKind: true },
  });
  if (!item) return res.status(404).json({ message: "Item not found." });
  if (item.itemKind !== "STOCK") {
    return res.status(400).json({ message: `${item.sku} is a service item — only a stock item can be manufactured.` });
  }

  const raw: unknown = req.body?.lines;
  if (!Array.isArray(raw)) {
    return res.status(400).json({ message: "lines is required — send an empty array to clear the bill of materials." });
  }

  const parsed: { componentItemId: string; qtyPerUnit: number }[] = [];
  const seen = new Set<string>();
  for (const entry of raw as { componentItemId?: unknown; qtyPerUnit?: unknown }[]) {
    const componentItemId = typeof entry?.componentItemId === "string" ? entry.componentItemId : "";
    const qtyPerUnit = Number(entry?.qtyPerUnit);
    if (!componentItemId) return res.status(400).json({ message: "Every line needs a component." });
    if (!Number.isFinite(qtyPerUnit) || qtyPerUnit <= 0) {
      return res.status(400).json({ message: "Quantity per unit must be more than zero." });
    }
    if (componentItemId === item.id) {
      return res.status(400).json({ message: `${item.sku} cannot be a component of itself.` });
    }
    // The database refuses this too. Catching it here turns a constraint
    // violation into a sentence.
    if (seen.has(componentItemId)) {
      return res.status(400).json({ message: "The same component is listed twice." });
    }
    seen.add(componentItemId);
    parsed.push({ componentItemId, qtyPerUnit });
  }

  if (parsed.length > 0) {
    const components = await prisma.item.findMany({
      where: { id: { in: parsed.map((l) => l.componentItemId) }, organizationId, deletedAt: null },
      select: { id: true, sku: true, itemKind: true, isActive: true },
    });
    // Typed explicitly rather than inferred: the inference collapses to `{}`
    // when the generated Prisma client is stale, which turns every field
    // access below into an error that has nothing to do with this code.
    type Comp = { id: string; sku: string; itemKind: string; isActive: boolean };
    const byId = new Map<string, Comp>((components as Comp[]).map((x) => [x.id, x]));
    for (const l of parsed) {
      const comp = byId.get(l.componentItemId);
      if (!comp) return res.status(400).json({ message: "A component is not an item in this organisation." });
      if (comp.itemKind !== "STOCK") {
        return res.status(400).json({ message: `${comp.sku} is a service item — it has no stock to consume. Labour and overhead go on the production order as cost, not here.` });
      }
      if (!comp.isActive) {
        return res.status(400).json({ message: `${comp.sku} is inactive and cannot be a component.` });
      }
    }

    // A cycle would make a production order explode for ever. Checked against
    // the graph as it stands, with this item's own lines about to be replaced
    // — so a component that reaches back to this item is refused whether the
    // path is one hop or five.
    for (const l of parsed) {
      if (await bomReaches(organizationId, l.componentItemId, item.id)) {
        const comp = byId.get(l.componentItemId)!;
        return res.status(400).json({
          message: `${comp.sku} is made from ${item.sku}, directly or through another sub-assembly. Adding it here would make each the ingredient of the other.`,
        });
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.bomLine.deleteMany({ where: { organizationId, finishedItemId: item.id } });
    if (parsed.length > 0) {
      await tx.bomLine.createMany({
        data: parsed.map((l) => ({
          organizationId, finishedItemId: item.id,
          componentItemId: l.componentItemId, qtyPerUnit: l.qtyPerUnit,
        })),
      });
    }
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "bill_of_materials", entityId: item.id,
    summary: parsed.length === 0
      ? `Cleared the bill of materials for ${item.sku}`
      : `Bill of materials for ${item.sku} — ${parsed.length} component${parsed.length === 1 ? "" : "s"}`,
  });

  res.json({ data: { lines: parsed.length } });
});

// PATCH /items/:id/toggle — activate/deactivate. Deactivating keeps every
// stock movement and journal line intact; it only takes the item out of the
// pickers on new documents. Use this rather than DELETE for an item that
// has history — DELETE refuses one with stock movements anyway.
//
// The paired ITEM business partner (see POST / below) is flipped to match.
// It's internal plumbing — the sub-ledger tag on stock account lines — and
// leaving the two out of step would make the Business Partners screen show
// an active partner for a retired item.
router.patch("/:id/toggle", canManageItems, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const item = await prisma.item.findFirst({ where: { id: req.params.id, organizationId, deletedAt: null } });
  if (!item) return res.status(404).json({ message: "Item not found." });

  const isActive = !item.isActive;
  const [updated] = await prisma.$transaction([
    prisma.item.update({ where: { id: item.id }, data: { isActive } }),
    prisma.businessPartner.update({ where: { id: item.businessPartnerId }, data: { isActive } }),
  ]);
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "TOGGLE", entityType: "item", entityId: item.id,
    summary: `${isActive ? "Activated" : "Deactivated"} item ${item.sku} — ${item.name}`,
  });
  res.json({ data: updated });
});

// POST /items — create an item, its paired ITEM business partner, and (if
// an opening balance was given) the opening stock movement. All three or
// none — one transaction.
// Returns the class id to store (or null), or `false` when it has already
// answered the request with a 400. Shared by POST and PATCH so the two can
// never disagree about what a capital item is.
async function resolveAssetClass(
  organizationId: string,
  kind: string,
  value: unknown,
  res: import("express").Response,
): Promise<string | null | false> {
  if (value === undefined || value === null || value === "") return null;
  if (kind !== "SERVICE") {
    res.status(400).json({ message: "Only a non-stock item can be a capital asset — a stock item's purchase already moves inventory." });
    return false;
  }
  const cls = await prisma.assetClass.findFirst({
    where: { id: String(value), organizationId, isActive: true },
    select: { id: true },
  });
  if (!cls) {
    res.status(400).json({ message: "That asset class doesn't belong to this organization, or is no longer active." });
    return false;
  }
  return cls.id;
}

router.post("/", canManageItems, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const {
    sku, name, description, uom, hsnCode, isFinishedGood, itemKind,
    stockAccountId, salesRate, purchaseRate, taxRate, defaultDiscountPct,
    openingQuantity, openingCost, openingBranchId, openingDate,
    defaultAssetClassId,
  } = req.body ?? {};

  const kind = itemKind === "SERVICE" ? "SERVICE" : "STOCK";

  if (!sku || !name || !stockAccountId) {
    return res.status(400).json({ message: "sku, name, and stockAccountId are required." });
  }

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true } });
  if (!org?.costingMethod) {
    return res.status(422).json({ message: "Set the organization's stock costing method before adding items." });
  }

  // stockAccountId means different things per kind — a stock control
  // account for STOCK, the expense head to debit for SERVICE. See the
  // column comment in schema.prisma for why the field wasn't renamed.
  const account = kind === "SERVICE"
    ? await prisma.account.findFirst({
        where: { id: stockAccountId, organizationId, deletedAt: null, accountType: "EXPENSE", isGroup: false },
      })
    : await prisma.account.findFirst({
        where: { id: stockAccountId, organizationId, isControlAccount: true, defaultBpType: "ITEM" },
      });
  if (!account) {
    return res.status(400).json({
      message: kind === "SERVICE"
        ? "For a service item, stockAccountId must be one of this org's expense accounts."
        : "stockAccountId must be one of this org's item control accounts.",
    });
  }

  // A capital item — one that always becomes a fixed asset rather than an
  // expense. Only a SERVICE item can be one, because a STOCK item's purchase
  // already moves inventory and capitalising it would record the same
  // purchase twice. items_asset_class_kind_ck says the same thing at the
  // database; this is where it becomes a sentence rather than a 23514.
  const assetClassId = await resolveAssetClass(organizationId, kind, defaultAssetClassId, res);
  if (assetClassId === false) return;

  const existing = await prisma.item.findUnique({ where: { organizationId_sku: { organizationId, sku } } });
  if (existing) return res.status(409).json({ message: `Item code ${sku} already exists.` });

  // A service has no stock, so an opening balance is meaningless rather
  // than merely unused — reject it instead of silently dropping the number
  // someone typed.
  if (kind === "SERVICE" && Number(openingQuantity ?? 0) > 0) {
    return res.status(400).json({ message: "A service item cannot have an opening quantity." });
  }

  const qty = kind === "SERVICE" ? 0 : Number(openingQuantity ?? 0);
  const cost = kind === "SERVICE" ? 0 : Number(openingCost ?? 0);
  let resolvedOpeningBranchId: string | null = openingBranchId ?? null;
  if (qty > 0) {
    if (!resolvedOpeningBranchId) {
      const ho = await prisma.branch.findFirst({ where: { organizationId, isHeadOffice: true } });
      resolvedOpeningBranchId = ho?.id ?? null;
    }
    if (!resolvedOpeningBranchId) return res.status(400).json({ message: "No branch found — provide openingBranchId." });
    if (cost <= 0) return res.status(400).json({ message: "openingCost must be greater than 0 when openingQuantity is set." });
  }

  const item = await prisma.$transaction(async (tx) => {
    const bp = await tx.businessPartner.create({
      data: { organizationId, bpType: "ITEM", name },
    });
    const created = await tx.item.create({
      data: {
        organizationId, sku, name,
        description: description ?? null,
        uom: uom || "EA",
        hsnCode: hsnCode ?? null,
        isFinishedGood: kind === "SERVICE" ? false : !!isFinishedGood,
        itemKind: kind,
        stockAccountId,
        defaultAssetClassId: assetClassId,
        businessPartnerId: bp.id,
        salesRate: salesRate ?? null,
        purchaseRate: purchaseRate ?? null,
        taxRate: taxRate ?? 0,
        defaultDiscountPct: defaultDiscountPct ?? 0,
        openingQuantity: qty,
        openingCost: cost,
      },
    });
    await tx.businessPartner.update({ where: { id: bp.id }, data: { refId: created.id } });

    if (qty > 0) {
      const when = openingDate ? new Date(openingDate) : new Date();
      await receiveStock(tx, {
        organizationId, branchId: resolvedOpeningBranchId!, itemId: created.id,
        quantity: qty, unitCost: cost, costingMethod: org.costingMethod!,
        movementType: "ADJUSTMENT_IN", referenceType: "item_opening_balance", referenceId: created.id,
        movementDate: when,
        narration: "Opening stock",
      });

      // AND POST IT. This moved stock and wrote nothing to the ledger, so the
      // valuation report and the accounts disagreed by the whole opening value
      // from the moment the item was created - and nothing said so.
      // Reconciling stock to 1201 is the control that catches a costing error,
      // and it cannot work while one side is fed through a door the other side
      // does not know about.
      await postOpeningStock(tx, {
        organizationId, branchId: resolvedOpeningBranchId, accountId: stockAccountId,
        cardId: bp.id, sku: created.sku, quantity: qty, unitCost: cost,
        when, userId: req.user!.userId,
      });
    }

    return created;
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "CREATE", entityType: "item", entityId: item.id,
    summary: `Created item ${item.sku} — ${item.name}`,
  });
  res.status(201).json({ data: item });
});

// PATCH /items/:id — everything except sku, stockAccountId, and the
// opening figures, same "structural fields locked after creation"
// convention as system Accounts.
router.patch("/:id", canManageItems, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const item = await prisma.item.findFirst({ where: { id: req.params.id, organizationId } });
  if (!item) return res.status(404).json({ message: "Item not found." });

  const { name, description, uom, hsnCode, isFinishedGood, salesRate, purchaseRate, taxRate, defaultDiscountPct, isActive, defaultAssetClassId } = req.body ?? {};

  // Unlike stockAccountId this one is editable after creation: it changes
  // what FUTURE bills do and never touches an asset already capitalised,
  // because every asset copies its accounts and life at capitalisation.
  // Sending null clears it, which is how an item stops being capital.
  let assetClassPatch: { defaultAssetClassId?: string | null } = {};
  if (defaultAssetClassId !== undefined) {
    const resolved = await resolveAssetClass(organizationId, item.itemKind, defaultAssetClassId, res);
    if (resolved === false) return;
    assetClassPatch = { defaultAssetClassId: resolved };
  }

  const updated = await prisma.item.update({
    where: { id: item.id },
    data: { name, description, uom, hsnCode, isFinishedGood, salesRate, purchaseRate, taxRate, defaultDiscountPct, isActive, ...assetClassPatch },
  });

  if (name && name !== item.name) {
    await prisma.businessPartner.update({ where: { id: item.businessPartnerId }, data: { name } });
  }

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "item", entityId: item.id,
    summary: `Updated item ${item.sku} — ${item.name}`,
  });
  res.json({ data: updated });
});

// DELETE /items/:id — only if it's never been touched by a stock movement.
router.delete("/:id", canManageItems, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const item = await prisma.item.findFirst({ where: { id: req.params.id, organizationId } });
  if (!item) return res.status(404).json({ message: "Item not found." });

  const used = await prisma.stockMovement.findFirst({ where: { itemId: item.id } });
  if (used) return res.status(409).json({ message: "This item has stock movements and cannot be deleted." });

  await prisma.$transaction([
    prisma.item.update({ where: { id: item.id }, data: { deletedAt: new Date() } }),
    prisma.businessPartner.update({ where: { id: item.businessPartnerId }, data: { deletedAt: new Date(), isActive: false } }),
  ]);
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "DELETE", entityType: "item", entityId: item.id,
    summary: `Deleted item ${item.sku} — ${item.name}`,
  });
  res.json({ data: { deleted: true } });
});

// ── Bulk upload (Template Download + Bulk Upload) ─────────────────────────
// Matches an uploaded row to an existing item by SKU. Opening Qty/Cost and
// Stock Account only ever apply when creating a new item — same
// "structural fields locked after creation" rule as PATCH /items/:id — so
// an update row silently ignores those three columns rather than erroring.

const ITEM_COLUMNS = [
  { header: "SKU *", hint: "← required", width: 14 },
  { header: "Name *", hint: "← required", width: 30 },
  { header: "Description", hint: "optional", width: 30 },
  { header: "UOM", hint: "default EA", width: 10 },
  { header: "HSN Code", hint: "optional", width: 12 },
  { header: "Stock Account Code *", hint: "← required for new items only", width: 18 },
  { header: "Sales Rate", hint: "optional, number", width: 14, numFmt: "#,##0.00" },
  { header: "Purchase Rate", hint: "optional, number", width: 14, numFmt: "#,##0.00" },
  { header: "Tax %", hint: "default 0", width: 9, numFmt: "0.00" },
  { header: "Opening Qty", hint: "new items only", width: 14, numFmt: "0.0000" },
  { header: "Opening Cost", hint: "required if Opening Qty > 0", width: 14, numFmt: "#,##0.00" },
];

interface ItemPreviewRow {
  rowNum: number;
  sku: string;
  name: string;
  description: string | null;
  uom: string;
  hsnCode: string | null;
  stockAccountCode: string | null;
  salesRate: number | null;
  purchaseRate: number | null;
  taxRate: number;
  openingQuantity: number;
  openingCost: number;
  status: "create" | "update" | "error";
  error?: string;
}

router.get("/bulk-upload/template", canManageItems, async (req, res) => {
  const buffer = await buildTemplateWorkbook("Items", ITEM_COLUMNS);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="SmartERP_Items_Template.xlsx"');
  res.send(buffer);
});

router.post("/bulk-upload/preview", canManageItems, upload.single("file"), async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  if (!req.file) return res.status(400).json({ message: "No file uploaded." });

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true } });

  const ws = await loadUploadedWorksheet(req.file.buffer);
  if (!ws) return res.json({ data: [] });

  const [existingItems, stockAccounts] = await Promise.all([
    prisma.item.findMany({ where: { organizationId, deletedAt: null }, select: { sku: true } }),
    prisma.account.findMany({
      where: { organizationId, deletedAt: null, isControlAccount: true, defaultBpType: "ITEM" },
      select: { id: true, accountCode: true },
    }),
  ]);
  const skuSet = new Set(existingItems.map((i) => i.sku.trim()));
  const accountByCode = new Map(stockAccounts.map((a) => [a.accountCode.trim(), a]));

  const preview: ItemPreviewRow[] = [];

  ws.eachRow((row, rowNum) => {
    if (rowNum <= 2) return;
    const sku = cellText(row, 1);
    const name = cellText(row, 2);
    if (!sku && !name) return;

    const push = (status: ItemPreviewRow["status"], error?: string) =>
      preview.push({
        rowNum, sku: sku ?? "", name: name ?? "",
        description: cellText(row, 3), uom: cellText(row, 4) || "EA", hsnCode: cellText(row, 5),
        stockAccountCode: cellText(row, 6),
        salesRate: null, purchaseRate: null, taxRate: 0, openingQuantity: 0, openingCost: 0,
        status, error,
      });

    if (!sku) return push("error", "SKU is required");
    if (!name) return push("error", "Name is required");

    const isUpdate = skuSet.has(sku);
    const stockAccountCode = cellText(row, 6);

    if (!isUpdate) {
      if (!org?.costingMethod) return push("error", "Set the org's stock costing method before adding items.");
      if (!stockAccountCode) return push("error", "Stock Account Code is required for a new item");
      if (!accountByCode.has(stockAccountCode)) return push("error", `Stock Account Code "${stockAccountCode}" is not one of this org's item control accounts`);
    }

    const salesRaw = row.getCell(7).value;
    const purchaseRaw = row.getCell(8).value;
    const taxRaw = row.getCell(9).value;
    const qtyRaw = row.getCell(10).value;
    const costRaw = row.getCell(11).value;

    const salesRate = salesRaw != null && salesRaw !== "" ? Number(salesRaw) : null;
    const purchaseRate = purchaseRaw != null && purchaseRaw !== "" ? Number(purchaseRaw) : null;
    const taxRate = taxRaw != null && taxRaw !== "" ? Number(taxRaw) : 0;
    const qty = qtyRaw != null && qtyRaw !== "" ? Number(qtyRaw) : 0;
    const cost = costRaw != null && costRaw !== "" ? Number(costRaw) : 0;

    if ([salesRate, purchaseRate, taxRate, qty, cost].some((n) => n !== null && isNaN(n as number))) {
      return push("error", "One of the numeric columns is not a valid number");
    }
    if (!isUpdate && qty > 0 && cost <= 0) {
      return push("error", "Opening Cost must be greater than 0 when Opening Qty is set");
    }

    preview.push({
      rowNum, sku, name,
      description: cellText(row, 3), uom: cellText(row, 4) || "EA", hsnCode: cellText(row, 5),
      stockAccountCode,
      salesRate, purchaseRate, taxRate,
      openingQuantity: isUpdate ? 0 : qty, openingCost: isUpdate ? 0 : cost,
      status: isUpdate ? "update" : "create",
    });
  });

  res.json({ data: preview });
});

router.post("/bulk-upload/apply", canManageItems, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const rows: ItemPreviewRow[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const workRows = rows.filter((r) => r.status === "create" || r.status === "update");
  if (workRows.length === 0) return res.json({ data: { created: 0, updated: 0 } });

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true } });
  const existingItems = await prisma.item.findMany({ where: { organizationId, deletedAt: null } });
  const bySku = new Map(existingItems.map((i) => [i.sku.trim(), i]));
  const stockAccounts = await prisma.account.findMany({
    where: { organizationId, deletedAt: null, isControlAccount: true, defaultBpType: "ITEM" },
  });
  const accountByCode = new Map(stockAccounts.map((a) => [a.accountCode.trim(), a]));
  const ho = await prisma.branch.findFirst({ where: { organizationId, isHeadOffice: true } });

  let created = 0, updated = 0;
  for (const row of workRows) {
    const found = bySku.get(row.sku);
    if (found) {
      await prisma.item.update({
        where: { id: found.id },
        data: {
          name: row.name, description: row.description, uom: row.uom || "EA",
          hsnCode: row.hsnCode, salesRate: row.salesRate, purchaseRate: row.purchaseRate,
          taxRate: row.taxRate,
        },
      });
      if (row.name !== found.name) {
        await prisma.businessPartner.update({ where: { id: found.businessPartnerId }, data: { name: row.name } });
      }
      updated++;
    } else {
      const account = row.stockAccountCode ? accountByCode.get(row.stockAccountCode) : null;
      if (!account || !org?.costingMethod || !ho) continue; // shouldn't happen — preview already validated this
      const item = await prisma.$transaction(async (tx) => {
        const bp = await tx.businessPartner.create({ data: { organizationId, bpType: "ITEM", name: row.name } });
        const createdItem = await tx.item.create({
          data: {
            organizationId, sku: row.sku, name: row.name,
            description: row.description, uom: row.uom || "EA", hsnCode: row.hsnCode,
            // Bulk upload only ever creates STOCK items: the template has a
            // Stock Account column and no kind, and a service item needs an
            // expense account instead. Explicit rather than relying on the
            // column default, so this doesn't silently change if the default
            // ever does. Service items are created one at a time on the
            // Items screen; extending the template is a later phase.
            itemKind: "STOCK",
            stockAccountId: account.id, businessPartnerId: bp.id,
            salesRate: row.salesRate, purchaseRate: row.purchaseRate, taxRate: row.taxRate,
            openingQuantity: row.openingQuantity, openingCost: row.openingCost,
          },
        });
        await tx.businessPartner.update({ where: { id: bp.id }, data: { refId: createdItem.id } });
        if (row.openingQuantity > 0) {
          const when = new Date();
          await receiveStock(tx, {
            organizationId, branchId: ho.id, itemId: createdItem.id,
            quantity: row.openingQuantity, unitCost: row.openingCost, costingMethod: org!.costingMethod!,
            movementType: "ADJUSTMENT_IN", referenceType: "item_opening_balance", referenceId: createdItem.id,
            movementDate: when, narration: "Opening stock (bulk upload)",
          });
          // The SAME posting the single-item path makes. This is the door most
          // opening stock actually comes through - a spreadsheet of a hundred
          // items on day one - so leaving it unposted while fixing the other
          // one would have fixed almost nothing.
          await postOpeningStock(tx, {
            organizationId, branchId: ho.id, accountId: account.id,
            cardId: bp.id, sku: row.sku, quantity: row.openingQuantity,
            unitCost: row.openingCost, when, userId: req.user!.userId,
          });
        }
        return createdItem;
      });
      bySku.set(item.sku.trim(), item);
      created++;
    }
  }

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "BULK_UPLOAD", entityType: "item", entityId: organizationId,
    summary: `Bulk upload: ${created} item(s) created, ${updated} updated`,
  });
  res.json({ data: { created, updated } });
});

export default router;
