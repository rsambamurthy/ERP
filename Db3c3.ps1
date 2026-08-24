$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Phase D-b: the transfer route (3 of 3)...' -ForegroundColor Cyan

function Add-FileText($rel, $expectedTail, $text) {
  $p = Join-Path $repo $rel
  if (-not (Test-Path -LiteralPath $p)) { throw "Missing file: $rel -- run the previous script first." }
  $t = [IO.File]::ReadAllText($p).Replace([string][char]13, '')
  $text = $text.Replace([string][char]13, '')
  $expectedTail = $expectedTail.Replace([string][char]13, '')
  if ($t.EndsWith($text)) { Write-Host "  skip   $rel"; return }
  if (-not $t.EndsWith($expectedTail)) { throw "$rel does not end where expected -- run the previous script first." }
  [IO.File]::WriteAllText($p, $t + $text, (New-Object Text.UTF8Encoding $false))
  Write-Host "  append $rel"
}
$tail = @'
    console.error("stock transfer dispatch failed", err);
    return res.status(500).json({ message: "Could not dispatch the transfer. Nothing was written." });
  }
});

'@
$f = @'
// POST /stock-transfers/:id/receive   { receivedDate }
//
// The receiving branch receives at the sending branch's cost — the unit cost
// recorded on the line at dispatch. Nothing is re-valued in transit.
//
// Untaxed: one entry at the receiving branch, Dr stock / Cr 1304.
// Taxable:  two entries — the receiving branch takes the goods and the ITC
//           against 2106, and the SENDING branch converts its transit asset
//           into a receivable. Section 16(2)(b) is why the credit is taken
//           here and not at dispatch: only receipt entitles it.
router.post("/:id/receive", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const transit = await inTransitAccountOr400(organizationId, res);
  if (!transit) return;

  const t = await loadTransfer(organizationId, req.params.id);
  if (!t) return res.status(404).json({ message: "Transfer not found." });
  if (t.status !== "DISPATCHED") {
    return res.status(409).json({ message: `${t.transferNumber} is ${t.status.toLowerCase()} — it cannot be received.` });
  }

  const taxable = t.taxTreatment === "TAXABLE";
  let accounts: TransferAccounts | null = null;
  if (taxable) {
    accounts = await taxAccountsOr400(organizationId, res);
    if (!accounts) return;
  }

  const receivedDate = dayOrNull(req.body?.receivedDate) ?? t.transferDate;
  if (receivedDate < t.transferDate) {
    return res.status(400).json({
      message: `Goods cannot arrive before they leave. ${t.transferNumber} was dispatched on ${isoDay(t.transferDate)}.`,
    });
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId }, select: { costingMethod: true },
  });
  const costingMethod = org?.costingMethod ?? "WEIGHTED_AVG";

  const label = t.documentNumber ? `${t.transferNumber} / ${t.documentNumber}` : t.transferNumber;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const journalEntry = await tx.journalEntry.create({
        data: {
          organizationId, branchId: t.toBranchId, entryDate: receivedDate,
          narration: `${t.transferNumber} — received from ${t.fromBranch.name}`.slice(0, 255),
          voucherType: "JV",
          referenceType: "stock_transfer_receipt",
          createdBy: req.user!.userId,
        },
      });

      let costTotal = 0;
      const legs: ItemLeg[] = [];
      let cgst = 0, sgst = 0, igst = 0;

      for (const l of t.lines) {
        const value = round2(Number(l.lineValue));
        costTotal = round2(costTotal + value);
        cgst = round2(cgst + Number(l.cgst ?? 0));
        sgst = round2(sgst + Number(l.sgst ?? 0));
        igst = round2(igst + Number(l.igst ?? 0));

        await receiveStock(tx, {
          organizationId, branchId: t.toBranchId, itemId: l.itemId,
          // NOT the stored unitCost. That column is the 4dp quotient
          // totalCost/quantity kept for display; multiplying it back out
          // gives a number a paisa or two away from lineValue, and since
          // lineValue is what the GL moved, the stock ledger would drift
          // permanently from the stock account. Deriving it here makes
          // quantity * unitCost reproduce lineValue exactly.
          quantity: Number(l.quantity), unitCost: exactUnitCost(l), costingMethod,
          movementType: "TRANSFER_IN",
          referenceType: "stock_transfer", referenceId: t.id,
          movementDate: receivedDate,
          narration: `${t.transferNumber} — from ${t.fromBranch.name}`,
        });

        legs.push({
          stockAccountId: l.item.stockAccountId, itemPartnerId: l.item.businessPartnerId,
          amount: value, narration: `${l.item.sku} — ${l.item.name}`,
        });
      }

      const taxTotal = round2(cgst + sgst + igst);
      let lines: JournalLineData[];
      let clearingId: string | null = null;

      if (taxable) {
        const fromPartner = await branchPartnerId(tx, organizationId, t.fromBranch);
        const toPartner = await branchPartnerId(tx, organizationId, t.toBranch);

        lines = receiptJournalLines({
          journalEntryId: journalEntry.id, accounts: accounts!,
          items: legs, costTotal, tax: { cgst, sgst, igst }, taxTotal,
          fromBranchPartnerId: fromPartner, label,
        });

        // The sending branch's own entry — it carries a different branchId,
        // so it cannot be lines on the entry above.
        const clearing = await tx.journalEntry.create({
          data: {
            organizationId, branchId: t.fromBranchId, entryDate: receivedDate,
            narration: `${t.transferNumber} — received at ${t.toBranch.name}`.slice(0, 255),
            voucherType: "JV",
            referenceType: "stock_transfer_transit",
            createdBy: req.user!.userId,
          },
        });
        clearingId = clearing.id;
        const clearingLines = transitClearingJournalLines({
          journalEntryId: clearing.id, accounts: accounts!,
          costTotal, toBranchPartnerId: toPartner, label,
        });
        const cImbalance = balanceProblem(clearingLines);
        if (cImbalance) throw Object.assign(new Error(cImbalance), { status: 500 });
        await tx.journalLine.createMany({ data: clearingLines });
      } else {
        lines = [
          ...legs.map((d) => ({
            journalEntryId: journalEntry.id, accountId: d.stockAccountId,
            businessPartnerId: d.itemPartnerId,
            debit: d.amount, credit: 0, narration: d.narration.slice(0, 255),
          })),
          {
            journalEntryId: journalEntry.id, accountId: transit.id,
            businessPartnerId: null, debit: 0, credit: costTotal,
            narration: `${t.transferNumber} — received at ${t.toBranch.name}`.slice(0, 255),
          },
        ];
      }

      const imbalance = balanceProblem(lines);
      if (imbalance) throw Object.assign(new Error(imbalance), { status: 500 });
      await tx.journalLine.createMany({ data: lines });

      // Guarded on the status this handler checked before the transaction
      // opened. Two people clicking Receive at once both get past that
      // check; the second one's updateMany matches ZERO rows once the first
      // has committed, and throwing here rolls back its stock movements and
      // its journal entries with it. Without the guard both would post, and
      // the unique indexes on the journal-entry columns would NOT catch it —
      // the two requests create different entries, so nothing collides.
      const claimed = await tx.stockTransfer.updateMany({
        where: { id: t.id, status: "DISPATCHED" },
        data: {
          status: "RECEIVED", receivedDate,
          receiptJournalEntryId: journalEntry.id,
          ...(clearingId ? { transitClearingJournalEntryId: clearingId } : {}),
        },
      });
      if (claimed.count === 0) {
        throw Object.assign(
          new Error(`${t.transferNumber} was received or cancelled by someone else a moment ago. Nothing was posted twice.`),
          { status: 409 }
        );
      }

      return { received: true, total: costTotal, taxTotal };
    });

    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "UPDATE", entityType: "stock_transfer", entityId: t.id,
      summary: `${t.transferNumber} received at ${t.toBranch.name} — ${result.total.toFixed(2)}${result.taxTotal > 0 ? ` + ${result.taxTotal.toFixed(2)} ITC` : ""}`,
    });

    res.json({ data: result });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 400 || status === 409) return res.status(status).json({ message: (err as Error).message });
    console.error("stock transfer receipt failed", err);
    return res.status(500).json({ message: "Could not receive the transfer. Nothing was written." });
  }
});

// POST /stock-transfers/:id/cancel   { entryDate? }
//
// Brings the goods back to the sending branch. Only while they are still in
// transit — once received they are somewhere, and the way to move them back
// is a transfer the other way.
//
// This posts a RETURN entry rather than deleting the dispatch. The dispatch
// consumed stock through the FIFO lots or the weighted average; deleting the
// entry would leave the stock ledger showing goods that went out with no
// accounting record of it.
//
// A CANCELLED TAXABLE TRANSFER STILL NEEDS A CREDIT NOTE
//
// The output tax is reversed in the ledger here, which is the right
// accounting. It is NOT the right GST reporting: an invoice that has been
// issued is undone by a credit note under section 34, reported in its own
// right, not by the invoice quietly ceasing to exist. Nothing here issues
// one — the reversal shows in the books, and the return has to be handled
// deliberately. Worth knowing before cancelling a transfer whose invoice has
// already gone out with the goods.
router.post("/:id/cancel", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const transit = await inTransitAccountOr400(organizationId, res);
  if (!transit) return;

  const t = await loadTransfer(organizationId, req.params.id);
  if (!t) return res.status(404).json({ message: "Transfer not found." });
  if (t.status !== "DISPATCHED") {
    return res.status(409).json({
      message: t.status === "RECEIVED"
        ? `${t.transferNumber} has already been received at ${t.toBranch.name}. Send the goods back with a transfer the other way — cancelling now would take stock off a branch that is holding it.`
        : `${t.transferNumber} is already cancelled.`,
    });
  }

  const taxable = t.taxTreatment === "TAXABLE";
  let accounts: TransferAccounts | null = null;
  if (taxable) {
    accounts = await taxAccountsOr400(organizationId, res);
    if (!accounts) return;
  }

  const entryDate = dayOrNull(req.body?.entryDate) ?? t.transferDate;
  if (entryDate < t.transferDate) {
    return res.status(400).json({ message: `The return cannot predate the dispatch on ${isoDay(t.transferDate)}.` });
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId }, select: { costingMethod: true },
  });
  const costingMethod = org?.costingMethod ?? "WEIGHTED_AVG";
  const label = t.documentNumber ? `${t.transferNumber} / ${t.documentNumber}` : t.transferNumber;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const journalEntry = await tx.journalEntry.create({
        data: {
          organizationId, branchId: t.fromBranchId, entryDate,
          narration: `${t.transferNumber} cancelled — returned to ${t.fromBranch.name}`.slice(0, 255),
          voucherType: "JV",
          referenceType: "stock_transfer_cancel",
          createdBy: req.user!.userId,
        },
      });

      let costTotal = 0;
      const legs: ItemLeg[] = [];
      let cgst = 0, sgst = 0, igst = 0;

      for (const l of t.lines) {
        const value = round2(Number(l.lineValue));
        costTotal = round2(costTotal + value);
        cgst = round2(cgst + Number(l.cgst ?? 0));
        sgst = round2(sgst + Number(l.sgst ?? 0));
        igst = round2(igst + Number(l.igst ?? 0));

        await receiveStock(tx, {
          organizationId, branchId: t.fromBranchId, itemId: l.itemId,
          // See the note in /receive: the sending branch must get back
          // exactly the value it gave up, not a re-multiplied rounding of it.
          quantity: Number(l.quantity), unitCost: exactUnitCost(l), costingMethod,
          movementType: "TRANSFER_IN",
          referenceType: "stock_transfer", referenceId: t.id,
          movementDate: entryDate,
          narration: `${t.transferNumber} cancelled — returned`,
        });

        legs.push({
          stockAccountId: l.item.stockAccountId, itemPartnerId: l.item.businessPartnerId,
          amount: value, narration: `${l.item.sku} — ${l.item.name}`,
        });
      }

      const taxTotal = round2(cgst + sgst + igst);
      let lines: JournalLineData[];

      if (taxable) {
        const toPartner = await branchPartnerId(tx, organizationId, t.toBranch);
        lines = cancelJournalLines({
          journalEntryId: journalEntry.id, accounts: accounts!,
          items: legs, costTotal, tax: { cgst, sgst, igst }, taxTotal,
          toBranchPartnerId: toPartner, label,
        });
      } else {
        lines = [
          ...legs.map((d) => ({
            journalEntryId: journalEntry.id, accountId: d.stockAccountId,
            businessPartnerId: d.itemPartnerId,
            debit: d.amount, credit: 0, narration: d.narration.slice(0, 255),
          })),
          {
            journalEntryId: journalEntry.id, accountId: transit.id,
            businessPartnerId: null, debit: 0, credit: costTotal,
            narration: `${t.transferNumber} cancelled`.slice(0, 255),
          },
        ];
      }

      const imbalance = balanceProblem(lines);
      if (imbalance) throw Object.assign(new Error(imbalance), { status: 500 });
      await tx.journalLine.createMany({ data: lines });

      // Same guard as /receive. This one also closes the receive-and-cancel
      // race: without it a transfer could be received at the destination AND
      // returned to the sender, creating stock out of nothing.
      const claimed = await tx.stockTransfer.updateMany({
        where: { id: t.id, status: "DISPATCHED" },
        data: { status: "CANCELLED", receiptJournalEntryId: journalEntry.id },
      });
      if (claimed.count === 0) {
        throw Object.assign(
          new Error(`${t.transferNumber} was received or cancelled by someone else a moment ago. Nothing was posted twice.`),
          { status: 409 }
        );
      }

      return { cancelled: true, total: costTotal, taxTotal, creditNoteNeeded: taxable && !!t.documentNumber };
    });

    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "UPDATE", entityType: "stock_transfer", entityId: t.id,
      summary: `${t.transferNumber} cancelled — ${result.total.toFixed(2)} returned to ${t.fromBranch.name}${result.creditNoteNeeded ? ` (invoice ${t.documentNumber} needs a credit note under s.34)` : ""}`,
    });

    res.json({ data: result });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 400 || status === 409) return res.status(status).json({ message: (err as Error).message });
    console.error("stock transfer cancel failed", err);
    return res.status(500).json({ message: "Could not cancel the transfer. Nothing was written." });
  }
});

export default router;
'@
Add-FileText 'backend/src/routes/stockTransfers.ts' $tail $f
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green