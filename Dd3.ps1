$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Phase D-d: transfer route...' -ForegroundColor Cyan

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

  res.json({ data: { branchId, financialYear, ...saved } });
});

// GET /stock-transfers
router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
'@
$n0 = @'

  res.json({ data: { branchId, financialYear, ...saved } });
});

// GET /stock-transfers/reconciliation?asOf=YYYY-MM-DD
//
// The control this whole clearing-account design exists to make checkable.
//
// Taking 2106 as a positive credit balance, at any date:
//
//     1305 + 1304 - 2106  =  what is still on a lorry
//
// because of how the three accounts move:
//
//   untaxed, in transit    1304 += cost
//   taxable, in transit    1304 += cost,  1305 += tax
//   taxable, received      1304 -= cost,  1305 += cost,  2106 += cost + tax
//
// A received taxable transfer therefore contributes cost + tax - (cost +
// tax) = 0, and only the in-transit ones are left. So the expected figure is
// the invoice value of everything dispatched and not yet arrived ~U+2014~ cost for
// an untaxed transfer, cost plus tax for a taxable one.
//
// Anything left over after subtracting that is a posting error, not a timing
// difference. That distinction is the point: "these two should match" is a
// weak control because they legitimately differ every day of the month.
//
// Registered before /:id so Express does not read "reconciliation" as an id.
router.get("/reconciliation", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  // An unparseable asOf is a 400, not a silent "today": a control report
  // that quietly answers a different question than the one asked is worse
  // than one that refuses. Absent is fine and means today, taken in UTC so
  // it matches the date-only columns rather than drifting a day for anyone
  // east of UTC in the early hours.
  const rawAsOf = typeof req.query.asOf === "string" ? req.query.asOf.trim() : "";
  let asOf: Date;
  if (rawAsOf) {
    const parsed = dayOrNull(rawAsOf);
    if (!parsed) return res.status(400).json({ message: "asOf must be a real date, as YYYY-MM-DD." });
    asOf = parsed;
  } else {
    const now = new Date();
    asOf = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  }

  const accounts = await prisma.account.findMany({
    where: {
      organizationId,
      accountCode: { in: [IN_TRANSIT_CODE, INTER_BRANCH_RECEIVABLE_CODE, INTER_BRANCH_PAYABLE_CODE] },
    },
    select: {
      id: true, accountCode: true, accountName: true, accountType: true,
      openingBalance: true, openingBalanceType: true,
    },
  });
  if (accounts.length < 3) {
    return res.status(400).json({
      message: "This organisation is missing one of 1304 / 1305 / 2106. Sync from templates first.",
    });
  }

  // Signed balances, debit-positive. 2106 is a liability so it comes back
  // negative, which is why the identity below ADDS all three rather than
  // subtracting the payable: the sign is already in the number.
  const sums = await prisma.journalLine.groupBy({
    by: ["accountId"],
    where: {
      accountId: { in: accounts.map((a) => a.id) },
      journalEntry: { organizationId, entryDate: { lte: asOf } },
    },
    _sum: { debit: true, credit: true },
  });
  // Opening balance + movement, the same way the Trial Balance and Balance
  // Sheet compute an account (lib/reports.ts). Movement alone would make
  // this control blind to the single largest thing it should catch: an
  // opening inter-branch balance carried in at go-live and never cleared
  // would sit in 1305 forever while this report cheerfully said "balanced".
  //
  // openingBalance is stored as a positive magnitude with its side in
  // openingBalanceType, so it has to be signed into the debit-positive
  // convention the movement uses before the two can be added.
  const balanceOf = (code: string) => {
    const acc = accounts.find((a) => a.accountCode === code)!;
    const row = sums.find((s) => s.accountId === acc.id);
    const movement = Number(row?._sum.debit ?? 0) - Number(row?._sum.credit ?? 0);
    const opening = Number(acc.openingBalance ?? 0) * (acc.openingBalanceType === "CREDIT" ? -1 : 1);
    return round2(opening + movement);
  };
  const transit = balanceOf(IN_TRANSIT_CODE);
  const receivable = balanceOf(INTER_BRANCH_RECEIVABLE_CODE);
  const payable = balanceOf(INTER_BRANCH_PAYABLE_CODE);
  const ledger = round2(transit + receivable + payable);

  // What was still in transit on that date. A transfer leaves transit when
  // it is received OR cancelled; the cancellation date is not a column, so
  // it is read from the entry the cancellation posted ~U+2014~ receiptJournalEntry
  // holds the return on a cancelled transfer (see /cancel).
  const open = await prisma.stockTransfer.findMany({
    where: { organizationId, transferDate: { lte: asOf } },
    include: {
      lines: { select: { lineValue: true, cgst: true, sgst: true, igst: true } },
      fromBranch: { select: { name: true } },
      toBranch: { select: { name: true } },
    },
  });
  const receiptEntryIds = open.map((t) => t.receiptJournalEntryId).filter((x): x is string => !!x);
  const receiptEntries = receiptEntryIds.length
    ? await prisma.journalEntry.findMany({
      where: { id: { in: receiptEntryIds } }, select: { id: true, entryDate: true },
    })
    : [];
  const entryDateById = new Map(receiptEntries.map((e) => [e.id, e.entryDate]));

  const inTransit = open.filter((t) => {
    if (t.status === "DISPATCHED") return true;
    if (t.status === "RECEIVED") return !t.receivedDate || t.receivedDate > asOf;
    // CANCELLED ~U+2014~ in transit up to the day the return was posted.
    const cancelledOn = t.receiptJournalEntryId ? entryDateById.get(t.receiptJournalEntryId) : null;
    return !cancelledOn || cancelledOn > asOf;
  });

  const rows = inTransit.map((t) => {
    const cost = round2(t.lines.reduce((s, l) => s + Number(l.lineValue), 0));
    const tax = round2(t.lines.reduce((s, l) => s + Number(l.cgst ?? 0) + Number(l.sgst ?? 0) + Number(l.igst ?? 0), 0));
    return {
      id: t.id, transferNumber: t.transferNumber,
      transferDate: isoDay(t.transferDate),
      fromBranch: t.fromBranch.name, toBranch: t.toBranch.name,
      taxTreatment: t.taxTreatment, documentNumber: t.documentNumber,
      status: t.status,
      cost, tax, invoiceValue: round2(cost + tax),
    };
  });
  const expected = round2(rows.reduce((s, r) => s + r.invoiceValue, 0));

  res.json({
    data: {
      asOf: isoDay(asOf),
      accounts: {
        transit, receivable, payable,
        // The sum as the identity states it. Reported alongside the parts so
        // a break can be read straight off rather than recomputed by hand.
        ledger,
      },
      expected,
      difference: round2(ledger - expected),
      balanced: Math.abs(round2(ledger - expected)) < 0.005,
      inTransit: rows.sort((a, b) => a.transferDate.localeCompare(b.transferDate)),
    },
  });
});

// GET /stock-transfers
router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
'@
Edit-FileText 'backend/src/routes/stockTransfers.ts' $o0 $n0
$o1 = @'
      return res.status(400).json({
        message: `${to.name} is marked as ${to.itcEligibility === "RESTRICTED" ? "making exempt or non-GST supplies" : "making mixed supplies with proportionate credit"}, so it cannot claim full input tax credit on this transfer. The second proviso to Rule 28 does not apply, the tax becomes a cost that has to be capitalised into that branch's stock, and neither the valuation nor the receipt-side accounting for that is built yet. Refused rather than posted on an assumption that is wrong for this branch.`,
      });
    }
    if (!from.stateCode || !to.stateCode) {
      const which = !from.stateCode ? from.name : to.name;
      return res.status(400).json({
        message: `${which} has no GST state code, so this transfer cannot be split into CGST+SGST or IGST. Set the state code on the branch ~U+2014~ unlike a customer, this is your own registration and guessing it would put the tax under the wrong heads on a real return.`,
'@
$n1 = @'
      return res.status(400).json({
        message: `${to.name} is marked as ${to.itcEligibility === "RESTRICTED" ? "making exempt or non-GST supplies" : "making mixed supplies with proportionate credit"}, so it cannot claim full input tax credit on this transfer. The second proviso to Rule 28 does not apply, the tax becomes a cost that has to be capitalised into that branch's stock, and neither the valuation nor the receipt-side accounting for that is built yet. Refused rather than posted on an assumption that is wrong for this branch.`,
      });
    }
    // Without both GSTINs this is not a supply anybody can invoice. It gets
    // here because taxTreatmentFor coalesces a null GSTIN to "" and calls
    // any difference TAXABLE ~U+2014~ which is right for "two registrations" and
    // wrong for "one registration and a branch nobody has finished setting
    // up". Refused with the actual fix rather than allowed through to
    // migration_047's CHECK, which would surface as an opaque 500.
    if (!from.gstin || !to.gstin) {
      const which = !from.gstin ? from.name : to.name;
      return res.status(400).json({
        message: `${which} has no GSTIN, but the other branch does ~U+2014~ so this looks like a supply between distinct persons without being one anybody can invoice. Either set that branch's GSTIN, or, if it genuinely trades under the same registration, give it the same GSTIN as the other branch and this becomes an ordinary delivery challan.`,
      });
    }
    if (!from.stateCode || !to.stateCode) {
      const which = !from.stateCode ? from.name : to.name;
      return res.status(400).json({
        message: `${which} has no GST state code, so this transfer cannot be split into CGST+SGST or IGST. Set the state code on the branch ~U+2014~ unlike a customer, this is your own registration and guessing it would put the tax under the wrong heads on a real return.`,
'@
Edit-FileText 'backend/src/routes/stockTransfers.ts' $o1 $n1
$o2 = @'
  }

  const items = await prisma.item.findMany({
    where: { id: { in: parsed.map((l) => l.itemId) }, organizationId, deletedAt: null },
    select: { id: true, sku: true, name: true, itemKind: true, stockAccountId: true, businessPartnerId: true, hsnCode: true, taxRate: true },
  });
  type It]));
  for (const l of parsed) {
    const it = byId.get(l.itemId);
    if (!it) return res.status(400).json({ message: "An item on this transfer is not in this organisation." });
'@
$n2 = @'
  }

  const items = await prisma.item.findMany({
    where: { id: { in: parsed.map((l) => l.itemId) }, organizationId, deletedAt: null },
    select: { id: true, sku: true, name: true, uom: true, itemKind: true, stockAccountId: true, businessPartnerId: true, hsnCode: true, taxRate: true },
  });
  type It = { id: string; sku: string; name: string; uom: string; itemKind: string; stockAccountId: string; businessPartnerId: string; hsnCode: string | null; taxRate: unknown };
  const byId = new Map<string, It>((items as It[]).map((x) => [x.id, x]));
  for (const l of parsed) {
    const it = byId.get(l.itemId);
    if (!it) return res.status(400).json({ message: "An item on this transfer is not in this organisation." });
'@
Edit-FileText 'backend/src/routes/stockTransfers.ts' $o2 $n2
$o3 = @'
          organizationId, transferNumber,
          fromBranchId, toBranchId, transferDate,
          status: "DISPATCHED", taxTreatment,
          toBranchItcEligibility: to.itcEligibility,
          // A taxable transfer's number is its tax invoice number and is
          // allocated, never typed. An untaxed one carries whatever delivery
          // challan reference the user entered.
          documentNumber: taxable
'@
$n3 = @'
          organizationId, transferNumber,
          fromBranchId, toBranchId, transferDate,
          status: "DISPATCHED", taxTreatment,
          toBranchItcEligibility: to.itcEligibility,
          // Frozen now, because this is what the return will report. Only
          // on a taxable transfer: an untaxed one is not a supply and
          // migration_047's CHECK expects these to stay null for it.
          ...(taxable ? {
            fromGstin: from.gstin, fromStateCode: from.stateCode,
            toGstin: to.gstin, toStateCode: to.stateCode,
            toBranchName: to.name.slice(0, 200),
          } : {}),
          // A taxable transfer's number is its tax invoice number and is
          // allocated, never typed. An untaxed one carries whatever delivery
          // challan reference the user entered.
          documentNumber: taxable
'@
Edit-FileText 'backend/src/routes/stockTransfers.ts' $o3 $n3
$o4 = @'
          data: {
            stockTransferId: transfer.id, itemId: l.itemId,
            quantity: l.quantity, unitCost: round4(unitCost), lineValue: round2(totalCost),
            ...(taxable ? {
              taxableValue: v.taxableValue, valuationBasis: v.valuationBasis,
              gstRate: v.gstRate, cgst: v.cgst, sgst: v.sgst, igst: v.igst,
            } : {}),
          },
'@
$n4 = @'
          data: {
            stockTransferId: transfer.id, itemId: l.itemId,
            quantity: l.quantity, unitCost: round4(unitCost), lineValue: round2(totalCost),
            ...(taxable ? {
              // Frozen for the HSN summary ~U+2014~ see migration_048.
              hsnCode: it.hsnCode, itemName: it.name.slice(0, 200), uom: it.uom,
              taxableValue: v.taxableValue, valuationBasis: v.valuationBasis,
              gstRate: v.gstRate, cgst: v.cgst, sgst: v.sgst, igst: v.igst,
            } : {}),
          },
'@
Edit-FileText 'backend/src/routes/stockTransfers.ts' $o4 $n4
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green