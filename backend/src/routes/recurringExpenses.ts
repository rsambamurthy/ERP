import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { isInterState, round2, splitGst } from "../lib/discountGst";
import { buildBillJournalLineRows, loadPostingAccounts } from "../lib/billPosting";

// Recurring Expenses — configuration only (Phase 2). A template says which
// vendor, which service items, what amount and which day of the month.
// Nothing here posts anything; Phase 3 adds the due list and the generate
// step that turns a template into a real Purchase Bill.
//
// Why a Purchase Bill and not a Journal Entry: lib/gstReports.ts sources
// GSTR-3B's ITC exclusively from purchase_bills, so a JV-based recurring
// expense would silently forfeit input credit on rent, telecom and
// professional fees. SERVICE items (migration_029) are what make a Purchase
// Bill able to carry an expense at all.
//
// Gated on purchase.post rather than a permission of its own: generating one
// of these IS posting a purchase bill, and it shouldn't be possible for
// someone who can't do that directly. Template maintenance is arguably
// master-data-shaped, but a second permission for one screen is overkill
// until an org actually asks to separate them.
const router = Router();
router.use(authenticate, requireActiveSubscription);
const canManage = requirePermission("purchase.post");

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

// Accepts "YYYY-MM" or any parseable date and pins it to the 1st, UTC. Both
// month columns are DATE and every comparison assumes the 1st, so
// normalising on the way in means nothing downstream has to defend against
// a stray day component.
function monthStart(value: unknown): Date | null {
  if (!value) return null;
  const raw = String(value);
  const d = /^\d{4}-\d{2}$/.test(raw) ? new Date(`${raw}-01T00:00:00Z`) : new Date(raw);
  if (isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function thisMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

interface LineInput {
  itemId: string;
  quantity?: number;
  rate?: number | null;
  taxRate?: number;
}

// Shared by POST and PATCH. Returns an error string, or the rows to write.
async function validateLines(
  organizationId: string,
  amountMode: string,
  rawLines: unknown
): Promise<{ error: string } | { rows: (LineInput & { sortOrder: number })[] }> {
  const lines: LineInput[] = Array.isArray(rawLines) ? rawLines : [];
  if (lines.length === 0) return { error: "At least one line is required." };

  const itemIds = [...new Set(lines.map((l) => l.itemId).filter(Boolean))];
  if (itemIds.length === 0) return { error: "Every line needs an item." };

  // SERVICE only. A recurring template pointing at a stock item would post
  // to a stock account and try to receive goods that never arrive — the
  // same reason every sales and stock route filters the other way.
  const items = await prisma.item.findMany({
    where: { id: { in: itemIds }, organizationId, deletedAt: null, itemKind: "SERVICE" },
    select: { id: true },
  });
  if (items.length !== itemIds.length) {
    return { error: "Every line must reference a service item belonging to this organization." };
  }

  const rows = lines.map((l, i) => ({
    itemId: l.itemId,
    quantity: Number(l.quantity ?? 1),
    rate: l.rate === null || l.rate === undefined || l.rate === ("" as unknown) ? null : Number(l.rate),
    taxRate: Number(l.taxRate ?? 0),
    sortOrder: i,
  }));

  for (const r of rows) {
    if (!(r.quantity > 0)) return { error: "Quantity must be greater than zero on every line." };
    if (r.rate !== null && !(r.rate >= 0)) return { error: "Rate cannot be negative." };
    // A FIXED template is what pre-fills the due screen, so a missing rate
    // there would produce a zero-value bill rather than an obvious error.
    if (amountMode === "FIXED" && (r.rate === null || !(r.rate > 0))) {
      return { error: "A fixed-amount template needs a rate on every line. Use Prompted if the amount varies." };
    }
  }
  return { rows };
}

// GET /recurring-expenses — list with the next month each template is due.
router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const templates = await prisma.recurringExpense.findMany({
    where: { organizationId, deletedAt: null },
    include: {
      businessPartner: { select: { id: true, name: true, code: true } },
      lines: { select: { quantity: true, rate: true, taxRate: true } },
      runs: { select: { periodMonth: true }, orderBy: { periodMonth: "desc" }, take: 1 },
    },
    orderBy: { name: "asc" },
  });

  const current = thisMonth();
  res.json({
    data: templates.map((t) => {
      const last = t.runs[0]?.periodMonth ?? null;
      // Next due = the month after the last run, or the start month,
      // whichever is later — but never before the template actually starts,
      // and null once it has ended.
      let next: Date | null = last ? addMonths(new Date(last), 1) : new Date(t.startMonth);
      if (next < new Date(t.startMonth)) next = new Date(t.startMonth);
      if (next < current) next = current;
      if (t.endMonth && next > new Date(t.endMonth)) next = null;
      const amount = t.lines.reduce((s, l) => {
        const base = Number(l.rate ?? 0) * Number(l.quantity);
        return s + base + (base * Number(l.taxRate)) / 100;
      }, 0);
      return {
        id: t.id,
        name: t.name,
        businessPartner: t.businessPartner,
        dayOfMonth: t.dayOfMonth,
        startMonth: t.startMonth,
        endMonth: t.endMonth,
        amountMode: t.amountMode,
        isActive: t.isActive,
        lineCount: t.lines.length,
        // Null for a PROMPTED template — its amount isn't known until the
        // month it's raised, and showing 0 would read as "free".
        estimatedAmount: t.amountMode === "FIXED" ? Number(amount.toFixed(2)) : null,
        lastRunMonth: last,
        nextDueMonth: t.isActive ? next : null,
      };
    }),
  });
});


// The bill date for a given period: the template's day, clamped to the
// month's length. Clamping is only reachable for a template created before
// the 1..28 CHECK existed — it's cheap insurance either way.
function billDateFor(period: Date, dayOfMonth: number): Date {
  const daysInMonth = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth(), Math.min(dayOfMonth, daysInMonth)));
}

// Is this template scheduled for this month at all? Independent of whether
// it has already been generated — the caller checks runs separately, so the
// due screen can show "already raised" rather than silently omitting it.
function isScheduledFor(t: { startMonth: Date; endMonth: Date | null; isActive: boolean }, period: Date): boolean {
  if (!t.isActive) return false;
  if (period < new Date(t.startMonth)) return false;
  if (t.endMonth && period > new Date(t.endMonth)) return false;
  return true;
}

// GET /recurring-expenses/due?month=YYYY-MM — every template scheduled for
// that month, with its lines costed, and whether it has already been raised.
//
// Declared above /:id: "due" is a single path segment, so /:id would
// otherwise swallow it and look for a template with that id. Same trap this
// codebase has hit twice before (items /stock-accounts, business-partners
// /lookup).
router.get("/due", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const period = monthStart(req.query.month) ?? thisMonth();

  const templates = await prisma.recurringExpense.findMany({
    where: { organizationId, deletedAt: null, isActive: true },
    include: {
      businessPartner: { select: { id: true, name: true, code: true } },
      lines: { orderBy: { sortOrder: "asc" }, include: { item: { select: { id: true, sku: true, name: true, uom: true } } } },
      runs: { where: { periodMonth: period }, include: { purchaseBill: { select: { id: true, billNumber: true, grandTotal: true } } } },
    },
    orderBy: { name: "asc" },
  });

  res.json({
    data: templates
      .filter((t) => isScheduledFor(t, period))
      .map((t) => {
        const run = t.runs[0] ?? null;
        const lines = t.lines.map((l) => {
          const qty = Number(l.quantity);
          const rate = l.rate === null ? null : Number(l.rate);
          const lineSubtotal = rate === null ? null : round2(qty * rate);
          return {
            itemId: l.itemId,
            item: l.item,
            quantity: qty,
            rate,
            taxRate: Number(l.taxRate),
            lineSubtotal,
            lineTotal: lineSubtotal === null ? null : round2(lineSubtotal + (lineSubtotal * Number(l.taxRate)) / 100),
          };
        });
        const total = lines.every((l) => l.lineTotal !== null)
          ? round2(lines.reduce((s, l) => s + (l.lineTotal ?? 0), 0))
          : null;
        return {
          id: t.id,
          name: t.name,
          businessPartner: t.businessPartner,
          amountMode: t.amountMode,
          dayOfMonth: t.dayOfMonth,
          billDate: billDateFor(period, t.dayOfMonth).toISOString().slice(0, 10),
          narration: t.narration,
          lines,
          estimatedTotal: total,
          // Already-raised templates stay in the list rather than vanishing,
          // so it's obvious at a glance that nothing was missed.
          alreadyRaised: run
            ? { billId: run.purchaseBill.id, billNumber: run.purchaseBill.billNumber, grandTotal: run.purchaseBill.grandTotal }
            : null,
        };
      }),
  });
});

// POST /recurring-expenses/generate
//   { month: "YYYY-MM", items: [{ recurringExpenseId, lines?: [{ itemId, quantity, rate, taxRate }] }] }
//
// One Purchase Bill per template, each in its own transaction so a failure
// on one doesn't roll back the ones that already worked — the response says
// exactly which succeeded and which didn't.
//
// The ledger shape comes from lib/billPosting.ts, shared with
// routes/purchaseBills.ts, so a recurring bill and a hand-entered one post
// identically. What is deliberately NOT reimplemented here: PO linking,
// 3-way matching, price-variance approval, foreign currency and customs
// duty. A recurring expense has none of those, and pretending otherwise
// would mean duplicating the most delicate code in the app.
router.post("/generate", canManage, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const period = monthStart(req.body?.month);
  if (!period) return res.status(400).json({ message: "month is required, as YYYY-MM." });

  const requests: { recurringExpenseId: string; lines?: LineInput[] }[] =
    Array.isArray(req.body?.items) ? req.body.items : [];
  if (requests.length === 0) return res.status(400).json({ message: "Select at least one recurring expense to raise." });

  const accounts = await loadPostingAccounts(organizationId);
  if (!accounts.tradePayables) {
    return res.status(500).json({ message: "Trade Payables account not found — re-run provisioning." });
  }

  const ho = await prisma.branch.findFirst({ where: { organizationId, isHeadOffice: true } });
  if (!ho) return res.status(400).json({ message: "No head office branch found — set one up first." });
  const branch = await prisma.branch.findFirst({ where: { id: ho.id, organizationId }, select: { stateCode: true } });

  const created: { recurringExpenseId: string; billNumber: string; grandTotal: number }[] = [];
  const failed: { recurringExpenseId: string; message: string }[] = [];

  for (const wanted of requests) {
    try {
      const t = await prisma.recurringExpense.findFirst({
        where: { id: wanted.recurringExpenseId, organizationId, deletedAt: null },
        include: {
          businessPartner: true,
          lines: { orderBy: { sortOrder: "asc" } },
        },
      });
      if (!t) { failed.push({ recurringExpenseId: wanted.recurringExpenseId, message: "Not found." }); continue; }
      if (!isScheduledFor(t, period)) {
        failed.push({ recurringExpenseId: t.id, message: `${t.name} is not scheduled for this month.` });
        continue;
      }

      // Overrides are matched to template lines by position, and only the
      // rate is taken from them. Quantity and tax rate stay with the
      // template so the due screen can't quietly change what is being
      // billed — only how much.
      const overrides = Array.isArray(wanted.lines) ? wanted.lines : null;
      const lineInputs = t.lines.map((l, i) => {
        const override = overrides?.[i];
        const rate = override && override.rate !== null && override.rate !== undefined
          ? Number(override.rate)
          : l.rate === null ? null : Number(l.rate);
        return { itemId: l.itemId, quantity: Number(l.quantity), rate, taxRate: Number(l.taxRate) };
      });
      const missing = lineInputs.find((l) => l.rate === null || !(l.rate >= 0));
      if (missing) {
        failed.push({ recurringExpenseId: t.id, message: `${t.name}: enter an amount before raising it.` });
        continue;
      }

      const items = await prisma.item.findMany({
        where: { id: { in: lineInputs.map((l) => l.itemId) }, organizationId, deletedAt: null },
      });
      const itemById = new Map(items.map((i) => [i.id, i]));
      if (items.length !== new Set(lineInputs.map((l) => l.itemId)).size) {
        failed.push({ recurringExpenseId: t.id, message: `${t.name}: one or more items no longer exist.` });
        continue;
      }

      const interState = isInterState(branch?.stateCode, t.businessPartner.stateCode);
      let subtotal = 0, taxTotal = 0, cgstTotal = 0, sgstTotal = 0, igstTotal = 0;
      const computed = lineInputs.map((l) => {
        const lineSubtotal = round2(l.quantity * l.rate!);
        const taxAmount = round2((lineSubtotal * l.taxRate) / 100);
        const { cgst, sgst, igst } = splitGst(taxAmount, interState);
        subtotal += lineSubtotal; taxTotal += taxAmount;
        cgstTotal += cgst; sgstTotal += sgst; igstTotal += igst;
        return {
          ...l, lineSubtotal, taxAmount, customsDutyAmount: 0,
          lineTotal: lineSubtotal + taxAmount,
          cgstAmount: cgst, sgstAmount: sgst, igstAmount: igst,
        };
      });
      const grandTotal = round2(subtotal + taxTotal);
      if (cgstTotal > 0 && !accounts.cgstInput) throw new Error("CGST Input Credit account not found — re-run provisioning.");
      if (sgstTotal > 0 && !accounts.sgstInput) throw new Error("SGST Input Credit account not found — re-run provisioning.");
      if (igstTotal > 0 && !accounts.igstInput) throw new Error("IGST Input Credit account not found — re-run provisioning.");

      const billDate = billDateFor(period, t.dayOfMonth);

      const bill = await prisma.$transaction(async (tx) => {
        // Bill numbering matches routes/purchaseBills.ts. Inside the
        // transaction so two concurrent generates can't both read the same
        // count.
        const count = await tx.purchaseBill.count({ where: { organizationId } });
        const billNumber = `PB-${String(count + 1).padStart(4, "0")}`;

        const journalEntry = await tx.journalEntry.create({
          data: {
            organizationId, branchId: ho.id, entryDate: billDate,
            narration: t.narration || `${t.name} — ${billDate.toISOString().slice(0, 7)}`,
            voucherType: "PB", referenceType: "purchase_bill", createdBy: req.user!.userId,
          },
        });
        await tx.journalLine.createMany({
          data: buildBillJournalLineRows({
            journalEntryId: journalEntry.id,
            computed,
            itemById: itemById as never,
            cgstTotal, sgstTotal, igstTotal,
            cgstInput: accounts.cgstInput, sgstInput: accounts.sgstInput, igstInput: accounts.igstInput,
            customsDutyPayableCredit: 0, customsDutyPayable: null,
            tradePayables: accounts.tradePayables!, tradePayablesCredit: grandTotal,
            vendor: t.businessPartner,
          }),
        });

        const createdBill = await tx.purchaseBill.create({
          data: {
            organizationId, branchId: ho.id, businessPartnerId: t.businessPartnerId,
            billNumber, billDate, narration: t.narration ?? "",
            journalEntryId: journalEntry.id,
            status: "POSTED",
            subtotal, taxTotal, grandTotal,
            cgstTotal, sgstTotal, igstTotal, customsDutyTotal: 0,
            currency: "INR", exchangeRate: 1,
            createdBy: req.user!.userId,
          },
        });

        await tx.purchaseBillLine.createMany({
          data: computed.map((l) => ({
            purchaseBillId: createdBill.id, itemId: l.itemId, quantity: l.quantity, rate: l.rate!,
            taxRate: l.taxRate, lineSubtotal: l.lineSubtotal, taxAmount: l.taxAmount, lineTotal: l.lineTotal,
            cgstAmount: l.cgstAmount, sgstAmount: l.sgstAmount, igstAmount: l.igstAmount,
            customsDutyAmount: 0,
          })),
        });

        // No receiveStock: every line is a SERVICE item, which has no stock
        // by definition (migration_029). The template route enforces that.
        //
        // This insert is the idempotency guard. The unique index on
        // (recurring_expense_id, period_month) means a second concurrent
        // generate for the same month fails here and rolls the whole
        // transaction back — including the bill — rather than double-booking
        // the payable.
        await tx.recurringExpenseRun.create({
          data: {
            recurringExpenseId: t.id, periodMonth: period,
            purchaseBillId: createdBill.id, generatedBy: req.user!.userId,
          },
        });

        return createdBill;
      });

      logAudit({
        organizationId, actorUserId: req.user!.userId,
        action: "CREATE", entityType: "purchase_bill", entityId: bill.id,
        summary: `Raised ${bill.billNumber} from recurring expense ${t.name} (${period.toISOString().slice(0, 7)})`,
      });
      created.push({ recurringExpenseId: t.id, billNumber: bill.billNumber, grandTotal });
    } catch (err: unknown) {
      // P2002 is the unique index doing its job — someone else raised this
      // template for this month while we were working.
      const code = (err as { code?: string })?.code;
      const message = code === "P2002"
        ? "Already raised for this month."
        : (err as Error)?.message ?? "Could not raise this bill.";
      failed.push({ recurringExpenseId: wanted.recurringExpenseId, message });
    }
  }

  res.json({ data: { created, failed } });
});

// GET /recurring-expenses/:id — template, lines, and run history.
router.get("/:id", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const t = await prisma.recurringExpense.findFirst({
    where: { id: req.params.id, organizationId, deletedAt: null },
    include: {
      businessPartner: { select: { id: true, name: true, code: true } },
      branch: { select: { id: true, name: true } },
      lines: {
        orderBy: { sortOrder: "asc" },
        include: { item: { select: { id: true, sku: true, name: true, uom: true } } },
      },
      runs: {
        orderBy: { periodMonth: "desc" },
        include: { purchaseBill: { select: { id: true, billNumber: true, billDate: true, grandTotal: true } } },
      },
    },
  });
  if (!t) return res.status(404).json({ message: "Recurring expense not found." });
  res.json({ data: t });
});

router.post("/", canManage, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const { name, businessPartnerId, branchId, dayOfMonth, startMonth, endMonth, amountMode, narration, lines } = req.body ?? {};

  if (!name || !businessPartnerId) {
    return res.status(400).json({ message: "name and businessPartnerId are required." });
  }
  const mode = amountMode === "PROMPTED" ? "PROMPTED" : "FIXED";

  const day = Number(dayOfMonth ?? 1);
  if (!Number.isInteger(day) || day < 1 || day > 28) {
    return res.status(400).json({ message: "dayOfMonth must be a whole number between 1 and 28." });
  }

  const start = monthStart(startMonth) ?? thisMonth();
  const end = monthStart(endMonth);
  if (end && end < start) return res.status(400).json({ message: "End month cannot be before start month." });

  // Vendors only. An expense is owed to someone you buy from, and the
  // generated bill credits Trade Payables against this partner.
  const vendor = await prisma.businessPartner.findFirst({
    where: { id: businessPartnerId, organizationId, deletedAt: null, bpType: "VENDOR" },
  });
  if (!vendor) return res.status(400).json({ message: "businessPartnerId must be a vendor in this organization." });

  const validated = await validateLines(organizationId, mode, lines);
  if ("error" in validated) return res.status(400).json({ message: validated.error });

  const created = await prisma.$transaction(async (tx) => {
    const t = await tx.recurringExpense.create({
      data: {
        organizationId,
        branchId: branchId ?? null,
        name,
        businessPartnerId,
        dayOfMonth: day,
        startMonth: start,
        endMonth: end,
        amountMode: mode,
        narration: narration ?? null,
        createdBy: req.user!.userId,
      },
    });
    await tx.recurringExpenseLine.createMany({
      data: validated.rows.map((r) => ({ ...r, recurringExpenseId: t.id })),
    });
    return t;
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "CREATE", entityType: "recurring_expense", entityId: created.id,
    summary: `Created recurring expense ${created.name} — ${vendor.name}`,
  });
  res.status(201).json({ data: created });
});

// PATCH /recurring-expenses/:id — lines are replaced wholesale, same
// convention as Purchase Order lines: a template is small and always edited
// as a whole, so diffing individual rows would be machinery for its own sake.
router.patch("/:id", canManage, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const existing = await prisma.recurringExpense.findFirst({
    where: { id: req.params.id, organizationId, deletedAt: null },
  });
  if (!existing) return res.status(404).json({ message: "Recurring expense not found." });

  const { name, businessPartnerId, branchId, dayOfMonth, startMonth, endMonth, amountMode, narration, lines } = req.body ?? {};
  const mode = amountMode === undefined ? existing.amountMode : amountMode === "PROMPTED" ? "PROMPTED" : "FIXED";

  const day = dayOfMonth === undefined ? existing.dayOfMonth : Number(dayOfMonth);
  if (!Number.isInteger(day) || day < 1 || day > 28) {
    return res.status(400).json({ message: "dayOfMonth must be a whole number between 1 and 28." });
  }

  const start = startMonth === undefined ? existing.startMonth : monthStart(startMonth) ?? existing.startMonth;
  const end = endMonth === undefined ? existing.endMonth : monthStart(endMonth);
  if (end && end < start) return res.status(400).json({ message: "End month cannot be before start month." });

  if (businessPartnerId && businessPartnerId !== existing.businessPartnerId) {
    const vendor = await prisma.businessPartner.findFirst({
      where: { id: businessPartnerId, organizationId, deletedAt: null, bpType: "VENDOR" },
    });
    if (!vendor) return res.status(400).json({ message: "businessPartnerId must be a vendor in this organization." });
  }

  const validated = lines === undefined ? null : await validateLines(organizationId, mode, lines);
  if (validated && "error" in validated) return res.status(400).json({ message: validated.error });

  await prisma.$transaction(async (tx) => {
    await tx.recurringExpense.update({
      where: { id: existing.id },
      data: {
        name: name ?? existing.name,
        businessPartnerId: businessPartnerId ?? existing.businessPartnerId,
        branchId: branchId === undefined ? existing.branchId : branchId,
        dayOfMonth: day,
        startMonth: start,
        endMonth: end,
        amountMode: mode,
        narration: narration === undefined ? existing.narration : narration,
      },
    });
    if (validated) {
      await tx.recurringExpenseLine.deleteMany({ where: { recurringExpenseId: existing.id } });
      await tx.recurringExpenseLine.createMany({
        data: validated.rows.map((r) => ({ ...r, recurringExpenseId: existing.id })),
      });
    }
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "recurring_expense", entityId: existing.id,
    summary: `Updated recurring expense ${name ?? existing.name}`,
  });
  res.json({ data: { updated: true } });
});

// Pause/resume. A paused template stops appearing on the due list but keeps
// every bill it has already generated — the normal way to stop one, since
// DELETE refuses once anything has been raised from it.
router.patch("/:id/toggle", canManage, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const t = await prisma.recurringExpense.findFirst({
    where: { id: req.params.id, organizationId, deletedAt: null },
  });
  if (!t) return res.status(404).json({ message: "Recurring expense not found." });

  const updated = await prisma.recurringExpense.update({
    where: { id: t.id },
    data: { isActive: !t.isActive },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "TOGGLE", entityType: "recurring_expense", entityId: t.id,
    summary: `${updated.isActive ? "Resumed" : "Paused"} recurring expense ${t.name}`,
  });
  res.json({ data: updated });
});

router.delete("/:id", canManage, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const t = await prisma.recurringExpense.findFirst({
    where: { id: req.params.id, organizationId, deletedAt: null },
  });
  if (!t) return res.status(404).json({ message: "Recurring expense not found." });

  // Same rule as Business Partner and Item: once it has produced something
  // real, deletion would orphan the audit trail linking those bills to why
  // they exist.
  const used = await prisma.recurringExpenseRun.findFirst({ where: { recurringExpenseId: t.id } });
  if (used) {
    return res.status(409).json({ message: "This recurring expense has already generated bills and cannot be deleted." });
  }

  await prisma.$transaction([
    prisma.recurringExpenseLine.deleteMany({ where: { recurringExpenseId: t.id } }),
    prisma.recurringExpense.update({ where: { id: t.id }, data: { deletedAt: new Date() } }),
  ]);
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "DELETE", entityType: "recurring_expense", entityId: t.id,
    summary: `Deleted recurring expense ${t.name}`,
  });
  res.json({ data: { deleted: true } });
});

export default router;