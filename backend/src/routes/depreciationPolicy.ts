import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import {
  isDepreciationMethod, lastPostedChargeMonth, methodInForce, monthStart,
} from "../lib/depreciationPolicy";

// The company's depreciation policy: which method, and the record of every
// time it changed.
//
// Gated on company.manage rather than journal.post. Changing the method is
// not a transaction — it is an accounting policy decision that alters every
// future charge on every asset, and it has to be disclosed. That is a
// company-level act, not a bookkeeping one.

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

// GET /depreciation-policy — the method in force this month, the method any
// future-dated change will move to, and the full history.
router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const now = new Date();
  const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [current, changes, lastPosted] = await Promise.all([
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
  ]);

  res.json({
    data: {
      currentMethod: current,
      // What a change may not reach back past. Null means nothing has ever
      // posted, so any month from this one onward is available.
      lastPostedChargeMonth: lastPosted ? monthLabel(lastPosted) : null,
      earliestEffectiveMonth: monthLabel(
        lastPosted
          ? new Date(Date.UTC(lastPosted.getUTCFullYear(), lastPosted.getUTCMonth() + 1, 1))
          : thisMonth,
      ),
      changes: changes.map((c) => ({
        id: c.id,
        fromMethod: c.fromMethod,
        toMethod: c.toMethod,
        effectiveMonth: monthLabel(c.effectiveMonth),
        reason: c.reason,
        recordedAt: c.createdAt,
      })),
    },
  });
});

// POST /depreciation-policy/change — switch method from a stated month.
//
// Prospective by construction: nothing already posted is touched, and the
// effective month cannot reach back to or past the last posted charge.
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
      message: `Depreciation has already posted for ${monthLabel(lastPosted)}. A change of method is prospective — it can take effect from ${monthLabel(new Date(Date.UTC(lastPosted.getUTCFullYear(), lastPosted.getUTCMonth() + 1, 1)))} at the earliest, and never restates a charge already made.`,
    });
  }

  const fromMethod = await methodInForce(organizationId, effective);
  if (fromMethod === toMethod) {
    return res.status(400).json({ message: `The method in force from ${monthLabel(effective)} is already ${toMethod}.` });
  }

  // Switching to WDV needs every live asset to carry a residual: the rate is
  // 1 - (residual/carrying)^(1/remaining), which at a zero residual is 1 —
  // the whole remaining value written off in a single month. Caught here,
  // naming the assets, rather than surfacing later as a constraint violation
  // or, worse, as a charge nobody questioned.
  if (toMethod === "WDV") {
    const zeroResidual = await prisma.fixedAsset.findMany({
      where: { organizationId, status: "ACTIVE", deletedAt: null, residualValue: 0 },
      select: { assetCode: true, name: true },
      take: 6,
    });
    if (zeroResidual.length > 0) {
      const named = zeroResidual.slice(0, 5).map((a) => `${a.assetCode} ${a.name}`).join(", ");
      return res.status(400).json({
        message: `Written-down value needs a residual value above zero, and these assets have none: ${named}${zeroResidual.length > 5 ? " and others" : ""}. Give them a residual before switching, or the whole remaining value would be written off in one month.`,
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
// Only a future-dated one. Once a month has been depreciated under a method,
// removing the change that put it there would make the posted charges
// unexplainable by the policy history — and the history is what the engine
// reads, so it would also change what future months compute.
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
