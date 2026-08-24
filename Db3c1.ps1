$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Phase D-b: the transfer route (1 of 3)...' -ForegroundColor Cyan

function Set-FileText($rel, $text) {
  $p = Join-Path $repo $rel
  $dir = Split-Path $p -Parent
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::WriteAllText($p, $text.Replace([string][char]13, ''), (New-Object Text.UTF8Encoding $false))
  Write-Host "  wrote  $rel"
}

function Add-FileText($rel, $expectedTail, $text) {
  $p = Join-Path $repo $rel
  if (-not (Test-Path -LiteralPath $p)) { throw "Missing file: $rel -- run the previous script first." }
  $t = [IO.File]::ReadAllText($p).Replace([string][char]13, '')
  $text = $text.Replace([string][char]13, '')
  $expectedTail = $expectedTail.Replace([string][char]13, '')
  if ($t.EndsWith($text)) { Write-Host "  skip   $rel"; return }
  if (-not $t.EndsWith($expectedTail)) { throw "$rel does not end where expected -- run the previous script first." }
  [IO.File]::WriteAllText($p, $t + $text, (New-Object Text.UTF8Encoding $false))
  Write-Host "  append $rel"
}
$f = @'
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

'@
Set-FileText 'backend/src/routes/stockTransfers.ts' $f
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green