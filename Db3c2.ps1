$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Phase D-b: the transfer route (2 of 3)...' -ForegroundColor Cyan

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
    lines,
    totalValue,
    taxTotal,
    // What the receiving branch owes: goods at cost plus the tax. Zero on an
    // untaxed transfer, where nothing is owed to anybody.
    invoiceTotal: round2(totalValue + taxTotal),
  };
}

'@
$f = @'
// ── Invoice numbering series ──────────────────────────────────────────────
//
// Registered BEFORE /:id, or Express reads "series" as a transfer id.

// GET /stock-transfers/series
router.get("/series", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const financialYear = typeof req.query.financialYear === "string" && req.query.financialYear
    ? req.query.financialYear
    : financialYearOf(new Date());

  const [branches, series] = await Promise.all([
    prisma.branch.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, name: true, gstin: true, stateCode: true, itcEligibility: true },
      orderBy: { name: "asc" },
    }),
    prisma.documentNumberSeries.findMany({
      where: { organizationId, seriesType: TRANSFER_SERIES_TYPE, financialYear },
      select: { branchId: true, prefix: true, nextNumber: true },
    }),
  ]);
  // Annotated because the row type is otherwise inferred as {} — the same
  // convention the other routes use where a narrow `select` loses its shape.
  type SeriesLite = { branchId: string; prefix: string; nextNumber: number };
  const byBranch = new Map<string, SeriesLite>((series as SeriesLite[]).map((s) => [s.branchId, s]));

  res.json({
    data: {
      financialYear,
      branches: branches.map((b) => {
        const s = byBranch.get(b.id);
        return {
          branchId: b.id, name: b.name, gstin: b.gstin, stateCode: b.stateCode,
          itcEligibility: b.itcEligibility,
          prefix: s?.prefix ?? null,
          nextNumber: s?.nextNumber ?? null,
          // A branch cannot send a taxable transfer without one of these.
          configured: !!s,
        };
      }),
    },
  });
});

// PUT /stock-transfers/series   { branchId, financialYear?, prefix }
//
// Sets the prefix for a branch and year. The running number is NOT settable:
// letting somebody move it backwards would re-issue an invoice number that
// has already been on a document.
router.put("/series", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const { branchId, prefix } = req.body ?? {};
  const financialYear = typeof req.body?.financialYear === "string" && req.body.financialYear
    ? req.body.financialYear
    : financialYearOf(new Date());

  if (typeof branchId !== "string" || !branchId) return res.status(400).json({ message: "Pick a branch." });
  if (typeof prefix !== "string") return res.status(400).json({ message: "A prefix is required." });
  const problem = prefixProblem(prefix);
  if (problem) return res.status(400).json({ message: problem });
  if (!/^\d{4}-\d{2}$/.test(financialYear)) {
    return res.status(400).json({ message: "financialYear should look like 2026-27." });
  }

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, organizationId, deletedAt: null }, select: { id: true, name: true },
  });
  if (!branch) return res.status(400).json({ message: "That branch is not in this organisation." });

  const clean = prefix.trim();
  const saved = await prisma.documentNumberSeries.upsert({
    where: {
      organizationId_branchId_seriesType_financialYear: {
        organizationId, branchId, seriesType: TRANSFER_SERIES_TYPE, financialYear,
      },
    },
    // Changing the prefix mid-year leaves the running number alone, so the
    // sequence continues rather than restarting under a new name.
    update: { prefix: clean },
    create: { organizationId, branchId, seriesType: TRANSFER_SERIES_TYPE, financialYear, prefix: clean },
    select: { prefix: true, nextNumber: true },
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "document_number_series", entityId: branch.id,
    summary: `Branch transfer invoice series for ${branch.name} ${financialYear}: ${clean}`,
  });

  res.json({ data: { branchId, financialYear, ...saved } });
});

// GET /stock-transfers
router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const status = typeof req.query.status === "string" ? req.query.status : null;

  const rows = await prisma.stockTransfer.findMany({
    where: { organizationId, ...(status && status !== "ALL" ? { status } : {}) },
    include: {
      fromBranch: { select: { id: true, name: true } },
      toBranch: { select: { id: true, name: true } },
      lines: { select: { lineValue: true, quantity: true, cgst: true, sgst: true, igst: true } },
    },
    orderBy: [{ transferDate: "desc" }, { createdAt: "desc" }],
    take: 300,
  });

  res.json({
    data: rows.map((t) => {
      const totalValue = round2(t.lines.reduce((s, l) => s + Number(l.lineValue), 0));
      const taxTotal = round2(t.lines.reduce((s, l) => s + Number(l.cgst ?? 0) + Number(l.sgst ?? 0) + Number(l.igst ?? 0), 0));
      return {
        id: t.id,
        transferNumber: t.transferNumber,
        transferDate: isoDay(t.transferDate),
        receivedDate: t.receivedDate ? isoDay(t.receivedDate) : null,
        fromBranch: t.fromBranch,
        toBranch: t.toBranch,
        status: t.status,
        taxTreatment: t.taxTreatment,
        documentNumber: t.documentNumber,
        lineCount: t.lines.length,
        totalValue,
        taxTotal,
        invoiceTotal: round2(totalValue + taxTotal),
      };
    }),
  });
});

// GET /stock-transfers/:id
router.get("/:id", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const t = await loadTransfer(organizationId, req.params.id);
  if (!t) return res.status(404).json({ message: "Transfer not found." });
  res.json({ data: transferJson(t) });
});

// POST /stock-transfers
//   { fromBranchId, toBranchId, transferDate, documentNumber?, ewayBillNumber?,
//     lines: [{ itemId, quantity }] }
//
// Creating a transfer DISPATCHES it. There is no draft state: a transfer that
// has not been dispatched is a list of items somebody is thinking about, and
// the system has no use for that.
router.post("/", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const transit = await inTransitAccountOr400(organizationId, res);
  if (!transit) return;

  const { fromBranchId, toBranchId, documentNumber, ewayBillNumber } = req.body ?? {};
  const transferDate = dayOrNull(req.body?.transferDate);

  if (!transferDate) return res.status(400).json({ message: "transferDate is required, as YYYY-MM-DD." });
  if (typeof fromBranchId !== "string" || !fromBranchId) return res.status(400).json({ message: "Pick the branch the goods are leaving." });
  if (typeof toBranchId !== "string" || !toBranchId) return res.status(400).json({ message: "Pick the branch the goods are going to." });
  if (fromBranchId === toBranchId) return res.status(400).json({ message: "The two branches must be different — nothing moves otherwise." });

  const branches = await prisma.branch.findMany({
    where: { id: { in: [fromBranchId, toBranchId] }, organizationId, deletedAt: null },
    select: { id: true, name: true, gstin: true, stateCode: true, itcEligibility: true },
  });
  type Br = { id: string; name: string; gstin: string | null; stateCode: string | null; itcEligibility: string };
  const from = (branches as Br[]).find((b) => b.id === fromBranchId);
  const to = (branches as Br[]).find((b) => b.id === toBranchId);
  if (!from || !to) return res.status(400).json({ message: "One of those branches is not in this organisation." });

  const taxTreatment = taxTreatmentFor(from, to);
  const taxable = taxTreatment === "TAXABLE";

  // Everything a taxable transfer needs before any stock moves.
  let accounts: TransferAccounts | null = null;
  let interState = false;
  if (taxable) {
    if (to.itcEligibility !== "FULL") {
      return res.status(400).json({
        message: `${to.name} is marked as ${to.itcEligibility === "RESTRICTED" ? "making exempt or non-GST supplies" : "making mixed supplies with proportionate credit"}, so it cannot claim full input tax credit on this transfer. The second proviso to Rule 28 does not apply, the tax becomes a cost that has to be capitalised into that branch's stock, and neither the valuation nor the receipt-side accounting for that is built yet. Refused rather than posted on an assumption that is wrong for this branch.`,
      });
    }
    if (!from.stateCode || !to.stateCode) {
      const which = !from.stateCode ? from.name : to.name;
      return res.status(400).json({
        message: `${which} has no GST state code, so this transfer cannot be split into CGST+SGST or IGST. Set the state code on the branch — unlike a customer, this is your own registration and guessing it would put the tax under the wrong heads on a real return.`,
      });
    }
    interState = isInterState(from.stateCode, to.stateCode);
    accounts = await taxAccountsOr400(organizationId, res);
    if (!accounts) return;
  }

  const raw = Array.isArray(req.body?.lines) ? req.body.lines : null;
  if (!raw || raw.length === 0) return res.status(400).json({ message: "Add at least one item to transfer." });

  const parsed: { itemId: string; quantity: number }[] = [];
  const seen = new Set<string>();
  for (const l of raw as { itemId?: unknown; quantity?: unknown }[]) {
    const itemId = typeof l?.itemId === "string" ? l.itemId : "";
    const quantity = Number(l?.quantity);
    if (!itemId) return res.status(400).json({ message: "Every line needs an item." });
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ message: "Every quantity must be more than zero." });
    }
    if (seen.has(itemId)) return res.status(400).json({ message: "The same item is listed twice." });
    seen.add(itemId);
    parsed.push({ itemId, quantity });
  }

  const items = await prisma.item.findMany({
    where: { id: { in: parsed.map((l) => l.itemId) }, organizationId, deletedAt: null },
    select: { id: true, sku: true, name: true, itemKind: true, stockAccountId: true, businessPartnerId: true, hsnCode: true, taxRate: true },
  });
  type It = { id: string; sku: string; name: string; itemKind: string; stockAccountId: string; businessPartnerId: string; hsnCode: string | null; taxRate: unknown };
  const byId = new Map<string, It>((items as It[]).map((x) => [x.id, x]));
  for (const l of parsed) {
    const it = byId.get(l.itemId);
    if (!it) return res.status(400).json({ message: "An item on this transfer is not in this organisation." });
    if (it.itemKind !== "STOCK") {
      return res.status(400).json({ message: `${it.sku} is a service item — it has no stock to move.` });
    }
  }

  // Item-master gaps that would produce an invalid invoice. Reported all at
  // once: somebody fixing item masters wants the whole list.
  if (taxable) {
    const bad = blockedLines(parsed.map((l) => {
      const it = byId.get(l.itemId)!;
      return {
        itemId: it.id, itemName: `${it.sku} — ${it.name}`,
        hsnCode: it.hsnCode, taxRate: it.taxRate === null || it.taxRate === undefined ? null : Number(it.taxRate),
        quantity: l.quantity, unitCost: 0,
      };
    }));
    if (bad.length > 0) {
      const noHsn = bad.filter((b) => b.reason === "MISSING_HSN").map((b) => b.itemName);
      const noRate = bad.filter((b) => b.reason === "MISSING_GST_RATE").map((b) => b.itemName);
      const parts: string[] = [];
      if (noHsn.length) parts.push(`no HSN code: ${noHsn.join("; ")}`);
      if (noRate.length) parts.push(`no GST rate set: ${noRate.join("; ")}`);
      return res.status(400).json({
        message: `This is a taxable branch transfer, so every line goes on a tax invoice and needs an HSN and a rate. Fix these on the item master first — ${parts.join(", ")}.`,
      });
    }
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId }, select: { costingMethod: true },
  });
  const costingMethod = org?.costingMethod ?? "WEIGHTED_AVG";

  // TR-0001 style, counted rather than allocated from a series — this is the
  // internal document reference, not the tax invoice number (that comes from
  // DocumentNumberSeries and IS allocated transactionally). Two dispatches at
  // the same instant can compute the same count and the second violates
  // stock_transfers_number_uq, so the whole transaction is retried rather
  // than surfacing a 500 on a perfectly legitimate dispatch. Retrying is safe
  // because the failed attempt rolled back completely: no stock consumed, and
  // the invoice number it had taken went back to the series.
  let transferNumber = "";

  try {
    const created = await withTransferNumberRetry(organizationId, async (tx, allocatedNumber) => {
      transferNumber = allocatedNumber;
      // The invoice number, before anything else, so a missing series aborts
      // the transaction rather than leaving stock consumed.
      let invoiceNumber: string | null = null;
      if (taxable) {
        invoiceNumber = await allocateTransferNumber(tx, organizationId, fromBranchId, transferDate);
        if (!invoiceNumber) {
          throw Object.assign(
            new Error(`${from.name} has no branch-transfer invoice series for ${financialYearOf(transferDate)}. A tax invoice needs a consecutive serial number under Rule 46(b) and there is none to take — set the prefix for this branch first.`),
            { status: 400 }
          );
        }
      }

      const journalEntry = await tx.journalEntry.create({
        data: {
          organizationId, branchId: fromBranchId, entryDate: transferDate,
          narration: `${transferNumber} — dispatched to ${to.name}`.slice(0, 255),
          voucherType: "JV",
          referenceType: "stock_transfer_dispatch",
          createdBy: req.user!.userId,
        },
      });

      const transfer = await tx.stockTransfer.create({
        data: {
          organizationId, transferNumber,
          fromBranchId, toBranchId, transferDate,
          status: "DISPATCHED", taxTreatment,
          toBranchItcEligibility: to.itcEligibility,
          // A taxable transfer's number is its tax invoice number and is
          // allocated, never typed. An untaxed one carries whatever delivery
          // challan reference the user entered.
          documentNumber: taxable
            ? invoiceNumber
            : (typeof documentNumber === "string" && documentNumber.trim() ? documentNumber.trim().slice(0, 30) : null),
          ewayBillNumber: typeof ewayBillNumber === "string" && ewayBillNumber.trim() ? ewayBillNumber.trim().slice(0, 20) : null,
          dispatchJournalEntryId: journalEntry.id,
          createdBy: req.user!.userId,
        },
      });

      const valued: ValuedLine[] = [];
      const legs: ItemLeg[] = [];

      for (const l of parsed) {
        const it = byId.get(l.itemId)!;
        // The cost the receiving branch will receive at. Taken from what the
        // stock is actually worth at the sending branch on the day, not typed.
        const { unitCost, totalCost } = await consumeStock(tx, {
          organizationId, branchId: fromBranchId, itemId: l.itemId,
          quantity: l.quantity, costingMethod,
          movementType: "TRANSFER_OUT",
          referenceType: "stock_transfer", referenceId: transfer.id,
          movementDate: transferDate,
          narration: `${transferNumber} — to ${to.name}`,
        });

        const input: TransferLineInput = {
          itemId: it.id, itemName: `${it.sku} — ${it.name}`,
          hsnCode: it.hsnCode,
          taxRate: it.taxRate === null || it.taxRate === undefined ? null : Number(it.taxRate),
          quantity: l.quantity, unitCost,
          // The authoritative figure — see TransferLineInput.lineValue.
          lineValue: round2(totalCost),
        };
        const v = valueLine(input, interState);
        valued.push(v);

        legs.push({
          stockAccountId: it.stockAccountId, itemPartnerId: it.businessPartnerId,
          amount: round2(totalCost), narration: `${it.sku} — ${it.name}`,
        });

        await tx.stockTransferLine.create({
          data: {
            stockTransferId: transfer.id, itemId: l.itemId,
            quantity: l.quantity, unitCost: round4(unitCost), lineValue: round2(totalCost),
            ...(taxable ? {
              taxableValue: v.taxableValue, valuationBasis: v.valuationBasis,
              gstRate: v.gstRate, cgst: v.cgst, sgst: v.sgst, igst: v.igst,
            } : {}),
          },
        });
      }

      const totals = totalsFor(valued);
      let lines: JournalLineData[];

      if (taxable) {
        const toPartner = await branchPartnerId(tx, organizationId, to);
        lines = dispatchJournalLines({
          journalEntryId: journalEntry.id, accounts: accounts!,
          items: legs, costTotal: totals.lineValueTotal,
          tax: { cgst: totals.cgstTotal, sgst: totals.sgstTotal, igst: totals.igstTotal },
          taxTotal: totals.taxTotal, toBranchPartnerId: toPartner,
          label: `${transferNumber} / ${invoiceNumber}`,
        });
      } else {
        // Unchanged from the untaxed design: one debit to 1304, one credit
        // per item against its own card.
        lines = [
          {
            journalEntryId: journalEntry.id, accountId: transit.id,
            businessPartnerId: null, debit: totals.lineValueTotal, credit: 0,
            narration: `${transferNumber} — in transit to ${to.name}`.slice(0, 255),
          },
          ...legs.map((c) => ({
            journalEntryId: journalEntry.id, accountId: c.stockAccountId,
            businessPartnerId: c.itemPartnerId,
            debit: 0, credit: c.amount, narration: c.narration.slice(0, 255),
          })),
        ];
      }

      const imbalance = balanceProblem(lines);
      if (imbalance) throw Object.assign(new Error(imbalance), { status: 500 });

      await tx.journalLine.createMany({ data: lines });

      // taxTotal only where tax was actually computed and posted. valueLine
      // runs for untaxed lines too (it is what produces lineValue), and it
      // reads the item's rate — but a same-GSTIN movement is not a supply,
      // nothing is stored on the line, and reporting a tax figure here would
      // contradict GET /:id, which reads the nulls back as zero.
      return { id: transfer.id, transferNumber, documentNumber: transfer.documentNumber, taxTreatment, total: totals.lineValueTotal, taxTotal: taxable ? totals.taxTotal : 0 };
    });

    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "CREATE", entityType: "stock_transfer", entityId: created.id,
      summary: `${transferNumber} — ${from.name} to ${to.name}, ${parsed.length} item${parsed.length === 1 ? "" : "s"}, ${created.total.toFixed(2)}${taxable ? ` + ${created.taxTotal.toFixed(2)} tax, invoice ${created.documentNumber}` : ""}`,
    });

    res.status(201).json({ data: created });
  } catch (err: unknown) {
    if (err instanceof InsufficientStockError) {
      return res.status(400).json({ message: err.message });
    }
    const status = (err as { status?: number })?.status;
    if (status === 400 || status === 409) return res.status(status).json({ message: (err as Error).message });
    console.error("stock transfer dispatch failed", err);
    return res.status(500).json({ message: "Could not dispatch the transfer. Nothing was written." });
  }
});

'@
Add-FileText 'backend/src/routes/stockTransfers.ts' $tail $f
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green