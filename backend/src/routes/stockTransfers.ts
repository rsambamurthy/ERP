import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { consumeStock, receiveStock, InsufficientStockError } from "../lib/costing";
import { isInterState } from "../lib/discountGst";
import {
  financialYearOf, blockedLines, valueLine, totalsFor,
  TransferLineInput, ValuedLine,
} from "../lib/transferValuation";
import {
  resolveTransferAccounts, dispatchJournalLines, receiptJournalLines,
  transitClearingJournalLines, cancelJournalLines, balanceProblem,
  prefixProblem, numberFromSeries, TRANSFER_SERIES_TYPE,
  IN_TRANSIT_CODE, INTER_BRANCH_RECEIVABLE_CODE, INTER_BRANCH_PAYABLE_CODE,
  CGST_OUTPUT_CODE, SGST_OUTPUT_CODE, IGST_OUTPUT_CODE,
  CGST_INPUT_CODE, SGST_INPUT_CODE, IGST_INPUT_CODE,
  TransferAccounts, ItemLeg, JournalLineData,
} from "../lib/transferPosting";

// Stock transfers between branches.
//
// Goods leave one branch and arrive at another, and those are two events
// rather than one. Dispatched on Monday and received on Thursday, the goods
// are at neither branch in between — they are in transit, and 1304 Stock in
// Transit is where the balance sheet says so.
//
// TWO KINDS OF TRANSFER, AND THEY ARE NOT THE SAME DOCUMENT
//
// UNTAXED (tax_treatment = NONE). Both branches on one GSTIN, so one legal
// person moving its own goods between its own godowns. Not a supply. Needs a
// delivery challan under Rule 55 and nothing else. Two journal entries, each
// balancing through 1304:
//
//   Dispatch, on the SENDING branch     Dr 1304   Cr the item's stock account
//   Receipt,  on the RECEIVING branch   Dr the item's stock account   Cr 1304
//
// TAXABLE (tax_treatment = TAXABLE). Different GSTINs, which section 25(4)
// makes DISTINCT PERSONS, and Schedule I paragraph 2 makes a supply between
// distinct persons taxable even with no consideration. Needs a tax invoice
// under section 31 / Rule 46, GST on a Rule 28 value, and reporting as an
// outward supply in the sending branch's GSTR-1. THREE journal entries,
// because two separate registrations keep two separate trial balances and
// neither may post to the other's accounts — see lib/transferPosting.ts.
//
// WHAT IS STILL REFUSED RATHER THAN GUESSED
//
// Each of these stops a dispatch instead of posting something defensible-
// looking. The output of this route is a statutory document; a wrong figure
// in a GSTR-1 is worse than a lorry that leaves an hour late.
//
//   - the receiving branch is not eligible for FULL input tax credit. The
//     second proviso to Rule 28 is then unavailable, the tax stops being
//     revenue-neutral, and it becomes a COST that AS 2 requires be
//     capitalised into the receiving branch's inventory. That is a different
//     design, not a different number.
//   - an item with no HSN, or with no GST rate set at all. Rule 46(g) needs
//     the HSN on the invoice and the NIC portal rejects an e-way bill
//     without it. (A rate of 0 is fine — that is a nil-rated item somebody
//     configured. Null is nobody having decided.)
//   - either branch's GST state code unknown, so CGST+SGST vs IGST cannot be
//     determined. Sales invoices fall back to CGST+SGST here so a
//     half-configured customer never blocks a sale; that is deliberately NOT
//     copied, because both branches are the organisation's own registrations
//     and an unset state code is a masters problem with a known fix.
//   - no invoice series configured for the sending branch. Rule 46(b) wants
//     a consecutive serial number; there is no sensible number to invent.

const router = Router();
router.use(authenticate, requireActiveSubscription);
// Moves stock and writes journal entries — the same gate as a Stock
// Adjustment and a production posting.
const canPost = requirePermission("inventory.post");

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

// The unit cost that reproduces a line's ledger value exactly.
//
// stock_transfer_lines.unit_cost is stored at 4 decimal places, but under
// FIFO the true cost is totalCost summed across lots and the unit cost is a
// non-terminating quotient of it. line_value is the figure the general
// ledger actually moved, so the far end of a transfer has to rebuild its
// stock value from THAT, or the stock ledger and the stock account diverge
// by a rounding crumb on every transfer and never converge again.
function exactUnitCost(l: { quantity: unknown; lineValue: unknown }): number {
  const q = Number(l.quantity);
  return q > 0 ? Number(l.lineValue) / q : 0;
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

const ALL_TRANSFER_CODES = [
  IN_TRANSIT_CODE, INTER_BRANCH_RECEIVABLE_CODE, INTER_BRANCH_PAYABLE_CODE,
  CGST_OUTPUT_CODE, SGST_OUTPUT_CODE, IGST_OUTPUT_CODE,
  CGST_INPUT_CODE, SGST_INPUT_CODE, IGST_INPUT_CODE,
];

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

// Every account a taxable transfer can touch, or a 400 naming the missing
// ones. Loaded up front so a dispatch fails before consuming any stock.
async function taxAccountsOr400(organizationId: string, res: import("express").Response): Promise<TransferAccounts | null> {
  const rows = await prisma.account.findMany({
    where: { organizationId, accountCode: { in: ALL_TRANSFER_CODES } },
    select: { id: true, accountCode: true },
  });
  const { accounts, missing } = resolveTransferAccounts(rows);
  if (!accounts) {
    res.status(400).json({
      message: `A taxable branch transfer posts to accounts this organisation does not have: ${missing.join(", ")}. Sync from templates first.`,
    });
    return null;
  }
  return accounts;
}

type Tx = Prisma.TransactionClient;

// The sub-ledger card for a branch acting as a GSTR-1 counterparty.
//
// Created lazily, the first time a branch is actually one end of a taxable
// transfer — the same convention routes/items.ts uses for ITEM partners. A
// branch that only ever sends and receives untaxed transfers never gets one.
//
// refId points at the branch, and the GSTIN is deliberately NOT copied onto
// the partner: read through the link and there is one source of truth, copy
// it and the two can silently disagree the day a branch re-registers.
async function branchPartnerId(tx: Tx, organizationId: string, branch: { id: string; name: string }): Promise<string> {
  const existing = await tx.businessPartner.findFirst({
    where: { organizationId, bpType: "BRANCH", refId: branch.id },
    select: { id: true },
  });
  if (existing) return existing.id;
  try {
    const created = await tx.businessPartner.create({
      data: { organizationId, bpType: "BRANCH", refId: branch.id, name: branch.name.slice(0, 200) },
      select: { id: true },
    });
    return created.id;
  } catch (err) {
    // business_partners_ref_uq (migration_046) — another transaction created
    // this branch's card between the read above and this write. Its card is
    // as good as the one we were about to make, so take it. Without the
    // index this branch would instead end up with TWO cards and its
    // 1305/2106 sub-ledger split across both, which is unreconcilable and
    // silent; with the index but without this catch, a legitimate dispatch
    // would fail on a race that has an obvious right answer.
    if ((err as { code?: string })?.code !== "P2002") throw err;
    const raced = await tx.businessPartner.findFirst({
      where: { organizationId, bpType: "BRANCH", refId: branch.id },
      select: { id: true },
    });
    if (!raced) throw err;
    return raced.id;
  }
}

// Takes the next invoice number for this branch and financial year, or null
// if no series is configured.
//
// The increment happens inside the caller's transaction, so two dispatches
// racing each other queue on the row rather than being handed the same
// number — and a dispatch that rolls back gives its number back rather than
// leaving a gap, which is what Rule 46(b)'s "consecutive" asks for.
async function allocateTransferNumber(
  tx: Tx, organizationId: string, branchId: string, transferDate: Date
): Promise<string | null> {
  const financialYear = financialYearOf(transferDate);
  const series = await tx.documentNumberSeries.findUnique({
    where: {
      organizationId_branchId_seriesType_financialYear: {
        organizationId, branchId, seriesType: TRANSFER_SERIES_TYPE, financialYear,
      },
    },
    select: { id: true, prefix: true, nextNumber: true },
  });
  if (!series) return null;
  const updated = await tx.documentNumberSeries.update({
    where: { id: series.id },
    data: { nextNumber: { increment: 1 } },
    select: { nextNumber: true },
  });
  // update returns the value AFTER incrementing; the number we allocated is
  // the one before it.
  return numberFromSeries({ prefix: series.prefix, nextNumber: series.nextNumber, financialYear }, updated.nextNumber - 1);
}

// Runs a dispatch transaction, retrying if two of them raced for the same
// TR-nnnn. The number is computed INSIDE the transaction so each attempt
// sees the committed count, and P2002 on the transfer-number index is the
// only error retried — anything else propagates on the first failure.
const TRANSFER_NUMBER_ATTEMPTS = 4;

function isTransferNumberCollision(err: unknown): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } };
  if (e?.code !== "P2002") return false;
  const target = e.meta?.target;
  const asText = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return asText.includes("transfer_number") || asText.includes("transferNumber");
}

async function withTransferNumberRetry<T>(
  organizationId: string,
  run: (tx: Tx, transferNumber: string) => Promise<T>
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < TRANSFER_NUMBER_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const count = await tx.stockTransfer.count({ where: { organizationId } });
        return run(tx, `TR-${String(count + 1).padStart(4, "0")}`);
      });
    } catch (err) {
      if (!isTransferNumberCollision(err)) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

async function loadTransfer(organizationId: string, id: string) {
  return prisma.stockTransfer.findFirst({
    where: { id, organizationId },
    include: {
      fromBranch: { select: { id: true, name: true, gstin: true, stateCode: true } },
      toBranch: { select: { id: true, name: true, gstin: true, stateCode: true } },
      lines: {
        include: {
          item: { select: { id: true, sku: true, name: true, uom: true, stockAccountId: true, businessPartnerId: true, hsnCode: true } },
        },
      },
    },
  });
}

type LoadedTransfer = NonNullable<Awaited<ReturnType<typeof loadTransfer>>>;

function transferJson(t: LoadedTransfer) {
  const lines = t.lines.map((l) => ({
    id: l.id,
    item: { id: l.item.id, sku: l.item.sku, name: l.item.name, uom: l.item.uom, hsnCode: l.item.hsnCode },
    quantity: Number(l.quantity),
    unitCost: Number(l.unitCost),
    lineValue: Number(l.lineValue),
    taxableValue: l.taxableValue === null ? null : Number(l.taxableValue),
    valuationBasis: l.valuationBasis,
    gstRate: l.gstRate === null ? null : Number(l.gstRate),
    cgst: l.cgst === null ? null : Number(l.cgst),
    sgst: l.sgst === null ? null : Number(l.sgst),
    igst: l.igst === null ? null : Number(l.igst),
  }));
  const taxTotal = round2(lines.reduce((s, l) => s + (l.cgst ?? 0) + (l.sgst ?? 0) + (l.igst ?? 0), 0));
  const totalValue = round2(lines.reduce((s, l) => s + l.lineValue, 0));
  return {
    id: t.id,
    transferNumber: t.transferNumber,
    transferDate: isoDay(t.transferDate),
    receivedDate: t.receivedDate ? isoDay(t.receivedDate) : null,
    fromBranch: { id: t.fromBranch.id, name: t.fromBranch.name, gstin: t.fromBranch.gstin },
    toBranch: { id: t.toBranch.id, name: t.toBranch.name, gstin: t.toBranch.gstin },
    status: t.status,
    taxTreatment: t.taxTreatment,
    toBranchItcEligibility: t.toBranchItcEligibility,
    documentNumber: t.documentNumber,
    ewayBillNumber: t.ewayBillNumber,
    dispatchJournalEntryId: t.dispatchJournalEntryId,
    receiptJournalEntryId: t.receiptJournalEntryId,
    transitClearingJournalEntryId: t.transitClearingJournalEntryId,
    lines,
    totalValue,
    taxTotal,
    // What the receiving branch owes: goods at cost plus the tax. Zero on an
    // untaxed transfer, where nothing is owed to anybody.
    invoiceTotal: round2(totalValue + taxTotal),
  };
}

// ── Invoice numbering series ──────────────────────────────────────────────
//
// Registered BEFORE /:id, or Express reads "series" as a transfer id.

// GET /stock-transfers/series
router.get("/series", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const financialYear = typeof req.query.financialYear === "string" && req.query.financialYear
    ? req.query.financialYear
    : financialYearOf(new Date());

  const [branches, series] = await Promise.all([
    prisma.branch.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, name: true, gstin: true, stateCode: true, itcEligibility: true },
      orderBy: { name: "asc" },
    }),
    prisma.documentNumberSeries.findMany({
      where: { organizationId, seriesType: TRANSFER_SERIES_TYPE, financialYear },
      select: { branchId: true, prefix: true, nextNumber: true },
    }),
  ]);
  // Annotated because the row type is otherwise inferred as {} — the same
  // convention the other routes use where a narrow `select` loses its shape.
  type SeriesLite = { branchId: string; prefix: string; nextNumber: number };
  const byBranch = new Map<string, SeriesLite>((series as SeriesLite[]).map((s) => [s.branchId, s]));

  res.json({
    data: {
      financialYear,
      branches: branches.map((b) => {
        const s = byBranch.get(b.id);
        return {
          branchId: b.id, name: b.name, gstin: b.gstin, stateCode: b.stateCode,
          itcEligibility: b.itcEligibility,
          prefix: s?.prefix ?? null,
          nextNumber: s?.nextNumber ?? null,
          // A branch cannot send a taxable transfer without one of these.
          configured: !!s,
        };
      }),
    },
  });
});

// PUT /stock-transfers/series   { branchId, financialYear?, prefix }
//
// Sets the prefix for a branch and year. The running number is NOT settable:
// letting somebody move it backwards would re-issue an invoice number that
// has already been on a document.
router.put("/series", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const { branchId, prefix } = req.body ?? {};
  const financialYear = typeof req.body?.financialYear === "string" && req.body.financialYear
    ? req.body.financialYear
    : financialYearOf(new Date());

  if (typeof branchId !== "string" || !branchId) return res.status(400).json({ message: "Pick a branch." });
  if (typeof prefix !== "string") return res.status(400).json({ message: "A prefix is required." });
  const problem = prefixProblem(prefix);
  if (problem) return res.status(400).json({ message: problem });
  if (!/^\d{4}-\d{2}$/.test(financialYear)) {
    return res.status(400).json({ message: "financialYear should look like 2026-27." });
  }

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, organizationId, deletedAt: null }, select: { id: true, name: true },
  });
  if (!branch) return res.status(400).json({ message: "That branch is not in this organisation." });

  const clean = prefix.trim();
  const saved = await prisma.documentNumberSeries.upsert({
    where: {
      organizationId_branchId_seriesType_financialYear: {
        organizationId, branchId, seriesType: TRANSFER_SERIES_TYPE, financialYear,
      },
    },
    // Changing the prefix mid-year leaves the running number alone, so the
    // sequence continues rather than restarting under a new name.
    update: { prefix: clean },
    create: { organizationId, branchId, seriesType: TRANSFER_SERIES_TYPE, financialYear, prefix: clean },
    select: { prefix: true, nextNumber: true },
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "document_number_series", entityId: branch.id,
    summary: `Branch transfer invoice series for ${branch.name} ${financialYear}: ${clean}`,
  });

  res.json({ data: { branchId, financialYear, ...saved } });
});

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
      lines: { select: { lineValue: true, quantity: true, cgst: true, sgst: true, igst: true } },
    },
    orderBy: [{ transferDate: "desc" }, { createdAt: "desc" }],
    take: 300,
  });

  res.json({
    data: rows.map((t) => {
      const totalValue = round2(t.lines.reduce((s, l) => s + Number(l.lineValue), 0));
      const taxTotal = round2(t.lines.reduce((s, l) => s + Number(l.cgst ?? 0) + Number(l.sgst ?? 0) + Number(l.igst ?? 0), 0));
      return {
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
        totalValue,
        taxTotal,
        invoiceTotal: round2(totalValue + taxTotal),
      };
    }),
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
    select: { id: true, name: true, gstin: true, stateCode: true, itcEligibility: true },
  });
  type Br = { id: string; name: string; gstin: string | null; stateCode: string | null; itcEligibility: string };
  const from = (branches as Br[]).find((b) => b.id === fromBranchId);
  const to = (branches as Br[]).find((b) => b.id === toBranchId);
  if (!from || !to) return res.status(400).json({ message: "One of those branches is not in this organisation." });

  const taxTreatment = taxTreatmentFor(from, to);
  const taxable = taxTreatment === "TAXABLE";

  // Everything a taxable transfer needs before any stock moves.
  let accounts: TransferAccounts | null = null;
  let interState = false;
  if (taxable) {
    if (to.itcEligibility !== "FULL") {
      return res.status(400).json({
        message: `${to.name} is marked as ${to.itcEligibility === "RESTRICTED" ? "making exempt or non-GST supplies" : "making mixed supplies with proportionate credit"}, so it cannot claim full input tax credit on this transfer. The second proviso to Rule 28 does not apply, the tax becomes a cost that has to be capitalised into that branch's stock, and neither the valuation nor the receipt-side accounting for that is built yet. Refused rather than posted on an assumption that is wrong for this branch.`,
      });
    }
    if (!from.stateCode || !to.stateCode) {
      const which = !from.stateCode ? from.name : to.name;
      return res.status(400).json({
        message: `${which} has no GST state code, so this transfer cannot be split into CGST+SGST or IGST. Set the state code on the branch — unlike a customer, this is your own registration and guessing it would put the tax under the wrong heads on a real return.`,
      });
    }
    interState = isInterState(from.stateCode, to.stateCode);
    accounts = await taxAccountsOr400(organizationId, res);
    if (!accounts) return;
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
    select: { id: true, sku: true, name: true, itemKind: true, stockAccountId: true, businessPartnerId: true, hsnCode: true, taxRate: true },
  });
  type It = { id: string; sku: string; name: string; itemKind: string; stockAccountId: string; businessPartnerId: string; hsnCode: string | null; taxRate: unknown };
  const byId = new Map<string, It>((items as It[]).map((x) => [x.id, x]));
  for (const l of parsed) {
    const it = byId.get(l.itemId);
    if (!it) return res.status(400).json({ message: "An item on this transfer is not in this organisation." });
    if (it.itemKind !== "STOCK") {
      return res.status(400).json({ message: `${it.sku} is a service item — it has no stock to move.` });
    }
  }

  // Item-master gaps that would produce an invalid invoice. Reported all at
  // once: somebody fixing item masters wants the whole list.
  if (taxable) {
    const bad = blockedLines(parsed.map((l) => {
      const it = byId.get(l.itemId)!;
      return {
        itemId: it.id, itemName: `${it.sku} — ${it.name}`,
        hsnCode: it.hsnCode, taxRate: it.taxRate === null || it.taxRate === undefined ? null : Number(it.taxRate),
        quantity: l.quantity, unitCost: 0,
      };
    }));
    if (bad.length > 0) {
      const noHsn = bad.filter((b) => b.reason === "MISSING_HSN").map((b) => b.itemName);
      const noRate = bad.filter((b) => b.reason === "MISSING_GST_RATE").map((b) => b.itemName);
      const parts: string[] = [];
      if (noHsn.length) parts.push(`no HSN code: ${noHsn.join("; ")}`);
      if (noRate.length) parts.push(`no GST rate set: ${noRate.join("; ")}`);
      return res.status(400).json({
        message: `This is a taxable branch transfer, so every line goes on a tax invoice and needs an HSN and a rate. Fix these on the item master first — ${parts.join(", ")}.`,
      });
    }
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId }, select: { costingMethod: true },
  });
  const costingMethod = org?.costingMethod ?? "WEIGHTED_AVG";

  // TR-0001 style, counted rather than allocated from a series — this is the
  // internal document reference, not the tax invoice number (that comes from
  // DocumentNumberSeries and IS allocated transactionally). Two dispatches at
  // the same instant can compute the same count and the second violates
  // stock_transfers_number_uq, so the whole transaction is retried rather
  // than surfacing a 500 on a perfectly legitimate dispatch. Retrying is safe
  // because the failed attempt rolled back completely: no stock consumed, and
  // the invoice number it had taken went back to the series.
  let transferNumber = "";

  try {
    const created = await withTransferNumberRetry(organizationId, async (tx, allocatedNumber) => {
      transferNumber = allocatedNumber;
      // The invoice number, before anything else, so a missing series aborts
      // the transaction rather than leaving stock consumed.
      let invoiceNumber: string | null = null;
      if (taxable) {
        invoiceNumber = await allocateTransferNumber(tx, organizationId, fromBranchId, transferDate);
        if (!invoiceNumber) {
          throw Object.assign(
            new Error(`${from.name} has no branch-transfer invoice series for ${financialYearOf(transferDate)}. A tax invoice needs a consecutive serial number under Rule 46(b) and there is none to take — set the prefix for this branch first.`),
            { status: 400 }
          );
        }
      }

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
          status: "DISPATCHED", taxTreatment,
          toBranchItcEligibility: to.itcEligibility,
          // A taxable transfer's number is its tax invoice number and is
          // allocated, never typed. An untaxed one carries whatever delivery
          // challan reference the user entered.
          documentNumber: taxable
            ? invoiceNumber
            : (typeof documentNumber === "string" && documentNumber.trim() ? documentNumber.trim().slice(0, 30) : null),
          ewayBillNumber: typeof ewayBillNumber === "string" && ewayBillNumber.trim() ? ewayBillNumber.trim().slice(0, 20) : null,
          dispatchJournalEntryId: journalEntry.id,
          createdBy: req.user!.userId,
        },
      });

      const valued: ValuedLine[] = [];
      const legs: ItemLeg[] = [];

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

        const input: TransferLineInput = {
          itemId: it.id, itemName: `${it.sku} — ${it.name}`,
          hsnCode: it.hsnCode,
          taxRate: it.taxRate === null || it.taxRate === undefined ? null : Number(it.taxRate),
          quantity: l.quantity, unitCost,
          // The authoritative figure — see TransferLineInput.lineValue.
          lineValue: round2(totalCost),
        };
        const v = valueLine(input, interState);
        valued.push(v);

        legs.push({
          stockAccountId: it.stockAccountId, itemPartnerId: it.businessPartnerId,
          amount: round2(totalCost), narration: `${it.sku} — ${it.name}`,
        });

        await tx.stockTransferLine.create({
          data: {
            stockTransferId: transfer.id, itemId: l.itemId,
            quantity: l.quantity, unitCost: round4(unitCost), lineValue: round2(totalCost),
            ...(taxable ? {
              taxableValue: v.taxableValue, valuationBasis: v.valuationBasis,
              gstRate: v.gstRate, cgst: v.cgst, sgst: v.sgst, igst: v.igst,
            } : {}),
          },
        });
      }

      const totals = totalsFor(valued);
      let lines: JournalLineData[];

      if (taxable) {
        const toPartner = await branchPartnerId(tx, organizationId, to);
        lines = dispatchJournalLines({
          journalEntryId: journalEntry.id, accounts: accounts!,
          items: legs, costTotal: totals.lineValueTotal,
          tax: { cgst: totals.cgstTotal, sgst: totals.sgstTotal, igst: totals.igstTotal },
          taxTotal: totals.taxTotal, toBranchPartnerId: toPartner,
          label: `${transferNumber} / ${invoiceNumber}`,
        });
      } else {
        // Unchanged from the untaxed design: one debit to 1304, one credit
        // per item against its own card.
        lines = [
          {
            journalEntryId: journalEntry.id, accountId: transit.id,
            businessPartnerId: null, debit: totals.lineValueTotal, credit: 0,
            narration: `${transferNumber} — in transit to ${to.name}`.slice(0, 255),
          },
          ...legs.map((c) => ({
            journalEntryId: journalEntry.id, accountId: c.stockAccountId,
            businessPartnerId: c.itemPartnerId,
            debit: 0, credit: c.amount, narration: c.narration.slice(0, 255),
          })),
        ];
      }

      const imbalance = balanceProblem(lines);
      if (imbalance) throw Object.assign(new Error(imbalance), { status: 500 });

      await tx.journalLine.createMany({ data: lines });

      // taxTotal only where tax was actually computed and posted. valueLine
      // runs for untaxed lines too (it is what produces lineValue), and it
      // reads the item's rate — but a same-GSTIN movement is not a supply,
      // nothing is stored on the line, and reporting a tax figure here would
      // contradict GET /:id, which reads the nulls back as zero.
      return { id: transfer.id, transferNumber, documentNumber: transfer.documentNumber, taxTreatment, total: totals.lineValueTotal, taxTotal: taxable ? totals.taxTotal : 0 };
    });

    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "CREATE", entityType: "stock_transfer", entityId: created.id,
      summary: `${transferNumber} — ${from.name} to ${to.name}, ${parsed.length} item${parsed.length === 1 ? "" : "s"}, ${created.total.toFixed(2)}${taxable ? ` + ${created.taxTotal.toFixed(2)} tax, invoice ${created.documentNumber}` : ""}`,
    });

    res.status(201).json({ data: created });
  } catch (err: unknown) {
    if (err instanceof InsufficientStockError) {
      return res.status(400).json({ message: err.message });
    }
    const status = (err as { status?: number })?.status;
    if (status === 400 || status === 409) return res.status(status).json({ message: (err as Error).message });
    console.error("stock transfer dispatch failed", err);
    return res.status(500).json({ message: "Could not dispatch the transfer. Nothing was written." });
  }
});

// POST /stock-transfers/:id/receive   { receivedDate }
//
// The receiving branch receives at the sending branch's cost — the unit cost
// recorded on the line at dispatch. Nothing is re-valued in transit.
//
// Untaxed: one entry at the receiving branch, Dr stock / Cr 1304.
// Taxable:  two entries — the receiving branch takes the goods and the ITC
//           against 2106, and the SENDING branch converts its transit asset
//           into a receivable. Section 16(2)(b) is why the credit is taken
//           here and not at dispatch: only receipt entitles it.
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

  const taxable = t.taxTreatment === "TAXABLE";
  let accounts: TransferAccounts | null = null;
  if (taxable) {
    accounts = await taxAccountsOr400(organizationId, res);
    if (!accounts) return;
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

  const label = t.documentNumber ? `${t.transferNumber} / ${t.documentNumber}` : t.transferNumber;

  try {
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

      let costTotal = 0;
      const legs: ItemLeg[] = [];
      let cgst = 0, sgst = 0, igst = 0;

      for (const l of t.lines) {
        const value = round2(Number(l.lineValue));
        costTotal = round2(costTotal + value);
        cgst = round2(cgst + Number(l.cgst ?? 0));
        sgst = round2(sgst + Number(l.sgst ?? 0));
        igst = round2(igst + Number(l.igst ?? 0));

        await receiveStock(tx, {
          organizationId, branchId: t.toBranchId, itemId: l.itemId,
          // NOT the stored unitCost. That column is the 4dp quotient
          // totalCost/quantity kept for display; multiplying it back out
          // gives a number a paisa or two away from lineValue, and since
          // lineValue is what the GL moved, the stock ledger would drift
          // permanently from the stock account. Deriving it here makes
          // quantity * unitCost reproduce lineValue exactly.
          quantity: Number(l.quantity), unitCost: exactUnitCost(l), costingMethod,
          movementType: "TRANSFER_IN",
          referenceType: "stock_transfer", referenceId: t.id,
          movementDate: receivedDate,
          narration: `${t.transferNumber} — from ${t.fromBranch.name}`,
        });

        legs.push({
          stockAccountId: l.item.stockAccountId, itemPartnerId: l.item.businessPartnerId,
          amount: value, narration: `${l.item.sku} — ${l.item.name}`,
        });
      }

      const taxTotal = round2(cgst + sgst + igst);
      let lines: JournalLineData[];
      let clearingId: string | null = null;

      if (taxable) {
        const fromPartner = await branchPartnerId(tx, organizationId, t.fromBranch);
        const toPartner = await branchPartnerId(tx, organizationId, t.toBranch);

        lines = receiptJournalLines({
          journalEntryId: journalEntry.id, accounts: accounts!,
          items: legs, costTotal, tax: { cgst, sgst, igst }, taxTotal,
          fromBranchPartnerId: fromPartner, label,
        });

        // The sending branch's own entry — it carries a different branchId,
        // so it cannot be lines on the entry above.
        const clearing = await tx.journalEntry.create({
          data: {
            organizationId, branchId: t.fromBranchId, entryDate: receivedDate,
            narration: `${t.transferNumber} — received at ${t.toBranch.name}`.slice(0, 255),
            voucherType: "JV",
            referenceType: "stock_transfer_transit",
            createdBy: req.user!.userId,
          },
        });
        clearingId = clearing.id;
        const clearingLines = transitClearingJournalLines({
          journalEntryId: clearing.id, accounts: accounts!,
          costTotal, toBranchPartnerId: toPartner, label,
        });
        const cImbalance = balanceProblem(clearingLines);
        if (cImbalance) throw Object.assign(new Error(cImbalance), { status: 500 });
        await tx.journalLine.createMany({ data: clearingLines });
      } else {
        lines = [
          ...legs.map((d) => ({
            journalEntryId: journalEntry.id, accountId: d.stockAccountId,
            businessPartnerId: d.itemPartnerId,
            debit: d.amount, credit: 0, narration: d.narration.slice(0, 255),
          })),
          {
            journalEntryId: journalEntry.id, accountId: transit.id,
            businessPartnerId: null, debit: 0, credit: costTotal,
            narration: `${t.transferNumber} — received at ${t.toBranch.name}`.slice(0, 255),
          },
        ];
      }

      const imbalance = balanceProblem(lines);
      if (imbalance) throw Object.assign(new Error(imbalance), { status: 500 });
      await tx.journalLine.createMany({ data: lines });

      // Guarded on the status this handler checked before the transaction
      // opened. Two people clicking Receive at once both get past that
      // check; the second one's updateMany matches ZERO rows once the first
      // has committed, and throwing here rolls back its stock movements and
      // its journal entries with it. Without the guard both would post, and
      // the unique indexes on the journal-entry columns would NOT catch it —
      // the two requests create different entries, so nothing collides.
      const claimed = await tx.stockTransfer.updateMany({
        where: { id: t.id, status: "DISPATCHED" },
        data: {
          status: "RECEIVED", receivedDate,
          receiptJournalEntryId: journalEntry.id,
          ...(clearingId ? { transitClearingJournalEntryId: clearingId } : {}),
        },
      });
      if (claimed.count === 0) {
        throw Object.assign(
          new Error(`${t.transferNumber} was received or cancelled by someone else a moment ago. Nothing was posted twice.`),
          { status: 409 }
        );
      }

      return { received: true, total: costTotal, taxTotal };
    });

    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "UPDATE", entityType: "stock_transfer", entityId: t.id,
      summary: `${t.transferNumber} received at ${t.toBranch.name} — ${result.total.toFixed(2)}${result.taxTotal > 0 ? ` + ${result.taxTotal.toFixed(2)} ITC` : ""}`,
    });

    res.json({ data: result });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 400 || status === 409) return res.status(status).json({ message: (err as Error).message });
    console.error("stock transfer receipt failed", err);
    return res.status(500).json({ message: "Could not receive the transfer. Nothing was written." });
  }
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
// accounting record of it.
//
// A CANCELLED TAXABLE TRANSFER STILL NEEDS A CREDIT NOTE
//
// The output tax is reversed in the ledger here, which is the right
// accounting. It is NOT the right GST reporting: an invoice that has been
// issued is undone by a credit note under section 34, reported in its own
// right, not by the invoice quietly ceasing to exist. Nothing here issues
// one — the reversal shows in the books, and the return has to be handled
// deliberately. Worth knowing before cancelling a transfer whose invoice has
// already gone out with the goods.
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

  const taxable = t.taxTreatment === "TAXABLE";
  let accounts: TransferAccounts | null = null;
  if (taxable) {
    accounts = await taxAccountsOr400(organizationId, res);
    if (!accounts) return;
  }

  const entryDate = dayOrNull(req.body?.entryDate) ?? t.transferDate;
  if (entryDate < t.transferDate) {
    return res.status(400).json({ message: `The return cannot predate the dispatch on ${isoDay(t.transferDate)}.` });
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId }, select: { costingMethod: true },
  });
  const costingMethod = org?.costingMethod ?? "WEIGHTED_AVG";
  const label = t.documentNumber ? `${t.transferNumber} / ${t.documentNumber}` : t.transferNumber;

  try {
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

      let costTotal = 0;
      const legs: ItemLeg[] = [];
      let cgst = 0, sgst = 0, igst = 0;

      for (const l of t.lines) {
        const value = round2(Number(l.lineValue));
        costTotal = round2(costTotal + value);
        cgst = round2(cgst + Number(l.cgst ?? 0));
        sgst = round2(sgst + Number(l.sgst ?? 0));
        igst = round2(igst + Number(l.igst ?? 0));

        await receiveStock(tx, {
          organizationId, branchId: t.fromBranchId, itemId: l.itemId,
          // See the note in /receive: the sending branch must get back
          // exactly the value it gave up, not a re-multiplied rounding of it.
          quantity: Number(l.quantity), unitCost: exactUnitCost(l), costingMethod,
          movementType: "TRANSFER_IN",
          referenceType: "stock_transfer", referenceId: t.id,
          movementDate: entryDate,
          narration: `${t.transferNumber} cancelled — returned`,
        });

        legs.push({
          stockAccountId: l.item.stockAccountId, itemPartnerId: l.item.businessPartnerId,
          amount: value, narration: `${l.item.sku} — ${l.item.name}`,
        });
      }

      const taxTotal = round2(cgst + sgst + igst);
      let lines: JournalLineData[];

      if (taxable) {
        const toPartner = await branchPartnerId(tx, organizationId, t.toBranch);
        lines = cancelJournalLines({
          journalEntryId: journalEntry.id, accounts: accounts!,
          items: legs, costTotal, tax: { cgst, sgst, igst }, taxTotal,
          toBranchPartnerId: toPartner, label,
        });
      } else {
        lines = [
          ...legs.map((d) => ({
            journalEntryId: journalEntry.id, accountId: d.stockAccountId,
            businessPartnerId: d.itemPartnerId,
            debit: d.amount, credit: 0, narration: d.narration.slice(0, 255),
          })),
          {
            journalEntryId: journalEntry.id, accountId: transit.id,
            businessPartnerId: null, debit: 0, credit: costTotal,
            narration: `${t.transferNumber} cancelled`.slice(0, 255),
          },
        ];
      }

      const imbalance = balanceProblem(lines);
      if (imbalance) throw Object.assign(new Error(imbalance), { status: 500 });
      await tx.journalLine.createMany({ data: lines });

      // Same guard as /receive. This one also closes the receive-and-cancel
      // race: without it a transfer could be received at the destination AND
      // returned to the sender, creating stock out of nothing.
      const claimed = await tx.stockTransfer.updateMany({
        where: { id: t.id, status: "DISPATCHED" },
        data: { status: "CANCELLED", receiptJournalEntryId: journalEntry.id },
      });
      if (claimed.count === 0) {
        throw Object.assign(
          new Error(`${t.transferNumber} was received or cancelled by someone else a moment ago. Nothing was posted twice.`),
          { status: 409 }
        );
      }

      return { cancelled: true, total: costTotal, taxTotal, creditNoteNeeded: taxable && !!t.documentNumber };
    });

    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "UPDATE", entityType: "stock_transfer", entityId: t.id,
      summary: `${t.transferNumber} cancelled — ${result.total.toFixed(2)} returned to ${t.fromBranch.name}${result.creditNoteNeeded ? ` (invoice ${t.documentNumber} needs a credit note under s.34)` : ""}`,
    });

    res.json({ data: result });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 400 || status === 409) return res.status(status).json({ message: (err as Error).message });
    console.error("stock transfer cancel failed", err);
    return res.status(500).json({ message: "Could not cancel the transfer. Nothing was written." });
  }
});

export default router;
