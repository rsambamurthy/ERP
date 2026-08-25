import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { frequencyInForce, isDepreciationMethod, methodInForce } from "../lib/depreciationPolicy";
import { buildSchedule } from "../lib/depreciationSchedule";

// The fixed asset register.
//
// Read-only. An asset is created by capitalising a Purchase Bill line and
// changed by nothing — its cost, life, method, residual and accounts were
// all fixed at capitalisation, and what happens to it afterwards happens
// through depreciation runs and, eventually, disposal. There is deliberately
// no edit endpoint: an asset whose cost could be edited after the fact would
// no longer reconcile to the journal entry that created it.
//
// Gross block, accumulated depreciation and net block are what Schedule III
// requires to be shown separately, and they are what this register reports.
// Accumulated depreciation is summed from the runs rather than stored on the
// asset, because the runs are the record of what actually posted — a stored
// total could drift from the ledger and nothing would notice.

const router = Router();
router.use(authenticate, requireActiveSubscription);

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

function isoDay(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

// GET /fixed-assets — the register.
router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  // RETURNED belongs here too. An asset sent back to the vendor is gone in
  // exactly the way a disposed one is, and leaving it on the register would
  // overstate the gross block by something the company does not own.
  const includeDisposed = String(req.query.includeDisposed ?? "") === "true";
  const GONE = ["DISPOSED", "RETURNED"];

  const assets = await prisma.fixedAsset.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ...(includeDisposed ? {} : { status: { notIn: GONE } }),
    },
    include: {
      assetClass: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
      assetAccount: { select: { accountCode: true, accountName: true } },
      purchaseBill: { select: { id: true, billNumber: true, businessPartner: { select: { name: true } } } },
      runs: { select: { amount: true } },
    },
    orderBy: { assetCode: "asc" },
  });

  res.json({
    data: assets.map((a) => {
      const gross = Number(a.grossCost);
      // Summed from what posted, never stored. See the note at the top.
      const accumulated = a.runs.reduce((s, r) => s + Number(r.amount), 0);
      return {
        id: a.id,
        assetCode: a.assetCode,
        name: a.name,
        assetClass: a.assetClass,
        branch: a.branch,
        assetAccount: a.assetAccount,
        vendor: a.purchaseBill?.businessPartner?.name ?? null,
        billNumber: a.purchaseBill?.billNumber ?? null,
        purchaseDate: isoDay(a.purchaseDate),
        inUseDate: isoDay(a.inUseDate),
        method: a.method,
        usefulLifeMonths: a.usefulLifeMonths,
        scheduleIiLifeMonths: a.scheduleIiLifeMonths,
        // True when this asset's life departs from what Schedule II
        // prescribes — the set an auditor asks for, answerable without
        // reading the class, which may have been edited since.
        departsFromScheduleII: a.usefulLifeMonths !== a.scheduleIiLifeMonths,
        grossCost: gross,
        residualValue: Number(a.residualValue),
        accumulatedDepreciation: accumulated,
        netBookValue: Number((gross - accumulated).toFixed(2)),
        periodsPosted: a.runs.length,
        status: a.status,
      };
    }),
  });
});

// GET /fixed-assets/:id — one asset, with every charge posted against it.
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

router.get("/:id", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  // An id that is not a uuid reaches Prisma as one anyway and comes back as
  // P2023, which the error handler turns into a 500 with a stack trace. It is
  // a client sending a bad URL, not a server fault.
  if (!UUID.test(req.params.id)) return res.status(404).json({ message: "Fixed asset not found." });

  const a = await prisma.fixedAsset.findFirst({
    where: { id: req.params.id, organizationId, deletedAt: null },
    include: {
      assetClass: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
      businessPartner: { select: { id: true, name: true } },
      assetAccount: { select: { accountCode: true, accountName: true } },
      accumDepAccount: { select: { accountCode: true, accountName: true } },
      depExpenseAccount: { select: { accountCode: true, accountName: true } },
      purchaseBill: {
        select: {
          id: true, billNumber: true, billDate: true,
          businessPartner: { select: { id: true, name: true } },
        },
      },
      runs: { orderBy: { periodStart: "asc" } },
    },
  });
  if (!a) return res.status(404).json({ message: "Asset not found." });

  const gross = Number(a.grossCost);
  const accumulated = a.runs.reduce((s, r) => s + Number(r.amount), 0);

  res.json({
    data: {
      id: a.id,
      assetCode: a.assetCode,
      name: a.name,
      assetClass: a.assetClass,
      branch: a.branch,
      // The asset's own sub-ledger card. Both balance-sheet accounts are
      // tagged to it, which is what makes one asset's gross block and
      // accumulated depreciation readable from the ledger itself.
      card: a.businessPartner,
      assetAccount: a.assetAccount,
      accumDepAccount: a.accumDepAccount,
      depExpenseAccount: a.depExpenseAccount,
      purchaseBill: a.purchaseBill
        ? {
            id: a.purchaseBill.id,
            billNumber: a.purchaseBill.billNumber,
            billDate: isoDay(a.purchaseBill.billDate),
            vendor: a.purchaseBill.businessPartner,
          }
        : null,
      purchaseDate: isoDay(a.purchaseDate),
      inUseDate: isoDay(a.inUseDate),
      method: a.method,
      usefulLifeMonths: a.usefulLifeMonths,
      scheduleIiLifeMonths: a.scheduleIiLifeMonths,
      departsFromScheduleII: a.usefulLifeMonths !== a.scheduleIiLifeMonths,
      // Copied from the asset class when this asset was capitalised, so the
      // disclosure stays attached to the asset even if the class is edited
      // or the policy later reverts.
      usefulLifeNote: a.usefulLifeNote,
      grossCost: gross,
      residualValue: Number(a.residualValue),
      gstCapitalised: a.gstCapitalised,
      accumulatedDepreciation: accumulated,
      netBookValue: Number((gross - accumulated).toFixed(2)),
      status: a.status,
      disposalDate: isoDay(a.disposalDate),
      disposalProceeds: a.disposalProceeds === null ? null : Number(a.disposalProceeds),
      runs: a.runs.map((r) => ({
        id: r.id,
        periodStart: isoDay(r.periodStart),
        periodEnd: isoDay(r.periodEnd),
        frequency: r.frequency,
        amount: Number(r.amount),
        openingWdv: Number(r.openingWdv),
        closingWdv: Number(r.closingWdv),
        runType: r.runType,
        journalEntryId: r.journalEntryId,
        generatedAt: r.generatedAt,
      })),
    },
  });
});

// GET /fixed-assets/:id/schedule — the whole life of this asset, period by
// period.
//
// A PROJECTION, not a promise. It is computed from the asset as it stands
// today at the company's current frequency, so a policy that changes later
// will change what actually posts. Periods that HAVE posted are marked, and
// their real figures are returned in place of the projected ones — the two
// should agree, and where they do not the difference is worth seeing rather
// than smoothing over.
router.get("/:id/schedule", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  // An id that is not a uuid reaches Prisma as one anyway and comes back as
  // P2023, which the error handler turns into a 500 with a stack trace. It is
  // a client sending a bad URL, not a server fault.
  if (!UUID.test(req.params.id)) return res.status(404).json({ message: "Fixed asset not found." });

  const a = await prisma.fixedAsset.findFirst({
    where: { id: req.params.id, organizationId, deletedAt: null },
    include: { runs: { orderBy: { periodStart: "asc" } } },
  });
  if (!a) return res.status(404).json({ message: "Asset not found." });

  const now = new Date();
  const [frequency, method] = await Promise.all([
    frequencyInForce(organizationId),
    // The method in force NOW for this asset's class, not the one stamped on
    // the asset at capitalisation. A method change — company-wide or for the
    // class — applies prospectively to assets already capitalised, so the
    // projection has to follow it or it would forecast the wrong curve.
    methodInForce(organizationId, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), a.assetClassId),
  ]);
  const projected = buildSchedule({
    grossCost: Number(a.grossCost),
    residualValue: Number(a.residualValue),
    usefulLifeMonths: a.usefulLifeMonths,
    method: isDepreciationMethod(method) ? method : "SLM",
    inUseDate: isoDay(a.inUseDate)!,
    frequency,
  });

  const postedByStart = new Map(a.runs.map((r) => [isoDay(r.periodStart)!, r]));

  res.json({
    data: {
      assetCode: a.assetCode,
      name: a.name,
      method,
      frequency,
      usefulLifeMonths: a.usefulLifeMonths,
      grossCost: Number(a.grossCost),
      residualValue: Number(a.residualValue),
      periods: projected.map((p) => {
        const posted = postedByStart.get(p.periodStart);
        return {
          ...p,
          posted: !!posted,
          // What actually posted, where it did. Shown instead of the
          // projection rather than beside it, because the ledger is the
          // fact and this table is the estimate.
          amount: posted ? Number(posted.amount) : p.amount,
          openingWdv: posted ? Number(posted.openingWdv) : p.openingWdv,
          closingWdv: posted ? Number(posted.closingWdv) : p.closingWdv,
        };
      }),
    },
  });
});

export default router;
