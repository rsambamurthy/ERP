import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { upload } from "../lib/upload";
import { buildTemplateWorkbook, loadUploadedWorksheet, cellText, cellDateIso } from "../lib/xlsxTemplate";
import { isSupportedCurrency, SUPPORTED_CURRENCIES } from "../lib/currencies";

// Currency Master — effective-dated FX rates. Nothing here ever posts to
// the journal or gets referenced by a foreign key from any transactional
// document (a Sales Invoice/Purchase Bill still snapshots its own
// exchangeRate value directly at posting time — see the schema.prisma
// comment on CurrencyRate). This is purely a lookup table a create-
// invoice/bill form queries to pre-fill that field faster than typing it
// by hand every time, so CRUD here is uneventful — no workflow, no
// approval, straightforward create/edit/delete master data, same shape as
// Item or a Business Partner.
const router = Router();
router.use(authenticate, requireActiveSubscription);
const canManageCurrency = requirePermission("currency.manage");

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

// A rate row only ever makes sense for a foreign currency — INR is always
// 1 by definition, and isn't something a user would ever look up a rate
// for. Shared by POST, PATCH validation, and the bulk-upload preview.
function validCurrencyCode(code: unknown): code is string {
  return typeof code === "string" && code !== "INR" && isSupportedCurrency(code);
}

// GET /currency-rates — full list for the org, newest effective date
// first within each currency code (matches how the Currency Master page
// naturally wants to display "history" per code).
router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const rates = await prisma.currencyRate.findMany({
    where: { organizationId },
    orderBy: [{ currencyCode: "asc" }, { effectiveFrom: "desc" }],
  });
  res.json({ data: rates });
});

// GET /currency-rates/lookup?currencyCode=USD&date=2026-08-11 — the
// applicable rate for a given currency as of a given transaction date:
// the most recent row whose effectiveFrom is on or before that date. Used
// by the Sales Invoice / Purchase Bill create forms to pre-fill the
// Exchange Rate field the moment the user picks a foreign currency and a
// date — never blocks the form if nothing's found (that field stays
// freely editable either way, this just saves a lookup the user would
// otherwise do themselves).
router.get("/lookup", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const currencyCode = typeof req.query.currencyCode === "string" ? req.query.currencyCode.toUpperCase() : "";
  const dateStr = typeof req.query.date === "string" ? req.query.date : "";
  if (!validCurrencyCode(currencyCode) || !dateStr) {
    return res.status(400).json({ message: "currencyCode (non-INR, supported) and date are required." });
  }
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return res.status(400).json({ message: "date is not a valid date." });

  const rate = await prisma.currencyRate.findFirst({
    where: { organizationId, currencyCode, effectiveFrom: { lte: date } },
    orderBy: { effectiveFrom: "desc" },
  });
  res.json({ data: rate ? { rate: rate.rate, effectiveFrom: rate.effectiveFrom } : null });
});

// POST /currency-rates — one row: a currency code, the date it takes
// effect from, and the rate. Same currency code can have any number of
// rows, one per effective date (the UNIQUE constraint is on the (org,
// code, date) triple, not on code alone) — that's the whole point: the
// rate that applies depends on which date a transaction falls on.
router.post("/", canManageCurrency, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const { currencyCode: rawCode, effectiveFrom, rate } = req.body ?? {};
  const currencyCode = typeof rawCode === "string" ? rawCode.toUpperCase() : rawCode;

  if (!validCurrencyCode(currencyCode)) {
    return res.status(400).json({ message: "currencyCode must be a supported non-INR currency (see SUPPORTED_CURRENCIES)." });
  }
  if (!effectiveFrom) return res.status(400).json({ message: "effectiveFrom is required." });
  const rateNum = Number(rate);
  if (!(rateNum > 0)) return res.status(400).json({ message: "rate must be greater than 0." });

  const existing = await prisma.currencyRate.findUnique({
    where: { organizationId_currencyCode_effectiveFrom: { organizationId, currencyCode, effectiveFrom: new Date(effectiveFrom) } },
  });
  if (existing) {
    return res.status(409).json({ message: `A rate for ${currencyCode} effective ${effectiveFrom} already exists — edit it instead.` });
  }

  const created = await prisma.currencyRate.create({
    data: { organizationId, currencyCode, effectiveFrom: new Date(effectiveFrom), rate: rateNum, createdBy: req.user!.userId },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "CREATE", entityType: "currency_rate", entityId: created.id,
    summary: `Added ${currencyCode} rate ${rateNum} effective ${effectiveFrom}`,
  });
  res.status(201).json({ data: created });
});

// PATCH /currency-rates/:id — rate only. currencyCode/effectiveFrom are
// structural (they're what the row's unique key and the lookup query key
// off), same "structural fields locked after creation" convention as
// Item's sku/stockAccountId — change either one by deleting and
// recreating the row instead.
router.patch("/:id", canManageCurrency, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const existing = await prisma.currencyRate.findFirst({ where: { id: req.params.id, organizationId } });
  if (!existing) return res.status(404).json({ message: "Currency rate not found." });

  const rateNum = Number(req.body?.rate);
  if (!(rateNum > 0)) return res.status(400).json({ message: "rate must be greater than 0." });

  const updated = await prisma.currencyRate.update({ where: { id: existing.id }, data: { rate: rateNum } });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "currency_rate", entityId: existing.id,
    summary: `Updated ${existing.currencyCode} rate (effective ${existing.effectiveFrom.toISOString().slice(0, 10)}) to ${rateNum}`,
  });
  res.json({ data: updated });
});

// DELETE /currency-rates/:id — a hard delete, unlike Item/BusinessPartner's
// soft delete: nothing anywhere references a CurrencyRate row by foreign
// key (every posted invoice/bill already snapshotted its own exchangeRate
// number directly), so there's no history to preserve by keeping a
// deletedAt tombstone — same reasoning migration_009 gives for why
// OrgRole permission edits don't need one either.
router.delete("/:id", canManageCurrency, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const existing = await prisma.currencyRate.findFirst({ where: { id: req.params.id, organizationId } });
  if (!existing) return res.status(404).json({ message: "Currency rate not found." });

  await prisma.currencyRate.delete({ where: { id: existing.id } });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "DELETE", entityType: "currency_rate", entityId: existing.id,
    summary: `Deleted ${existing.currencyCode} rate effective ${existing.effectiveFrom.toISOString().slice(0, 10)}`,
  });
  res.json({ data: { deleted: true } });
});

// ── Bulk upload (Template Download + Bulk Upload) ─────────────────────────
// Matches an uploaded row to an existing rate by the natural (currencyCode,
// effectiveFrom) key — same three-route shape as items.ts.

const CURRENCY_RATE_COLUMNS = [
  {
    header: "Currency Code *", hint: "← required, pick from list", width: 16,
    dropdown: SUPPORTED_CURRENCIES.filter((c) => c.code !== "INR").map((c) => c.code),
  },
  { header: "Effective From (YYYY-MM-DD) *", hint: "← required", width: 22 },
  { header: "Rate — 1 unit = ₹ *", hint: "← required, number", width: 16, numFmt: "0.000000" },
];

interface CurrencyRatePreviewRow {
  rowNum: number;
  currencyCode: string;
  effectiveFrom: string | null;
  rate: number | null;
  status: "create" | "update" | "error";
  error?: string;
}

router.get("/bulk-upload/template", canManageCurrency, async (req, res) => {
  const buffer = await buildTemplateWorkbook("Currency Rates", CURRENCY_RATE_COLUMNS);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="SmartERP_CurrencyRates_Template.xlsx"');
  res.send(buffer);
});

router.post("/bulk-upload/preview", canManageCurrency, upload.single("file"), async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  if (!req.file) return res.status(400).json({ message: "No file uploaded." });

  const ws = await loadUploadedWorksheet(req.file.buffer);
  if (!ws) return res.json({ data: [] });

  const existingRates: { currencyCode: string; effectiveFrom: Date }[] =
    await prisma.currencyRate.findMany({ where: { organizationId }, select: { currencyCode: true, effectiveFrom: true } });
  const existingKeys = new Set(existingRates.map((r) => `${r.currencyCode}|${r.effectiveFrom.toISOString().slice(0, 10)}`));

  const preview: CurrencyRatePreviewRow[] = [];
  // Two rows in the same uploaded file could target the same (code, date)
  // key — track that within the file too, same as items.ts would catch
  // via its skuSet, so a duplicate inside the upload itself surfaces as an
  // error rather than silently letting the second row overwrite the first
  // on apply.
  const seenInFile = new Set<string>();

  ws.eachRow((row, rowNum) => {
    if (rowNum <= 2) return;
    const rawCode = cellText(row, 1);
    const effectiveFrom = cellDateIso(row, 2);
    const rawRate = row.getCell(3).value;
    if (!rawCode && !effectiveFrom && (rawRate == null || rawRate === "")) return;

    const currencyCode = rawCode ? rawCode.toUpperCase() : "";
    const rate = rawRate != null && rawRate !== "" ? Number(rawRate) : null;

    const push = (status: CurrencyRatePreviewRow["status"], error?: string) =>
      preview.push({ rowNum, currencyCode, effectiveFrom, rate, status, error });

    if (!validCurrencyCode(currencyCode)) return push("error", `"${rawCode ?? ""}" is not a supported non-INR currency code`);
    if (!effectiveFrom) return push("error", "Effective From is required and must be a valid date");
    if (rate === null || isNaN(rate) || !(rate > 0)) return push("error", "Rate is required and must be a number greater than 0");

    const key = `${currencyCode}|${effectiveFrom}`;
    if (seenInFile.has(key)) return push("error", `Duplicate row in this file for ${currencyCode} effective ${effectiveFrom}`);
    seenInFile.add(key);

    push(existingKeys.has(key) ? "update" : "create");
  });

  res.json({ data: preview });
});

router.post("/bulk-upload/apply", canManageCurrency, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const rows: CurrencyRatePreviewRow[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const workRows = rows.filter((r) => r.status === "create" || r.status === "update");
  if (workRows.length === 0) return res.json({ data: { created: 0, updated: 0 } });

  let created = 0, updated = 0;
  for (const row of workRows) {
    if (!row.effectiveFrom || row.rate === null) continue; // shouldn't happen — preview already validated this
    const effectiveFrom = new Date(row.effectiveFrom);
    const existing = await prisma.currencyRate.findUnique({
      where: { organizationId_currencyCode_effectiveFrom: { organizationId, currencyCode: row.currencyCode, effectiveFrom } },
    });
    if (existing) {
      await prisma.currencyRate.update({ where: { id: existing.id }, data: { rate: row.rate } });
      updated++;
    } else {
      await prisma.currencyRate.create({
        data: { organizationId, currencyCode: row.currencyCode, effectiveFrom, rate: row.rate, createdBy: req.user!.userId },
      });
      created++;
    }
  }

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "BULK_UPLOAD", entityType: "currency_rate", entityId: organizationId,
    summary: `Bulk upload: ${created} currency rate(s) created, ${updated} updated`,
  });
  res.json({ data: { created, updated } });
});

export default router;
