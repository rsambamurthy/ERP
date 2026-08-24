$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Phase D-b part 1: valuation and numbering helpers...' -ForegroundColor Cyan

function Set-FileText($rel, $text) {
  $p = Join-Path $repo $rel
  $dir = Split-Path $p -Parent
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::WriteAllText($p, $text.Replace([string][char]13, ''), (New-Object Text.UTF8Encoding $false))
  Write-Host "  wrote  $rel"
}
$f0 = @'
// Valuation and document numbering for taxable branch transfers.
//
// Everything here is a pure function. No database, no Prisma, no request —
// so the arithmetic that decides what tax goes on a statutory invoice can be
// read and tested on its own, which matters more here than usual: a mistake
// in this file becomes a wrong figure in a GSTR-1 return.
//
// WHY A BRANCH TRANSFER IS TAXED AT ALL
//
// Section 25(4) makes two registrations of one company DISTINCT PERSONS, and
// Schedule I paragraph 2 makes a supply between distinct persons taxable even
// though no money changes hands. So goods moving from a Tamil Nadu
// registration to a Karnataka one are a supply, needing a tax invoice under
// section 31 / Rule 46 and reporting in the sending branch's GSTR-1.
//
// WHAT THE GOODS ARE WORTH FOR THAT TAX — RULE 28
//
// Rule 28 sets the value of a supply between distinct persons, in order:
//
//   28(1)(a)  open market value
//   1st proviso  90% of the price the recipient charges an unrelated
//                customer — available only where the recipient sells the
//                goods on AS-IS, without further processing
//   28(1)(b)  the value of goods of like kind and quality
//   28(1)(c)  Rule 30 — 110% of cost of production/manufacture/acquisition
//
// The SECOND PROVISO sits outside that sequence and overrides it: where the
// recipient is eligible for FULL input tax credit, the value declared in the
// invoice IS DEEMED to be the open market value. It is a deeming fiction, not
// a fallback — once it applies there is no obligation to go looking for a
// market price. It applies to the overwhelming majority of transfers, because
// the transaction is revenue-neutral to the exchequer: the sending branch
// pays the tax, the receiving branch claims exactly that as credit.
//
// So SECOND_PROVISO is the basis this module computes, and it computes it AT
// COST. Cost, rather than the ₹1-a-unit the proviso would equally permit,
// for two reasons that are not about tax at all:
//
//   - the value goes on the invoice and the e-way bill, and a figure nobody
//     can defend to a checkpost officer is a practical problem even when it
//     is a legal one;
//   - it keeps the clearing accounts reconcilable. Stock moves at cost
//     through 1304/1305/2106 (see migration_044), so when the invoice value
//     equals cost, the identity 1305 + 1304 - 2106 = 0 holds on every date.
//     An invoice value different from cost would put an internal margin into
//     the receiving branch's stock, which AS 2 then requires be eliminated
//     on consolidation — a whole unrealised-profit apparatus avoided by
//     making these two numbers the same number.
//
// The other four bases are named in the type because they are real and a
// line may one day need them (a transfer into a branch making exempt
// supplies cannot use the second proviso at all). None is computed here.
//
// The tax itself is always on the Rule 28 value, never on cost — those
// coincide today only because the basis chosen makes them coincide.

import { splitGst } from "./discountGst";

export type ValuationBasis =
  | "SECOND_PROVISO"
  | "OMV"
  | "NINETY_PCT"
  | "LIKE_KIND"
  | "RULE_30";

export type ItcEligibility = "FULL" | "RESTRICTED" | "PROPORTIONATE";

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── Financial year ────────────────────────────────────────────────────────
//
// India's financial year runs 1 April to 31 March. A tax invoice's serial
// number must be unique within a financial year (Rule 46(b)), which is why
// the series is keyed by one.

export function financialYearOf(d: Date): string {
  // getUTCMonth() is 0-based: 0=Jan, 3=Apr. Dates are stored as @db.Date and
  // constructed at UTC midnight throughout this codebase, so reading the UTC
  // parts is reading the date that was actually entered — using the local
  // getMonth() here would shift the year boundary by a timezone for anyone
  // running the server west of UTC.
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const startYear = m >= 3 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

// "2026-27" -> "26-27", the form that conventionally appears inside the
// number itself. The canonical long form is what's stored, because it sorts
// and cannot be misread across a century.
export function shortFinancialYear(fy: string): string {
  return fy.slice(2);
}

// The longest prefix that still leaves room for a full number.
//
// A number is prefix + "/" + "26-27" + "/" + sequence. document_number is
// VARCHAR(30), and the sequence is padded to 4 but allowed to grow — an
// organisation issuing more than 9,999 transfer invoices in one year gets a
// 5-digit sequence rather than a collision. Budgeting for that 5th digit:
// 30 - 1 - 5 - 1 - 5 = 18.
export const MAX_SERIES_PREFIX_LENGTH = 18;

export function formatDocumentNumber(
  prefix: string,
  financialYear: string,
  sequence: number
): string {
  return `${prefix}/${shortFinancialYear(financialYear)}/${String(sequence).padStart(4, "0")}`;
}

// ── Whether a taxable transfer may be posted at all ───────────────────────
//
// Each of these is a refusal rather than a default, and deliberately so. The
// output of this route is a statutory document; a guess that lands in a
// GSTR-1 is worse than a dispatch that does not happen until someone fixes
// the master data.

export type TransferBlockedReason =
  | "RECIPIENT_ITC_RESTRICTED"
  | "MISSING_HSN"
  | "MISSING_GST_RATE"
  | "UNKNOWN_STATE"
  | "NO_SERIES";

export interface TransferLineInput {
  itemId: string;
  itemName: string;
  hsnCode: string | null;
  taxRate: number | null;
  quantity: number;
  unitCost: number;
}

export interface BlockedLine {
  itemId: string;
  itemName: string;
  reason: TransferBlockedReason;
}

// Returns every line that cannot be invoiced, not just the first — someone
// fixing item masters wants the whole list, not one round trip per item.
export function blockedLines(lines: TransferLineInput[]): BlockedLine[] {
  const out: BlockedLine[] = [];
  for (const l of lines) {
    // Rule 46(g) requires the HSN on the face of the invoice, and the NIC
    // portal rejects an e-way bill without it. A missing HSN is caught here
    // rather than at the portal, after the lorry has left.
    if (!l.hsnCode || !l.hsnCode.trim()) {
      out.push({ itemId: l.itemId, itemName: l.itemName, reason: "MISSING_HSN" });
      continue;
    }
    // A null rate is unset, and unset is not the same as zero. A genuinely
    // nil-rated item is configured as 0 and passes.
    if (l.taxRate === null || l.taxRate === undefined) {
      out.push({ itemId: l.itemId, itemName: l.itemName, reason: "MISSING_GST_RATE" });
    }
  }
  return out;
}

// ── The line valuation ────────────────────────────────────────────────────

export interface ValuedLine {
  itemId: string;
  quantity: number;
  unitCost: number;
  // What the stock movement is worth. Cost, always — this is the figure that
  // moves inventory and the clearing accounts.
  lineValue: number;
  // What the tax is charged on. Equal to lineValue under SECOND_PROVISO,
  // which is the only basis computed today, but a separate number because
  // under any other basis it is a different one.
  taxableValue: number;
  valuationBasis: ValuationBasis;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
}

// interState is passed in rather than derived, because deriving it needs the
// two branches' state codes and this module deliberately holds no query. The
// caller must refuse UNKNOWN_STATE rather than passing a guess: unlike a
// sales invoice — where discountGst.isInterState falls back to CGST+SGST so
// that a half-configured customer does not block a sale — a branch transfer
// with an undeterminable place of supply must not post. Both branches are
// the organisation's own registrations; if their state codes are unset that
// is a masters problem with a known fix, not a fact about a third party.
export function valueLine(
  line: TransferLineInput,
  interState: boolean
): ValuedLine {
  const lineValue = round2(line.quantity * line.unitCost);
  // The second proviso deems the invoice value to be open market value, and
  // the invoice value declared is cost. See the header for why cost and not
  // some other permitted figure.
  const taxableValue = lineValue;
  const gstRate = line.taxRate ?? 0;
  const taxAmount = round2((taxableValue * gstRate) / 100);
  const { cgst, sgst, igst } = splitGst(taxAmount, interState);
  return {
    itemId: line.itemId,
    quantity: line.quantity,
    unitCost: line.unitCost,
    lineValue,
    taxableValue,
    valuationBasis: "SECOND_PROVISO",
    gstRate,
    cgst,
    sgst,
    igst,
  };
}

export interface TransferTotals {
  lineValueTotal: number;
  taxableTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  taxTotal: number;
  // What the sending branch is owed and the receiving branch owes: the goods
  // at cost plus the tax on them. The single figure that hits 1305 at one
  // end and 2106 at the other, which is why it is computed once here rather
  // than assembled twice in the posting code.
  clearingTotal: number;
}

export function totalsFor(lines: ValuedLine[]): TransferTotals {
  const lineValueTotal = round2(lines.reduce((s, l) => s + l.lineValue, 0));
  const taxableTotal = round2(lines.reduce((s, l) => s + l.taxableValue, 0));
  const cgstTotal = round2(lines.reduce((s, l) => s + l.cgst, 0));
  const sgstTotal = round2(lines.reduce((s, l) => s + l.sgst, 0));
  const igstTotal = round2(lines.reduce((s, l) => s + l.igst, 0));
  const taxTotal = round2(cgstTotal + sgstTotal + igstTotal);
  return {
    lineValueTotal,
    taxableTotal,
    cgstTotal,
    sgstTotal,
    igstTotal,
    taxTotal,
    clearingTotal: round2(lineValueTotal + taxTotal),
  };
}

'@
Set-FileText 'backend/src/lib/transferValuation.ts' $f0
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green