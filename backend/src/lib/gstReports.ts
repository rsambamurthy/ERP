// GSTR-1 (outward supplies) and GSTR-3B (summary return) computations.
// Deliberately a practical MSME-first-pass subset, not a full compliance
// engine — see the notes inline and in ROADMAP.md's "GST Statutory Reports"
// section for exactly what's simplified and why:
//   - Place of supply = the customer/vendor's own stateCode (bill-to), never
//     a separately-modeled ship-to state — this app doesn't track ship-to
//     addresses at all.
//   - B2C is one summarized table (by state + rate), not split into the
//     >2.5L "B2CL" invoice-wise table GSTR-1 technically has — this app
//     doesn't flag large B2C invoices separately.
//   - No cess (not modeled anywhere in this app), no exempt/nil-rated/
//     zero-rated distinction (every taxable line is treated as a normal
//     taxable supply), no reverse-charge flag.
//   - GSTR-3B's "net payable" is liability-minus-ITC per tax head, clamped
//     at zero — it does NOT model the government's actual cross-utilization
//     set-off order (IGST credit first against IGST then CGST then SGST,
//     etc.). Treat it as an indicative figure, not a filing-ready number.
//   - Sales Return doesn't (yet) account for the original invoice's
//     discount when computing its own tax base (see ROADMAP.md) — that
//     imprecision carries through to this report's credit-note figures.
//   - SalesReturnLine/PurchaseReturnLine store only a combined taxAmount,
//     no CGST/SGST/IGST split — recomputed here via isInterState/splitGst,
//     same as routes/salesReturns.ts and purchaseReturns.ts do at posting
//     time.
import { prisma } from "../db";
import { isInterState, splitGst, round2 } from "./discountGst";

export interface Gstr1B2BRow {
  gstin: string;
  receiverName: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceValue: number;
  placeOfSupply: string;
  rate: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface Gstr1B2CRow {
  placeOfSupply: string;
  rate: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface Gstr1HsnRow {
  hsnCode: string;
  description: string;
  uom: string;
  rate: number;
  quantity: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface Gstr1CreditNoteRow {
  noteNumber: string;
  noteDate: string;
  originalInvoiceNumber: string;
  gstin: string | null;
  receiverName: string;
  placeOfSupply: string;
  rate: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface Gstr1Report {
  from: string;
  to: string;
  b2b: Gstr1B2BRow[];
  b2c: Gstr1B2CRow[];
  hsn: Gstr1HsnRow[];
  creditNotes: Gstr1CreditNoteRow[];
  totals: { taxableValue: number; cgst: number; sgst: number; igst: number; invoiceValue: number };
}

type RateAcc = { taxableValue: number; cgst: number; sgst: number; igst: number };
const emptyRateAcc = (): RateAcc => ({ taxableValue: 0, cgst: 0, sgst: 0, igst: 0 });
function addRateAcc(a: RateAcc, taxableValue: number, cgst: number, sgst: number, igst: number): RateAcc {
  return {
    taxableValue: round2(a.taxableValue + taxableValue),
    cgst: round2(a.cgst + cgst),
    sgst: round2(a.sgst + sgst),
    igst: round2(a.igst + igst),
  };
}

export async function computeGstr1(
  organizationId: string,
  from: Date,
  to: Date,
  branchId?: string
): Promise<Gstr1Report> {
  const invoices = await prisma.salesInvoice.findMany({
    where: { organizationId, invoiceDate: { gte: from, lte: to }, ...(branchId ? { branchId } : {}) },
    include: { businessPartner: true, branch: true, lines: { include: { item: true } } },
    orderBy: { invoiceDate: "asc" },
  });

  const b2b: Gstr1B2BRow[] = [];
  const b2cMap = new Map<string, Gstr1B2CRow>();
  const hsnMap = new Map<string, Gstr1HsnRow>();

  for (const inv of invoices) {
    const placeOfSupply = inv.businessPartner.stateCode ?? inv.branch?.stateCode ?? "—";
    const byRate = new Map<number, RateAcc>();
    for (const line of inv.lines) {
      const rate = Number(line.taxRate);
      byRate.set(
        rate,
        addRateAcc(byRate.get(rate) ?? emptyRateAcc(), Number(line.taxableValue), Number(line.cgstAmount), Number(line.sgstAmount), Number(line.igstAmount))
      );

      const hsnKey = `${line.item.hsnCode ?? "N/A"}|${rate}`;
      const prev = hsnMap.get(hsnKey);
      hsnMap.set(hsnKey, {
        hsnCode: line.item.hsnCode ?? "N/A",
        description: line.item.name,
        uom: line.item.uom,
        rate,
        quantity: round2((prev?.quantity ?? 0) + Number(line.quantity)),
        taxableValue: round2((prev?.taxableValue ?? 0) + Number(line.taxableValue)),
        cgst: round2((prev?.cgst ?? 0) + Number(line.cgstAmount)),
        sgst: round2((prev?.sgst ?? 0) + Number(line.sgstAmount)),
        igst: round2((prev?.igst ?? 0) + Number(line.igstAmount)),
      });
    }

    if (inv.businessPartner.gstin) {
      for (const [rate, acc] of byRate) {
        b2b.push({
          gstin: inv.businessPartner.gstin,
          receiverName: inv.businessPartner.name,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate.toISOString().slice(0, 10),
          invoiceValue: Number(inv.grandTotal),
          placeOfSupply,
          rate,
          ...acc,
        });
      }
    } else {
      for (const [rate, acc] of byRate) {
        const key = `${placeOfSupply}|${rate}`;
        const existing = b2cMap.get(key) ?? { placeOfSupply, rate, ...emptyRateAcc() };
        b2cMap.set(key, { ...existing, ...addRateAcc(existing, acc.taxableValue, acc.cgst, acc.sgst, acc.igst) });
      }
    }
  }

  const returns = await prisma.salesReturn.findMany({
    where: { organizationId, returnDate: { gte: from, lte: to }, ...(branchId ? { branchId } : {}) },
    include: { businessPartner: true, branch: true, salesInvoice: true, lines: true },
    orderBy: { returnDate: "asc" },
  });

  const creditNotes: Gstr1CreditNoteRow[] = [];
  for (const ret of returns) {
    const placeOfSupply = ret.businessPartner.stateCode ?? ret.branch?.stateCode ?? "—";
    const interState = isInterState(ret.branch?.stateCode, ret.businessPartner.stateCode);
    const byRate = new Map<number, RateAcc>();
    for (const line of ret.lines) {
      const rate = Number(line.taxRate);
      const { cgst, sgst, igst } = splitGst(Number(line.taxAmount), interState);
      byRate.set(rate, addRateAcc(byRate.get(rate) ?? emptyRateAcc(), Number(line.lineSubtotal), cgst, sgst, igst));
    }
    for (const [rate, acc] of byRate) {
      creditNotes.push({
        noteNumber: ret.returnNumber,
        noteDate: ret.returnDate.toISOString().slice(0, 10),
        originalInvoiceNumber: ret.salesInvoice.invoiceNumber,
        gstin: ret.businessPartner.gstin,
        receiverName: ret.businessPartner.name,
        placeOfSupply,
        rate,
        ...acc,
      });
    }
  }

  const b2c = [...b2cMap.values()].sort((a, b) => a.placeOfSupply.localeCompare(b.placeOfSupply) || a.rate - b.rate);
  const hsn = [...hsnMap.values()].sort((a, b) => a.hsnCode.localeCompare(b.hsnCode) || a.rate - b.rate);

  const totals = [...b2b, ...b2c].reduce(
    (t, r) => ({
      taxableValue: round2(t.taxableValue + r.taxableValue),
      cgst: round2(t.cgst + r.cgst),
      sgst: round2(t.sgst + r.sgst),
      igst: round2(t.igst + r.igst),
      invoiceValue: t.invoiceValue,
    }),
    { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, invoiceValue: round2(invoices.reduce((s, i) => s + Number(i.grandTotal), 0)) }
  );

  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), b2b, b2c, hsn, creditNotes, totals };
}

export interface Gstr3bSection {
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface Gstr3bReport {
  from: string;
  to: string;
  outward: Gstr3bSection; // 3.1(a), net of Sales Return credit notes
  itc: Gstr3bSection; // 4(A), net of Purchase Return debit notes
  netPayable: { cgst: number; sgst: number; igst: number; total: number };
}

function sectionTotal(s: Omit<Gstr3bSection, "total">): Gstr3bSection {
  return { ...s, total: round2(s.cgst + s.sgst + s.igst) };
}

export async function computeGstr3b(
  organizationId: string,
  from: Date,
  to: Date,
  branchId?: string
): Promise<Gstr3bReport> {
  const invAgg = await prisma.salesInvoice.aggregate({
    where: { organizationId, invoiceDate: { gte: from, lte: to }, ...(branchId ? { branchId } : {}) },
    _sum: { subtotal: true, discountTotal: true, cgstTotal: true, sgstTotal: true, igstTotal: true },
  });
  const billAgg = await prisma.purchaseBill.aggregate({
    where: { organizationId, billDate: { gte: from, lte: to }, ...(branchId ? { branchId } : {}) },
    _sum: { subtotal: true, cgstTotal: true, sgstTotal: true, igstTotal: true },
  });

  // Neither return type stores its own CGST/SGST/IGST split — recompute per
  // return the same way the posting routes do (constant per return, since
  // it only depends on branch vs. partner state, not on individual lines).
  const salesReturns = await prisma.salesReturn.findMany({
    where: { organizationId, returnDate: { gte: from, lte: to }, ...(branchId ? { branchId } : {}) },
    include: { businessPartner: true, branch: true },
  });
  const purchaseReturns = await prisma.purchaseReturn.findMany({
    where: { organizationId, returnDate: { gte: from, lte: to }, ...(branchId ? { branchId } : {}) },
    include: { businessPartner: true, branch: true },
  });

  const retOut = salesReturns.reduce(
    (t, r) => {
      const { cgst, sgst, igst } = splitGst(Number(r.taxTotal), isInterState(r.branch?.stateCode, r.businessPartner.stateCode));
      return { taxableValue: round2(t.taxableValue + Number(r.subtotal)), cgst: round2(t.cgst + cgst), sgst: round2(t.sgst + sgst), igst: round2(t.igst + igst) };
    },
    { taxableValue: 0, cgst: 0, sgst: 0, igst: 0 }
  );
  const retItc = purchaseReturns.reduce(
    (t, r) => {
      const { cgst, sgst, igst } = splitGst(Number(r.taxTotal), isInterState(r.branch?.stateCode, r.businessPartner.stateCode));
      return { taxableValue: round2(t.taxableValue + Number(r.subtotal)), cgst: round2(t.cgst + cgst), sgst: round2(t.sgst + sgst), igst: round2(t.igst + igst) };
    },
    { taxableValue: 0, cgst: 0, sgst: 0, igst: 0 }
  );

  const outward = sectionTotal({
    taxableValue: round2(Number(invAgg._sum.subtotal ?? 0) - Number(invAgg._sum.discountTotal ?? 0) - retOut.taxableValue),
    cgst: round2(Number(invAgg._sum.cgstTotal ?? 0) - retOut.cgst),
    sgst: round2(Number(invAgg._sum.sgstTotal ?? 0) - retOut.sgst),
    igst: round2(Number(invAgg._sum.igstTotal ?? 0) - retOut.igst),
  });
  const itc = sectionTotal({
    taxableValue: round2(Number(billAgg._sum.subtotal ?? 0) - retItc.taxableValue),
    cgst: round2(Number(billAgg._sum.cgstTotal ?? 0) - retItc.cgst),
    sgst: round2(Number(billAgg._sum.sgstTotal ?? 0) - retItc.sgst),
    igst: round2(Number(billAgg._sum.igstTotal ?? 0) - retItc.igst),
  });

  const netPayable = {
    cgst: Math.max(0, round2(outward.cgst - itc.cgst)),
    sgst: Math.max(0, round2(outward.sgst - itc.sgst)),
    igst: Math.max(0, round2(outward.igst - itc.igst)),
    total: 0,
  };
  netPayable.total = round2(netPayable.cgst + netPayable.sgst + netPayable.igst);

  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), outward, itc, netPayable };
}
