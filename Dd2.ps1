$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Phase D-d: schema and GST reporting...' -ForegroundColor Cyan

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
  // The receiving branch's itcEligibility, copied here at dispatch and then
  // frozen for the same reason taxTreatment is. The route reads THIS, never
  // the live branch row, once a transfer exists.
  toBranchItcEligibility String    @default("FULL") @map("to_branch_itc_eligibility") @db.VarChar(20)
  // Rule 55 delivery challan number on an untaxed transfer; the section 31 /
  // Rule 46 TAX INVOICE number on a taxable one, allocated from
  // DocumentNumberSeries for the sending branch.
  documentNumber         String?   @map("document_number") @db.VarChar(30)
'@
$n0 = @'
  // The receiving branch's itcEligibility, copied here at dispatch and then
  // frozen for the same reason taxTreatment is. The route reads THIS, never
  // the live branch row, once a transfer exists.
  toBranchItcEligibility String    @default("FULL") @map("to_branch_itc_eligibility") @db.VarChar(20)
  // Who the counterparty was and where the supply took place, frozen at
  // dispatch. A taxable transfer is reported in the sending branch's GSTR-1
  // with the receiving branch as a B2B counterparty, and all of that
  // identity otherwise lives on the branches table and would be read live ~U+2014~
  // so correcting a branch's GSTIN would restate periods already filed.
  // Exactly the defect migration_031 fixed for sales invoices; see
  // migration_047. Null on an untaxed transfer, which is not a supply and
  // appears in no return.
  fromGstin              String?   @map("from_gstin") @db.VarChar(15)
  fromStateCode          String?   @map("from_state_code") @db.VarChar(2)
  toGstin                String?   @map("to_gstin") @db.VarChar(15)
  toStateCode            String?   @map("to_state_code") @db.VarChar(2)
  toBranchName           String?   @map("to_branch_name") @db.VarChar(200)
  // Rule 55 delivery challan number on an untaxed transfer; the section 31 /
  // Rule 46 TAX INVOICE number on a taxable one, allocated from
  // DocumentNumberSeries for the sending branch.
  documentNumber         String?   @map("document_number") @db.VarChar(30)
'@
Edit-FileText 'backend/prisma/schema.prisma' $o0 $n0
$o1 = @'
  // Which step of Rule 28 justifies taxableValue. Per line, because one
  // transfer can carry a bought-in item with a known market price alongside
  // a manufactured one that has none.
  valuationBasis  String   @default("SECOND_PROVISO") @map("valuation_basis") @db.VarChar(20)
  gstRate         Decimal? @map("gst_rate") @db.Decimal(5, 2)
  cgst            Decimal? @db.Decimal(14, 2)
  sgst            Decimal? @db.Decimal(14, 2)
  igst            Decimal? @db.Decimal(14, 2)
'@
$n1 = @'
  // Which step of Rule 28 justifies taxableValue. Per line, because one
  // transfer can carry a bought-in item with a known market price alongside
  // a manufactured one that has none.
  valuationBasis  String   @default("SECOND_PROVISO") @map("valuation_basis") @db.VarChar(20)
  // What was supplied, frozen at dispatch ~U+2014~ the classification half of the
  // same defect migration_047 fixed for the counterparty. GSTR-1's HSN
  // summary reported these from the item master, so correcting an HSN
  // restated a filed period. See migration_048.
  hsnCode         String?  @map("hsn_code") @db.VarChar(10)
  itemName        String?  @map("item_name") @db.VarChar(200)
  uom             String?  @db.VarChar(20)
  gstRate         Decimal? @map("gst_rate") @db.Decimal(5, 2)
  cgst            Decimal? @db.Decimal(14, 2)
  sgst            Decimal? @db.Decimal(14, 2)
  igst            Decimal? @db.Decimal(14, 2)
'@
Edit-FileText 'backend/prisma/schema.prisma' $o1 $n1
$o2 = @'
  sgst: number;
  igst: number;
}

export interface Gstr1Report {
  from: string;
  to: string;
  b2b: Gstr1B2BRow[];
  b2c: Gstr1B2CRow[];
  exports: Gstr1ExportRow[];
  hsn: Gstr1HsnRow[];
  creditNotes: Gstr1CreditNoteRow[];
  totals: { taxableValue: number; cgst: number; sgst: number; igst: number; invoiceValue: number };
  // Separate from `totals` ~U+2014~ Table 6A is its own subtotal in the real
  // return, not folded into the domestic B2B+B2C taxable value/tax figures.
  exportsTotal: { taxableValue: number; igst: number; invoiceValue: number };
'@
$n2 = @'
  sgst: number;
  igst: number;
}

// A taxable branch transfer that was cancelled after its invoice had gone
// out. The ledger reversal happens at cancellation, but section 34 undoes an
// ISSUED invoice with a credit note, and nothing in this system raises one ~U+2014~
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
  // Needs a manual credit note ~U+2014~ see Gstr1CancelledTransferRow. Empty in the
  // ordinary case, and worth showing prominently when it is not.
  cancelledTransfers: Gstr1CancelledTransferRow[];
  totals: { taxableValue: number; cgst: number; sgst: number; igst: number; invoiceValue: number };
  // Separate from `totals` ~U+2014~ Table 6A is its own subtotal in the real
  // return, not folded into the domestic B2B+B2C taxable value/tax figures.
  exportsTotal: { taxableValue: number; igst: number; invoiceValue: number };
'@
Edit-FileText 'backend/src/lib/gstReports.ts' $o2 $n2
$o3 = @'
      });
    }
  }

  const b2c = [...b2cMap.values()].sort((a, b) => a.placeOfSupply.localeCompare(b.placeOfSupply) || a.rate - b.rate);
  const hsn = [...hsnMap.values()].sort((a, b) => a.hsnCode.localeCompare(b.hsnCode) || a.rate - b.rate);

  // Domestic-only ~U+2014~ exports get their own exportsTotal below, same
  // separation the real GSTR-1 return has between the main taxable-value
  // summary and Table 6A.
  const domesticInvoiceValue = round2(invoices.filter((i) => i.currency === "INR").reduce((s, i) => s + Number(i.grandTotal), 0));
  const totals = [...b2b, ...b2c].reduce(
    (t, r) => ({
      taxableValue: round2(t.taxableValue + r.taxableValue),
      cgst: round2(t.cgst + r.cgst),
'@
$n3 = @'
      });
    }
  }

  // ~U+2500~~U+2500~ Taxable branch transfers ~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~
  //
  // Section 25(4) makes two registrations of one company distinct persons,
  // and Schedule I paragraph 2 makes a supply between them taxable with no
  // consideration at all. The GSTN has no "branch transfer" category: these
  // go into Table 4A as ordinary B2B supplies against the receiving branch's
  // GSTIN, which is what lets that branch's GSTR-2B pick them up and match
  // the credit.
  //
  // Filtered by the SENDING branch, because that is whose return this is ~U+2014~
  // the same transfer appears as an inward supply in the receiving branch's
  // 2B, not its 1.
  //
  // Every identity field here is the SNAPSHOT taken at dispatch
  // (migration_047), never the branch master. Re-registering a branch must
  // not restate a filed period.
  const transfers = await prisma.stockTransfer.findMany({
    where: {
      organizationId, taxTreatment: "TAXABLE",
      transferDate: { gte: from, lte: to },
      ...(branchId ? { fromBranchId: branchId } : {}),
    },
    include: { lines: { include: { item: true } } },
    orderBy: { transferDate: "asc" },
  });

  const cancelledTransfers: Gstr1CancelledTransferRow[] = [];

  for (const tr of transfers) {
    // Checked BEFORE the line loop, not after. The HSN summary is written
    // inside that loop, so guarding afterwards would let a skipped transfer
    // contribute HSN rows with no matching B2B row and no contribution to
    // totals ~U+2014~ two sheets of one return that no longer reconcile. Cannot
    // happen while migration_047's CHECK holds, which is exactly why it
    // would go unnoticed if it ever did.
    if (tr.status !== "CANCELLED" && (!tr.toGstin || !tr.documentNumber)) continue;

    const byRate = new Map<number, RateAcc>();
    let taxableTotal = 0;
    let taxTotal = 0;

    for (const line of tr.lines) {
      const rate = Number(line.gstRate ?? 0);
      const taxable = Number(line.taxableValue ?? 0);
      const cg = Number(line.cgst ?? 0), sg = Number(line.sgst ?? 0), ig = Number(line.igst ?? 0);
      taxableTotal = round2(taxableTotal + taxable);
      taxTotal = round2(taxTotal + cg + sg + ig);

      if (tr.status === "CANCELLED") continue;
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
      // Left out of the supply tables ~U+2014~ it did not happen ~U+2014~ but surfaced,
      // because the invoice number was issued and a credit note is owed.
      if (tr.documentNumber) {
        cancelledTransfers.push({
          transferNumber: tr.transferNumber,
          invoiceNumber: tr.documentNumber,
          invoiceDate: tr.transferDate.toISOString().slice(0, 10),
          toGstin: tr.toGstin ?? "~U+2014~",
          toBranchName: tr.toBranchName ?? "~U+2014~",
          taxableValue: taxableTotal,
          taxAmount: taxTotal,
        });
      }
      continue;
    }

    for (const [rate, acc] of byRate) {
      b2b.push({
        gstin: tr.toGstin,
        receiverName: tr.toBranchName ?? "~U+2014~",
        invoiceNumber: tr.documentNumber,
        invoiceDate: tr.transferDate.toISOString().slice(0, 10),
        // Goods at cost plus the tax ~U+2014~ what the receiving branch owes, and
        // what the invoice says. Stock still moved at cost; the tax is a
        // separate leg that never entered the value of the goods.
        invoiceValue: round2(taxableTotal + taxTotal),
        placeOfSupply: tr.toStateCode ?? "~U+2014~",
        rate,
        ...acc,
      });
    }
  }

  const b2c = [...b2cMap.values()].sort((a, b) => a.placeOfSupply.localeCompare(b.placeOfSupply) || a.rate - b.rate);
  const hsn = [...hsnMap.values()].sort((a, b) => a.hsnCode.localeCompare(b.hsnCode) || a.rate - b.rate);

  // Branch-transfer invoices are domestic B2B supplies and belong in the
  // invoice-value total alongside sales invoices. Cancelled ones do not:
  // they are listed separately and are not being reported as supplies.
  const transferInvoiceValue = round2(
    transfers
      .filter((tr) => tr.status !== "CANCELLED" && tr.toGstin && tr.documentNumber)
      .reduce((s, tr) => s + tr.lines.reduce(
        (ls, l) => ls + Number(l.taxableValue ?? 0) + Number(l.cgst ?? 0) + Number(l.sgst ?? 0) + Number(l.igst ?? 0), 0), 0)
  );
  // Domestic-only ~U+2014~ exports get their own exportsTotal below, the same
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
'@
Edit-FileText 'backend/src/lib/gstReports.ts' $o3 $n3
$o4 = @'
    }),
    { taxableValue: 0, igst: 0, invoiceValue: exportsInvoiceValue }
  );

  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), b2b, b2c, exports, hsn, creditNotes, totals, exportsTotal };
}

export interface Gstr3bSection {
  taxableValue: number;
'@
$n4 = @'
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
'@
Edit-FileText 'backend/src/lib/gstReports.ts' $o4 $n4
$o5 = @'

  const retOut = sumReturns(salesReturns as unknown as ReturnLike[]);
  const retItc = sumReturns(purchaseReturns as unknown as ReturnLike[]);

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
'@
$n5 = @'

  const retOut = sumReturns(salesReturns as unknown as ReturnLike[]);
  const retItc = sumReturns(purchaseReturns as unknown as ReturnLike[]);

  // ~U+2500~~U+2500~ Taxable branch transfers, both sides ~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~~U+2500~
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
  // it in the next. Revenue-neutral over the year, not within the month ~U+2014~
  // expected, and the commonest question somebody will ask about these
  // figures.
  //
  // CANCELLED transfers are excluded from both. The supply did not happen,
  // and the ledger reversal says so. Where the invoice had already gone out
  // this understates the period by design: an issued invoice is properly
  // undone by a credit note under section 34, which this system does not
  // raise ~U+2014~ computeGstr1's cancelledTransfers list is what flags the ones
  // needing manual treatment.
  const dispatched = await prisma.stockTransfer.findMany({
    where: {
      organizationId, taxTreatment: "TAXABLE", status: { not: "CANCELLED" },
      transferDate: { gte: from, lte: to },
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
  const trItc = transferTotals(receivedIn);

  const outward = sectionTotal({
    taxableValue: round2(Number(invAgg._sum.subtotal ?? 0) - Number(invAgg._sum.discountTotal ?? 0) - retOut.taxableValue + trOut.taxableValue),
    cgst: round2(Number(invAgg._sum.cgstTotal ?? 0) - retOut.cgst + trOut.cgst),
    sgst: round2(Number(invAgg._sum.sgstTotal ?? 0) - retOut.sgst + trOut.sgst),
    igst: round2(Number(invAgg._sum.igstTotal ?? 0) - retOut.igst + trOut.igst),
  });
  const itc = sectionTotal({
    taxableValue: round2(Number(billAgg._sum.subtotal ?? 0) - retItc.taxableValue + trItc.taxableValue),
    cgst: round2(Number(billAgg._sum.cgstTotal ?? 0) - retItc.cgst + trItc.cgst),
    sgst: round2(Number(billAgg._sum.sgstTotal ?? 0) - retItc.sgst + trItc.sgst),
    igst: round2(Number(billAgg._sum.igstTotal ?? 0) - retItc.igst + trItc.igst),
  });

  const netPayable = {
    cgst: Math.max(0, round2(outward.cgst - itc.cgst)),
'@
Edit-FileText 'backend/src/lib/gstReports.ts' $o5 $n5
$o6 = @'
        { header: "IGST", width: 14, numFmt: "#,##0.00" },
      ],
      rows: report.creditNotes.map((r) => [r.noteNumber, r.noteDate, r.originalInvoiceNumber, r.gstin, r.receiverName, r.placeOfSupply, r.rate, r.taxableValue, r.cgst, r.sgst, r.igst]),
    },
  ]);

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="GSTR1_${report.from}_to_${report.to}.xlsx"`);
'@
$n6 = @'
        { header: "IGST", width: 14, numFmt: "#,##0.00" },
      ],
      rows: report.creditNotes.map((r) => [r.noteNumber, r.noteDate, r.originalInvoiceNumber, r.gstin, r.receiverName, r.placeOfSupply, r.rate, r.taxableValue, r.cgst, r.sgst, r.igst]),
    },
    {
      // NOT a GSTR-1 table ~U+2014~ an exception list. These branch-transfer
      // invoices were issued and then cancelled, so they are deliberately
      // absent from B2B above, which leaves a hole in a serial number series
      // that Rule 46(b) requires to be consecutive. Section 34 undoes an
      // issued invoice with a credit note, and this system does not raise
      // one. Anyone filing from the workbook rather than the screen needs to
      // see them, which is the whole reason the sheet exists even when it is
      // usually empty.
      name: "Cancelled Transfers",
      columns: [
        { header: "Transfer", width: 14 },
        { header: "Invoice Number (issued)", width: 24 },
        { header: "Invoice Date", width: 14 },
        { header: "Receiving GSTIN", width: 20 },
        { header: "Receiving Branch", width: 26 },
        { header: "Taxable Value", width: 16, numFmt: "#,##0.00" },
        { header: "Tax", width: 14, numFmt: "#,##0.00" },
        { header: "Action needed", width: 40 },
      ],
      rows: report.cancelledTransfers.map((r) => [
        r.transferNumber, r.invoiceNumber, r.invoiceDate, r.toGstin, r.toBranchName,
        r.taxableValue, r.taxAmount,
        "Raise a credit note under section 34 ~U+2014~ not reported above",
      ]),
    },
  ]);

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="GSTR1_${report.from}_to_${report.to}.xlsx"`);
'@
Edit-FileText 'backend/src/routes/gst.ts' $o6 $n6
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green