$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Phase D-c: types and API for taxable transfers...' -ForegroundColor Cyan

# This script is pure ASCII. Every non-ASCII character travels as ~U+XXXX~
# and is decoded below, so it behaves identically whether PowerShell reads it
# as UTF-8 or as Windows-1252. No byte-order mark needed.
$decoder = [Text.RegularExpressions.MatchEvaluator] {
  param($m)
  [char]::ConvertFromUtf32([Convert]::ToInt32($m.Groups[1].Value, 16))
}
function Decode($s) {
  return [Text.RegularExpressions.Regex]::Replace($s, '~U\+([0-9A-Fa-f]{4,6})~', $decoder)
}

function Edit-FileText($rel, $old, $new) {
  $p = Join-Path $repo $rel
  if (-not (Test-Path -LiteralPath $p)) { throw "Missing file: $rel" }
  $old = (Decode $old).Replace([string][char]13, '')
  $new = (Decode $new).Replace([string][char]13, '')
  $t = [IO.File]::ReadAllText($p).Replace([string][char]13, '')
  if ($t.Contains($new)) { Write-Host "  skip   $rel"; return }
  $i = $t.IndexOf($old)
  if ($i -lt 0) { throw "Anchor not found in $rel." }
  if ($t.IndexOf($old, $i + 1) -ge 0) { throw "Anchor is not unique in $rel." }
  $t = $t.Substring(0, $i) + $new + $t.Substring($i + $old.Length)
  [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
  Write-Host "  edit   $rel"
}
$o0 = @'
  stateCode: string | null;
  phone: string | null;
  email: string | null;
  address: unknown;
  isHeadOffice: boolean;
'@
$n0 = @'
  stateCode: string | null;
  // Whether this branch can claim FULL input tax credit on what it receives.
  // Defaults to FULL, which is what makes valuing a branch transfer into it
  // at cost legal under the second proviso to Rule 28.
  itcEligibility: ItcEligibility;
  phone: string | null;
  email: string | null;
  address: unknown;
  isHeadOffice: boolean;
'@
Edit-FileText 'frontend/lib/types.ts' $o0 $n0
$o1 = @'
export interface StockTransferLineView {
  id: string;
  item: { id: string; sku: string; name: string; uom: string };
  quantity: number;
  // What the stock was worth at the sending branch. Never entered ~U+2014~ the
  // receiving branch receives at this cost and nothing is re-valued in
  // transit.
  unitCost: number;
  lineValue: number;
}
'@
$n1 = @'
// Which step of Rule 28 justifies a taxable line's value. Only
// SECOND_PROVISO is written today: where the receiving branch can claim full
// input tax credit, the proviso DEEMS the invoice value to be open market
// value, and the value declared is cost. The rest of the hierarchy is named
// because a line into a branch that cannot claim full credit would need it.
export type ValuationBasis =
  | "SECOND_PROVISO" | "OMV" | "NINETY_PCT" | "LIKE_KIND" | "RULE_30";

export const VALUATION_BASIS_LABEL: Record<ValuationBasis, string> = {
  SECOND_PROVISO: "Rule 28, 2nd proviso (invoice value = OMV)",
  OMV: "Rule 28(1)(a) open market value",
  NINETY_PCT: "Rule 28, 1st proviso (90% of onward price)",
  LIKE_KIND: "Rule 28(1)(b) like kind and quality",
  RULE_30: "Rule 30 (110% of cost)",
};

// Whether a branch can claim full input tax credit on what it receives.
// FULL is what makes the second proviso available and a transfer at cost
// legal; the others mean the tax would be a cost to that branch, which is
// not built ~U+2014~ a taxable transfer into one is refused.
export type ItcEligibility = "FULL" | "RESTRICTED" | "PROPORTIONATE";

export interface StockTransferLineView {
  id: string;
  item: { id: string; sku: string; name: string; uom: string; hsnCode: string | null };
  quantity: number;
  // What the stock was worth at the sending branch. Never entered ~U+2014~ the
  // receiving branch receives at this cost and nothing is re-valued in
  // transit.
  unitCost: number;
  lineValue: number;
  // Null on an untaxed transfer, which is not a supply and carries no tax.
  // taxableValue equals lineValue under the second proviso by design; it is
  // a separate figure because under any other basis it would not be.
  taxableValue: number | null;
  valuationBasis: ValuationBasis;
  gstRate: number | null;
  cgst: number | null;
  sgst: number | null;
  igst: number | null;
}
'@
Edit-FileText 'frontend/lib/types.ts' $o1 $n1
$o2 = @'
  // NONE or TAXABLE. Only NONE is written today ~U+2014~ a transfer between
  // branches with different GSTINs is refused rather than posted untaxed.
  taxTreatment: string;
  documentNumber: string | null;
  lineCount: number;
  totalValue: number;
}

export interface StockTransferDetail extends Omit<StockTransferSummary, "lineCount"> {
  ewayBillNumber: string | null;
  dispatchJournalEntryId: string | null;
  receiptJournalEntryId: string | null;
  lines: StockTransferLineView[];
}
'@
$n2 = @'
  // NONE for a same-GSTIN move (one legal person, delivery challan under
  // Rule 55). TAXABLE where the GSTINs differ, which section 25(4) makes
  // distinct persons ~U+2014~ a supply needing a tax invoice and GST.
  taxTreatment: string;
  // The Rule 55 challan reference on an untaxed transfer; the section 31 /
  // Rule 46 tax invoice number, allocated from the branch's series, on a
  // taxable one.
  documentNumber: string | null;
  lineCount: number;
  // Goods at cost. Never includes tax ~U+2014~ stock moves at cost end to end.
  totalValue: number;
  taxTotal: number;
  // What the receiving branch owes: goods at cost plus the tax. Equals
  // totalValue on an untaxed transfer, where nothing is owed to anybody.
  invoiceTotal: number;
}

export interface StockTransferDetail extends Omit<StockTransferSummary, "lineCount"> {
  fromBranch: { id: string; name: string; gstin: string | null };
  toBranch: { id: string; name: string; gstin: string | null };
  // The receiving branch's ITC posture, frozen at dispatch. Read from here
  // rather than the live branch, so reclassifying a branch never restates a
  // transfer already made.
  toBranchItcEligibility: ItcEligibility;
  ewayBillNumber: string | null;
  dispatchJournalEntryId: string | null;
  receiptJournalEntryId: string | null;
  // Only a taxable transfer has a third entry: the sending branch converting
  // its stock-in-transit into a receivable when the goods land.
  transitClearingJournalEntryId: string | null;
  lines: StockTransferLineView[];
}

// One branch's tax-invoice numbering for a financial year.
export interface TransferSeriesRow {
  branchId: string;
  name: string;
  gstin: string | null;
  stateCode: string | null;
  itcEligibility: ItcEligibility;
  prefix: string | null;
  nextNumber: number | null;
  // False means this branch cannot send a taxable transfer at all ~U+2014~ Rule
  // 46(b) wants a consecutive serial number and there is none to take.
  configured: boolean;
}

export interface TransferSeries {
  financialYear: string;
  branches: TransferSeriesRow[];
}
'@
Edit-FileText 'frontend/lib/types.ts' $o2 $n2
$o3 = @'
  StockTransferSummary,
  StockTransferDetail,
'@
$n3 = @'
  StockTransferSummary,
  StockTransferDetail,
  TransferSeries,
'@
Edit-FileText 'frontend/lib/api.ts' $o3 $n3
$o4 = @'
export function createStockTransfer(body: {
  fromBranchId: string; toBranchId: string; transferDate: string;
  documentNumber?: string; ewayBillNumber?: string;
  lines: { itemId: string; quantity: number }[];
}) {
  return request<{ data: { id: string; transferNumber: string; total: number } }>("/stock-transfers", {
    method: "POST", body: JSON.stringify(body),
  });
}

export function receiveStockTransfer(id: string, receivedDate?: string) {
  return request<{ data: { received: boolean; total: number } }>(`/stock-transfers/${id}/receive`, {
    method: "POST", body: JSON.stringify({ receivedDate }),
  });
}

// Brings the goods back to the sending branch. Only while in transit.
export function cancelStockTransfer(id: string, entryDate?: string) {
  return request<{ data: { cancelled: boolean; total: number } }>(`/stock-transfers/${id}/cancel`, {
    method: "POST", body: JSON.stringify({ entryDate }),
  });
}
'@
$n4 = @'
export function createStockTransfer(body: {
  fromBranchId: string; toBranchId: string; transferDate: string;
  documentNumber?: string; ewayBillNumber?: string;
  lines: { itemId: string; quantity: number }[];
}) {
  return request<{
    data: {
      id: string; transferNumber: string; total: number;
      // The tax invoice number on a taxable transfer, allocated server-side
      // from the sending branch's series; the challan reference otherwise.
      documentNumber: string | null;
      taxTreatment: string; taxTotal: number;
    };
  }>("/stock-transfers", { method: "POST", body: JSON.stringify(body) });
}

// The tax-invoice numbering series, per branch, for one financial year.
// Without one a branch cannot send a taxable transfer at all.
export function getTransferSeries(financialYear?: string) {
  const q = financialYear ? `?financialYear=${encodeURIComponent(financialYear)}` : "";
  return request<{ data: TransferSeries }>(`/stock-transfers/series${q}`);
}

// Sets the prefix only. The running number is deliberately not settable:
// moving it backwards would re-issue a number already on a document.
export function setTransferSeries(body: { branchId: string; financialYear?: string; prefix: string }) {
  return request<{ data: { branchId: string; financialYear: string; prefix: string; nextNumber: number } }>(
    "/stock-transfers/series", { method: "PUT", body: JSON.stringify(body) },
  );
}

export function receiveStockTransfer(id: string, receivedDate?: string) {
  return request<{ data: { received: boolean; total: number; taxTotal: number } }>(`/stock-transfers/${id}/receive`, {
    method: "POST", body: JSON.stringify({ receivedDate }),
  });
}

// Brings the goods back to the sending branch. Only while in transit.
export function cancelStockTransfer(id: string, entryDate?: string) {
  return request<{
    // creditNoteNeeded: the ledger reversal is done, but an invoice that has
    // already been issued is undone by a credit note under section 34, and
    // nothing here issues one.
    data: { cancelled: boolean; total: number; taxTotal: number; creditNoteNeeded: boolean };
  }>(`/stock-transfers/${id}/cancel`, { method: "POST", body: JSON.stringify({ entryDate }) });
}
'@
Edit-FileText 'frontend/lib/api.ts' $o4 $n4
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green