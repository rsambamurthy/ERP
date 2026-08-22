$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Depreciation configuration endpoint...' -ForegroundColor Cyan

function Set-FileText($rel, $text) {
  $p = Join-Path $repo $rel
  $dir = Split-Path $p -Parent
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::WriteAllText($p, $text.Replace([string][char]13, ''), (New-Object Text.UTF8Encoding $false))
  Write-Host "  wrote  $rel"
}

Set-FileText 'backend/src/routes/depreciationPolicy.ts' 'import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import {
  isDepreciationFrequency, isDepreciationMethod, lastPostedChargeMonth,
  methodInForce, monthStart,
} from "../lib/depreciationPolicy";

// Configuration > Depreciation. Everything about how this company
// depreciates, in one place:
//
//   1. the useful life per asset class — what Schedule II prescribes, and
//      what this company has adopted, which may be shorter
//   2. the method, SLM or WDV
//   3. how often the charge is posted
//   4. the residual percentage per class
//   5. the rate formulas, shown so the arithmetic is never a mystery
//   6. the capitalisation threshold
//
// All of it is org-level policy, so all of it is gated on company.manage
// rather than journal.post. None of these are transactions; they are
// decisions that change what every future charge on every asset will be,
// and most of them have to be disclosed.
//
// What is NOT here: anything retrospective. Editing a class changes what
// FUTURE assets do — every asset copies its accounts, life, method and
// residual at capitalisation — and changing the method applies from a stated
// month forward. Nothing on this screen can rewrite a charge already posted.

const router = Router();
router.use(authenticate, requireActiveSubscription);
const canManageCompany = requirePermission("company.manage");

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

function monthLabel(d: Date): string {
  return d.toISOString().slice(0, 7);
}

function nextMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

// GET /depreciation-policy — the whole configuration.
router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const now = new Date();
  const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [org, current, changes, lastPosted, classes] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { depreciationFrequency: true, capitalisationThreshold: true },
    }),
    methodInForce(organizationId, thisMonth),
    prisma.depreciationMethodChange.findMany({
      where: { organizationId },
      orderBy: { effectiveMonth: "desc" },
      select: {
        id: true, fromMethod: true, toMethod: true, effectiveMonth: true,
        reason: true, createdAt: true,
      },
    }),
    lastPostedChargeMonth(organizationId),
    prisma.assetClass.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true, name: true, isActive: true,
        scheduleIiLifeMonths: true, defaultUsefulLifeMonths: true,
        lifePolicyNote: true, defaultResidualPct: true,
        assetAccount: { select: { accountCode: true, accountName: true } },
      },
    }),
  ]);

  res.json({
    data: {
      currentMethod: current,
      frequency: org?.depreciationFrequency ?? "MONTHLY",
      capitalisationThreshold: Number(org?.capitalisationThreshold ?? 0),
      // The end of the last posted period, so a change can never land inside
      // a period already charged.
      lastPostedChargeMonth: lastPosted ? monthLabel(lastPosted) : null,
      earliestEffectiveMonth: monthLabel(lastPosted ? nextMonth(lastPosted) : thisMonth),
      changes: changes.map((c) => ({
        id: c.id,
        fromMethod: c.fromMethod,
        toMethod: c.toMethod,
        effectiveMonth: monthLabel(c.effectiveMonth),
        reason: c.reason,
        recordedAt: c.createdAt,
      })),
      classes: classes.map((c) => ({
        id: c.id,
        name: c.name,
        isActive: c.isActive,
        scheduleIiLifeMonths: c.scheduleIiLifeMonths,
        usefulLifeMonths: c.defaultUsefulLifeMonths,
        lifePolicyNote: c.lifePolicyNote,
        residualPct: Number(c.defaultResidualPct),
        assetAccount: c.assetAccount,
      })),
    },
  });
});

// PATCH /depreciation-policy — frequency and threshold.
//
// Neither is dated. A frequency change applies from the next period nobody
// has posted yet, and every run already written carries the frequency it was
// computed at, so no history is lost by storing only the current value. The
// threshold only ever affects a bill entered after it is set.
router.patch("/", canManageCompany, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const { frequency, capitalisationThreshold } = req.body ?? {};
  const data: { depreciationFrequency?: string; capitalisationThreshold?: number } = {};

  if (frequency !== undefined) {
    if (!isDepreciationFrequency(frequency)) {
      return res.status(400).json({ message: "frequency must be MONTHLY, QUARTERLY, HALF_YEARLY or ANNUAL." });
    }
    data.depreciationFrequency = frequency;
  }

  if (capitalisationThreshold !== undefined) {
    const amount = Number(capitalisationThreshold);
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ message: "The capitalisation threshold must be zero or more. Zero means no threshold." });
    }
    data.capitalisationThreshold = amount;
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ message: "Nothing to change." });
  }

  await prisma.organization.update({ where: { id: organizationId }, data });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "depreciation_policy", entityId: organizationId,
    summary: [
      data.depreciationFrequency ? `frequency ${data.depreciationFrequency}` : null,
      data.capitalisationThreshold !== undefined ? `capitalisation threshold ${data.capitalisationThreshold}` : null,
    ].filter(Boolean).join(", "),
  });

  res.json({ data });
});

// PATCH /depreciation-policy/classes/:id — a class''s lives, residual and the
// justification for adopting a life the statute does not prescribe.
//
// Everything here affects FUTURE assets only. An asset copies its life,
// residual and accounts at capitalisation precisely so that editing a class
// later cannot redirect or re-rate something already half depreciated.
router.patch("/classes/:id", canManageCompany, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const cls = await prisma.assetClass.findFirst({ where: { id: req.params.id, organizationId } });
  if (!cls) return res.status(404).json({ message: "Asset class not found." });

  const { usefulLifeMonths, scheduleIiLifeMonths, lifePolicyNote, residualPct, isActive } = req.body ?? {};

  const life = usefulLifeMonths === undefined ? cls.defaultUsefulLifeMonths : Number(usefulLifeMonths);
  const statutory = scheduleIiLifeMonths === undefined ? cls.scheduleIiLifeMonths : Number(scheduleIiLifeMonths);
  const note = lifePolicyNote === undefined
    ? (cls.lifePolicyNote ?? "")
    : String(lifePolicyNote ?? "").trim();

  for (const [label, value] of [["useful life", life], ["Schedule II life", statutory]] as const) {
    if (!Number.isInteger(value) || value < 1 || value > 1200) {
      return res.status(400).json({ message: `The ${label} must be a whole number of months between 1 and 1200.` });
    }
  }

  const residual = residualPct === undefined ? Number(cls.defaultResidualPct) : Number(residualPct);
  if (!Number.isFinite(residual) || residual < 0 || residual >= 100) {
    // 100% would mean an asset that never depreciates, which is not a
    // residual but a decision not to depreciate at all.
    return res.status(400).json({ message: "The residual percentage must be zero or more and under 100." });
  }

  // Part A paragraph 3(i). One justification for the policy, not one per
  // asset — assets copy it. Required in both directions: the 2014 amendment
  // made a longer life as disclosable as a shorter one.
  if (life !== statutory && !note) {
    const direction = life > statutory ? "longer" : "shorter";
    return res.status(400).json({
      message: `${life} months is ${direction} than the ${statutory} months Schedule II prescribes for ${cls.name}. Record the justification — Part A paragraph 3(i) requires the difference to be disclosed, supported by technical advice.`,
    });
  }
  if (note.length > 500) {
    return res.status(400).json({ message: "The justification can be at most 500 characters." });
  }

  const updated = await prisma.assetClass.update({
    where: { id: cls.id },
    data: {
      defaultUsefulLifeMonths: life,
      scheduleIiLifeMonths: statutory,
      // Cleared automatically when the policy returns to the statutory life,
      // so a stale justification cannot outlive the deviation it explained.
      lifePolicyNote: life === statutory ? null : note,
      defaultResidualPct: residual,
      ...(isActive === undefined ? {} : { isActive: !!isActive }),
    },
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "asset_class", entityId: cls.id,
    summary: `${cls.name}: life ${cls.defaultUsefulLifeMonths}→${life} months (Schedule II ${cls.scheduleIiLifeMonths}→${statutory}), residual ${Number(cls.defaultResidualPct)}→${residual}%`,
  });

  res.json({ data: { id: updated.id } });
});

// POST /depreciation-policy/change — switch method from a stated month.
//
// Prospective by construction: nothing already posted is touched, and the
// effective month cannot reach back into a period already charged.
router.post("/change", canManageCompany, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const { toMethod, effectiveMonth, reason } = req.body ?? {};

  if (!isDepreciationMethod(toMethod)) {
    return res.status(400).json({ message: "toMethod must be SLM or WDV." });
  }
  const effective = monthStart(effectiveMonth);
  if (!effective) {
    return res.status(400).json({ message: "effectiveMonth is required, as YYYY-MM." });
  }
  const note = String(reason ?? "").trim();
  if (!note) {
    // Not a formality. A change in accounting estimate is disclosable, and
    // an undisclosed change of method is not a thing that exists.
    return res.status(400).json({ message: "A reason is required — a change of method has to be disclosed, and this is what the disclosure is written from." });
  }
  if (note.length > 500) {
    return res.status(400).json({ message: "The reason can be at most 500 characters." });
  }

  const lastPosted = await lastPostedChargeMonth(organizationId);
  if (lastPosted && effective <= lastPosted) {
    return res.status(400).json({
      message: `Depreciation has already posted up to ${monthLabel(lastPosted)}. A change of method is prospective — it can take effect from ${monthLabel(nextMonth(lastPosted))} at the earliest, and never restates a charge already made.`,
    });
  }

  const fromMethod = await methodInForce(organizationId, effective);
  if (fromMethod === toMethod) {
    return res.status(400).json({ message: `The method in force from ${monthLabel(effective)} is already ${toMethod}.` });
  }

  // Switching to WDV needs every live asset to carry a residual: the rate is
  // 1 - residual%^(1/life), which at a zero residual is 1 — the whole
  // remaining value written off in a single period. Caught here, naming the
  // assets, rather than surfacing later as a constraint violation or, worse,
  // as a charge nobody questioned.
  if (toMethod === "WDV") {
    const zeroResidual = await prisma.fixedAsset.findMany({
      where: { organizationId, status: "ACTIVE", deletedAt: null, residualValue: 0 },
      select: { assetCode: true, name: true },
      take: 6,
    });
    if (zeroResidual.length > 0) {
      const named = zeroResidual.slice(0, 5).map((a) => `${a.assetCode} ${a.name}`).join(", ");
      return res.status(400).json({
        message: `Written-down value needs a residual value above zero, and these assets have none: ${named}${zeroResidual.length > 5 ? " and others" : ""}. Give them a residual before switching, or the whole remaining value would be written off in one period.`,
      });
    }
  }

  const change = await prisma.depreciationMethodChange.create({
    data: {
      organizationId, fromMethod, toMethod,
      effectiveMonth: effective, reason: note,
      changedBy: req.user!.userId,
    },
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "depreciation_policy", entityId: change.id,
    summary: `Depreciation method ${fromMethod} to ${toMethod} from ${monthLabel(effective)} — ${note}`,
  });

  res.status(201).json({
    data: {
      id: change.id,
      fromMethod, toMethod,
      effectiveMonth: monthLabel(effective),
      reason: note,
    },
  });
});

// DELETE /depreciation-policy/change/:id — undo a change that has not taken
// effect yet.
//
// Only a future-dated one. Once a period has been depreciated under a
// method, removing the change that put it there would make the posted
// charges unexplainable by the policy history — and the history is what the
// engine reads, so it would also change what future periods compute.
router.delete("/change/:id", canManageCompany, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const change = await prisma.depreciationMethodChange.findFirst({
    where: { id: req.params.id, organizationId },
  });
  if (!change) return res.status(404).json({ message: "Change not found." });

  const lastPosted = await lastPostedChargeMonth(organizationId);
  if (lastPosted && change.effectiveMonth <= lastPosted) {
    return res.status(400).json({
      message: `This change is already in effect — depreciation has posted up to ${monthLabel(lastPosted)} under it. It can no longer be withdrawn.`,
    });
  }

  await prisma.depreciationMethodChange.delete({ where: { id: change.id } });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "DELETE", entityType: "depreciation_policy", entityId: change.id,
    summary: `Withdrew the ${change.fromMethod} to ${change.toMethod} change dated ${monthLabel(change.effectiveMonth)} before it took effect`,
  });

  res.json({ data: { id: change.id } });
});

export default router;
'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green