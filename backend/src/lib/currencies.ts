// Fixed currency list for foreign-currency Sales Invoices / Purchase Bills
// (export/import trade). Deliberately small — the common currencies an
// Indian MSME actually invoices/bills in — not a full ISO 4217 table.
// Mirrored by hand in frontend/lib/types.ts (same convention as
// SCHEDULE_III_HEADS — no shared package between the two apps).
//
// Exchange rate is manual entry — the rate the user looked up themselves
// (e.g. CBIC's notified rate or their bank's rate) or one pre-filled from
// this org's own Currency Master (see routes/currencyRates.ts /
// CurrencyRate in schema.prisma — an effective-dated rate table, keyed
// off this same fixed code list). Either way it's still just a plain
// number typed onto the invoice/bill at posting time, no live FX API
// integration. All GST/accounting figures stay in INR, computed as
// rate = round2(rateFc * exchangeRate) before any existing discount/tax/
// costing logic runs; the *Fc fields on the invoice/bill/line are a
// display-only convenience (see routes/salesInvoices.ts, purchaseBills.ts).

export interface CurrencyDef {
  code: string; // ISO 4217
  symbol: string;
  name: string;
}

export const SUPPORTED_CURRENCIES: CurrencyDef[] = [
  { code: "INR", symbol: "₹", name: "Indian Rupee" },
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "GBP", symbol: "£", name: "British Pound" },
  { code: "AED", symbol: "AED", name: "UAE Dirham" },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar" },
  { code: "JPY", symbol: "¥", name: "Japanese Yen" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar" },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar" },
  { code: "CHF", symbol: "CHF", name: "Swiss Franc" },
  { code: "CNY", symbol: "¥", name: "Chinese Yuan" },
];

const CODES = new Set(SUPPORTED_CURRENCIES.map((c) => c.code));

export function isSupportedCurrency(code: string): boolean {
  return CODES.has(code);
}

export function getCurrency(code: string): CurrencyDef | undefined {
  return SUPPORTED_CURRENCIES.find((c) => c.code === code);
}
