import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { SALES_REVENUE_CODE } from "./salesInvoices";

// Charge Master - the labels an invoice may put on freight, packing,
// insurance and the like, each bound to the income account it credits.
//
// WHY THIS TABLE EXISTS. migration_054 shipped charges with a free-text
// label. That drifts: "Delivery charges", "Delivery Charges", "Delivery",
// "Frieght", all on account 5002, and any report grouping by label breaks
// into four rows that are one thing. The account was always the stable key
// and the label never was, so the label stops being typed and starts being
// chosen. A unique index on lower(label) per organisation is what actually
// enforces it - see migration_055.
//
// There is deliberately NO tax rate here, for the same reason there is none
// on a charge row: a charge is prorated into the goods lines and taxed at
// THEIR rate (section 8(a), composite supply), so it never has a rate of its
// own to get wrong. See lib/discountGst.ts.
//
// Gated on coa.manage rather than a permission of its own. The only decision
// a charge type encodes is which income head a recovery lands in, which is a
// chart-of-accounts decision wearing a friendlier name - and adding a
// permission to the catalogue changes every custom role's grid for one
// screen that nobody would grant separately.
const router = Router();
router.use(authenticate, requireActiveSubscription);
const canManage = requirePermission("coa.manage");

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

const withAccount = {
  account: { select: { id: true, accountCode: true, accountName: true, accountType: true } },
} as const;

// The account a charge type may point at, and the one refusal that matters.
// Returns an error message, or null when the account is fine.
//
// Both halves are the same rule the invoice already enforces (see the charge
// validation in routes/salesInvoices.ts), applied one step earlier. Checking
// it here as well is not duplication for its own sake: a master row that
// cannot be used is worse than a refusal at the point of creation, because
// the user finds out about it mid-invoice with a customer waiting.
async function accountProblem(organizationId: string, accountId: unknown): Promise<string | null> {
  if (!accountId || typeof accountId !== "string") return "Choose the income account this charge credits.";
  const account = await prisma.account.findFirst({
    where: { id: accountId, organizationId, deletedAt: null },
    select: { accountType: true, accountCode: true, isGroup: true },
  });
  if (!account) return "That account does not belong to this organization.";
  if (account.accountType !== "INCOME" || account.isGroup) {
    return "A charge recovers money from a customer, so it must credit an income account that is not a group.";
  }
  if (account.accountCode === SALES_REVENUE_CODE) {
    return "A charge cannot credit Sales Revenue — use a separate head such as Freight & Delivery " +
      "Recovered, so what you recover on delivery can be read against what delivery costs you.";
  }
  return null;
}

// GET /charge-types - active only by default, because that is what a picker
// wants; ?includeInactive=true for the master screen, which has to show the
// retired ones in order to bring one back.
router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const includeInactive = String(req.query.includeInactive ?? "") === "true";
  const chargeTypes = await prisma.chargeType.findMany({
    where: { organizationId, ...(includeInactive ? {} : { isActive: true }) },
    include: withAccount,
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
  res.json({ data: chargeTypes });
});

router.post("/", canManage, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const { label, accountId, sortOrder } = req.body ?? {};

  const trimmed = String(label ?? "").trim();
  if (!trimmed) return res.status(400).json({ message: "Give the charge a label." });
  if (trimmed.length > 60) return res.status(400).json({ message: "A charge label is at most 60 characters." });

  const problem = await accountProblem(organizationId, accountId);
  if (problem) return res.status(400).json({ message: problem });

  // Case-insensitively, because that is the whole point. The unique index in
  // migration_055 is the real guard; this exists so the user gets a sentence
  // instead of a constraint violation.
  const clash = await prisma.chargeType.findFirst({
    where: { organizationId, label: { equals: trimmed, mode: "insensitive" } },
    select: { label: true, isActive: true },
  });
  if (clash) {
    return res.status(409).json({
      message: clash.isActive
        ? `"${clash.label}" already exists.`
        : `"${clash.label}" already exists but is inactive — reactivate it rather than adding a second one.`,
    });
  }

  const chargeType = await prisma.chargeType.create({
    data: {
      organizationId, label: trimmed, accountId: String(accountId),
      sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
    },
    include: withAccount,
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "CREATE", entityType: "charge_type", entityId: chargeType.id,
    summary: `Created charge type ${chargeType.label} — credits ${chargeType.account.accountCode}`,
  });
  res.status(201).json({ data: chargeType });
});

// PATCH /charge-types/:id - label, account and order.
//
// THE ACCOUNT IS EDITABLE, AND THAT IS SAFE, which is worth stating because
// it looks like it should not be. Every charge already posted holds its own
// account_id, snapshotted at the time (migration_054), so repointing a type
// changes where the NEXT charge lands and rewrites nothing that has been
// issued. Same reasoning as a customer's GSTIN on an old invoice.
router.patch("/:id", canManage, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const existing = await prisma.chargeType.findFirst({
    where: { id: req.params.id, organizationId },
  });
  if (!existing) return res.status(404).json({ message: "Charge type not found." });

  const { label, accountId, sortOrder } = req.body ?? {};
  const data: { label?: string; accountId?: string; sortOrder?: number } = {};

  if (label !== undefined) {
    const trimmed = String(label).trim();
    if (!trimmed) return res.status(400).json({ message: "Give the charge a label." });
    if (trimmed.length > 60) return res.status(400).json({ message: "A charge label is at most 60 characters." });
    const clash = await prisma.chargeType.findFirst({
      where: { organizationId, label: { equals: trimmed, mode: "insensitive" }, id: { not: existing.id } },
      select: { label: true },
    });
    if (clash) return res.status(409).json({ message: `"${clash.label}" already exists.` });
    data.label = trimmed;
  }
  if (accountId !== undefined) {
    const problem = await accountProblem(organizationId, accountId);
    if (problem) return res.status(400).json({ message: problem });
    data.accountId = String(accountId);
  }
  if (sortOrder !== undefined && Number.isFinite(Number(sortOrder))) data.sortOrder = Number(sortOrder);

  const chargeType = await prisma.chargeType.update({
    where: { id: existing.id }, data, include: withAccount,
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "charge_type", entityId: chargeType.id,
    summary: `Updated charge type ${chargeType.label}`,
  });
  res.json({ data: chargeType });
});

// PATCH /charge-types/:id/toggle - retire it, or bring it back.
//
// There is no DELETE, and there should not be. A charge type that has been
// used is pointed at by documents; deleting it would either fail on the
// foreign key or, worse, take the link with it and leave a report unable to
// say what a recovery was for. Deactivating takes it out of the picker and
// leaves every invoice it ever appeared on exactly as it was.
router.patch("/:id/toggle", canManage, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const existing = await prisma.chargeType.findFirst({
    where: { id: req.params.id, organizationId },
  });
  if (!existing) return res.status(404).json({ message: "Charge type not found." });

  const chargeType = await prisma.chargeType.update({
    where: { id: existing.id },
    data: { isActive: !existing.isActive },
    include: withAccount,
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "charge_type", entityId: chargeType.id,
    summary: `${chargeType.isActive ? "Reactivated" : "Deactivated"} charge type ${chargeType.label}`,
  });
  res.json({ data: chargeType });
});

export default router;
