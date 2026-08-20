import { prisma } from "../db";

// The ledger shape of a Purchase Bill, extracted so the two things that
// create one — routes/purchaseBills.ts and the Recurring Expenses generator
// — post identically.
//
// Only the journal shape and the account lookups live here. Orchestration
// stays with each caller, because they genuinely differ: a purchase bill may
// be PO-linked with 3-way matching, price-variance approval, foreign
// currency and customs duty, none of which a recurring expense has. What
// must never diverge is which accounts get debited and credited, and that is
// exactly what this file owns.

// Every org's core COA (seed.ts) always includes these — same convention
// journal.ts uses for CASH_BANK_CODES.
export const TRADE_PAYABLES_CODE = "2001";
export const CGST_INPUT_CODE = "1102";
export const SGST_INPUT_CODE = "1103";
export const IGST_INPUT_CODE = "1104";
// Import bills only — customs duty + import IGST both credit here instead
// of Trade Payables, since neither is actually owed to the foreign vendor.
export const CUSTOMS_DUTY_PAYABLE_CODE = "2105";

export interface PostingAccounts {
  tradePayables: { id: string } | null;
  cgstInput: { id: string } | null;
  sgstInput: { id: string } | null;
  igstInput: { id: string } | null;
  customsDutyPayable: { id: string } | null;
}

export async function loadPostingAccounts(organizationId: string): Promise<PostingAccounts> {
  const [cgstInput, sgstInput, igstInput, tradePayables, customsDutyPayable] = await Promise.all([
    prisma.account.findFirst({ where: { organizationId, accountCode: CGST_INPUT_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: SGST_INPUT_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: IGST_INPUT_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: TRADE_PAYABLES_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: CUSTOMS_DUTY_PAYABLE_CODE } }),
  ]);
  return { tradePayables, cgstInput, sgstInput, igstInput, customsDutyPayable };
}

// Dr each line's account (a stock control account for STOCK, an expense head
// for SERVICE), Dr GST Input split, Cr Customs Duty Payable on imports,
// Cr Trade Payables tagged to the vendor.
export function buildBillJournalLineRows(args: {
  journalEntryId: string;
  computed: { itemId: string; quantity: number; lineSubtotal: number; customsDutyAmount: number }[];
  itemById: Map<string, { stockAccountId: string; businessPartnerId: string; sku: string; itemKind: string }>;
  cgstTotal: number; sgstTotal: number; igstTotal: number;
  cgstInput: { id: string } | null; sgstInput: { id: string } | null; igstInput: { id: string } | null;
  customsDutyPayableCredit: number; customsDutyPayable: { id: string } | null;
  tradePayables: { id: string }; tradePayablesCredit: number;
  vendor: { id: string; name: string };
}) {
  const {
    journalEntryId, computed, itemById, cgstTotal, sgstTotal, igstTotal,
    cgstInput, sgstInput, igstInput, customsDutyPayableCredit, customsDutyPayable,
    tradePayables, tradePayablesCredit, vendor,
  } = args;
  return [
    ...computed.map((l) => ({
      journalEntryId,
      accountId: itemById.get(l.itemId)!.stockAccountId,
      // The partner tag is the item's paired ITEM sub-ledger row, which only
      // means anything on a stock control account. A SERVICE line debits a
      // plain expense head with no sub-ledger, so tagging it would put a
      // balance on a partner nobody will ever look up.
      businessPartnerId: itemById.get(l.itemId)!.itemKind === "SERVICE"
        ? null
        : itemById.get(l.itemId)!.businessPartnerId,
      debit: l.lineSubtotal + l.customsDutyAmount, credit: 0,
      narration: `${itemById.get(l.itemId)!.sku} x ${l.quantity}`,
    })),
    ...(cgstTotal > 0 ? [{ journalEntryId, accountId: cgstInput!.id, businessPartnerId: null, debit: cgstTotal, credit: 0, narration: "CGST Input" }] : []),
    ...(sgstTotal > 0 ? [{ journalEntryId, accountId: sgstInput!.id, businessPartnerId: null, debit: sgstTotal, credit: 0, narration: "SGST Input" }] : []),
    ...(igstTotal > 0 ? [{ journalEntryId, accountId: igstInput!.id, businessPartnerId: null, debit: igstTotal, credit: 0, narration: "IGST Input" }] : []),
    ...(customsDutyPayableCredit > 0 ? [{ journalEntryId, accountId: customsDutyPayable!.id, businessPartnerId: null, debit: 0, credit: customsDutyPayableCredit, narration: "Customs duty + import IGST payable" }] : []),
    { journalEntryId, accountId: tradePayables.id, businessPartnerId: vendor.id, debit: 0, credit: tradePayablesCredit, narration: `Payable to ${vendor.name}` },
  ];
}
