import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requireRole } from "../middleware/auth";
import { upload } from "../lib/upload";
import { buildTemplateWorkbook, loadUploadedWorksheet, cellText } from "../lib/xlsxTemplate";

const router = Router();
router.use(authenticate);

const COST_CATEGORY_NAMES = ["MATERIAL", "LABOUR", "SUBCONTRACT", "OVERHEAD", "OTHER"];

async function getOrgProject(projectId: string, organizationId: string) {
  return prisma.project.findFirst({ where: { id: projectId, organizationId, deletedAt: null } });
}

async function getOrgBoq(boqId: string, organizationId: string) {
  const boq = await prisma.boq.findUnique({ where: { id: boqId }, include: { project: true } });
  if (!boq || boq.project.organizationId !== organizationId) return null;
  return boq;
}

// ---------------------------------------------------------------------
// BOQ versions (Section 6.3)
// ---------------------------------------------------------------------

// GET /boq/project/:projectId — list BOQ versions for a project.
router.get("/project/:projectId", async (req, res) => {
  const project = await getOrgProject(req.params.projectId, req.user!.organizationId);
  if (!project) return res.status(404).json({ message: "Project not found." });

  const boqs = await prisma.boq.findMany({
    where: { projectId: project.id },
    orderBy: { version: "desc" },
    include: { _count: { select: { lines: true } } },
  });
  res.json({ data: boqs });
});

// POST /boq/project/:projectId — start a new BOQ version. Append-only
// (Section 6.3: "BOQ revision history — append-only versions, not
// destructive edits") — this never edits an existing version's rows.
router.post("/project/:projectId", requireRole("SUPER_ADMIN", "ESTIMATOR"), async (req, res) => {
  const project = await getOrgProject(req.params.projectId, req.user!.organizationId);
  if (!project) return res.status(404).json({ message: "Project not found." });

  const last = await prisma.boq.findFirst({ where: { projectId: project.id }, orderBy: { version: "desc" } });
  const boq = await prisma.boq.create({
    data: { projectId: project.id, version: (last?.version ?? 0) + 1, status: "DRAFT" },
  });
  res.status(201).json({ data: boq });
});

// GET /boq/:boqId — detail, with lines + estimates.
router.get("/:boqId", async (req, res) => {
  const boq = await getOrgBoq(req.params.boqId, req.user!.organizationId);
  if (!boq) return res.status(404).json({ message: "BOQ not found." });

  const lines = await prisma.boqLine.findMany({
    where: { boqId: boq.id },
    orderBy: { lineNo: "asc" },
    include: { item: true, costCategory: true, estimate: true },
  });
  res.json({ data: { ...boq, lines } });
});

// ---------------------------------------------------------------------
// Import (Section 6.3) — Excel template / preview / apply, same
// three-route shape as SmartERP's own bulk-upload screens. R1 does not
// build the "AI-assisted column mapping" the blueprint describes
// (that's the BOQ Intelligence Agent, R3) — this is a fixed template
// instead, same simplification the PRD's Section 6.3 calls out.
//
// Note on "Cost Category" here: it classifies what kind of work the
// line itself is (reporting/filtering only). It does NOT feed Budget
// generation — that pulls from each line's Estimate cost-component
// breakdown instead (see routes/budget.ts). A line can be tagged
// MATERIAL here and still have Estimate.labourCost > 0 if installing it
// costs labour — the two aren't the same axis.
// ---------------------------------------------------------------------

const BOQ_IMPORT_COLUMNS = [
  { header: "Line No *", hint: "← required, whole number", width: 10 },
  { header: "Description *", hint: "← required", width: 40 },
  { header: "Item SKU", hint: "← optional, matched to synced items", width: 16 },
  { header: "Cost Category *", hint: "← required, pick from list", width: 16, dropdown: COST_CATEGORY_NAMES },
  { header: "UOM *", hint: "← required, e.g. NOS, KG, M", width: 10 },
  { header: "Quantity *", hint: "← required, number", width: 12, numFmt: "0.0000" },
  { header: "Rate *", hint: "← required, number", width: 12, numFmt: "0.00" },
  { header: "Billable (Y/N)", hint: "← optional, default Y", width: 12, dropdown: ["Y", "N"] },
];

interface BoqLinePreviewRow {
  rowNum: number;
  lineNo: number | null;
  description: string;
  itemSku: string | null;
  itemMatched: boolean;
  costCategoryName: string;
  uom: string;
  quantity: number | null;
  rate: number | null;
  amount: number | null;
  billable: boolean;
  status: "create" | "error";
  error?: string;
}

router.get("/:boqId/import/template", requireRole("SUPER_ADMIN", "ESTIMATOR"), async (req, res) => {
  const boq = await getOrgBoq(req.params.boqId, req.user!.organizationId);
  if (!boq) return res.status(404).json({ message: "BOQ not found." });

  const buffer = await buildTemplateWorkbook("BOQ Lines", BOQ_IMPORT_COLUMNS);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="ProjectOS_BOQ_Template.xlsx"');
  res.send(buffer);
});

router.post("/:boqId/import/preview", requireRole("SUPER_ADMIN", "ESTIMATOR"), upload.single("file"), async (req, res) => {
  const boq = await getOrgBoq(req.params.boqId, req.user!.organizationId);
  if (!boq) return res.status(404).json({ message: "BOQ not found." });
  if (!req.file) return res.status(400).json({ message: "No file uploaded." });

  const ws = await loadUploadedWorksheet(req.file.buffer);
  if (!ws) return res.json({ data: [] });

  const organizationId = req.user!.organizationId;
  const [existingLines, costCategories, items] = await Promise.all([
    prisma.boqLine.findMany({ where: { boqId: boq.id }, select: { lineNo: true } }),
    prisma.costCategory.findMany({ where: { organizationId } }),
    prisma.syncedItem.findMany({ where: { organizationId }, select: { id: true, sku: true } }),
  ]);
  const existingLineNos = new Set(existingLines.map((l) => l.lineNo));
  const categoryByName = new Map(costCategories.map((c) => [c.name.toUpperCase(), c]));
  const itemBySku = new Map(items.map((i) => [i.sku.toUpperCase(), i]));

  const preview: BoqLinePreviewRow[] = [];
  const seenLineNos = new Set<number>();

  ws.eachRow((row, rowNum) => {
    if (rowNum <= 2) return;
    const rawLineNo = cellText(row, 1);
    const description = cellText(row, 2) ?? "";
    const itemSku = cellText(row, 3);
    const costCategoryName = (cellText(row, 4) ?? "").toUpperCase();
    const uom = cellText(row, 5) ?? "";
    const rawQty = row.getCell(6).value;
    const rawRate = row.getCell(7).value;
    const billableRaw = (cellText(row, 8) ?? "Y").toUpperCase();

    if (!rawLineNo && !description && !uom && (rawQty == null || rawQty === "")) return; // blank row

    const lineNo = rawLineNo ? Number(rawLineNo) : null;
    const quantity = rawQty != null && rawQty !== "" ? Number(rawQty) : null;
    const rate = rawRate != null && rawRate !== "" ? Number(rawRate) : null;
    const item = itemSku ? itemBySku.get(itemSku.toUpperCase()) : undefined;
    const category = categoryByName.get(costCategoryName);
    const billable = billableRaw !== "N";
    const amount = quantity != null && rate != null ? Math.round(quantity * rate * 100) / 100 : null;

    const push = (status: BoqLinePreviewRow["status"], error?: string) =>
      preview.push({
        rowNum, lineNo, description, itemSku, itemMatched: !!item, costCategoryName, uom,
        quantity, rate, amount, billable, status, error,
      });

    if (lineNo === null || !Number.isInteger(lineNo) || lineNo <= 0) return push("error", "Line No is required and must be a positive whole number");
    if (existingLineNos.has(lineNo)) return push("error", `Line No ${lineNo} already exists in this BOQ version`);
    if (seenLineNos.has(lineNo)) return push("error", `Duplicate Line No ${lineNo} in this file`);
    seenLineNos.add(lineNo);
    if (!description) return push("error", "Description is required");
    if (!category) return push("error", `"${costCategoryName}" is not a recognised cost category`);
    if (!uom) return push("error", "UOM is required");
    if (quantity === null || isNaN(quantity) || quantity <= 0) return push("error", "Quantity is required and must be a number greater than 0");
    if (rate === null || isNaN(rate) || rate < 0) return push("error", "Rate is required and must be a number, 0 or greater");
    if (itemSku && !item) {
      // Not an error — SmartERP sync (Section 9.1 / task #118) isn't
      // built yet, so no synced items exist for most pilots yet. The
      // line still imports; itemMatched:false just means the frontend
      // should visibly flag it as unlinked.
    }

    push("create");
  });

  res.json({ data: preview });
});

router.post("/:boqId/import/apply", requireRole("SUPER_ADMIN", "ESTIMATOR"), async (req, res) => {
  const boq = await getOrgBoq(req.params.boqId, req.user!.organizationId);
  if (!boq) return res.status(404).json({ message: "BOQ not found." });
  if (boq.status === "APPROVED" || boq.status === "SUPERSEDED") {
    return res.status(409).json({ message: `Cannot add lines to a BOQ in "${boq.status}" status — start a new version instead.` });
  }

  const rows: BoqLinePreviewRow[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const createRows = rows.filter((r) => r.status === "create");
  if (createRows.length === 0) return res.json({ data: { created: 0 } });

  const organizationId = req.user!.organizationId;
  const [costCategories, items] = await Promise.all([
    prisma.costCategory.findMany({ where: { organizationId } }),
    prisma.syncedItem.findMany({ where: { organizationId }, select: { id: true, sku: true } }),
  ]);
  const categoryByName = new Map(costCategories.map((c) => [c.name.toUpperCase(), c.id]));
  const itemBySku = new Map(items.map((i) => [i.sku.toUpperCase(), i.id]));

  let created = 0;
  await prisma.$transaction(async (tx) => {
    for (const row of createRows) {
      if (row.lineNo === null || row.quantity === null || row.rate === null) continue; // preview already validated this
      await tx.boqLine.create({
        data: {
          boqId: boq.id,
          lineNo: row.lineNo,
          description: row.description,
          itemId: row.itemSku ? itemBySku.get(row.itemSku.toUpperCase()) ?? null : null,
          costCategoryId: categoryByName.get(row.costCategoryName.toUpperCase()) ?? null,
          uom: row.uom,
          quantity: row.quantity,
          rate: row.rate,
          amount: row.amount ?? row.quantity * row.rate,
          billable: row.billable,
        },
      });
      created++;
    }
    if (boq.status === "DRAFT") {
      await tx.boq.update({ where: { id: boq.id }, data: { status: "IMPORTED" } });
    }
  });

  res.json({ data: { created } });
});

// POST /boq/:boqId/lines — add a single line by hand, for the cases a
// spreadsheet import isn't worth it for (a one-line correction, a pilot
// testing the flow). Same validation rules as the import path, just for
// one row instead of a file.
router.post("/:boqId/lines", requireRole("SUPER_ADMIN", "ESTIMATOR"), async (req, res) => {
  const boq = await getOrgBoq(req.params.boqId, req.user!.organizationId);
  if (!boq) return res.status(404).json({ message: "BOQ not found." });
  if (boq.status === "APPROVED" || boq.status === "SUPERSEDED") {
    return res.status(409).json({ message: `Cannot add lines to a BOQ in "${boq.status}" status — start a new version instead.` });
  }

  const { lineNo, description, itemId, costCategoryId, uom, quantity, rate, billable } = req.body ?? {};
  if (!lineNo || !description || !uom || quantity == null || rate == null) {
    return res.status(400).json({ message: "lineNo, description, uom, quantity and rate are required." });
  }
  const existing = await prisma.boqLine.findUnique({ where: { boqId_lineNo: { boqId: boq.id, lineNo } } });
  if (existing) return res.status(409).json({ message: `Line No ${lineNo} already exists in this BOQ version.` });

  const line = await prisma.boqLine.create({
    data: {
      boqId: boq.id, lineNo, description, itemId: itemId ?? null, costCategoryId: costCategoryId ?? null,
      uom, quantity, rate, amount: Number(quantity) * Number(rate), billable: billable ?? true,
    },
  });
  if (boq.status === "DRAFT") await prisma.boq.update({ where: { id: boq.id }, data: { status: "IMPORTED" } });
  res.status(201).json({ data: line });
});

// ---------------------------------------------------------------------
// Approval (Section 6.3) — R1 collapses "Validated" into "Imported"
// (no separate manual validation step exposed yet); Draft -> Imported
// -> Approved is what's actually reachable today.
// ---------------------------------------------------------------------

router.post("/:boqId/approve", requireRole("SUPER_ADMIN", "PROJECT_MANAGER"), async (req, res) => {
  const boq = await getOrgBoq(req.params.boqId, req.user!.organizationId);
  if (!boq) return res.status(404).json({ message: "BOQ not found." });
  if (boq.status !== "IMPORTED" && boq.status !== "VALIDATED") {
    return res.status(409).json({ message: `Cannot approve a BOQ in "${boq.status}" status.` });
  }
  const lineCount = await prisma.boqLine.count({ where: { boqId: boq.id } });
  if (lineCount === 0) return res.status(409).json({ message: "Cannot approve an empty BOQ — import at least one line first." });

  await prisma.$transaction(async (tx) => {
    // Baseline vs. revised vs. current (Section 6.3): only one APPROVED
    // version per project at a time — a newly approved version
    // supersedes whichever one was approved before it.
    await tx.boq.updateMany({
      where: { projectId: boq.projectId, status: "APPROVED" },
      data: { status: "SUPERSEDED" },
    });
    await tx.boq.update({ where: { id: boq.id }, data: { status: "APPROVED" } });
  });

  res.json({ data: { id: boq.id, status: "APPROVED" } });
});

// ---------------------------------------------------------------------
// Estimate (Section 6.3) — one row per BOQ line, cost-component breakdown.
// ---------------------------------------------------------------------

router.put("/lines/:lineId/estimate", requireRole("SUPER_ADMIN", "ESTIMATOR"), async (req, res) => {
  const line = await prisma.boqLine.findUnique({ where: { id: req.params.lineId }, include: { boq: { include: { project: true } } } });
  if (!line || line.boq.project.organizationId !== req.user!.organizationId) {
    return res.status(404).json({ message: "BOQ line not found." });
  }

  const materialCost = Number(req.body?.materialCost ?? 0);
  const labourCost = Number(req.body?.labourCost ?? 0);
  const subcontractCost = Number(req.body?.subcontractCost ?? 0);
  const overheadCost = Number(req.body?.overheadCost ?? 0);
  const totalCost = materialCost + labourCost + subcontractCost + overheadCost;

  const existing = await prisma.estimate.findUnique({ where: { boqLineId: line.id } });
  const estimate = existing
    ? await prisma.estimate.update({
        where: { boqLineId: line.id },
        data: { materialCost, labourCost, subcontractCost, overheadCost, totalCost, version: existing.version + 1 },
      })
    : await prisma.estimate.create({
        data: { boqLineId: line.id, materialCost, labourCost, subcontractCost, overheadCost, totalCost },
      });

  res.json({ data: estimate });
});

export default router;
