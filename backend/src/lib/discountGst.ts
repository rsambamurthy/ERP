// Shared discount-proration and CGST/SGST/IGST split helpers for Sales
// Invoice (discount + GST split) and Purchase Bill (GST split only — see
// ROADMAP.md's "Discount + GST Split" section for why Purchase Bill doesn't
// get a discount concept in this pass).

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Same-state (CGST+SGST) vs different-state (IGST) call, compared by GST
// state code. Falls back to CGST+SGST if either side's stateCode is
// unknown (unregistered branch, or a customer/vendor with no GSTIN/state
// set yet) rather than blocking posting — see migration_014's note.
export function isInterState(
  branchStateCode: string | null | undefined,
  partnerStateCode: string | null | undefined
): boolean {
  if (!branchStateCode || !partnerStateCode) return false;
  return branchStateCode !== partnerStateCode;
}

export function splitGst(taxAmount: number, interState: boolean): { cgst: number; sgst: number; igst: number } {
  if (taxAmount <= 0) return { cgst: 0, sgst: 0, igst: 0 };
  if (interState) return { cgst: 0, sgst: 0, igst: round2(taxAmount) };
  const cgst = round2(taxAmount / 2);
  const sgst = round2(taxAmount - cgst); // remainder to sgst, not a second /2, so cgst+sgst always equals taxAmount exactly
  return { cgst, sgst, igst: 0 };
}

export type DiscountType = "PERCENT" | "FLAT";

export interface DiscountLineInput {
  quantity: number;
  rate: number;
  taxRate: number;
  discountType?: DiscountType | null;
  discountValue?: number;
}

export interface DiscountLineResult {
  lineSubtotal: number; // gross, qty*rate, pre-discount
  lineDiscountAmount: number;
  invoiceDiscountShare: number;
  // This line's share of the document-level charges. ADDS to the taxable
  // value, where the two discounts above subtract from it.
  chargeShare: number;
  taxableValue: number;
  taxAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  lineTotal: number; // taxableValue + taxAmount — what this line contributes to Grand Total
}

// Applies each line's own discount first, then prorates the invoice-level
// discount across lines by their post-line-discount value, then computes
// GST on whatever's left. The last line absorbs any rounding remainder so
// the per-line invoiceDiscountShare figures always sum exactly to the
// invoice-level discount amount (standard "last line eats the rounding"
// technique — avoids a total that's a paisa off from what was actually
// charged).
//
// CHARGES ARE PRORATED THE SAME WAY, WITH THE OPPOSITE SIGN, and that is
// the whole reason freight on this invoice gets taxed correctly.
//
// Section 15(2)(c) puts incidental expenses - packing, and anything the
// supplier does in respect of the supply at or before delivery - inside the
// VALUE of the supply, and section 8(a) taxes a composite supply at the
// rate of the PRINCIPAL supply. So delivery charged on an invoice for pumps
// at 18% is taxed at 18%, under the pumps' HSN, not at 5% under SAC 9965.
//
// Prorating the charge into each line's taxable value before GST is
// computed makes that true by construction. There is no way to give a
// charge a rate of its own here, because it never has one to give - it
// simply increases the value of the goods it accompanies, which is what the
// Act says it does. Add it as a line with its own rate instead and every
// invoice carrying freight understates output tax.
//
// Prorated by post-discount value, so a charge follows the money rather
// than the line count: a 900.00 line carries nine times the freight of a
// 100.00 one. Last line eats the rounding, exactly as the discount does.
export function computeDiscountedLines(
  lines: DiscountLineInput[],
  invoiceDiscount: { type?: DiscountType | null; value?: number },
  interState: boolean,
  // Total of the document-level charges - freight, packing, insurance.
  // See the note above the proration below.
  chargesTotal = 0
): DiscountLineResult[] {
  const step1 = lines.map((l) => {
    const lineSubtotal = round2(l.quantity * l.rate);
    const rawDiscount =
      l.discountType === "PERCENT" ? (lineSubtotal * (l.discountValue ?? 0)) / 100
      : l.discountType === "FLAT" ? Math.min(l.discountValue ?? 0, lineSubtotal)
      : 0;
    const lineDiscountAmount = round2(Math.max(0, rawDiscount));
    const netOfLineDiscount = round2(lineSubtotal - lineDiscountAmount);
    return { ...l, lineSubtotal, lineDiscountAmount, netOfLineDiscount };
  });

  const subtotalAfterLineDiscount = round2(step1.reduce((s, l) => s + l.netOfLineDiscount, 0));
  const rawInvoiceDiscount =
    invoiceDiscount.type === "PERCENT" ? (subtotalAfterLineDiscount * (invoiceDiscount.value ?? 0)) / 100
    : invoiceDiscount.type === "FLAT" ? Math.min(invoiceDiscount.value ?? 0, subtotalAfterLineDiscount)
    : 0;
  const invoiceDiscountAmount = round2(Math.max(0, rawInvoiceDiscount));

  // Base for the CHARGE proration: what each line is worth after both
  // discounts. Computed here rather than inside the loop because the
  // denominator has to be the whole invoice, not the part seen so far.
  const netOfBothDiscounts = step1.map((l, idx) => {
    const d = invoiceDiscountAmount === 0 ? 0
      : subtotalAfterLineDiscount > 0
        ? round2((invoiceDiscountAmount * l.netOfLineDiscount) / subtotalAfterLineDiscount)
        : 0;
    return round2(l.netOfLineDiscount - d);
  });
  const netTotal = round2(netOfBothDiscounts.reduce((s, v) => s + v, 0));
  const charges = round2(Math.max(0, chargesTotal));

  let assignedShare = 0;
  let assignedCharge = 0;
  return step1.map((l, idx) => {
    const last = idx === step1.length - 1;
    let share: number;
    if (last) {
      share = round2(invoiceDiscountAmount - assignedShare);
    } else {
      share =
        subtotalAfterLineDiscount > 0
          ? round2((invoiceDiscountAmount * l.netOfLineDiscount) / subtotalAfterLineDiscount)
          : 0;
      assignedShare = round2(assignedShare + share);
    }
    let chargeShare: number;
    if (last) {
      chargeShare = round2(charges - assignedCharge);
    } else {
      chargeShare = netTotal > 0 ? round2((charges * netOfBothDiscounts[idx]) / netTotal) : 0;
      assignedCharge = round2(assignedCharge + chargeShare);
    }
    const taxableValue = round2(l.netOfLineDiscount - share + chargeShare);
    const taxAmount = round2((taxableValue * l.taxRate) / 100);
    const { cgst, sgst, igst } = splitGst(taxAmount, interState);
    return {
      lineSubtotal: l.lineSubtotal,
      lineDiscountAmount: l.lineDiscountAmount,
      invoiceDiscountShare: share,
      chargeShare,
      taxableValue,
      taxAmount,
      cgstAmount: cgst,
      sgstAmount: sgst,
      igstAmount: igst,
      lineTotal: round2(taxableValue + taxAmount),
    };
  });
}
