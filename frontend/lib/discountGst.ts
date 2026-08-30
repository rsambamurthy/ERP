// Client-side mirror of backend/src/lib/discountGst.ts — used only for the
// live total preview on Sales Invoice / Purchase Bill before posting. The
// server recomputes everything authoritatively; this exists so the
// on-screen totals don't jump between what the user sees while filling the
// form and what actually gets posted.

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function isInterState(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a !== b;
}

export function splitGst(taxAmount: number, interState: boolean): { cgst: number; sgst: number; igst: number } {
  if (taxAmount <= 0) return { cgst: 0, sgst: 0, igst: 0 };
  if (interState) return { cgst: 0, sgst: 0, igst: round2(taxAmount) };
  const cgst = round2(taxAmount / 2);
  const sgst = round2(taxAmount - cgst);
  return { cgst, sgst, igst: 0 };
}

export interface DiscountLineInput {
  quantity: number;
  rate: number;
  taxRate: number;
  discountType?: "PERCENT" | "FLAT" | null;
  discountValue?: number;
}

export function computeDiscountedLines(
  lines: DiscountLineInput[],
  invoiceDiscount: { type?: "PERCENT" | "FLAT" | null; value?: number },
  interState: boolean,
  // Total of the document-level charges - freight, packing, insurance.
  // See the note above the proration below.
  chargesTotal = 0
) {
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
