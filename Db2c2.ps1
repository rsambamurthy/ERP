$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Phase D-b part 2c (retry): remaining schema edits...' -ForegroundColor Cyan

function Edit-FileText($rel, $old, $new) {
  $p = Join-Path $repo $rel
  if (-not (Test-Path -LiteralPath $p)) { throw "Missing file: $rel" }
  $old = $old.Replace([string][char]13, '')
  $new = $new.Replace([string][char]13, '')
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
  // Only NONE is written today — see the header of routes/stockTransfers.ts
  // on why a taxable transfer is refused rather than posted untaxed.
  taxTreatment           String    @default("NONE") @map("tax_treatment") @db.VarChar(10)
  documentNumber         String?   @map("document_number") @db.VarChar(30)
'@
$n0 = @'
  taxTreatment           String    @default("NONE") @map("tax_treatment") @db.VarChar(10)
  // The receiving branch's itcEligibility, copied here at dispatch and then
  // frozen for the same reason taxTreatment is. The route reads THIS, never
  // the live branch row, once a transfer exists.
  toBranchItcEligibility String    @default("FULL") @map("to_branch_itc_eligibility") @db.VarChar(20)
  // Rule 55 delivery challan number on an untaxed transfer; the section 31 /
  // Rule 46 TAX INVOICE number on a taxable one, allocated from
  // DocumentNumberSeries for the sending branch.
  documentNumber         String?   @map("document_number") @db.VarChar(30)
'@
Edit-FileText 'backend/prisma/schema.prisma' $o0 $n0
$o1 = @'
  // Two entries because a journal entry carries one branch: the dispatch
  // belongs to the sending branch and the receipt to the receiving one, and
  // 1304 Stock in Transit is what lets each balance on its own. On a
  // cancelled transfer the second entry is the RETURN to the sender.
  dispatchJournalEntryId String?   @map("dispatch_journal_entry_id") @db.Uuid
  receiptJournalEntryId  String?   @map("receipt_journal_entry_id") @db.Uuid
'@
$n1 = @'
  // An untaxed transfer has TWO entries — dispatch at the sending branch and
  // receipt at the receiving one, each balancing through 1304 Stock in
  // Transit, because one legal person's books can carry both halves.
  //
  // A TAXABLE transfer has THREE. Its two branches are distinct persons
  // under s.25(4) with separate trial balances, so neither may touch an
  // account belonging to the other; the third entry converts the sender's
  // transit asset into a receivable when the goods land. See
  // migration_045's header for the full postings.
  //
  // On a cancelled transfer receiptJournalEntryId holds the RETURN to the
  // sender instead — the column means "the second entry of this transfer".
  dispatchJournalEntryId String?   @map("dispatch_journal_entry_id") @db.Uuid
  receiptJournalEntryId  String?   @map("receipt_journal_entry_id") @db.Uuid
  transitClearingJournalEntryId String? @map("transit_clearing_journal_entry_id") @db.Uuid
'@
Edit-FileText 'backend/prisma/schema.prisma' $o1 $n1
$o2 = @'
  // Rule 28 value and the tax on it. Null while taxTreatment is NONE, which
  // is everything this phase writes.
  taxableValue    Decimal? @map("taxable_value") @db.Decimal(14, 2)
  gstRate         Decimal? @map("gst_rate") @db.Decimal(5, 2)
'@
$n2 = @'
  // Rule 28 value and the tax on it. Null on an untaxed (same-GSTIN)
  // transfer, which is not a supply and carries no tax at all.
  //
  // taxableValue is a separate number from lineValue even though the two are
  // equal today: lineValue is what the STOCK is worth and moves inventory,
  // taxableValue is what the TAX is charged on. Under SECOND_PROVISO they
  // coincide by design (see lib/transferValuation.ts); under any other basis
  // in the Rule 28 hierarchy they do not.
  taxableValue    Decimal? @map("taxable_value") @db.Decimal(14, 2)
  // Which step of Rule 28 justifies taxableValue. Per line, because one
  // transfer can carry a bought-in item with a known market price alongside
  // a manufactured one that has none.
  valuationBasis  String   @default("SECOND_PROVISO") @map("valuation_basis") @db.VarChar(20)
  gstRate         Decimal? @map("gst_rate") @db.Decimal(5, 2)
'@
Edit-FileText 'backend/prisma/schema.prisma' $o2 $n2
$o3 = @'
  @@index([stockTransferId])
  @@map("stock_transfer_lines")
}
'@
$n3 = @'
  @@index([stockTransferId])
  @@map("stock_transfer_lines")
}

// Consecutive document numbering, per branch per financial year.
//
// A tax invoice needs a serial number that is consecutive and unique within
// a financial year (Rule 46(b)), and two branches of one company are
// DISTINCT PERSONS under s.25(4) — so the series belongs to a branch, not to
// the organisation. Keyed by financial year as well, because the numbering
// conventionally restarts every April: a new year is a new row starting at
// 1, rather than a reset job somebody has to remember to run.
//
// prefix is set deliberately, once, per branch (GST/IBT/TN) rather than
// invented by code — it is the part a company's auditors recognise, and
// nothing should generate it for them.
//
// seriesType names only STOCK_TRANSFER today. Sales Invoice numbering is
// still a plain row count in routes/salesInvoices.ts; this table is where it
// would move without a second one being built.
model DocumentNumberSeries {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId String   @map("organization_id") @db.Uuid
  branchId       String   @map("branch_id") @db.Uuid
  seriesType     String   @map("series_type") @db.VarChar(20)
  // "2026-27" — the label, not a date.
  financialYear  String   @map("financial_year") @db.VarChar(9)
  prefix         String   @db.VarChar(20)
  // The number the NEXT document will take. Allocated by incrementing this
  // row inside the posting transaction, so two dispatches racing each other
  // cannot be handed the same number.
  nextNumber     Int      @default(1) @map("next_number")
  createdAt      DateTime @default(now()) @map("created_at")

  organization Organization @relation(fields: [organizationId], references: [id])
  branch       Branch       @relation(fields: [branchId], references: [id])

  @@unique([organizationId, branchId, seriesType, financialYear], map: "document_number_series_uq")
  @@map("document_number_series")
}
'@
Edit-FileText 'backend/prisma/schema.prisma' $o3 $n3
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green