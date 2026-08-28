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
//   - Table 6A (exports — see Gstr1ExportRow) is a separate table, not
//     mixed into B2B/B2C/`totals`: a foreign-currency Sales Invoice
//     (currency != "INR") is routed here instead of B2B/B2C regardless of
//     whether the customer happens to have a GSTIN on file. Still included
//     in the HSN summary, same as the real return does. exportType is
//     WPAY (with payment of IGST) or WOPAY (LUT/Bond — zero-rated); an
//     invoice with no exportType set at all (shouldn't happen going
//     forward, since it's required at posting) is treated as WOPAY.
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

export interface Gstr1ExportRow {
  invoiceNumber: string;
  invoiceDate: string;
  invoiceValue: number; // grandTotal — INR, same convention as B2B's invoiceValue
  shippingBillNumber: string | null;
  shippingBillDate: string | null;
  portCode: string | null;
  rate: number;
  taxableValue: number;
  igst: number; // exports are always IGST-only (or 0) — never CGST/SGST, see routes/salesInvoices.ts
  exportType: "WPAY" | "WOPAY";
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

// A taxable branch transfer that was cancelled after its invoice had gone
// out. The ledger reversal happens at cancellation, but section 34 undoes an
// ISSUED invoice with a credit note, and nothing in this system raises one —
// so the supply is left out of the tables below (it did not happen) and
// listed here instead, because an invoice number that simply vanishes from a
// consecutive series is exactly what an auditor asks about.
export interface Gstr1CancelledTransferRow {
  transferNumber: string;
  invoiceNumber: string;
  invoiceDate: string;
  toGstin: string;
  toBranchName: string;
  taxableValue: number;
  taxAmount: number;
}

export interface Gstr1Report {
  from: string;
  to: string;
  b2b: Gstr1B2BRow[];
  b2c: Gstr1B2CRow[];
  exports: Gstr1ExportRow[];
  hsn: Gstr1HsnRow[];
  creditNotes: Gstr1CreditNoteRow[];
  // Needs a manual credit note — see Gstr1CancelledTransferRow. Empty in the
  // ordinary case, and worth showing prominently when it is not.
  cancelledTransfers: Gstr1CancelledTransferRow[];
  totals: { taxableValue: number; cgst: number; sgst: number; igst: number; invoiceValue: number };
  // Separate from `totals` — Table 6A is its own subtotal in the real
  // return, not folded into the domestic B2B+B2C taxable value/tax figures.
  exportsTotal: { taxableValue: number; igst: number; invoiceValue: number };
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
  const exports: Gstr1ExportRow[] = [];
  const hsnMap = new Map<string, Gstr1HsnRow>();

  for (const inv of invoices) {
    const isForeign = inv.currency !== "INR";
    // Snapshot first, master only as a fallback for documents posted before
    // migration_031 whose backfill somehow didn't reach them. Reading the
    // master here is what let a customer edit restate an already-filed
    // period — see the migration's header for the full account.
    const partyGstin = inv.partyGstin ?? inv.businessPartner.gstin;
    const partyName = inv.partyName ?? inv.businessPartner.name;
    const placeOfSupply = inv.partyStateCode ?? inv.businessPartner.stateCode ?? inv.branch?.stateCode ?? "—";
    const byRate = new Map<number, RateAcc>();
    for (const line of inv.lines) {
      const rate = Number(line.taxRate);
      byRate.set(
        rate,
        addRateAcc(byRate.get(rate) ?? emptyRateAcc(), Number(line.taxableValue), Number(line.cgstAmount), Number(line.sgstAmount), Number(line.igstAmount))
      );

      // Same rule for the item: what was declared, not what the master
      // says today.
      const lineHsn = line.hsnCode ?? line.item.hsnCode ?? "N/A";
      const hsnKey = `${lineHsn}|${rate}`;
      const prev = hsnMap.get(hsnKey);
      hsnMap.set(hsnKey, {
        hsnCode: lineHsn,
        description: line.itemName ?? line.item.name,
        uom: line.uom ?? line.item.uom,
        rate,
        quantity: round2((prev?.quantity ?? 0) + Number(line.quantity)),
        taxableValue: round2((prev?.taxableValue ?? 0) + Number(line.taxableValue)),
        cgst: round2((prev?.cgst ?? 0) + Number(line.cgstAmount)),
        sgst: round2((prev?.sgst ?? 0) + Number(line.sgstAmount)),
        igst: round2((prev?.igst ?? 0) + Number(line.igstAmount)),
      });
    }

    if (isForeign) {
      // Table 6A — never B2B/B2C, regardless of whether the foreign
      // customer happens to have a GSTIN on file.
      const exportType: "WPAY" | "WOPAY" = inv.exportType === "WPAY" ? "WPAY" : "WOPAY";
      for (const [rate, acc] of byRate) {
        exports.push({
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate.toISOString().slice(0, 10),
          invoiceValue: Number(inv.grandTotal),
          shippingBillNumber: inv.shippingBillNumber,
          shippingBillDate: inv.shippingBillDate ? inv.shippingBillDate.toISOString().slice(0, 10) : null,
          portCode: inv.portCode,
          rate,
          taxableValue: acc.taxableValue,
          igst: acc.igst,
          exportType,
        });
      }
    } else if (partyGstin) {
      for (const [rate, acc] of byRate) {
        b2b.push({
          gstin: partyGstin,
          receiverName: partyName,
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
    const placeOfSupply = ret.partyStateCode ?? ret.businessPartner.stateCode ?? ret.branch?.stateCode ?? "—";
    // The split is stored on each line now (migration_031). Only a line
    // predating that column and missed by the backfill falls back to
    // recomputing, which is the behaviour this whole change exists to end.
    const byRate = new Map<number, RateAcc>();
    for (const line of ret.lines) {
      const rate = Number(line.taxRate);
      const stored = Number(line.cgstAmount) + Number(line.sgstAmount) + Number(line.igstAmount);
      const { cgst, sgst, igst } = stored > 0
        ? { cgst: Number(line.cgstAmount), sgst: Number(line.sgstAmount), igst: Number(line.igstAmount) }
        : splitGst(Number(line.taxAmount), isInterState(ret.branch?.stateCode, ret.partyStateCode ?? ret.businessPartner.stateCode));
      byRate.set(rate, addRateAcc(byRate.get(rate) ?? emptyRateAcc(), Number(line.lineSubtotal), cgst, sgst, igst));
    }
    for (const [rate, acc] of byRate) {
      creditNotes.push({
        noteNumber: ret.returnNumber,
        noteDate: ret.returnDate.toISOString().slice(0, 10),
        originalInvoiceNumber: ret.salesInvoice.invoiceNumber,
        gstin: ret.partyGstin ?? ret.businessPartner.gstin,
        receiverName: ret.partyName ?? ret.businessPartner.name,
        placeOfSupply,
        rate,
        ...acc,
      });
    }
  }

  // ── Taxable branch transfers ──────────────────────────────────────────
  //
  // Section 25(4) makes two registrations of one company distinct persons,
  // and Schedule I paragraph 2 makes a supply between them taxable with no
  // consideration at all. The GSTN has no "branch transfer" category: these
  // go into Table 4A as ordinary B2B supplies against the receiving branch's
  // GSTIN, which is what lets that branch's GSTR-2B pick them up and match
  // the credit.
  //
  // Filtered by the SENDING branch, because that is whose return this is —
  // the same transfer appears as an inward supply in the receiving branch's
  // 2B, not its 1.
  //
  // Every identity field here is the SNAPSHOT taken at dispatch
  // (migration_047), never the branch master. Re-registering a branch must
  // not restate a filed period.
  // TWO PERIODS, NOT ONE. A transfer's INVOICE belongs to the return for the
  // month it was issued - the supply happened, section 34 does not un-happen
  // it - and its CREDIT NOTE belongs to the return for the month the note was
  // issued, which may be a later one. So a transfer is in scope here if
  // EITHER date falls in the window, and each contributes only its own half.
  const transfers = await prisma.stockTransfer.findMany({
    where: {
      organizationId, taxTreatment: "TAXABLE",
      ...(branchId ? { fromBranchId: branchId } : {}),
      OR: [
        { transferDate: { gte: from, lte: to } },
        { creditNoteDate: { gte: from, lte: to } },
      ],
    },
    include: { lines: { include: { item: true } } },
    orderBy: { transferDate: "asc" },
  });

  const cancelledTransfers: Gstr1CancelledTransferRow[] = [];
  // Branch-transfer invoices are domestic B2B supplies and belong in the
  // invoice-value total alongside sales invoices. Accumulated INSIDE the loop
  // below, at the point a transfer is about to be pushed into b2b, so exactly
  // the documents reported as supplies are the documents counted here. It was
  // a filter over `transfers` until credit notes existed, and that filter said
  // `status !== "CANCELLED"` - which stopped being the same question the
  // moment a cancelled-and-credited transfer began appearing in 4A. The
  // invoice-value total would then have omitted a document whose taxable value
  // and tax it was carrying, and the two would have disagreed by exactly the
  // gross value of every credited invoice in the period.
  let transferInvoiceValue = 0;

  for (const tr of transfers) {
    // Checked BEFORE the line loop, not after. The HSN summary is written
    // inside that loop, so guarding afterwards would let a skipped transfer
    // contribute HSN rows with no matching B2B row and no contribution to
    // totals — two sheets of one return that no longer reconcile. Cannot
    // happen while migration_047's CHECK holds, which is exactly why it
    // would go unnoticed if it ever did.
    if (tr.status !== "CANCELLED" && (!tr.toGstin || !tr.documentNumber)) continue;

    const byRate = new Map<number, RateAcc>();
    const noteByRate = new Map<number, RateAcc>();
    let taxableTotal = 0;
    let taxTotal = 0;
    const invoiceInPeriod = tr.transferDate >= from && tr.transferDate <= to;
    const noteInPeriod = !!tr.creditNoteDate
      && tr.creditNoteDate >= from && tr.creditNoteDate <= to;
    // A cancellation from BEFORE migration_052 has no note, so nothing has
    // undone its invoice. It stays out of the supply tables exactly as every
    // cancelled transfer used to, and is listed for manual treatment instead.
    // One WITH a note is an ordinary supply that was later credited, and
    // belongs in 4A like any other.
    const orphanedCancellation = tr.status === "CANCELLED" && !tr.creditNoteNumber;
    const countsAsSupply = invoiceInPeriod && !orphanedCancellation;

    for (const line of tr.lines) {
      const rate = Number(line.gstRate ?? 0);
      const taxable = Number(line.taxableValue ?? 0);
      const cg = Number(line.cgst ?? 0), sg = Number(line.sgst ?? 0), ig = Number(line.igst ?? 0);
      taxableTotal = round2(taxableTotal + taxable);
      taxTotal = round2(taxTotal + cg + sg + ig);

      // The note side, accumulated in the same pass because it reverses the
      // same lines at the same rates.
      if (noteInPeriod) {
        noteByRate.set(rate, addRateAcc(noteByRate.get(rate) ?? emptyRateAcc(), taxable, cg, sg, ig));
      }

      // The supply is reported in the period of the INVOICE, whether or not
      // it was later cancelled. What undoes it is the credit note below, in
      // the period that note was issued - which is how section 34 works and
      // why a cancelled transfer is no longer simply dropped.
      if (!countsAsSupply) continue;
      byRate.set(rate, addRateAcc(byRate.get(rate) ?? emptyRateAcc(), taxable, cg, sg, ig));

      // The HSN summary counts every outward supply, a branch transfer
      // included.
      //
      // Read from the SNAPSHOT (migration_048), with the master only as a
      // fallback for a row written before that column existed. Reading the
      // master is what let an HSN correction restate a filed period. The
      // "N/A" beyond that should never fire at all: a taxable dispatch is
      // refused outright when an item has no HSN (routes/stockTransfers.ts).
      const lineHsn = line.hsnCode ?? line.item.hsnCode ?? "N/A";
      const hsnKey = `${lineHsn}|${rate}`;
      const prev = hsnMap.get(hsnKey);
      hsnMap.set(hsnKey, {
        hsnCode: lineHsn,
        description: line.itemName ?? line.item.name,
        uom: line.uom ?? line.item.uom,
        rate,
        quantity: round2((prev?.quantity ?? 0) + Number(line.quantity)),
        taxableValue: round2((prev?.taxableValue ?? 0) + taxable),
        cgst: round2((prev?.cgst ?? 0) + cg),
        sgst: round2((prev?.sgst ?? 0) + sg),
        igst: round2((prev?.igst ?? 0) + ig),
      });
    }

    if (tr.status === "CANCELLED") {
      if (noteInPeriod && tr.documentNumber) {
        // TABLE 9B. Section 34(1): the invoice stands in the period it was
        // issued and a credit note reduces the period the NOTE was issued in.
        // Where both fall in one month the two net to nothing and the return
        // reads exactly as it did when a cancellation was simply dropped;
        // where they straddle a month end the supply is declared in the first
        // and reversed in the second, which is the case the old treatment got
        // wrong by understating the dispatch month.
        for (const [rate, acc] of noteByRate) {
          creditNotes.push({
            noteNumber: tr.creditNoteNumber!,
            noteDate: tr.creditNoteDate!.toISOString().slice(0, 10),
            originalInvoiceNumber: tr.documentNumber,
            gstin: tr.toGstin,
            receiverName: tr.toBranchName ?? "—",
            placeOfSupply: tr.toStateCode ?? "—",
            rate,
            ...acc,
          });
        }
      } else if (!tr.creditNoteNumber && invoiceInPeriod && tr.documentNumber) {
        // NO NOTE AT ALL - a cancellation from before migration_052. The
        // invoice went out and nothing has undone it, so it is left out of
        // the supply tables and surfaced here instead, exactly as every
        // cancelled transfer used to be. Somebody has to raise a note by
        // hand; this is the report saying which one, and it empties itself
        // as the old rows age out of the periods anybody still files.
        cancelledTransfers.push({
          transferNumber: tr.transferNumber,
          invoiceNumber: tr.documentNumber,
          invoiceDate: tr.transferDate.toISOString().slice(0, 10),
          toGstin: tr.toGstin ?? "—",
          toBranchName: tr.toBranchName ?? "—",
          taxableValue: taxableTotal,
          taxAmount: taxTotal,
        });
      }
      // A credited supply falls through to the B2B push below; an orphaned
      // one, or one in scope only because its NOTE lands in this period, does
      // not - byRate is empty in the second case anyway, and skipping is
      // clearer than relying on that.
      if (!countsAsSupply) continue;
    }

    // Redundant at runtime — the guard at the top of the loop already
    // rejected a non-cancelled transfer missing either of these. It is here
    // because TypeScript cannot carry that narrowing across the cancelled
    // branch's `continue`, and asserting with `!` would silence a nullability
    // the compiler is right about rather than proving it wrong.
    if (!tr.toGstin || !tr.documentNumber) continue;

    transferInvoiceValue = round2(transferInvoiceValue + taxableTotal + taxTotal);

    for (const [rate, acc] of byRate) {
      b2b.push({
        gstin: tr.toGstin,
        receiverName: tr.toBranchName ?? "—",
        invoiceNumber: tr.documentNumber,
        invoiceDate: tr.transferDate.toISOString().slice(0, 10),
        // Goods at cost plus the tax — what the receiving branch owes, and
        // what the invoice says. Stock still moved at cost; the tax is a
        // separate leg that never entered the value of the goods.
        invoiceValue: round2(taxableTotal + taxTotal),
        placeOfSupply: tr.toStateCode ?? "—",
        rate,
        ...acc,
      });
    }
  }

  const b2c = [...b2cMap.values()].sort((a, b) => a.placeOfSupply.localeCompare(b.placeOfSupply) || a.rate - b.rate);
  const hsn = [...hsnMap.values()].sort((a, b) => a.hsnCode.localeCompare(b.hsnCode) || a.rate - b.rate);

  // Domestic-only — exports get their own exportsTotal below, the same
  // separation the real GSTR-1 return has between the main taxable-value
  // summary and Table 6A.
  //
  // Rebuilt from the source documents rather than summed off the b2b rows,
  // because those are emitted per tax rate: one document with two rates
  // produces two rows each carrying its FULL invoice value, so adding that
  // column up would double-count it.
  const domesticInvoiceValue = round2(
    invoices.filter((i) => i.currency === "INR").reduce((s, i) => s + Number(i.grandTotal), 0)
    + transferInvoiceValue
  );
  const totals = [...b2b, ...b2c].reduce(
    (t, r) => ({
      taxableValue: round2(t.taxableValue + r.taxableValue),
      cgst: round2(t.cgst + r.cgst),
      sgst: round2(t.sgst + r.sgst),
      igst: round2(t.igst + r.igst),
      invoiceValue: t.invoiceValue,
    }),
    { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, invoiceValue: domesticInvoiceValue }
  );

  const exportsInvoiceValue = round2(invoices.filter((i) => i.currency !== "INR").reduce((s, i) => s + Number(i.grandTotal), 0));
  const exportsTotal = exports.reduce(
    (t, r) => ({
      taxableValue: round2(t.taxableValue + r.taxableValue),
      igst: round2(t.igst + r.igst),
      invoiceValue: t.invoiceValue,
    }),
    { taxableValue: 0, igst: 0, invoiceValue: exportsInvoiceValue }
  );

  return {
    from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10),
    b2b, b2c, exports, hsn, creditNotes, cancelledTransfers, totals, exportsTotal,
  };
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
  // status: "POSTED" only — a bill held Pending Approval (3-way match price
  // variance) hasn't actually posted yet, so its ITC isn't real yet either;
  // a Rejected one never posted at all. See PurchaseBill.status.
  const billAgg = await prisma.purchaseBill.aggregate({
    where: { organizationId, billDate: { gte: from, lte: to }, status: "POSTED", ...(branchId ? { branchId } : {}) },
    _sum: { subtotal: true, cgstTotal: true, sgstTotal: true, igstTotal: true },
  });

  // Both return types now store their own CGST/SGST/IGST split per line
  // (migration_031), decided once at posting. Before that it was recomputed
  // here on every read from the partner's *current* state code, so moving a
  // partner between states flipped CGST+SGST into IGST on returns that had
  // already been filed the other way.
  //
  // The fallback recompute below only fires for a return whose lines are all
  // still at 0/0/0 — pre-migration rows the backfill missed.
  const salesReturns = await prisma.salesReturn.findMany({
    where: { organizationId, returnDate: { gte: from, lte: to }, ...(branchId ? { branchId } : {}) },
    include: { businessPartner: true, branch: true, lines: true },
  });
  const purchaseReturns = await prisma.purchaseReturn.findMany({
    where: { organizationId, returnDate: { gte: from, lte: to }, ...(branchId ? { branchId } : {}) },
    include: { businessPartner: true, branch: true, lines: true },
  });

  type ReturnLike = {
    subtotal: unknown; taxTotal: unknown;
    branch: { stateCode: string | null } | null;
    businessPartner: { stateCode: string | null };
    partyStateCode?: string | null;
    lines: { cgstAmount: unknown; sgstAmount: unknown; igstAmount: unknown }[];
  };

  function sumReturns(rows: ReturnLike[]) {
    return rows.reduce(
      (t, r) => {
        const cgstStored = r.lines.reduce((s, l) => s + Number(l.cgstAmount), 0);
        const sgstStored = r.lines.reduce((s, l) => s + Number(l.sgstAmount), 0);
        const igstStored = r.lines.reduce((s, l) => s + Number(l.igstAmount), 0);
        const { cgst, sgst, igst } = cgstStored + sgstStored + igstStored > 0
          ? { cgst: cgstStored, sgst: sgstStored, igst: igstStored }
          : splitGst(Number(r.taxTotal), isInterState(r.branch?.stateCode, r.partyStateCode ?? r.businessPartner.stateCode));
        return {
          taxableValue: round2(t.taxableValue + Number(r.subtotal)),
          cgst: round2(t.cgst + cgst), sgst: round2(t.sgst + sgst), igst: round2(t.igst + igst),
        };
      },
      { taxableValue: 0, cgst: 0, sgst: 0, igst: 0 }
    );
  }

  const retOut = sumReturns(salesReturns as unknown as ReturnLike[]);
  const retItc = sumReturns(purchaseReturns as unknown as ReturnLike[]);

  // ── Taxable branch transfers, both sides ──────────────────────────────
  //
  // These land in 3B asymmetrically, and deliberately so:
  //
  //   OUTWARD  when DISPATCHED. The time of supply is the issue of the
  //            invoice (section 12), so the sending branch owes the tax from
  //            that date. Keyed on transferDate and fromBranchId.
  //   ITC      when RECEIVED. Section 16(2)(b) allows the credit only on
  //            receipt of the goods. Keyed on receivedDate and toBranchId.
  //
  // So a transfer that crosses a month end pays tax in one return and claims
  // it in the next. Revenue-neutral over the year, not within the month —
  // expected, and the commonest question somebody will ask about these
  // figures.
  //
  // A CANCELLED transfer is now in the outward figure for the month it was
  // DISPATCHED, and its credit note reduces the month the NOTE was issued in.
  // Section 34 does not un-happen a supply; it credits it. Where both fall in
  // one month the two net to nothing and this reads exactly as it did when a
  // cancellation was simply dropped from both — where they straddle a month
  // end, the old treatment understated the dispatch month by the whole value
  // of an invoice that had genuinely gone out.
  //
  // A cancellation from before migration_052 has no note. It is excluded here
  // rather than left declared-and-never-credited, which keeps every existing
  // period reading as it always did; computeGstr1's cancelledTransfers list
  // is what flags those for manual treatment.
  const dispatched = await prisma.stockTransfer.findMany({
    where: {
      organizationId, taxTreatment: "TAXABLE",
      transferDate: { gte: from, lte: to },
      ...(branchId ? { fromBranchId: branchId } : {}),
      OR: [{ status: { not: "CANCELLED" } }, { creditNoteNumber: { not: null } }],
    },
    include: { lines: true },
  });
  // The reversal, in the period of the note.
  const credited = await prisma.stockTransfer.findMany({
    where: {
      organizationId, taxTreatment: "TAXABLE", status: "CANCELLED",
      creditNoteDate: { gte: from, lte: to },
      ...(branchId ? { fromBranchId: branchId } : {}),
    },
    include: { lines: true },
  });
  const receivedIn = await prisma.stockTransfer.findMany({
    where: {
      organizationId, taxTreatment: "TAXABLE", status: "RECEIVED",
      receivedDate: { gte: from, lte: to },
      ...(branchId ? { toBranchId: branchId } : {}),
    },
    include: { lines: true },
  });

  type TransferLike = { lines: { taxableValue: unknown; cgst: unknown; sgst: unknown; igst: unknown }[] };
  function transferTotals(rows: TransferLike[]): RateAcc {
    return rows.reduce<RateAcc>((acc, tr) => tr.lines.reduce<RateAcc>((a, l) => addRateAcc(
      a, Number(l.taxableValue ?? 0), Number(l.cgst ?? 0), Number(l.sgst ?? 0), Number(l.igst ?? 0),
    ), acc), emptyRateAcc());
  }
  const trOut = transferTotals(dispatched);
  const trCredit = transferTotals(credited);
  const trItc = transferTotals(receivedIn);

  const outward = sectionTotal({
    taxableValue: round2(Number(invAgg._sum.subtotal ?? 0) - Number(invAgg._sum.discountTotal ?? 0) - retOut.taxableValue + trOut.taxableValue - trCredit.taxableValue),
    cgst: round2(Number(invAgg._sum.cgstTotal ?? 0) - retOut.cgst + trOut.cgst - trCredit.cgst),
    sgst: round2(Number(invAgg._sum.sgstTotal ?? 0) - retOut.sgst + trOut.sgst - trCredit.sgst),
    igst: round2(Number(invAgg._sum.igstTotal ?? 0) - retOut.igst + trOut.igst - trCredit.igst),
  });
  const itc = sectionTotal({
    taxableValue: round2(Number(billAgg._sum.subtotal ?? 0) - retItc.taxableValue + trItc.taxableValue),
    cgst: round2(Number(billAgg._sum.cgstTotal ?? 0) - retItc.cgst + trItc.cgst),
    sgst: round2(Number(billAgg._sum.sgstTotal ?? 0) - retItc.sgst + trItc.sgst),
    igst: round2(Number(billAgg._sum.igstTotal ?? 0) - retItc.igst + trItc.igst),
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
