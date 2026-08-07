import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { upload } from "../lib/upload";
import { buildTemplateWorkbook, loadUploadedWorksheet, cellText, cellDateIso } from "../lib/xlsxTemplate";

const router = Router();
router.use(authenticate, requireActiveSubscription);
const canManageBp = requirePermission("businessPartners.manage");

// stateCode (the 2-digit GST state code) is auto-filled from a GSTIN's
// first 2 characters when one is set, but stays independently editable —
// a B2C customer or an unregistered vendor still has a state without
// having a GSTIN. See migration_014 / branches.ts's identical helper.
function resolveStateCode(stateCode: unknown, gstin: unknown): string | null | undefined {
  if (stateCode !== undefined) return stateCode ? String(stateCode).trim() : null;
  if (gstin) return String(gstin).trim().toUpperCase().slice(0, 2);
  return undefined;
}

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

// GET /business-partners?bpType=CUSTOMER|VENDOR
router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const bpType = req.query.bpType ? String(req.query.bpType) : undefined;
  const partners = await prisma.businessPartner.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ...(bpType ? { bpType } : {}),
    },
    orderBy: { name: "asc" },
  });
  res.json({ data: partners });
});

// POST /business-partners — creates a customer or vendor master record.
router.post("/", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const { bpType, name, gstin, stateCode, phone, email, address, openingBalance, openingBalanceType } = req.body ?? {};
  if (!bpType || !["CUSTOMER", "VENDOR"].includes(bpType) || !name) {
    return res.status(400).json({ message: "bpType (CUSTOMER or VENDOR) and name are required." });
  }

  const partner = await prisma.businessPartner.create({
    data: {
      organizationId,
      bpType, name,
      gstin: gstin ?? null,
      stateCode: resolveStateCode(stateCode, gstin) ?? null,
      phone: phone ?? null,
      email: email ?? null,
      address: address ?? null,
      openingBalance: openingBalance ?? 0,
      openingBalanceType: openingBalanceType ?? null,
    },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "CREATE", entityType: "business_partner", entityId: partner.id,
    summary: `Created ${bpType.toLowerCase()} ${partner.name}`,
  });
  res.status(201).json({ data: partner });
});

router.patch("/:id", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const partner = await prisma.businessPartner.findFirst({
    where: { id: req.params.id, organizationId },
  });
  if (!partner) return res.status(404).json({ message: "Business partner not found." });

  const body = { ...(req.body ?? {}) };
  if (body.stateCode === undefined && body.gstin !== undefined) {
    const derived = resolveStateCode(undefined, body.gstin);
    if (derived !== undefined) body.stateCode = derived;
  }

  const updated = await prisma.businessPartner.update({
    where: { id: partner.id },
    data: body,
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "business_partner", entityId: partner.id,
    summary: `Updated ${partner.name}`,
  });
  res.json({ data: updated });
});

router.patch("/:id/toggle", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const partner = await prisma.businessPartner.findFirst({
    where: { id: req.params.id, organizationId },
  });
  if (!partner) return res.status(404).json({ message: "Business partner not found." });

  const updated = await prisma.businessPartner.update({
    where: { id: partner.id },
    data: { isActive: !partner.isActive },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "TOGGLE", entityType: "business_partner", entityId: partner.id,
    summary: `${updated.isActive ? "Activated" : "Deactivated"} ${partner.name}`,
  });
  res.json({ data: updated });
});

router.delete("/:id", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const partner = await prisma.businessPartner.findFirst({
    where: { id: req.params.id, organizationId },
  });
  if (!partner) return res.status(404).json({ message: "Business partner not found." });

  const used = await prisma.journalLine.findFirst({ where: { businessPartnerId: partner.id } });
  if (used) {
    return res.status(409).json({ message: "This business partner has journal entries and cannot be deleted." });
  }

  await prisma.businessPartner.update({ where: { id: partner.id }, data: { deletedAt: new Date() } });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "DELETE", entityType: "business_partner", entityId: partner.id,
    summary: `Deleted ${partner.name}`,
  });
  res.json({ data: { deleted: true } });
});

// ── Bulk upload (Template Download + Bulk Upload) ─────────────────────────
// Business Partners have no natural key until one is given here — a row
// with a Code matches an existing partner by (org, code) for update;
// a row with a blank Code always creates a new partner (never matched
// against anything, since name alone isn't reliable — see ROADMAP-adjacent
// decision made when this was designed).

const BP_COLUMNS = [
  { header: "Type *", hint: "← pick from list", width: 12, dropdown: ["CUSTOMER", "VENDOR"] },
  { header: "Code", hint: "optional — set to update later via re-upload", width: 14 },
  { header: "Name *", hint: "← required", width: 30 },
  { header: "GSTIN", hint: "optional", width: 18 },
  { header: "Phone", hint: "optional", width: 15 },
  { header: "Email", hint: "optional", width: 26 },
  { header: "Address", hint: "optional", width: 30 },
  { header: "Opening Balance", hint: "optional, number", width: 16, numFmt: "#,##0.00" },
  { header: "DR / CR", hint: "required if balance given", width: 9, dropdown: ["DR", "CR"], align: "center" as const },
  { header: "As On Date", hint: "optional", width: 14, numFmt: "dd-mmm-yyyy" },
];

interface BpPreviewRow {
  rowNum: number;
  bpType: "CUSTOMER" | "VENDOR" | null;
  code: string | null;
  name: string;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  openingBalance: number | null;
  openingBalanceType: "DEBIT" | "CREDIT" | null;
  openingBalanceDate: string | null;
  status: "create" | "update" | "error";
  error?: string;
}

router.get("/bulk-upload/template", canManageBp, async (req, res) => {
  const buffer = await buildTemplateWorkbook("Business Partners", BP_COLUMNS);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="SmartERP_BusinessPartners_Template.xlsx"');
  res.send(buffer);
});

router.post("/bulk-upload/preview", canManageBp, upload.single("file"), async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  if (!req.file) return res.status(400).json({ message: "No file uploaded." });

  const ws = await loadUploadedWorksheet(req.file.buffer);
  if (!ws) return res.json({ data: [] });

  const existing = await prisma.businessPartner.findMany({
    where: { organizationId, deletedAt: null, code: { not: null } },
    select: { code: true },
  });
  const byCode = new Set(existing.map((p) => p.code!.trim()));

  const preview: BpPreviewRow[] = [];

  ws.eachRow((row, rowNum) => {
    if (rowNum <= 2) return;
    const typeRaw = (cellText(row, 1) ?? "").toUpperCase();
    const name = cellText(row, 3);
    if (!typeRaw && !name) return;

    const push = (status: BpPreviewRow["status"], error?: string) =>
      preview.push({
        rowNum,
        bpType: typeRaw === "CUSTOMER" || typeRaw === "VENDOR" ? typeRaw : null,
        code: cellText(row, 2), name: name ?? "",
        gstin: cellText(row, 4), phone: cellText(row, 5), email: cellText(row, 6), address: cellText(row, 7),
        openingBalance: null, openingBalanceType: null, openingBalanceDate: cellDateIso(row, 10),
        status, error,
      });

    if (typeRaw !== "CUSTOMER" && typeRaw !== "VENDOR") return push("error", 'Type must be "CUSTOMER" or "VENDOR"');
    if (!name) return push("error", "Name is required");

    const code = cellText(row, 2);
    const status: "create" | "update" = code && byCode.has(code) ? "update" : "create";

    const balRaw = row.getCell(8).value;
    const balance = balRaw != null && balRaw !== "" ? Number(balRaw) : null;
    if (balance !== null && isNaN(balance)) return push("error", "Opening balance is not a valid number");

    const sideRaw = (cellText(row, 9) ?? "").toUpperCase();
    let side: "DEBIT" | "CREDIT" | null = null;
    if (sideRaw === "DR") side = "DEBIT";
    else if (sideRaw === "CR") side = "CREDIT";
    else if (sideRaw) return push("error", `Invalid DR/CR value: "${sideRaw}"`);
    if (balance && balance > 0 && !side) return push("error", "DR/CR is required when Opening Balance is given");

    preview.push({
      rowNum, bpType: typeRaw as "CUSTOMER" | "VENDOR", code, name,
      gstin: cellText(row, 4), phone: cellText(row, 5), email: cellText(row, 6), address: cellText(row, 7),
      openingBalance: balance, openingBalanceType: side, openingBalanceDate: cellDateIso(row, 10),
      status,
    });
  });

  res.json({ data: preview });
});

router.post("/bulk-upload/apply", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const rows: BpPreviewRow[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const workRows = rows.filter((r) => r.status === "create" || r.status === "update");
  if (workRows.length === 0) return res.json({ data: { created: 0, updated: 0 } });

  const existing = await prisma.businessPartner.findMany({
    where: { organizationId, deletedAt: null, code: { not: null } },
  });
  const byCode = new Map(existing.map((p) => [p.code!.trim(), p]));

  let created = 0, updated = 0;
  for (const row of workRows) {
    const data = {
      bpType: row.bpType!,
      name: row.name,
      gstin: row.gstin,
      phone: row.phone,
      email: row.email,
      address: row.address ? { full: row.address } : undefined,
      openingBalance: row.openingBalance ?? 0,
      openingBalanceType: row.openingBalanceType,
    };

    const found = row.code ? byCode.get(row.code) : null;
    if (found) {
      await prisma.businessPartner.update({ where: { id: found.id }, data });
      updated++;
    } else {
      const partner = await prisma.businessPartner.create({
        data: { organizationId, code: row.code, ...data },
      });
      if (row.code) byCode.set(row.code.trim(), partner);
      created++;
    }
  }

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "BULK_UPLOAD", entityType: "business_partner", entityId: organizationId,
    summary: `Bulk upload: ${created} business partner(s) created, ${updated} updated`,
  });
  res.json({ data: { created, updated } });
});

export default router;
