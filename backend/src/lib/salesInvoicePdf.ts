import PDFDocument from "pdfkit";

// Renders a Sales Invoice as a formal GST "Tax Invoice" — unlike
// lib/purchaseOrderPdf.ts / lib/salesOrderPdf.ts (plain pre-commitment
// documents), this one is a legal document under GST law, so it surfaces
// the CGST/SGST/IGST split, HSN codes, discount, and (for a foreign-
// currency export) the LUT/Bond/shipping-bill declaration — the same
// fields already tracked on SalesInvoice/SalesInvoiceLine. Same pdfkit /
// plain-layout / no-logo approach as the other two documents.

export interface SalesInvoicePdfData {
  invoiceNumber: string;
  invoiceDate: Date;
  narration: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  grandTotal: number;
  // True when this supply is inter-state (IGST) rather than intra-state
  // (CGST+SGST) — decides which tax columns the line table shows. An
  // export invoice is always inter-state (see routes/salesInvoices.ts).
  interState: boolean;
  currency: string;
  exchangeRate: number;
  grandTotalFc: number | null;
  exportType: string | null;
  lutBondNumber: string | null;
  lutBondDate: Date | null;
  shippingBillNumber: string | null;
  shippingBillDate: Date | null;
  portCode: string | null;
  salesOrderNumber: string | null;
  organization: {
    name: string;
    registeredOfficeAddress: string | null;
    cin: string | null;
  };
  branch: {
    name: string;
    gstin: string | null;
    address: unknown;
    phone: string | null;
    email: string | null;
  } | null;
  customer: {
    name: string;
    gstin: string | null;
    address: unknown;
    phone: string | null;
    email: string | null;
  };
  lines: {
    itemSku: string;
    itemName: string;
    hsnCode: string | null;
    uom: string;
    quantity: number;
    rate: number;
    taxableValue: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    lineTotal: number;
  }[];
  // Freight, packing, insurance. No tax column, deliberately: the tax on
  // a charge is already inside the line figures above, because the charge
  // was prorated into their taxable values. A tax column here would read
  // as additional tax, which it is not.
  charges?: { label: string; amount: number }[];
}

// Business partner / branch address is a free-form Json column — same
// convention as purchaseOrderPdf.ts's formatAddress.
function formatAddress(address: unknown): string | null {
  if (!address) return null;
  if (typeof address === "string") return address;
  if (typeof address === "object" && address !== null && "full" in address) {
    const full = (address as { full?: unknown }).full;
    return typeof full === "string" ? full : null;
  }
  try {
    return JSON.stringify(address);
  } catch {
    return null;
  }
}

function money(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const EXPORT_TYPE_LABELS: Record<string, string> = {
  LUT: "Export under LUT (zero-rated)",
  BOND: "Export under Bond (zero-rated)",
  WPAY: "Export with Payment of IGST",
};

export function buildSalesInvoicePdf(data: SalesInvoicePdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 44 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const pageLeft = doc.page.margins.left;
  const pageRight = doc.page.width - doc.page.margins.right;
  const pageWidth = pageRight - pageLeft;
  const isForeign = data.currency !== "INR";

  // ── Header: company identity ──────────────────────────────────────────
  doc.fontSize(16).font("Helvetica-Bold").text(data.organization.name, pageLeft, doc.y);
  doc.font("Helvetica").fontSize(9).fillColor("#555555");
  const orgAddress = data.organization.registeredOfficeAddress;
  if (orgAddress) doc.text(orgAddress);
  if (data.organization.cin) doc.text(`CIN: ${data.organization.cin}`);
  if (data.branch?.gstin) doc.text(`GSTIN: ${data.branch.gstin}`);
  doc.fillColor("#000000");

  doc.moveDown(0.5);
  doc.moveTo(pageLeft, doc.y).lineTo(pageRight, doc.y).strokeColor("#cccccc").stroke();
  doc.moveDown(0.6);

  // ── Title + invoice meta ────────────────────────────────────────────
  const titleY = doc.y;
  doc.fontSize(14).font("Helvetica-Bold").text("TAX INVOICE", pageLeft, titleY);
  doc.fontSize(9).font("Helvetica");
  const metaX = pageLeft + pageWidth * 0.55;
  const metaWidth = pageWidth * 0.45;
  doc.text(`Invoice Number:  ${data.invoiceNumber}`, metaX, titleY, { width: metaWidth, align: "right" });
  doc.text(`Invoice Date:  ${data.invoiceDate.toLocaleDateString("en-IN")}`, metaX, doc.y, { width: metaWidth, align: "right" });
  if (data.salesOrderNumber) {
    doc.text(`Against Sales Order:  ${data.salesOrderNumber}`, metaX, doc.y, { width: metaWidth, align: "right" });
  }
  if (isForeign) {
    doc.text(`Currency:  ${data.currency} @ ${data.exchangeRate.toFixed(4)}`, metaX, doc.y, { width: metaWidth, align: "right" });
  }
  doc.text(`Supply Type:  ${data.interState ? "Inter-State (IGST)" : "Intra-State (CGST + SGST)"}`, metaX, doc.y, { width: metaWidth, align: "right" });

  doc.y = Math.max(doc.y, titleY + 60);
  doc.moveDown(0.8);

  // ── Customer / Issuing-branch boxes, side by side ───────────────────
  const colWidth = pageWidth / 2 - 10;
  const boxTop = doc.y;

  doc.fontSize(9).font("Helvetica-Bold").text("BILL TO", pageLeft, boxTop);
  doc.font("Helvetica").fontSize(10).text(data.customer.name, pageLeft, doc.y + 2, { width: colWidth });
  doc.fontSize(9).fillColor("#555555");
  const customerAddress = formatAddress(data.customer.address);
  if (customerAddress) doc.text(customerAddress, { width: colWidth });
  if (data.customer.gstin) doc.text(`GSTIN: ${data.customer.gstin}`, { width: colWidth });
  if (data.customer.phone) doc.text(`Phone: ${data.customer.phone}`, { width: colWidth });
  if (data.customer.email) doc.text(`Email: ${data.customer.email}`, { width: colWidth });
  doc.fillColor("#000000");
  const customerBottom = doc.y;

  if (data.branch) {
    const branchX = pageLeft + colWidth + 20;
    doc.fontSize(9).font("Helvetica-Bold").text("FROM BRANCH", branchX, boxTop, { width: colWidth });
    doc.font("Helvetica").fontSize(10).text(data.branch.name, branchX, boxTop + 14, { width: colWidth });
    doc.fontSize(9).fillColor("#555555");
    const branchAddress = formatAddress(data.branch.address);
    if (branchAddress) doc.text(branchAddress, branchX, doc.y, { width: colWidth });
    if (data.branch.gstin) doc.text(`GSTIN: ${data.branch.gstin}`, branchX, doc.y, { width: colWidth });
    if (data.branch.phone) doc.text(`Phone: ${data.branch.phone}`, branchX, doc.y, { width: colWidth });
    if (data.branch.email) doc.text(`Email: ${data.branch.email}`, branchX, doc.y, { width: colWidth });
    doc.fillColor("#000000");
  }

  doc.y = Math.max(customerBottom, doc.y) + 16;

  // ── Export declaration (foreign-currency invoices only) ─────────────
  if (isForeign && data.exportType) {
    doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#333333").text(
      EXPORT_TYPE_LABELS[data.exportType] ?? data.exportType, pageLeft, doc.y
    );
    doc.font("Helvetica").fontSize(8).fillColor("#555555");
    if (data.lutBondNumber) doc.text(`LUT/Bond No: ${data.lutBondNumber}${data.lutBondDate ? ` dated ${data.lutBondDate.toLocaleDateString("en-IN")}` : ""}`);
    if (data.shippingBillNumber) doc.text(`Shipping Bill: ${data.shippingBillNumber}${data.shippingBillDate ? ` dated ${data.shippingBillDate.toLocaleDateString("en-IN")}` : ""}${data.portCode ? ` · Port: ${data.portCode}` : ""}`);
    doc.fillColor("#000000");
    doc.moveDown(0.6);
  }

  // ── Line items table ─────────────────────────────────────────────────
  // Columns depend on supply type: inter-state shows one IGST column,
  // intra-state shows CGST + SGST — never both kinds at once, mirroring
  // what the invoice detail screen already does (see app/sales/invoices).
  const fixedNarrow = 22 + 42 + 32 + 48 + 55; // #, HSN, Qty, Rate, Taxable Value
  const taxColsWidth = data.interState ? 46 : 38 + 38;
  const amountWidth = 58;
  const itemWidth = pageWidth - fixedNarrow - taxColsWidth - amountWidth;

  const cols = [
    { key: "no", label: "#", width: 22, align: "left" as const },
    { key: "item", label: "Item", width: itemWidth, align: "left" as const },
    { key: "hsn", label: "HSN", width: 42, align: "left" as const },
    { key: "qty", label: "Qty", width: 32, align: "right" as const },
    { key: "rate", label: "Rate", width: 48, align: "right" as const },
    { key: "taxable", label: "Taxable Val.", width: 55, align: "right" as const },
    ...(data.interState
      ? [{ key: "igst", label: "IGST", width: 46, align: "right" as const }]
      : [
          { key: "cgst", label: "CGST", width: 38, align: "right" as const },
          { key: "sgst", label: "SGST", width: 38, align: "right" as const },
        ]),
    { key: "amount", label: "Amount", width: amountWidth, align: "right" as const },
  ];
  let x = pageLeft;
  const colX: number[] = [];
  for (const c of cols) { colX.push(x); x += c.width; }

  function tableHeader() {
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff");
    doc.rect(pageLeft, y, pageWidth, 18).fill("#374151");
    doc.fillColor("#ffffff");
    cols.forEach((c, i) => doc.text(c.label, colX[i] + 3, y + 5, { width: c.width - 6, align: c.align }));
    doc.fillColor("#000000");
    doc.y = y + 18;
  }

  function ensureSpace(rowHeight: number) {
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom - 120) {
      doc.addPage();
      tableHeader();
    }
  }

  tableHeader();
  doc.font("Helvetica").fontSize(8);
  data.lines.forEach((l, idx) => {
    ensureSpace(20);
    const y = doc.y;
    const rowValues = [
      String(idx + 1),
      `${l.itemSku} — ${l.itemName}`,
      l.hsnCode ?? "—",
      String(l.quantity),
      money(l.rate),
      money(l.taxableValue),
      ...(data.interState ? [money(l.igstAmount)] : [money(l.cgstAmount), money(l.sgstAmount)]),
      money(l.lineTotal),
    ];
    cols.forEach((c, i) => doc.text(rowValues[i], colX[i] + 3, y + 4, { width: c.width - 6, align: c.align }));
    const rowHeight = Math.max(18, doc.heightOfString(rowValues[1], { width: cols[1].width - 6 }) + 8);
    doc.moveTo(pageLeft, y + rowHeight).lineTo(pageRight, y + rowHeight).strokeColor("#e5e7eb").stroke();
    doc.y = y + rowHeight;
  });

  doc.moveDown(0.8);

  // ── Totals ────────────────────────────────────────────────────────────
  const totalsWidth = 220;
  const totalsX = pageRight - totalsWidth;
  const totalsLabelWidth = totalsWidth - 90;
  function totalLine(label: string, value: string, bold = false) {
    const y = doc.y;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 10 : 9);
    doc.text(label, totalsX, y, { width: totalsLabelWidth, align: "left" });
    doc.text(value, totalsX + totalsLabelWidth, y, { width: 90, align: "right" });
    doc.y = y + (bold ? 16 : 14);
  }
  totalLine("Subtotal", money(data.subtotal));
  if (data.discountTotal > 0) totalLine("Discount", `- ${money(data.discountTotal)}`);
  // Between the discount and the tax, which is where they belong in the
  // arithmetic: a charge increases the value the tax is then computed on.
  for (const c of data.charges ?? []) totalLine(c.label, money(c.amount));
  if (data.interState) {
    if (data.igstTotal > 0) totalLine("IGST", money(data.igstTotal));
  } else {
    if (data.cgstTotal > 0) totalLine("CGST", money(data.cgstTotal));
    if (data.sgstTotal > 0) totalLine("SGST", money(data.sgstTotal));
  }
  doc.moveTo(totalsX, doc.y + 2).lineTo(pageRight, doc.y + 2).strokeColor("#000000").stroke();
  doc.moveDown(0.4);
  totalLine("Grand Total", `₹ ${money(data.grandTotal)}`, true);
  if (isForeign && data.grandTotalFc !== null) {
    totalLine(`Equiv. (${data.currency})`, money(data.grandTotalFc));
  }

  doc.moveDown(1.5);

  // ── Notes ─────────────────────────────────────────────────────────────
  if (data.narration) {
    doc.font("Helvetica-Bold").fontSize(9).text("Notes", pageLeft, doc.y);
    doc.font("Helvetica").fontSize(9).fillColor("#555555").text(data.narration, pageLeft, doc.y + 2, { width: pageWidth });
    doc.fillColor("#000000");
    doc.moveDown(1);
  }

  // ── Signature block ──────────────────────────────────────────────────
  ensureSpace(70);
  doc.moveDown(1.5);
  const sigY = doc.y;
  doc.fontSize(9).text(`For ${data.organization.name}`, pageLeft, sigY);
  doc.moveDown(2.5);
  doc.moveTo(pageLeft, doc.y).lineTo(pageLeft + 160, doc.y).strokeColor("#000000").stroke();
  doc.fontSize(8).fillColor("#555555").text("Authorized Signatory", pageLeft, doc.y + 4);
  doc.fillColor("#000000");

  doc.fontSize(7.5).fillColor("#999999").text(
    "System-generated Tax Invoice — no signature required.",
    pageLeft, doc.page.height - doc.page.margins.bottom - 10,
    { width: pageWidth, align: "center" }
  );

  doc.end();
  return done;
}
