import { Router } from "express";
import { prisma } from "../db";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate);

const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];
const BP_TYPES = ["CUSTOMER", "VENDOR", "ITEM"];

// GET /accounts — full chart of accounts for the org, ordered like a COA
// screen expects (by type, then sort order, then code).
router.get("/", async (req, res) => {
  const accounts = await prisma.account.findMany({
    where: { organizationId: req.user!.organizationId, deletedAt: null },
    orderBy: [{ accountType: "asc" }, { sortOrder: "asc" }, { accountCode: "asc" }],
  });
  res.json({ data: accounts });
});

// POST /accounts — add a custom account on top of the provisioned/templated
// ones. Templated accounts are is_system=true and protected from structural
// edits (see PATCH below), but nothing stops adding new ones here.
router.post("/", async (req, res) => {
  const {
    accountCode, accountName, accountType, subType, description,
    parentId, isGroup, isControlAccount, defaultBpType,
    openingBalance, openingBalanceType, openingBalanceDate,
  } = req.body ?? {};

  if (!accountCode || !accountName || !accountType) {
    return res.status(400).json({ message: "accountCode, accountName, and accountType are required." });
  }
  if (!ACCOUNT_TYPES.includes(accountType)) {
    return res.status(400).json({ message: `accountType must be one of ${ACCOUNT_TYPES.join(", ")}.` });
  }
  if (defaultBpType && !BP_TYPES.includes(defaultBpType)) {
    return res.status(400).json({ message: `defaultBpType must be one of ${BP_TYPES.join(", ")}.` });
  }

  const existing = await prisma.account.findUnique({
    where: { organizationId_accountCode: { organizationId: req.user!.organizationId, accountCode } },
  });
  if (existing) return res.status(409).json({ message: `Account code ${accountCode} already exists.` });

  const account = await prisma.account.create({
    data: {
      organizationId: req.user!.organizationId,
      accountCode, accountName, accountType,
      subType: subType ?? null,
      description: description ?? null,
      parentId: parentId ?? null,
      isGroup: !!isGroup,
      isControlAccount: !!isControlAccount,
      defaultBpType: isControlAccount ? (defaultBpType ?? null) : null,
      isSystem: false,
      openingBalance: openingBalance ?? null,
      openingBalanceType: openingBalanceType ?? null,
      openingBalanceDate: openingBalanceDate ? new Date(openingBalanceDate) : null,
    },
  });
  res.status(201).json({ data: account });
});

// PATCH /accounts/:id — system (templated) accounts keep their code/type/
// hierarchy fixed; everything else is editable by anyone.
router.patch("/:id", async (req, res) => {
  const account = await prisma.account.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
  });
  if (!account) return res.status(404).json({ message: "Account not found." });

  const body = req.body ?? {};
  const openingBalanceDate = body.openingBalanceDate ? new Date(body.openingBalanceDate) : undefined;

  const data = account.isSystem
    ? {
        accountName: body.accountName,
        description: body.description,
        isControlAccount: body.isControlAccount,
        defaultBpType: body.isControlAccount ? body.defaultBpType : null,
        openingBalance: body.openingBalance,
        openingBalanceType: body.openingBalanceType,
        openingBalanceDate,
      }
    : { ...body, openingBalanceDate };

  const updated = await prisma.account.update({ where: { id: account.id }, data });
  res.json({ data: updated });
});

// PATCH /accounts/:id/toggle — activate/deactivate (hide from pickers without
// losing history).
router.patch("/:id/toggle", async (req, res) => {
  const account = await prisma.account.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
  });
  if (!account) return res.status(404).json({ message: "Account not found." });
  if (account.isSystem) return res.status(409).json({ message: "System accounts cannot be deactivated." });

  const updated = await prisma.account.update({
    where: { id: account.id },
    data: { isActive: !account.isActive },
  });
  res.json({ data: updated });
});

// DELETE /accounts/:id — only if it has never been posted to.
router.delete("/:id", async (req, res) => {
  const account = await prisma.account.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
  });
  if (!account) return res.status(404).json({ message: "Account not found." });
  if (account.isSystem) return res.status(409).json({ message: "System accounts cannot be deleted." });

  const used = await prisma.journalLine.findFirst({ where: { accountId: account.id } });
  if (used) return res.status(409).json({ message: "This account has journal entries and cannot be deleted." });

  await prisma.account.update({ where: { id: account.id }, data: { deletedAt: new Date() } });
  res.json({ data: { deleted: true } });
});

export default router;
