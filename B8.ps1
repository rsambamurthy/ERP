$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Fixed asset register: endpoint...' -ForegroundColor Cyan

function Set-FileText($rel, $text) {
  $p = Join-Path $repo $rel
  $dir = Split-Path $p -Parent
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::WriteAllText($p, $text.Replace([string][char]13, ''), (New-Object Text.UTF8Encoding $false))
  Write-Host "  wrote  $rel"
}
function Edit-FileText($rel, $old, $new) {
  $p = Join-Path $repo $rel
  if (-not (Test-Path -LiteralPath $p)) { throw "Missing file: $rel" }
  $old = $old.Replace([string][char]13, '')
  $new = $new.Replace([string][char]13, '')
  $t = [IO.File]::ReadAllText($p).Replace([string][char]13, '')
  if ($t.Contains($new)) { Write-Host "  skip   $rel"; return }
  $i = $t.IndexOf($old)
  if ($i -lt 0) { throw "Anchor not found in $rel." }
  if ($t.IndexOf($old, $i + 1) -ge 0) { throw "Anchor is not unique in $rel." }
  $t = $t.Substring(0, $i) + $new + $t.Substring($i + $old.Length)
  [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
  Write-Host "  edit   $rel"
}

Set-FileText 'backend/src/routes/fixedAssets.ts' 'import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requireActiveSubscription, resolveOrgId } from "../middleware/auth";

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

  const includeDisposed = String(req.query.includeDisposed ?? "") === "true";

  const assets = await prisma.fixedAsset.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ...(includeDisposed ? {} : { status: { not: "DISPOSED" } }),
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
        // True when this asset''s life departs from what Schedule II
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
router.get("/:id", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

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
      // The asset''s own sub-ledger card. Both balance-sheet accounts are
      // tagged to it, which is what makes one asset''s gross block and
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

export default router;
'

Edit-FileText 'backend/src/index.ts' 'import depreciationPolicyRoutes from "./routes/depreciationPolicy";
' 'import depreciationPolicyRoutes from "./routes/depreciationPolicy";
import fixedAssetsRoutes from "./routes/fixedAssets";
'

Edit-FileText 'backend/src/index.ts' 'app.use("/depreciation-policy", depreciationPolicyRoutes);
' 'app.use("/depreciation-policy", depreciationPolicyRoutes);
app.use("/fixed-assets", fixedAssetsRoutes);
'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green