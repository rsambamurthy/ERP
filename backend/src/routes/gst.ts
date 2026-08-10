import { Router } from "express";
import { authenticate, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { computeGstr1, computeGstr3b } from "../lib/gstReports";
import { buildDataWorkbook } from "../lib/xlsxTemplate";

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

// Same read-only access as the other accounting reports (Trial Balance,
// P&L, Balance Sheet) — no requirePermission gate, every org member can
// view/export these.

function parsePeriod(req: import("express").Request, res: import("express").Response): { from: Date; to: Date; branchId?: string } | null {
  const { from, to, branchId } = req.query;
  if (!from || !to) {
    res.status(400).json({ message: "from and to are required (YYYY-MM-DD)." });
    return null;
  }
  const fromDate = new Date(String(from));
  const toDate = new Date(String(to));
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    res.status(400).json({ message: "from/to must be valid dates." });
    return null;
  }
  return { from: fromDate, to: toDate, branchId: branchId ? String(branchId) : undefined };
}

// GET /gst/gstr1?from=&to=&branchId=
router.get("/gstr1", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const period = parsePeriod(req, res);
  if (!period) return;
  const report = await computeGstr1(organizationId, period.from, period.to, period.branchId);
  res.json({ data: report });
});

// GET /gst/gstr1/export?from=&to=&branchId= — same data as an .xlsx with
// one sheet per table (B2B / B2C / Exports (6A) / HSN Summary / Credit Notes).
router.get("/gstr1/export", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const period = parsePeriod(req, res);
  if (!period) return;
  const report = await computeGstr1(organizationId, period.from, period.to, period.branchId);

  const buffer = await buildDataWorkbook([
    {
      name: "B2B Invoices",
      columns: [
        { header: "GSTIN of Recipient", width: 20 },
        { header: "Receiver Name", width: 26 },
        { header: "Invoice Number", width: 18 },
        { header: "Invoice Date", width: 14 },
        { header: "Invoice Value", width: 16, numFmt: "#,##0.00" },
        { header: "Place of Supply", width: 14 },
        { header: "Rate (%)", width: 10 },
        { header: "Taxable Value", width: 16, numFmt: "#,##0.00" },
        { header: "CGST", width: 14, numFmt: "#,##0.00" },
        { header: "SGST", width: 14, numFmt: "#,##0.00" },
        { header: "IGST", width: 14, numFmt: "#,##0.00" },
      ],
      rows: report.b2b.map((r) => [r.gstin, r.receiverName, r.invoiceNumber, r.invoiceDate, r.invoiceValue, r.placeOfSupply, r.rate, r.taxableValue, r.cgst, r.sgst, r.igst]),
    },
    {
      name: "B2C Summary",
      columns: [
        { header: "Place of Supply", width: 14 },
        { header: "Rate (%)", width: 10 },
        { header: "Taxable Value", width: 16, numFmt: "#,##0.00" },
        { header: "CGST", width: 14, numFmt: "#,##0.00" },
        { header: "SGST", width: 14, numFmt: "#,##0.00" },
        { header: "IGST", width: 14, numFmt: "#,##0.00" },
      ],
      rows: report.b2c.map((r) => [r.placeOfSupply, r.rate, r.taxableValue, r.cgst, r.sgst, r.igst]),
    },
    {
      name: "Exports (6A)",
      columns: [
        { header: "Invoice Number", width: 18 },
        { header: "Invoice Date", width: 14 },
        { header: "Invoice Value", width: 16, numFmt: "#,##0.00" },
        { header: "Shipping Bill No.", width: 18 },
        { header: "Shipping Bill Date", width: 16 },
        { header: "Port Code", width: 12 },
        { header: "Integrated Tax Rate (%)", width: 16 },
        { header: "Taxable Value", width: 16, numFmt: "#,##0.00" },
        { header: "Integrated Tax Amount", width: 16, numFmt: "#,##0.00" },
        { header: "Export Type", width: 14 },
      ],
      rows: report.exports.map((r) => [
        r.invoiceNumber, r.invoiceDate, r.invoiceValue,
        r.shippingBillNumber ?? "", r.shippingBillDate ?? "", r.portCode ?? "",
        r.rate, r.taxableValue, r.igst, r.exportType,
      ]),
    },
    {
      name: "HSN Summary",
      columns: [
        { header: "HSN Code", width: 12 },
        { header: "Description", width: 26 },
        { header: "UOM", width: 10 },
        { header: "Rate (%)", width: 10 },
        { header: "Quantity", width: 12, numFmt: "#,##0.00" },
        { header: "Taxable Value", width: 16, numFmt: "#,##0.00" },
        { header: "CGST", width: 14, numFmt: "#,##0.00" },
        { header: "SGST", width: 14, numFmt: "#,##0.00" },
        { header: "IGST", width: 14, numFmt: "#,##0.00" },
      ],
      rows: report.hsn.map((r) => [r.hsnCode, r.description, r.uom, r.rate, r.quantity, r.taxableValue, r.cgst, r.sgst, r.igst]),
    },
    {
      name: "Credit Notes",
      columns: [
        { header: "Note Number", width: 16 },
        { header: "Note Date", width: 14 },
        { header: "Original Invoice", width: 18 },
        { header: "GSTIN of Recipient", width: 20 },
        { header: "Receiver Name", width: 26 },
        { header: "Place of Supply", width: 14 },
        { header: "Rate (%)", width: 10 },
        { header: "Taxable Value", width: 16, numFmt: "#,##0.00" },
        { header: "CGST", width: 14, numFmt: "#,##0.00" },
        { header: "SGST", width: 14, numFmt: "#,##0.00" },
        { header: "IGST", width: 14, numFmt: "#,##0.00" },
      ],
      rows: report.creditNotes.map((r) => [r.noteNumber, r.noteDate, r.originalInvoiceNumber, r.gstin, r.receiverName, r.placeOfSupply, r.rate, r.taxableValue, r.cgst, r.sgst, r.igst]),
    },
  ]);

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="GSTR1_${report.from}_to_${report.to}.xlsx"`);
  res.send(buffer);
});

// GET /gst/gstr3b?from=&to=&branchId=
router.get("/gstr3b", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const period = parsePeriod(req, res);
  if (!period) return;
  const report = await computeGstr3b(organizationId, period.from, period.to, period.branchId);
  res.json({ data: report });
});

// GET /gst/gstr3b/export?from=&to=&branchId=
router.get("/gstr3b/export", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const period = parsePeriod(req, res);
  if (!period) return;
  const report = await computeGstr3b(organizationId, period.from, period.to, period.branchId);

  const moneyCol = (header: string) => ({ header, width: 16, numFmt: "#,##0.00" });
  const buffer = await buildDataWorkbook([
    {
      name: "GSTR-3B Summary",
      columns: [{ header: "Section", width: 34 }, moneyCol("Taxable Value"), moneyCol("CGST"), moneyCol("SGST"), moneyCol("IGST"), moneyCol("Total Tax")],
      rows: [
        ["3.1(a) Outward Taxable Supplies (net of credit notes)", report.outward.taxableValue, report.outward.cgst, report.outward.sgst, report.outward.igst, report.outward.total],
        ["4(A) ITC Available (net of debit notes)", report.itc.taxableValue, report.itc.cgst, report.itc.sgst, report.itc.igst, report.itc.total],
        ["Net Tax Payable (indicative — see note)", null, report.netPayable.cgst, report.netPayable.sgst, report.netPayable.igst, report.netPayable.total],
      ],
    },
  ]);

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="GSTR3B_${report.from}_to_${report.to}.xlsx"`);
  res.send(buffer);
});

export default router;
