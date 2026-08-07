import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { upload } from "../lib/upload";
import { buildTemplateWorkbook, loadUploadedWorksheet, cellText, cellDateIso } from "../lib/xlsxTemplate";
import { provisionOrganization } from "../lib/provisioning";

// Resolves the target org for this request (the caller's own org, or — for
// a platform admin — whichever org they passed via ?organizationId=/body).
function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

const router = Router();
router.use(authenticate, requireActiveSubscription);

const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];
const BP_TYPES = ["CUSTOMER", "VENDOR", "ITEM"];
// Restructuring the Chart of Accounts is an OWNER/ADMIN action — ACCOUNTANT
// and VIEWER can read it but not add, edit, or deactivate accounts.
const canManageCoa = requirePermission("coa.manage");

// GET /accounts — full chart of accounts for the org, ordered like a COA
// screen expects (by type, then sort order, then code).
router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const accounts = await prisma.account.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: [{ accountType: "asc" }, { sortOrder: "asc" }, { accountCode: "asc" }],
  });
  res.json({ data: accounts });
});

// POST /accounts/sync-templates — re-runs provisioning's account seeding
// for an org that already exists. Orgs provisioned before a given template
// account existed (e.g. anyone who signed up before Sales/Purchase/
// Inventory shipped GST Input/Output, COGS, Sales Revenue, Inventory
// Adjustments, Trade Receivables/Payables) never got it — provisioning
// only ever runs once, automatically, at signup. provisionOrganization()
// is safe to call again: it only adds accounts whose code doesn't already
// exist for this org, never touches or duplicates anything already there.
router.post("/sync-templates", canManageCoa, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const before = await prisma.account.count({ where: { organizationId } });
  await provisionOrganization(organizationId);
  const after = await prisma.account.count({ where: { organizationId } });
  const added = after - before;

  if (added > 0) {
    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "UPDATE", entityType: "account", entityId: organizationId,
      summary: `Synced Chart of Accounts from templates — ${added} account${added === 1 ? "" : "s"} added`,
    });
  }
  res.json({ data: { added } });
});

// POST /accounts — add a custom account on top of the provisioned/templated
// ones. Templated accounts are is_system=true and protected from structural
// edits (see PATCH below), but nothing stops adding new ones here.
router.post("/", canManageCoa, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
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
    where: { organizationId_accountCode: { organizationId, accountCode } },
  });
  if (existing) return res.status(409).json({ message: `Account code ${accountCode} already exists.` });

  const account = await prisma.account.create({
    data: {
      organizationId,
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
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "CREATE", entityType: "account", entityId: account.id,
    summary: `Created account ${account.accountCode} — ${account.accountName}`,
  });
  res.status(201).json({ data: account });
});

// PATCH /accounts/:id — system (templated) accounts keep their code/type/
// hierarchy fixed; everything else is editable by OWNER/ADMIN.
router.patch("/:id", canManageCoa, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const account = await prisma.account.findFirst({
    where: { id: req.params.id, organizationId },
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
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "account", entityId: account.id,
    summary: `Updated account ${account.accountCode} — ${account.accountName}`,
  });
  res.json({ data: updated });
});

// PATCH /accounts/:id/toggle — activate/deactivate (hide from pickers without
// losing history).
router.patch("/:id/toggle", canManageCoa, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const account = await prisma.account.findFirst({
    where: { id: req.params.id, organizationId },
  });
  if (!account) return res.status(404).json({ message: "Account not found." });
  if (account.isSystem) return res.status(409).json({ message: "System accounts cannot be deactivated." });

  const updated = await prisma.account.update({
    where: { id: account.id },
    data: { isActive: !account.isActive },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "TOGGLE", entityType: "account", entityId: account.id,
    summary: `${updated.isActive ? "Activated" : "Deactivated"} account ${account.accountCode} — ${account.accountName}`,
  });
  res.json({ data: updated });
});

// DELETE /accounts/:id — only if it has never been posted to.
router.delete("/:id", canManageCoa, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const account = await prisma.account.findFirst({
    where: { id: req.params.id, organizationId },
  });
  if (!account) return res.status(404).json({ message: "Account not found." });
  if (account.isSystem) return res.status(409).json({ message: "System accounts cannot be deleted." });

  const used = await prisma.journalLine.findFirst({ where: { accountId: account.id } });
  if (used) return res.status(409).json({ message: "This account has journal entries and cannot be deleted." });

  await prisma.account.update({ where: { id: account.id }, data: { deletedAt: new Date() } });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "DELETE", entityType: "account", entityId: account.id,
    summary: `Deleted account ${account.accountCode} — ${account.accountName}`,
  });
  res.json({ data: { deleted: true } });
});

// ── Bulk upload (Template Download + Bulk Upload) ─────────────────────────
// Same three-step flow as Items/Business Partners below: download a styled
// .xlsx template, upload it for server-side validation (nothing is written
// yet — every row comes back tagged create/update/error), then apply only
// the rows the user confirms. Matching an uploaded row to an existing
// account is by Account Code (already unique per org).

const COA_COLUMNS = [
  { header: "Code *", hint: "← required, e.g. 5010", width: 12 },
  { header: "Name *", hint: "← required", width: 30 },
  { header: "Type *", hint: "← pick from list", width: 14, dropdown: ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] },
  { header: "Sub Type", hint: "optional", width: 20 },
  { header: "Parent Code", hint: "optional — must already exist", width: 14 },
  { header: "Is Group", hint: "Y or N (default N)", width: 10, dropdown: ["Y", "N"], align: "center" as const },
  { header: "Description", hint: "optional", width: 30 },
  { header: "Opening Balance", hint: "optional, number", width: 16, numFmt: "#,##0.00" },
  { header: "DR / CR", hint: "required if balance given", width: 9, dropdown: ["DR", "CR"], align: "center" as const },
  { header: "As On Date", hint: "optional", width: 14, numFmt: "dd-mmm-yyyy" },
];

interface CoaPreviewRow {
  rowNum: number;
  accountCode: string;
  accountName: string;
  accountType: string | null;
  subType: string | null;
  parentCode: string | null;
  isGroup: boolean;
  description: string | null;
  openingBalance: number | null;
  openingBalanceType: "DEBIT" | "CREDIT" | null;
  openingBalanceDate: string | null;
  status: "create" | "update" | "error";
  isSystem?: boolean;
  error?: string;
}

router.get("/bulk-upload/template", canManageCoa, async (req, res) => {
  const buffer = await buildTemplateWorkbook("Chart of Accounts", COA_COLUMNS);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="SmartERP_ChartOfAccounts_Template.xlsx"');
  res.send(buffer);
});

router.post("/bulk-upload/preview", canManageCoa, upload.single("file"), async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  if (!req.file) return res.status(400).json({ message: "No file uploaded." });

  const ws = await loadUploadedWorksheet(req.file.buffer);
  if (!ws) return res.json({ data: [] });

  const existing = await prisma.account.findMany({
    where: { organizationId, deletedAt: null },
    select: { accountCode: true, isSystem: true },
  });
  const byCode = new Map(existing.map((a) => [a.accountCode.trim(), a]));

  const preview: CoaPreviewRow[] = [];

  ws.eachRow((row, rowNum) => {
    if (rowNum <= 2) return;
    const accountCode = cellText(row, 1);
    const accountName = cellText(row, 2);
    if (!accountCode && !accountName) return; // blank row

    const push = (status: CoaPreviewRow["status"], error?: string) =>
      preview.push({
        rowNum,
        accountCode: accountCode ?? "",
        accountName: accountName ?? "",
        accountType: cellText(row, 3),
        subType: cellText(row, 4),
        parentCode: cellText(row, 5),
        isGroup: (cellText(row, 6) ?? "").toUpperCase() === "Y",
        description: cellText(row, 7),
        openingBalance: null,
        openingBalanceType: null,
        openingBalanceDate: cellDateIso(row, 10),
        status,
        error,
      });

    if (!accountCode) return push("error", "Code is required");
    if (!accountName) return push("error", "Name is required");

    const existingAccount = byCode.get(accountCode);
    const status: "create" | "update" = existingAccount ? "update" : "create";
    const accountType = cellText(row, 3);
    if (accountType && !ACCOUNT_TYPES.includes(accountType)) {
      return push("error", `Type must be one of ${ACCOUNT_TYPES.join(", ")}`);
    }
    if (status === "create" && !accountType) {
      return push("error", `Type is required for a new account (one of ${ACCOUNT_TYPES.join(", ")})`);
    }

    const balRaw = row.getCell(8).value;
    const balance = balRaw != null && balRaw !== "" ? Number(balRaw) : null;
    if (balance !== null && isNaN(balance)) return push("error", "Opening balance is not a valid number");

    const sideRaw = (cellText(row, 9) ?? "").toUpperCase();
    let side: "DEBIT" | "CREDIT" | null = null;
    if (sideRaw === "DR") side = "DEBIT";
    else if (sideRaw === "CR") side = "CREDIT";
    else if (sideRaw) return push("error", `Invalid DR/CR value: "${sideRaw}"`);
    if (balance && balance > 0 && !side) return push("error", "DR/CR is required when Opening Balance is given");

    const parentCode = cellText(row, 5);
    if (parentCode && !byCode.has(parentCode)) return push("error", `Parent account code "${parentCode}" not found`);

    preview.push({
      rowNum, accountCode, accountName,
      accountType: accountType, subType: cellText(row, 4), parentCode,
      isGroup: (cellText(row, 6) ?? "").toUpperCase() === "Y",
      description: cellText(row, 7),
      openingBalance: balance, openingBalanceType: side,
      openingBalanceDate: cellDateIso(row, 10),
      status, isSystem: existingAccount?.isSystem ?? false,
    });
  });

  res.json({ data: preview });
});

router.post("/bulk-upload/apply", canManageCoa, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const rows: CoaPreviewRow[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const workRows = rows.filter((r) => r.status === "create" || r.status === "update");
  if (workRows.length === 0) return res.json({ data: { created: 0, updated: 0 } });

  const existing = await prisma.account.findMany({ where: { organizationId, deletedAt: null } });
  const byCode = new Map(existing.map((a) => [a.accountCode.trim(), a]));

  let created = 0, updated = 0;
  for (const row of workRows) {
    const parent = row.parentCode ? byCode.get(row.parentCode) : null;
    const found = byCode.get(row.accountCode);

    if (found) {
      const data = found.isSystem
        ? {
            accountName: row.accountName,
            description: row.description,
            openingBalance: row.openingBalance,
            openingBalanceType: row.openingBalanceType,
            openingBalanceDate: row.openingBalanceDate ? new Date(row.openingBalanceDate) : null,
          }
        : {
            accountName: row.accountName,
            accountType: row.accountType ?? found.accountType,
            subType: row.subType,
            description: row.description,
            parentId: parent?.id ?? found.parentId,
            isGroup: row.isGroup,
            openingBalance: row.openingBalance,
            openingBalanceType: row.openingBalanceType,
            openingBalanceDate: row.openingBalanceDate ? new Date(row.openingBalanceDate) : null,
          };
      await prisma.account.update({ where: { id: found.id }, data });
      updated++;
    } else {
      const account = await prisma.account.create({
        data: {
          organizationId,
          accountCode: row.accountCode, accountName: row.accountName,
          accountType: row.accountType!, subType: row.subType,
          description: row.description, parentId: parent?.id ?? null,
          isGroup: row.isGroup, isSystem: false,
          openingBalance: row.openingBalance, openingBalanceType: row.openingBalanceType,
          openingBalanceDate: row.openingBalanceDate ? new Date(row.openingBalanceDate) : null,
        },
      });
      byCode.set(account.accountCode.trim(), account);
      created++;
    }
  }

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "BULK_UPLOAD", entityType: "account", entityId: organizationId,
    summary: `Bulk upload: ${created} account(s) created, ${updated} updated`,
  });
  res.json({ data: { created, updated } });
});

export default router;
