$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Production orders: route, part 2 of 2...' -ForegroundColor Cyan

function Add-FileText($rel, $expectEnd, $text) {
  $p = Join-Path $repo $rel
  if (-not (Test-Path -LiteralPath $p)) { throw "Missing file: $rel — run part 1 first." }
  $t = [IO.File]::ReadAllText($p).Replace([string][char]13, '')
  $text = $text.Replace([string][char]13, '')
  if ($t.EndsWith($text)) { Write-Host "  skip   $rel"; return }
  $expectEnd = $expectEnd.Replace([string][char]13, '')
  if (-not $t.EndsWith($expectEnd)) { throw "Part 1 has not been applied to $rel, or the file was changed after it." }
  [IO.File]::WriteAllText($p, $t + $text, (New-Object Text.UTF8Encoding $false))
  Write-Host "  append $rel"
}

Add-FileText 'backend/src/routes/productionOrders.ts' '(400).json({ message: err.message });
    }
    console.error("production issue failed", err);
    return res.status(500).json({ message: "Could not post the issue. Nothing was written." });
  }
});

' '// POST /production-orders/:id/cost   { entryDate, lines: [{ accountId, amount }], narration? }
//
//   Dr 1302 Work in Progress          total
//   Cr each expense account named
//
// This is cost of conversion being capitalised into inventory, which AS 2
// requires. It credits the expense head directly; see the note in the
// capability document about the Schedule III presentation question.
router.post("/:id/cost", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const wip = await wipAccountOr400(organizationId, res);
  if (!wip) return;

  const entryDate = dayOrNull(req.body?.entryDate);
  const order = await openOrderOr400(organizationId, req.params.id, entryDate, res);
  if (!order) return;

  const raw = Array.isArray(req.body?.lines) ? req.body.lines : null;
  if (!raw || raw.length === 0) return res.status(400).json({ message: "Add at least one cost line." });

  const parsed: { accountId: string; amount: number }[] = [];
  for (const l of raw as { accountId?: unknown; amount?: unknown }[]) {
    const accountId = typeof l?.accountId === "string" ? l.accountId : "";
    const amount = Number(l?.amount);
    if (!accountId) return res.status(400).json({ message: "Every cost line needs an account." });
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Every cost amount must be more than zero." });
    }
    parsed.push({ accountId, amount: round2(amount) });
  }

  const accounts = await prisma.account.findMany({
    where: { id: { in: parsed.map((l) => l.accountId) }, organizationId, deletedAt: null },
    select: { id: true, accountCode: true, accountName: true, accountType: true, isControlAccount: true },
  });
  type Acc = { id: string; accountCode: string; accountName: string; accountType: string; isControlAccount: boolean };
  const accById = new Map<string, Acc>((accounts as Acc[]).map((a) => [a.id, a]));
  for (const l of parsed) {
    const a = accById.get(l.accountId);
    if (!a) return res.status(400).json({ message: "A cost account is not in this organisation." });
    if (a.accountType !== "EXPENSE") {
      return res.status(400).json({ message: `${a.accountCode} ${a.accountName} is not an expense account. Conversion cost is absorbed out of an expense head.` });
    }
    // A control account''s balance breaks down by sub-ledger card, and a
    // conversion cost has no card to carry. Refused rather than posted
    // untagged, which is what would silently break that account''s breakdown.
    if (a.isControlAccount) {
      return res.status(400).json({ message: `${a.accountCode} ${a.accountName} is a control account and needs a sub-ledger card. Pick a plain expense head.` });
    }
  }

  const total = round2(parsed.reduce((s, l) => s + l.amount, 0));

  const result = await prisma.$transaction(async (tx) => {
    const journalEntry = await tx.journalEntry.create({
      data: {
        organizationId, branchId: order.branchId, entryDate: entryDate!,
        narration: `Conversion cost absorbed into ${order.orderNumber}`.slice(0, 255),
        voucherType: "JV",
        referenceType: "production_cost",
        createdBy: req.user!.userId,
      },
    });

    const entry = await tx.productionEntry.create({
      data: {
        productionOrderId: order.id, entryType: "COST", entryDate: entryDate!,
        totalValue: total, journalEntryId: journalEntry.id,
        narration: typeof req.body?.narration === "string" ? req.body.narration.slice(0, 255) : null,
        createdBy: req.user!.userId,
      },
    });

    await tx.productionEntryLine.createMany({
      data: parsed.map((l) => ({
        productionEntryId: entry.id, accountId: l.accountId, lineValue: l.amount,
      })),
    });

    await tx.journalLine.createMany({
      data: [
        {
          journalEntryId: journalEntry.id, accountId: wip.id,
          businessPartnerId: null, debit: total, credit: 0,
          narration: `Conversion cost — ${order.orderNumber}`.slice(0, 255),
        },
        ...parsed.map((l) => ({
          journalEntryId: journalEntry.id, accountId: l.accountId,
          businessPartnerId: null, debit: 0, credit: l.amount,
          narration: `Absorbed into ${order.orderNumber}`.slice(0, 255),
        })),
      ],
    });

    return { entryId: entry.id, total };
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "CREATE", entityType: "production_cost", entityId: order.id,
    summary: `${order.orderNumber} — conversion cost ${total.toFixed(2)}`,
  });

  res.json({ data: result });
});

// How much of the WIP pool a receipt of `quantity` takes with it.
//
// Proportional to what is still expected, and the LAST receipt takes the
// whole remaining balance so the order closes at exactly zero rather than a
// rounding remainder — the same balancing-figure rule the depreciation
// schedule and the prepaid schedule use for their final instalment.
//
// Exported for the tests; the arithmetic is small but it is the number the
// finished good is valued at, so it is worth being able to check directly.
export function absorptionFor(
  wipBalance: number, quantity: number, planned: number, alreadyReceived: number,
  declaredFinal = false,
): { absorbed: number; final: boolean } {
  const stillExpected = Math.max(planned - alreadyReceived, quantity);
  // Final either because the order has now made what it planned to, or
  // because the user has said this is the last of it — a short yield is a
  // decision someone takes, not something arithmetic discovers.
  const final = declaredFinal || alreadyReceived + quantity >= planned - 0.00005;
  if (final) return { absorbed: round2(wipBalance), final: true };
  return { absorbed: round2(wipBalance * (quantity / stillExpected)), final: false };
}

// POST /production-orders/:id/receive   { entryDate, quantity, final?, narration? }
//
//   Dr the finished item''s stock account, tagged to its own card
//   Cr 1302 Work in Progress
//
// `final` means "this is the last output from this order". It absorbs the
// WHOLE remaining balance into this receipt and closes the order — which is
// how ordinary process loss is treated: the good units carry the cost of the
// units lost. It is set automatically once the planned quantity has been
// made, and set by hand when a short yield is called finished.
//
// There is deliberately no way to move the remaining balance into stock
// WITHOUT a quantity. A value-only top-up would move the ledger and leave
// the stock valuation behind, and the two would never agree again.
router.post("/:id/receive", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const wip = await wipAccountOr400(organizationId, res);
  if (!wip) return;

  const entryDate = dayOrNull(req.body?.entryDate);
  const order = await openOrderOr400(organizationId, req.params.id, entryDate, res);
  if (!order) return;

  const quantity = Number(req.body?.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return res.status(400).json({ message: "Quantity received must be more than zero." });
  }

  const pos = positionOf(order.entries);
  if (pos.wipBalance <= 0) {
    return res.status(400).json({
      message: "Nothing has been issued to this order yet, so there is no cost to give the output. Issue the material first.",
    });
  }

  const planned = Number(order.plannedQuantity);
  const declaredFinal = req.body?.final === true;
  const { absorbed, final } = absorptionFor(pos.wipBalance, quantity, planned, pos.receivedQuantity, declaredFinal);
  if (absorbed <= 0) {
    return res.status(400).json({ message: "There is no work-in-progress value left to absorb." });
  }
  const unitCost = round4(absorbed / quantity);

  const org = await prisma.organization.findUnique({
    where: { id: organizationId }, select: { costingMethod: true },
  });
  const costingMethod = org?.costingMethod ?? "WEIGHTED_AVG";

  const result = await prisma.$transaction(async (tx) => {
    const journalEntry = await tx.journalEntry.create({
      data: {
        organizationId, branchId: order.branchId, entryDate: entryDate!,
        narration: `Output received from ${order.orderNumber}`.slice(0, 255),
        voucherType: "JV",
        referenceType: "production_receipt",
        createdBy: req.user!.userId,
      },
    });

    const entry = await tx.productionEntry.create({
      data: {
        productionOrderId: order.id, entryType: "RECEIPT", entryDate: entryDate!,
        totalValue: absorbed, journalEntryId: journalEntry.id,
        narration: typeof req.body?.narration === "string" ? req.body.narration.slice(0, 255) : null,
        createdBy: req.user!.userId,
      },
    });

    await receiveStock(tx, {
      organizationId, branchId: order.branchId, itemId: order.finishedItemId,
      quantity, unitCost, costingMethod,
      movementType: "PRODUCTION_IN",
      referenceType: "production_receipt", referenceId: entry.id,
      movementDate: entryDate!,
      narration: `Made on ${order.orderNumber}`,
    });

    await tx.productionEntryLine.create({
      data: {
        productionEntryId: entry.id, itemId: order.finishedItemId,
        quantity, unitCost, lineValue: absorbed,
      },
    });

    await tx.journalLine.createMany({
      data: [
        {
          journalEntryId: journalEntry.id, accountId: order.finishedItem.stockAccountId,
          businessPartnerId: order.finishedItem.businessPartnerId,
          debit: absorbed, credit: 0,
          narration: `${order.finishedItem.sku} — ${order.finishedItem.name}`.slice(0, 255),
        },
        {
          journalEntryId: journalEntry.id, accountId: wip.id,
          businessPartnerId: null, debit: 0, credit: absorbed,
          narration: `Absorbed by output from ${order.orderNumber}`.slice(0, 255),
        },
      ],
    });

    // An order that has made what it set out to make is finished. Anything
    // else is closed deliberately, so a short yield is a decision rather than
    // something that happens by arithmetic.
    if (final) {
      await tx.productionOrder.update({ where: { id: order.id }, data: { status: "COMPLETED" } });
    }

    return { entryId: entry.id, absorbed, unitCost, completed: final };
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "CREATE", entityType: "production_receipt", entityId: order.id,
    summary: `${order.orderNumber} — received ${quantity} at ${result.unitCost}, absorbing ${absorbed.toFixed(2)}`,
  });

  res.json({ data: result });
});

// POST /production-orders/:id/close
//
// Marks an order finished. It moves NOTHING — closing is a status change, not
// a posting.
//
// That is a deliberate narrowing. An earlier version let a close sweep the
// remaining WIP into the finished goods account, and it was wrong: the ledger
// would have moved while the stock valuation stayed where it was, and the two
// would never have agreed again. Value only enters stock through a receipt,
// which carries a quantity and goes through receiveStock.
//
// So an order with a balance left is not closed here. It is told what to do
// instead — post the last receipt marked final, which absorbs the balance
// into the units actually made, or cancel, which writes it off.
router.post("/:id/close", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const order = await loadOrder(organizationId, req.params.id);
  if (!order) return res.status(404).json({ message: "Production order not found." });
  if (order.status !== "OPEN") {
    return res.status(409).json({ message: `${order.orderNumber} is already ${order.status.toLowerCase()}.` });
  }

  const pos = positionOf(order.entries);

  if (pos.wipBalance > 0) {
    return res.status(409).json({
      message: pos.receivedQuantity > 0
        ? `${order.orderNumber} still has ${pos.wipBalance.toFixed(2)} in work in progress. Receive the remaining output and tick "this is the last of it" — the balance is then absorbed into the units actually made, which is how ordinary process loss is treated. If nothing more is coming, cancel the order instead.`
        : `${order.orderNumber} has ${pos.wipBalance.toFixed(2)} in work in progress and no output to carry it. Cancel the order — that writes the cost off as abnormal loss, which is what AS 2 requires when there is no product to absorb it.`,
    });
  }

  await prisma.productionOrder.update({ where: { id: order.id }, data: { status: "COMPLETED" } });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "production_order", entityId: order.id,
    summary: `${order.orderNumber} closed — ${pos.receivedQuantity} made, ${pos.absorbed.toFixed(2)} absorbed`,
  });

  res.json({ data: { completed: true, receivedQuantity: pos.receivedQuantity } });
});

// POST /production-orders/:id/cancel
//
// Abandons an order. Any remaining WIP is written off to 4003 Abnormal
// Production Loss rather than absorbed, because there is no output to carry
// it — AS 2 excludes abnormal waste from the cost of inventories, so it is an
// expense of the period.
//
// Material already issued is NOT returned to stock. It was consumed; if some
// of it came back, that is a separate inward Stock Adjustment with its own
// reason.
router.post("/:id/cancel", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const order = await loadOrder(organizationId, req.params.id);
  if (!order) return res.status(404).json({ message: "Production order not found." });
  if (order.status !== "OPEN") {
    return res.status(409).json({ message: `${order.orderNumber} is already ${order.status.toLowerCase()}.` });
  }

  const pos = positionOf(order.entries);
  const entryDate = dayOrNull(req.body?.entryDate) ?? new Date(`${isoDay(new Date())}T00:00:00.000Z`);

  if (pos.wipBalance === 0) {
    await prisma.productionOrder.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "UPDATE", entityType: "production_order", entityId: order.id,
      summary: `${order.orderNumber} cancelled`,
    });
    return res.json({ data: { writtenOff: 0, cancelled: true } });
  }

  const wip = await wipAccountOr400(organizationId, res);
  if (!wip) return;

  const loss = await prisma.account.findFirst({
    where: { organizationId, accountCode: ABNORMAL_LOSS_CODE },
    select: { id: true },
  });
  if (!loss) {
    return res.status(400).json({
      message: "This organisation has no 4003 Abnormal Production Loss account. Sync from templates first — the write-off has nowhere to go.",
    });
  }

  const writtenOff = pos.wipBalance;
  await prisma.$transaction(async (tx) => {
    const journalEntry = await tx.journalEntry.create({
      data: {
        organizationId, branchId: order.branchId, entryDate,
        narration: `${order.orderNumber} cancelled — work in progress written off`.slice(0, 255),
        voucherType: "JV",
        referenceType: "production_cancel",
        createdBy: req.user!.userId,
      },
    });

    const entry = await tx.productionEntry.create({
      data: {
        productionOrderId: order.id, entryType: "WRITEOFF", entryDate,
        totalValue: writtenOff, journalEntryId: journalEntry.id,
        narration: "Abnormal loss on cancellation",
        createdBy: req.user!.userId,
      },
    });

    await tx.productionEntryLine.create({
      data: { productionEntryId: entry.id, accountId: loss.id, lineValue: writtenOff },
    });

    await tx.journalLine.createMany({
      data: [
        {
          journalEntryId: journalEntry.id, accountId: loss.id,
          businessPartnerId: null, debit: writtenOff, credit: 0,
          narration: `Abnormal loss — ${order.orderNumber}`.slice(0, 255),
        },
        {
          journalEntryId: journalEntry.id, accountId: wip.id,
          businessPartnerId: null, debit: 0, credit: writtenOff,
          narration: `${order.orderNumber} cancelled`.slice(0, 255),
        },
      ],
    });

    await tx.productionOrder.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "production_order", entityId: order.id,
    summary: `${order.orderNumber} cancelled — ${writtenOff.toFixed(2)} written off to abnormal loss`,
  });

  res.json({ data: { writtenOff, cancelled: true } });
});

export default router;
'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green