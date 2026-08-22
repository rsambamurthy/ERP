$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Class-level method: schema, helper, routes...' -ForegroundColor Cyan

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

Edit-FileText 'backend/prisma/schema.prisma' '  depExpenseAccount Account    @relation("AssetClassExpense", fields: [depExpenseAccountId], references: [id])
  assets          FixedAsset[]
  items           Item[]

  @@unique([organizationId, name])
  @@map("asset_classes")' '  depExpenseAccount Account    @relation("AssetClassExpense", fields: [depExpenseAccountId], references: [id])
  assets          FixedAsset[]
  items           Item[]
  methodChanges   DepreciationMethodChange[]

  @@unique([organizationId, name])
  @@map("asset_classes")'

Edit-FileText 'backend/prisma/schema.prisma' 'model DepreciationMethodChange {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId String   @map("organization_id") @db.Uuid
  fromMethod     String   @map("from_method") @db.VarChar(3)
  toMethod       String   @map("to_method") @db.VarChar(3)
  // First of the month the new method starts applying from.' 'model DepreciationMethodChange {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId String   @map("organization_id") @db.Uuid
  // NULL means the change applies company-wide; an id scopes it to that one
  // asset class. Most companies use a single method, but a company may
  // reasonably depreciate plant on WDV and buildings on SLM provided the
  // policy note says which — see migration_039.
  assetClassId   String?  @map("asset_class_id") @db.Uuid
  fromMethod     String   @map("from_method") @db.VarChar(3)
  toMethod       String   @map("to_method") @db.VarChar(3)
  // First of the month the new method starts applying from.'

Edit-FileText 'backend/prisma/schema.prisma' '  createdAt      DateTime @default(now()) @map("created_at")

  organization Organization @relation(fields: [organizationId], references: [id])

  @@unique([organizationId, effectiveMonth])
  @@map("depreciation_method_changes")
}
' '  createdAt      DateTime @default(now()) @map("created_at")

  organization Organization @relation(fields: [organizationId], references: [id])
  assetClass   AssetClass?  @relation(fields: [assetClassId], references: [id])

  // Uniqueness is two PARTIAL indexes in migration_039 — one company-wide
  // change per month, one per class per month — which Prisma cannot express:
  // a plain unique over (org, class, month) would admit two company-wide
  // changes in a month, because Postgres treats NULLs as distinct.
  @@index([organizationId, assetClassId, effectiveMonth])
  @@map("depreciation_method_changes")
}
'

Edit-FileText 'backend/src/lib/depreciationPolicy.ts' 'export async function methodInForce(
  organizationId: string,
  month: Date,
): Promise<DepreciationMethod> {
  const change = await prisma.depreciationMethodChange.findFirst({
    where: { organizationId, effectiveMonth: { lte: month } },
    orderBy: { effectiveMonth: "desc" },
    select: { toMethod: true },
  });' 'export async function methodInForce(
  organizationId: string,
  month: Date,
  assetClassId?: string | null,
): Promise<DepreciationMethod> {
  // A class that has been given its own method keeps it even when the
  // company changes — that is what an override means. A class that never
  // has follows the company automatically, with nothing to configure.
  if (assetClassId) {
    const forClass = await prisma.depreciationMethodChange.findFirst({
      where: { organizationId, assetClassId, effectiveMonth: { lte: month } },
      orderBy: { effectiveMonth: "desc" },
      select: { toMethod: true },
    });
    if (forClass && isDepreciationMethod(forClass.toMethod)) return forClass.toMethod;
  }

  const change = await prisma.depreciationMethodChange.findFirst({
    where: { organizationId, assetClassId: null, effectiveMonth: { lte: month } },
    orderBy: { effectiveMonth: "desc" },
    select: { toMethod: true },
  });'

Edit-FileText 'backend/src/routes/depreciationPolicy.ts' '//
//   1. the useful life per asset class — what Schedule II prescribes, and
//      what this company has adopted, which may be shorter
//   2. the method, SLM or WDV
//   3. how often the charge is posted
//   4. the residual percentage per class
//   5. the rate formulas, shown so the arithmetic is never a mystery' '//
//   1. the useful life per asset class — what Schedule II prescribes, and
//      what this company has adopted, which may be shorter
//   2. the method, SLM or WDV — company-wide, or per class where a company
//      depreciates one class differently from the rest
//   3. how often the charge is posted
//   4. the residual percentage per class
//   5. the rate formulas, shown so the arithmetic is never a mystery'

Edit-FileText 'backend/src/routes/depreciationPolicy.ts' '      select: {
        id: true, fromMethod: true, toMethod: true, effectiveMonth: true,
        reason: true, createdAt: true,
      },
    }),
    lastPostedChargeMonth(organizationId),' '      select: {
        id: true, fromMethod: true, toMethod: true, effectiveMonth: true,
        reason: true, createdAt: true,
        assetClass: { select: { id: true, name: true } },
      },
    }),
    lastPostedChargeMonth(organizationId),'

Edit-FileText 'backend/src/routes/depreciationPolicy.ts' '      },
    }),
  ]);

  res.json({
    data: {' '      },
    }),
  ]);

  // Resolved per class, because a class may carry its own method. Done
  // after the classes are known rather than in the Promise.all above.
  const classMethods = await Promise.all(
    classes.map((c) => methodInForce(organizationId, thisMonth, c.id)),
  );

  res.json({
    data: {'

Edit-FileText 'backend/src/routes/depreciationPolicy.ts' '        effectiveMonth: monthLabel(c.effectiveMonth),
        reason: c.reason,
        recordedAt: c.createdAt,
      })),
      classes: classes.map((c) => ({
        id: c.id,
        name: c.name,
        isActive: c.isActive,' '        effectiveMonth: monthLabel(c.effectiveMonth),
        reason: c.reason,
        recordedAt: c.createdAt,
        // null means company-wide.
        assetClass: c.assetClass,
      })),
      classes: classes.map((c, idx) => ({
        id: c.id,
        name: c.name,
        isActive: c.isActive,'

Edit-FileText 'backend/src/routes/depreciationPolicy.ts' '        lifePolicyNote: c.lifePolicyNote,
        residualPct: Number(c.defaultResidualPct),
        assetAccount: c.assetAccount,
      })),
    },
  });' '        lifePolicyNote: c.lifePolicyNote,
        residualPct: Number(c.defaultResidualPct),
        assetAccount: c.assetAccount,
        // What this class actually depreciates on today. differsFromCompany
        // is exactly that and no more — a class may carry an explicit
        // override that happens to match the company, and calling that "its
        // own" would be a claim this figure cannot support.
        method: classMethods[idx],
        differsFromCompany: classMethods[idx] !== current,
      })),
    },
  });'

Edit-FileText 'backend/src/routes/depreciationPolicy.ts' '  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const { toMethod, effectiveMonth, reason } = req.body ?? {};

  if (!isDepreciationMethod(toMethod)) {
    return res.status(400).json({ message: "toMethod must be SLM or WDV." });' '  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const { toMethod, effectiveMonth, reason, assetClassId } = req.body ?? {};

  if (!isDepreciationMethod(toMethod)) {
    return res.status(400).json({ message: "toMethod must be SLM or WDV." });'

Edit-FileText 'backend/src/routes/depreciationPolicy.ts' '    return res.status(400).json({ message: "The reason can be at most 500 characters." });
  }

  const lastPosted = await lastPostedChargeMonth(organizationId);
  if (lastPosted && effective <= lastPosted) {
    return res.status(400).json({' '    return res.status(400).json({ message: "The reason can be at most 500 characters." });
  }

  // Scope. Absent means company-wide; a class id scopes the change to that
  // class alone, which then keeps its method even when the company changes.
  let scope: { id: string; name: string } | null = null;
  if (assetClassId) {
    const cls = await prisma.assetClass.findFirst({
      where: { id: String(assetClassId), organizationId },
      select: { id: true, name: true },
    });
    if (!cls) return res.status(400).json({ message: "That asset class doesn''t belong to this organization." });
    scope = cls;
  }

  const lastPosted = await lastPostedChargeMonth(organizationId);
  if (lastPosted && effective <= lastPosted) {
    return res.status(400).json({'

Edit-FileText 'backend/src/routes/depreciationPolicy.ts' '    });
  }

  const fromMethod = await methodInForce(organizationId, effective);
  if (fromMethod === toMethod) {
    return res.status(400).json({ message: `The method in force from ${monthLabel(effective)} is already ${toMethod}.` });
  }

  // Switching to WDV needs every live asset to carry a residual: the rate is' '    });
  }

  const fromMethod = await methodInForce(organizationId, effective, scope?.id ?? null);
  if (fromMethod === toMethod) {
    return res.status(400).json({
      message: scope
        ? `${scope.name} already depreciates on ${toMethod} from ${monthLabel(effective)}.`
        : `The method in force from ${monthLabel(effective)} is already ${toMethod}.`,
    });
  }

  // Switching to WDV needs every live asset to carry a residual: the rate is'

Edit-FileText 'backend/src/routes/depreciationPolicy.ts' '  // as a charge nobody questioned.
  if (toMethod === "WDV") {
    const zeroResidual = await prisma.fixedAsset.findMany({
      where: { organizationId, status: "ACTIVE", deletedAt: null, residualValue: 0 },
      select: { assetCode: true, name: true },
      take: 6,
    });' '  // as a charge nobody questioned.
  if (toMethod === "WDV") {
    const zeroResidual = await prisma.fixedAsset.findMany({
      where: {
        organizationId, status: "ACTIVE", deletedAt: null, residualValue: 0,
        // Only the assets the change actually reaches.
        ...(scope ? { assetClassId: scope.id } : {}),
      },
      select: { assetCode: true, name: true },
      take: 6,
    });'

Edit-FileText 'backend/src/routes/depreciationPolicy.ts' '
  const change = await prisma.depreciationMethodChange.create({
    data: {
      organizationId, fromMethod, toMethod,
      effectiveMonth: effective, reason: note,
      changedBy: req.user!.userId,
    },' '
  const change = await prisma.depreciationMethodChange.create({
    data: {
      organizationId, assetClassId: scope?.id ?? null,
      fromMethod, toMethod,
      effectiveMonth: effective, reason: note,
      changedBy: req.user!.userId,
    },'

Edit-FileText 'backend/src/routes/depreciationPolicy.ts' '  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "depreciation_policy", entityId: change.id,
    summary: `Depreciation method ${fromMethod} to ${toMethod} from ${monthLabel(effective)} — ${note}`,
  });

  res.status(201).json({
    data: {
      id: change.id,
      fromMethod, toMethod,
      effectiveMonth: monthLabel(effective),
      reason: note,' '  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "depreciation_policy", entityId: change.id,
    summary: `${scope ? `${scope.name}: ` : "Company-wide: "}depreciation method ${fromMethod} to ${toMethod} from ${monthLabel(effective)} — ${note}`,
  });

  res.status(201).json({
    data: {
      id: change.id,
      assetClass: scope,
      fromMethod, toMethod,
      effectiveMonth: monthLabel(effective),
      reason: note,'

Edit-FileText 'backend/src/routes/purchaseBills.ts' '      // necessarily the method in force today: a change may already be dated
      // forward. Rejecting a line the policy would refuse is the point of
      // looking it up here rather than at posting time.
      const method = await methodInForce(organizationId, new Date(`${String(l.inUseDate).slice(0, 7)}-01T00:00:00.000Z`));
      capitalMethod.set(i, method);
      // fixed_assets_wdv_residual_ck says the same thing. The reason it is
      // said twice is that the consequence of it being wrong — the entire' '      // necessarily the method in force today: a change may already be dated
      // forward. Rejecting a line the policy would refuse is the point of
      // looking it up here rather than at posting time.
      // Scoped to the class: a class may carry its own method, and then it
      // keeps it even when the company changes.
      const method = await methodInForce(organizationId, new Date(`${String(l.inUseDate).slice(0, 7)}-01T00:00:00.000Z`), cls.id);
      capitalMethod.set(i, method);
      // fixed_assets_wdv_residual_ck says the same thing. The reason it is
      // said twice is that the consequence of it being wrong — the entire'

Edit-FileText 'backend/src/routes/fixedAssets.ts' 'import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { frequencyInForce, isDepreciationMethod } from "../lib/depreciationPolicy";
import { buildSchedule } from "../lib/depreciationSchedule";

// The fixed asset register.' 'import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { frequencyInForce, isDepreciationMethod, methodInForce } from "../lib/depreciationPolicy";
import { buildSchedule } from "../lib/depreciationSchedule";

// The fixed asset register.'

Edit-FileText 'backend/src/routes/fixedAssets.ts' '  });
  if (!a) return res.status(404).json({ message: "Asset not found." });

  const frequency = await frequencyInForce(organizationId);
  const projected = buildSchedule({
    grossCost: Number(a.grossCost),
    residualValue: Number(a.residualValue),
    usefulLifeMonths: a.usefulLifeMonths,
    method: isDepreciationMethod(a.method) ? a.method : "SLM",
    inUseDate: isoDay(a.inUseDate)!,
    frequency,
  });' '  });
  if (!a) return res.status(404).json({ message: "Asset not found." });

  const now = new Date();
  const [frequency, method] = await Promise.all([
    frequencyInForce(organizationId),
    // The method in force NOW for this asset''s class, not the one stamped on
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
  });'

Edit-FileText 'backend/src/routes/fixedAssets.ts' '    data: {
      assetCode: a.assetCode,
      name: a.name,
      method: a.method,
      frequency,
      usefulLifeMonths: a.usefulLifeMonths,
      grossCost: Number(a.grossCost),' '    data: {
      assetCode: a.assetCode,
      name: a.name,
      method,
      frequency,
      usefulLifeMonths: a.usefulLifeMonths,
      grossCost: Number(a.grossCost),'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green