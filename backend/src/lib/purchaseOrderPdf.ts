import PDFDocument from "pdfkit";

// Renders a Purchase Order as a formal, printable/emailable document — the
// same information already on the PO detail screen, laid out the way a
// vendor actually expects to receive a PO. Built with pdfkit (pure JS, no
// headless-browser dependency, so it runs fine in any Node container)
// rather than an HTML->PDF renderer.
//
// Deliberately plain, single-column layout — no logo (Organization has no
// logo/image field yet), no letterhead template. Good enough to send to a
// vendor; a fancier branded template is future scope, not this pass.

export interface PurchaseOrderPdfData {
  poNumber: string;
  poDate: Date;
  expectedDeliveryDate: Date | null;
  status: string;
  narration: string;
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
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
  vendor: {
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
    taxRate: number;
    lineTotal: number;
  }[];
}

// Business partner / branch address is a free-form Json column — in
// practice either null, or `{ full: "..." }` (the shape bulk-upload and
// the API both write). Anything else just gets stringified rather than
// silently dropped.
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

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending Approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  CLOSED: "Closed (fully billed)",
};

export function buildPurchaseOrderPdf(data: PurchaseOrderPdfData): Promise<Buffer> {
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

  // ── Title + PO meta ──────────────────────────────────────────────────
  const titleY = doc.y;
  doc.fontSize(14).font("Helvetica-Bold").text("PURCHASE ORDER", pageLeft, titleY);
  doc.fontSize(9).font("Helvetica");
  const metaX = pageLeft + pageWidth * 0.6;
  const metaWidth = pageWidth * 0.4;
  doc.text(`PO Number:  ${data.poNumber}`, metaX, titleY, { width: metaWidth, align: "right" });
  doc.text(`PO Date:  ${data.poDate.toLocaleDateString("en-IN")}`, metaX, doc.y, { width: metaWidth, align: "right" });
  if (data.expectedDeliveryDate) {
    doc.text(`Expected Delivery:  ${data.expectedDeliveryDate.toLocaleDateString("en-IN")}`, metaX, doc.y, { width: metaWidth, align: "right" });
  }
  doc.text(`Status:  ${STATUS_LABELS[data.status] ?? data.status}`, metaX, doc.y, { width: metaWidth, align: "right" });

  doc.y = Math.max(doc.y, titleY + 60);
  doc.moveDown(0.8);

  // ── Vendor / Deliver-to boxes, side by side ─────────────────────────
  const colWidth = pageWidth / 2 - 10;
  const boxTop = doc.y;

  doc.fontSize(9).font("Helvetica-Bold").text("VENDOR", pageLeft, boxTop);
  doc.font("Helvetica").fontSize(10).text(data.vendor.name, pageLeft, doc.y + 2, { width: colWidth });
  doc.fontSize(9).fillColor("#555555");
  const vendorAddress = formatAddress(data.vendor.address);
  if (vendorAddress) doc.text(vendorAddress, { width: colWidth });
  if (data.vendor.gstin) doc.text(`GSTIN: ${data.vendor.gstin}`, { width: colWidth });
  if (data.vendor.phone) doc.text(`Phone: ${data.vendor.phone}`, { width: colWidth });
  if (data.vendor.email) doc.text(`Email: ${data.vendor.email}`, { width: colWidth });
  doc.fillColor("#000000");
  const vendorBottom = doc.y;

  if (data.branch) {
    const branchX = pageLeft + colWidth + 20;
    doc.fontSize(9).font("Helvetica-Bold").text("DELIVER TO", branchX, boxTop, { width: colWidth });
    doc.font("Helvetica").fontSize(10).text(data.branch.name, branchX, boxTop + 14, { width: colWidth });
    doc.fontSize(9).fillColor("#555555");
    const branchAddress = formatAddress(data.branch.address);
    if (branchAddress) doc.text(branchAddress, branchX, doc.y, { width: colWidth });
    if (data.branch.gstin) doc.text(`GSTIN: ${data.branch.gstin}`, branchX, doc.y, { width: colWidth });
    if (data.branch.phone) doc.text(`Phone: ${data.branch.phone}`, branchX, doc.y, { width: colWidth });
    if (data.branch.email) doc.text(`Email: ${data.branch.email}`, branchX, doc.y, { width: colWidth });
    doc.fillColor("#000000");
  }

  doc.y = Math.max(vendorBottom, doc.y) + 20;

  // ── Line items table ─────────────────────────────────────────────────
  // Columns: # | Item | HSN | Qty | UOM | Rate | Tax% | Amount
  const cols = [
    { key: "no", label: "#", width: 22, align: "left" as const },
    { key: "item", label: "Item", width: pageWidth - 22 - 55 - 45 - 40 - 60 - 40 - 75, align: "left" as const },
    { key: "hsn", label: "HSN", width: 55, align: "left" as const },
    { key: "qty", label: "Qty", width: 45, align: "right" as const },
    { key: "uom", label: "UOM", width: 40, align: "left" as const },
    { key: "rate", label: "Rate", width: 60, align: "right" as const },
    { key: "tax", label: "Tax %", width: 40, align: "right" as const },
    { key: "amount", label: "Amount", width: 75, align: "right" as const },
  ];
  let x = pageLeft;
  const colX: number[] = [];
  for (const c of cols) { colX.push(x); x += c.width; }

  function tableHeader() {
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff");
    doc.rect(pageLeft, y, pageWidth, 18).fill("#374151");
    doc.fillColor("#ffffff");
    cols.forEach((c, i) => doc.text(c.label, colX[i] + 4, y + 5, { width: c.width - 8, align: c.align }));
    doc.fillColor("#000000");
    doc.y = y + 18;
  }

  function ensureSpace(rowHeight: number) {
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom - 100) {
      doc.addPage();
      tableHeader();
    }
  }

  tableHeader();
  doc.font("Helvetica").fontSize(8.5);
  data.lines.forEach((l, idx) => {
    ensureSpace(20);
    const y = doc.y;
    const rowValues = [
      String(idx + 1),
      `${l.itemSku} — ${l.itemName}`,
      l.hsnCode ?? "—",
      String(l.quantity),
      l.uom,
      money(l.rate),
      l.taxRate.toFixed(2),
      money(l.lineTotal),
    ];
    cols.forEach((c, i) => doc.text(rowValues[i], colX[i] + 4, y + 4, { width: c.width - 8, align: c.align }));
    const rowHeight = Math.max(18, doc.heightOfString(rowValues[1], { width: cols[1].width - 8 }) + 8);
    doc.moveTo(pageLeft, y + rowHeight).lineTo(pageRight, y + rowHeight).strokeColor("#e5e7eb").stroke();
    doc.y = y + rowHeight;
  });

  doc.moveDown(0.8);

  // ── Totals ────────────────────────────────────────────────────────────
  const totalsWidth = 200;
  const totalsX = pageRight - totalsWidth;
  const totalsLabelWidth = totalsWidth - 90;
  // Both halves of a line are drawn at one captured `y`, then doc.y is
  // advanced explicitly by a fixed row height — calling .text() twice in a
  // row otherwise each auto-advances doc.y independently, which drifts the
  // label/value out of alignment.
  function totalLine(label: string, value: string, bold = false) {
    const y = doc.y;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 10 : 9);
    doc.text(label, totalsX, y, { width: totalsLabelWidth, align: "left" });
    doc.text(value, totalsX + totalsLabelWidth, y, { width: 90, align: "right" });
    doc.y = y + (bold ? 16 : 14);
  }
  totalLine("Subtotal", money(data.subtotal));
  totalLine("Tax", money(data.taxTotal));
  doc.moveTo(totalsX, doc.y + 2).lineTo(pageRight, doc.y + 2).strokeColor("#000000").stroke();
  doc.moveDown(0.4);
  totalLine("Grand Total", money(data.grandTotal), true);

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
    "System-generated Purchase Order.",
    pageLeft, doc.page.height - doc.page.margins.bottom - 10,
    { width: pageWidth, align: "center" }
  );

  doc.end();
  return done;
}
