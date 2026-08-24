// The accounts, the counterparty cards, the invoice number and the journal
// lines a taxable branch transfer needs.
//
// Split out of routes/stockTransfers.ts so the three sets of postings can be
// read side by side. Each function returns line data; none of them writes.
// The route owns the transaction and the ordering.
//
// THE THREE ENTRIES, AND WHY THERE ARE THREE
//
// An untaxed transfer moves goods between two branches of ONE registration.
// One legal person, one balance sheet, so two entries suffice and each
// balances through 1304 Stock in Transit. That case is unchanged and does
// not come through this file at all.
//
// A taxable transfer moves goods between two registrations, which section
// 25(4) makes DISTINCT PERSONS. Two separate trial balances that must each
// stand on their own, and neither may post to an account belonging to the
// other. That takes three:
//
//   DISPATCH — sending branch
//     Dr 1304 Stock in Transit          cost
//     Dr 1305 Inter-Branch Receivable   tax
//       Cr the item's stock account         cost   (per item, on its card)
//       Cr Output CGST/SGST/IGST            tax
//
//   RECEIPT — receiving branch
//     Dr the item's stock account       cost   (per item, on its card)
//     Dr Input CGST/SGST/IGST           tax
//       Cr 2106 Inter-Branch Payable        cost + tax
//
//   RECEIPT — sending branch
//     Dr 1305 Inter-Branch Receivable   cost
//       Cr 1304 Stock in Transit            cost
//
// THE RECONCILIATION THIS MAKES POSSIBLE
//
// Taking 2106 as a positive credit balance:
//
//     1305 + 1304 - 2106  =  invoice value of transfers dispatched
//                            but not yet received
//
//   in transit   1305 = tax,        1304 = cost, 2106 = 0          -> cost + tax
//   received     1305 = cost + tax, 1304 = 0,    2106 = cost + tax -> 0
//
// So it is ZERO whenever nothing is on a lorry, and otherwise equals exactly
// what is on the lorry — which can be checked against the transfers table
// itself. It is NOT zero on every date; an earlier draft of this comment
// claimed that, and it was wrong. Anything left over after subtracting the
// genuinely-in-transit transfers is a posting error.
//
// The reason the two halves arrive at different moments: the tax is incurred
// at DISPATCH (the invoice is issued, section 12) while the goods are still
// the sender's, so 1305 carries the tax alone and 1304 carries the cost.
// Only on receipt does the cost half move across into the receivable.
//
// WHY THE ITC IS TAKEN AT RECEIPT AND NOT AT DISPATCH
//
// Section 16(2)(b) allows input tax credit only on RECEIPT of the goods. The
// sending branch's output liability arises at dispatch under section 12 (the
// issue of the invoice). So a transfer that crosses a month end pays tax in
// one return and claims it in the next — revenue-neutral over the year but
// not within the month, which is expected and is not a bug in these
// postings.
//
// STOCK MOVES AT COST, TAX IS COMPUTED ON THE RULE 28 VALUE
//
// The two are the same number under the second proviso (see
// lib/transferValuation.ts), which is what keeps an internal margin out of
// the receiving branch's inventory and spares the whole unrealised-profit
// elimination apparatus. They are still computed and passed separately,
// because under any other Rule 28 basis they diverge.

import { financialYearOf, formatDocumentNumber, MAX_SERIES_PREFIX_LENGTH } from "./transferValuation";

// The chart-of-accounts codes this posting touches. Output GST at 2102-2104
// and input GST at 1102-1104 are the same accounts a Sales Invoice and a
// Purchase Bill already use — a branch transfer's tax is ordinary output tax
// at one end and ordinary input tax at the other, and giving it its own
// accounts would only split the GST returns across two places.
export const IN_TRANSIT_CODE = "1304";
export const INTER_BRANCH_RECEIVABLE_CODE = "1305";
export const INTER_BRANCH_PAYABLE_CODE = "2106";
export const CGST_OUTPUT_CODE = "2102";
export const SGST_OUTPUT_CODE = "2103";
export const IGST_OUTPUT_CODE = "2104";
export const CGST_INPUT_CODE = "1102";
export const SGST_INPUT_CODE = "1103";
export const IGST_INPUT_CODE = "1104";

export const TRANSFER_SERIES_TYPE = "STOCK_TRANSFER";

export interface TransferAccounts {
  transitId: string;
  receivableId: string;
  payableId: string;
  cgstOutId: string;
  sgstOutId: string;
  igstOutId: string;
  cgstInId: string;
  sgstInId: string;
  igstInId: string;
}

type AccountRow = { id: string; accountCode: string };

// Loads every account a taxable transfer can touch, and names the ones that
// are missing rather than failing later on an undefined id. All of them are
// required even when a particular transfer will not use them all: an
// organisation that cannot post the IGST leg should find that out when it
// configures its chart, not on the one inter-state dispatch that needs it.
export function resolveTransferAccounts(rows: AccountRow[]): {
  accounts: TransferAccounts | null;
  missing: string[];
} {
  const byCode = new Map(rows.map((r) => [r.accountCode, r.id]));
  const need: [string, string][] = [
    [IN_TRANSIT_CODE, "1304 Stock in Transit"],
    [INTER_BRANCH_RECEIVABLE_CODE, "1305 Inter-Branch Receivable"],
    [INTER_BRANCH_PAYABLE_CODE, "2106 Inter-Branch Payable"],
    [CGST_OUTPUT_CODE, "2102 CGST Output"],
    [SGST_OUTPUT_CODE, "2103 SGST Output"],
    [IGST_OUTPUT_CODE, "2104 IGST Output"],
    [CGST_INPUT_CODE, "1102 CGST Input"],
    [SGST_INPUT_CODE, "1103 SGST Input"],
    [IGST_INPUT_CODE, "1104 IGST Input"],
  ];
  const missing = need.filter(([code]) => !byCode.has(code)).map(([, label]) => label);
  if (missing.length > 0) return { accounts: null, missing };
  return {
    accounts: {
      transitId: byCode.get(IN_TRANSIT_CODE)!,
      receivableId: byCode.get(INTER_BRANCH_RECEIVABLE_CODE)!,
      payableId: byCode.get(INTER_BRANCH_PAYABLE_CODE)!,
      cgstOutId: byCode.get(CGST_OUTPUT_CODE)!,
      sgstOutId: byCode.get(SGST_OUTPUT_CODE)!,
      igstOutId: byCode.get(IGST_OUTPUT_CODE)!,
      cgstInId: byCode.get(CGST_INPUT_CODE)!,
      sgstInId: byCode.get(SGST_INPUT_CODE)!,
      igstInId: byCode.get(IGST_INPUT_CODE)!,
    },
    missing: [],
  };
}

// ── Document numbering ────────────────────────────────────────────────────

export interface SeriesRow {
  prefix: string;
  nextNumber: number;
  financialYear: string;
}

export function seriesKeyFor(transferDate: Date) {
  return financialYearOf(transferDate);
}

export function numberFromSeries(series: SeriesRow, allocated: number): string {
  return formatDocumentNumber(series.prefix, series.financialYear, allocated);
}

// A prefix long enough to overflow document_number's VARCHAR(30) once the
// year and sequence are appended is rejected when it is SET, not when a
// dispatch silently truncates a statutory invoice number.
export function prefixProblem(prefix: string): string | null {
  const p = prefix.trim();
  if (!p) return "A series needs a prefix — it is the part your auditors recognise.";
  if (p.length > MAX_SERIES_PREFIX_LENGTH) {
    return `That prefix is ${p.length} characters. The financial year and running number are appended to it, and the whole number has to fit in 30 — so the prefix can be at most ${MAX_SERIES_PREFIX_LENGTH}.`;
  }
  return null;
}

// ── The journal lines ─────────────────────────────────────────────────────

export interface JournalLineData {
  journalEntryId: string;
  accountId: string;
  businessPartnerId: string | null;
  debit: number;
  credit: number;
  narration: string;
}

export interface ItemLeg {
  stockAccountId: string;
  itemPartnerId: string;
  amount: number;
  narration: string;
}

export interface TaxTotals {
  cgst: number;
  sgst: number;
  igst: number;
}

function taxLegs(
  journalEntryId: string,
  accounts: TransferAccounts,
  tax: TaxTotals,
  side: "OUTPUT" | "INPUT",
  narration: string
): JournalLineData[] {
  const out: JournalLineData[] = [];
  const map: [number, string, string][] = side === "OUTPUT"
    ? [[tax.cgst, accounts.cgstOutId, "CGST Output"],
       [tax.sgst, accounts.sgstOutId, "SGST Output"],
       [tax.igst, accounts.igstOutId, "IGST Output"]]
    : [[tax.cgst, accounts.cgstInId, "CGST Input"],
       [tax.sgst, accounts.sgstInId, "SGST Input"],
       [tax.igst, accounts.igstInId, "IGST Input"]];
  for (const [amount, accountId, label] of map) {
    // A zero-value journal line is noise in a ledger, not information. Only
    // the heads that actually carry tax get a line — an inter-state transfer
    // writes IGST alone, an intra-state one CGST and SGST alone.
    if (amount <= 0) continue;
    out.push({
      journalEntryId, accountId, businessPartnerId: null,
      // Output tax is a liability the sender owes; input tax is an asset the
      // receiver reclaims. Opposite sides of the entry, same three heads.
      debit: side === "INPUT" ? amount : 0,
      credit: side === "OUTPUT" ? amount : 0,
      narration: `${label} — ${narration}`.slice(0, 255),
    });
  }
  return out;
}

// DISPATCH, on the sending branch.
export function dispatchJournalLines(args: {
  journalEntryId: string;
  accounts: TransferAccounts;
  items: ItemLeg[];
  costTotal: number;
  tax: TaxTotals;
  taxTotal: number;
  toBranchPartnerId: string;
  label: string;
}): JournalLineData[] {
  const { journalEntryId, accounts, items, costTotal, tax, taxTotal, toBranchPartnerId, label } = args;
  const lines: JournalLineData[] = [
    {
      journalEntryId, accountId: accounts.transitId, businessPartnerId: null,
      debit: costTotal, credit: 0,
      narration: `${label} — in transit`.slice(0, 255),
    },
  ];
  // The receivable carries only the TAX at this point. The cost half joins
  // it when the goods land, via the transit-clearing entry — until then the
  // cost is an asset in its own right, sitting in 1304 where a balance sheet
  // drawn mid-transit can still see the goods.
  if (taxTotal > 0) {
    lines.push({
      journalEntryId, accountId: accounts.receivableId, businessPartnerId: toBranchPartnerId,
      debit: taxTotal, credit: 0,
      narration: `${label} — tax recoverable from receiving branch`.slice(0, 255),
    });
  }
  for (const it of items) {
    lines.push({
      journalEntryId, accountId: it.stockAccountId, businessPartnerId: it.itemPartnerId,
      debit: 0, credit: it.amount, narration: it.narration.slice(0, 255),
    });
  }
  lines.push(...taxLegs(journalEntryId, accounts, tax, "OUTPUT", label));
  return lines;
}

// RECEIPT, on the receiving branch.
export function receiptJournalLines(args: {
  journalEntryId: string;
  accounts: TransferAccounts;
  items: ItemLeg[];
  costTotal: number;
  tax: TaxTotals;
  taxTotal: number;
  fromBranchPartnerId: string;
  label: string;
}): JournalLineData[] {
  const { journalEntryId, accounts, items, costTotal, tax, taxTotal, fromBranchPartnerId, label } = args;
  const lines: JournalLineData[] = [];
  for (const it of items) {
    lines.push({
      journalEntryId, accountId: it.stockAccountId, businessPartnerId: it.itemPartnerId,
      debit: it.amount, credit: 0, narration: it.narration.slice(0, 255),
    });
  }
  lines.push(...taxLegs(journalEntryId, accounts, tax, "INPUT", label));
  lines.push({
    journalEntryId, accountId: accounts.payableId, businessPartnerId: fromBranchPartnerId,
    debit: 0, credit: Math.round((costTotal + taxTotal + Number.EPSILON) * 100) / 100,
    narration: `${label} — due to sending branch`.slice(0, 255),
  });
  return lines;
}

// RECEIPT, on the SENDING branch: the transit asset becomes a receivable.
export function transitClearingJournalLines(args: {
  journalEntryId: string;
  accounts: TransferAccounts;
  costTotal: number;
  toBranchPartnerId: string;
  label: string;
}): JournalLineData[] {
  const { journalEntryId, accounts, costTotal, toBranchPartnerId, label } = args;
  return [
    {
      journalEntryId, accountId: accounts.receivableId, businessPartnerId: toBranchPartnerId,
      debit: costTotal, credit: 0,
      narration: `${label} — goods received by branch`.slice(0, 255),
    },
    {
      journalEntryId, accountId: accounts.transitId, businessPartnerId: null,
      debit: 0, credit: costTotal,
      narration: `${label} — out of transit`.slice(0, 255),
    },
  ];
}

// CANCEL, on the sending branch: the dispatch undone while still in transit.
//
// The output tax is reversed here because the supply did not happen. For GST
// REPORTING that reversal is a credit note under section 34 rather than a
// silent un-posting, and nothing in this file issues one — see the note in
// routes/stockTransfers.ts on /cancel. The ledger effect is the same; the
// return is where the difference has to be handled.
export function cancelJournalLines(args: {
  journalEntryId: string;
  accounts: TransferAccounts;
  items: ItemLeg[];
  costTotal: number;
  tax: TaxTotals;
  taxTotal: number;
  toBranchPartnerId: string;
  label: string;
}): JournalLineData[] {
  const { journalEntryId, accounts, items, costTotal, tax, taxTotal, toBranchPartnerId, label } = args;
  const lines: JournalLineData[] = [];
  for (const it of items) {
    lines.push({
      journalEntryId, accountId: it.stockAccountId, businessPartnerId: it.itemPartnerId,
      debit: it.amount, credit: 0, narration: it.narration.slice(0, 255),
    });
  }
  // Output tax debited back out of the liability it was credited into.
  lines.push(...taxLegs(journalEntryId, accounts, tax, "INPUT", label).map((l) => ({
    ...l,
    accountId: l.accountId === accounts.cgstInId ? accounts.cgstOutId
      : l.accountId === accounts.sgstInId ? accounts.sgstOutId
      : accounts.igstOutId,
    narration: l.narration.replace(" Input ", " Output ").slice(0, 255),
  })));
  lines.push({
    journalEntryId, accountId: accounts.transitId, businessPartnerId: null,
    debit: 0, credit: costTotal,
    narration: `${label} cancelled — out of transit`.slice(0, 255),
  });
  if (taxTotal > 0) {
    lines.push({
      journalEntryId, accountId: accounts.receivableId, businessPartnerId: toBranchPartnerId,
      debit: 0, credit: taxTotal,
      narration: `${label} cancelled — tax no longer recoverable`.slice(0, 255),
    });
  }
  return lines;
}

// A balance check the caller runs before writing. Every one of these entries
// is assembled from several independently-rounded figures, and an entry that
// does not balance must not reach the database — the ledger has no way to
// tell later which side was wrong.
export function balanceProblem(lines: JournalLineData[]): string | null {
  const d = Math.round(lines.reduce((s, l) => s + l.debit, 0) * 100);
  const c = Math.round(lines.reduce((s, l) => s + l.credit, 0) * 100);
  if (d !== c) {
    return `Journal entry does not balance: debits ${(d / 100).toFixed(2)}, credits ${(c / 100).toFixed(2)}.`;
  }
  return null;
}
