// Tool catalogue + executors for the AI data assistant (POST /chatbot/ask).
//
// Every executor's FIRST argument is organizationId, injected by
// routes/chatbot.ts from the authenticated request's own org — never from
// anything the model supplies. This is the only tenant-scoping boundary;
// no executor here should ever accept an organizationId from `input`.
//
// Financial tools wrap the exact same functions the report pages use
// (lib/reports.ts, lib/gstReports.ts). Never recompute this math here —
// see the header comment on lib/reports.ts for why.
import { prisma } from "../db";
import { computeTrialBalance, computePnl, computeBalanceSheet, computeCashBook, computeReceiptsPayments } from "./reports";
import { computeGstr1, computeGstr3b } from "./gstReports";

// Anthropic Messages API tool definitions — passed verbatim in the `tools`
// array of every POST /chatbot/ask request.
export const CHATBOT_TOOLS = [
  {
    name: "get_trial_balance",
    description:
      "Trial balance — every account's net debit or credit balance as of a date (defaults to today). Use for 'what's the balance in X account' or a general account listing.",
    input_schema: {
      type: "object",
      properties: { asOf: { type: "string", description: "ISO date (YYYY-MM-DD), defaults to today" } },
    },
  },
  {
    name: "get_profit_and_loss",
    description: "Profit & Loss statement (income vs expense) for a date range. Use for 'how much profit/revenue/expense did we make'.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "ISO date, start of period" },
        to: { type: "string", description: "ISO date, end of period" },
      },
    },
  },
  {
    name: "get_balance_sheet",
    description: "Balance sheet (assets, liabilities, equity) as of a date.",
    input_schema: {
      type: "object",
      properties: { asOf: { type: "string", description: "ISO date, defaults to today" } },
    },
  },
  {
    name: "get_cash_book",
    description: "Cash & bank running balance and transaction list for a date range.",
    input_schema: {
      type: "object",
      properties: { from: { type: "string", description: "ISO date" }, to: { type: "string", description: "ISO date" } },
    },
  },
  {
    name: "get_receipts_and_payments",
    description: "Cash/bank receipts and payments, itemized, for a date range.",
    input_schema: {
      type: "object",
      properties: { from: { type: "string", description: "ISO date" }, to: { type: "string", description: "ISO date" } },
    },
  },
  {
    name: "get_gstr1_summary",
    description:
      "GSTR-1 (outward supplies) summary totals for a date range — taxable value, CGST/SGST/IGST, invoice counts. Indicative figures, not filing-ready.",
    input_schema: {
      type: "object",
      properties: { from: { type: "string", description: "ISO date" }, to: { type: "string", description: "ISO date" } },
      required: ["from", "to"],
    },
  },
  {
    name: "get_gstr3b_summary",
    description: "GSTR-3B summary — outward tax liability, input tax credit, and net payable by tax head, for a date range. Indicative figures, not filing-ready.",
    input_schema: {
      type: "object",
      properties: { from: { type: "string", description: "ISO date" }, to: { type: "string", description: "ISO date" } },
      required: ["from", "to"],
    },
  },
  {
    name: "get_stock_summary",
    description:
      "Current stock on hand by item, with quantity and an estimated value (weighted-average cost). Use for 'how much stock/inventory do we have'. Estimated value is approximate for FIFO-costed organizations.",
    input_schema: {
      type: "object",
      properties: { itemName: { type: "string", description: "Optional filter — partial item name or SKU" } },
    },
  },
  {
    name: "list_recent_sales_invoices",
    description: "Recent sales invoices, most recent first. Optionally filter by customer name.",
    input_schema: {
      type: "object",
      properties: {
        customerName: { type: "string", description: "Optional partial customer name filter" },
        limit: { type: "number", description: "Max rows to return, default 20, max 50" },
      },
    },
  },
  {
    name: "list_recent_purchase_bills",
    description: "Recent purchase bills, most recent first. Optionally filter by vendor name.",
    input_schema: {
      type: "object",
      properties: {
        vendorName: { type: "string", description: "Optional partial vendor name filter" },
        limit: { type: "number", description: "Max rows to return, default 20, max 50" },
      },
    },
  },
  {
    name: "list_outstanding_balances",
    description:
      "Customers/vendors with an outstanding (unpaid) balance, largest first. Use for 'who owes us money' (bpType CUSTOMER) or 'who do we owe' (bpType VENDOR).",
    input_schema: {
      type: "object",
      properties: {
        bpType: { type: "string", enum: ["CUSTOMER", "VENDOR"], description: "Which side to list — omit for both" },
        limit: { type: "number", description: "Max rows to return, default 20, max 50" },
      },
    },
  },
  {
    name: "list_sales_orders",
    description:
      "Sales Orders — count by status (DRAFT/PENDING_APPROVAL/APPROVED/REJECTED/CANCELLED/CLOSED) plus the most recent orders. Use for 'how many sales orders', 'open sales orders', 'sales orders for <customer>'.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Optional exact status filter" },
        customerName: { type: "string", description: "Optional partial customer name filter" },
        limit: { type: "number", description: "Max rows in the recent-orders list, default 20, max 50" },
      },
    },
  },
  {
    name: "list_purchase_orders",
    description:
      "Purchase Orders — count by status (DRAFT/PENDING_APPROVAL/APPROVED/REJECTED/CANCELLED/CLOSED) plus the most recent orders. Use for 'how many purchase orders', 'open purchase orders', 'purchase orders for <vendor>'.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Optional exact status filter" },
        vendorName: { type: "string", description: "Optional partial vendor name filter" },
        limit: { type: "number", description: "Max rows in the recent-orders list, default 20, max 50" },
      },
    },
  },
  {
    name: "list_goods_receipt_notes",
    description: "Goods Receipt Notes (physical stock-in against an approved Purchase Order) — total count plus the most recent ones.",
    input_schema: {
      type: "object",
      properties: {
        vendorName: { type: "string", description: "Optional partial vendor name filter" },
        limit: { type: "number", description: "Max rows to return, default 20, max 50" },
      },
    },
  },
  {
    name: "list_delivery_notes",
    description: "Delivery Notes (physical stock-out against an approved Sales Order) — total count plus the most recent ones.",
    input_schema: {
      type: "object",
      properties: {
        customerName: { type: "string", description: "Optional partial customer name filter" },
        limit: { type: "number", description: "Max rows to return, default 20, max 50" },
      },
    },
  },
  {
    name: "list_sales_returns",
    description: "Sales Returns (credit notes against a Sales Invoice) — total count/value plus the most recent ones.",
    input_schema: {
      type: "object",
      properties: {
        customerName: { type: "string", description: "Optional partial customer name filter" },
        limit: { type: "number", description: "Max rows to return, default 20, max 50" },
      },
    },
  },
  {
    name: "list_purchase_returns",
    description: "Purchase Returns (debit notes against a Purchase Bill) — total count/value plus the most recent ones.",
    input_schema: {
      type: "object",
      properties: {
        vendorName: { type: "string", description: "Optional partial vendor name filter" },
        limit: { type: "number", description: "Max rows to return, default 20, max 50" },
      },
    },
  },
  {
    name: "list_items",
    description: "The item/product catalog — count plus a list, optionally searched by name or SKU. Use for 'how many items/products do we have' or 'do we sell/stock X'. For quantity/value on hand, use get_stock_summary instead.",
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Optional partial name or SKU filter" },
        includeInactive: { type: "boolean", description: "Include inactive items too, default false" },
        limit: { type: "number", description: "Max rows to return, default 30, max 100" },
      },
    },
  },
  {
    name: "list_business_partners",
    description:
      "The customer/vendor directory — counts by type plus a list, optionally searched by name. Use for 'how many customers/vendors do we have' or 'do we have a customer/vendor called X'. For who owes/is owed money, use list_outstanding_balances instead.",
    input_schema: {
      type: "object",
      properties: {
        bpType: { type: "string", enum: ["CUSTOMER", "VENDOR"], description: "Optional — omit for both" },
        search: { type: "string", description: "Optional partial name filter" },
        includeInactive: { type: "boolean", description: "Include inactive partners too, default false" },
        limit: { type: "number", description: "Max rows to return, default 30, max 100" },
      },
    },
  },
  {
    name: "list_journal_entries",
    description:
      "Manual and auto-posted journal/accounting entries for a date range, most recent first — each entry's date, narration, voucher number, and total amount. Use for 'how many journal entries', 'entries this month', or to find a specific transaction by narration.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Optional ISO date, start of period" },
        to: { type: "string", description: "Optional ISO date, end of period" },
        narrationContains: { type: "string", description: "Optional partial-text filter on the narration" },
        limit: { type: "number", description: "Max rows to return, default 20, max 50" },
      },
    },
  },
] as const;

function clampLimit(n: unknown, def: number, max: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : def;
  return Math.min(Math.max(v, 1), max);
}

export async function executeChatbotTool(organizationId: string, name: string, input: any): Promise<unknown> {
  switch (name) {
    case "get_trial_balance": {
      const { rows, totalDebit, totalCredit, asOf } = await computeTrialBalance(organizationId, input?.asOf);
      return {
        asOf,
        totalDebit,
        totalCredit,
        accounts: rows.map((r) => ({ code: r.account.accountCode, name: r.account.accountName, type: r.account.accountType, debit: r.debit, credit: r.credit })),
      };
    }
    case "get_profit_and_loss": {
      const r = await computePnl(organizationId, input?.from, input?.to);
      return {
        from: r.from,
        to: r.to,
        totalIncome: r.totalIncome,
        totalExpense: r.totalExpense,
        netProfit: r.netProfit,
        income: r.income.map((x) => ({ account: x.account.accountName, amount: x.amount })),
        expense: r.expense.map((x) => ({ account: x.account.accountName, amount: x.amount })),
      };
    }
    case "get_balance_sheet": {
      const r = await computeBalanceSheet(organizationId, input?.asOf);
      return {
        asOf: r.asOf,
        totalAssets: r.totalAssets,
        totalLiabilities: r.totalLiabilities,
        totalEquity: r.totalEquity,
        netProfitToDate: r.netProfitToDate,
        balanced: r.balanced,
        assets: r.assets.map((x) => ({ account: x.account.accountName, amount: x.amount })),
        liabilities: r.liabilities.map((x) => ({ account: x.account.accountName, amount: x.amount })),
        equity: r.equity.map((x) => ({ account: x.account.accountName, amount: x.amount })),
      };
    }
    case "get_cash_book": {
      const r = await computeCashBook(organizationId, input?.from, input?.to);
      return {
        openingBalance: r.openingBalance,
        closingBalance: r.rows.length ? r.rows[r.rows.length - 1].balance : r.openingBalance,
        transactionCount: r.rows.length,
        // Most recent 50 only — a wide date range shouldn't flood the
        // model's context; totals above already summarize the full range.
        recentRows: r.rows.slice(-50),
      };
    }
    case "get_receipts_and_payments": {
      const r = await computeReceiptsPayments(organizationId, input?.from, input?.to);
      return {
        totalReceipts: r.totalReceipts,
        totalPayments: r.totalPayments,
        receiptCount: r.receipts.length,
        paymentCount: r.payments.length,
        recentReceipts: r.receipts.slice(-30),
        recentPayments: r.payments.slice(-30),
      };
    }
    case "get_gstr1_summary": {
      if (!input?.from || !input?.to) throw new Error("from and to are required.");
      const r = await computeGstr1(organizationId, new Date(input.from), new Date(input.to));
      return {
        from: r.from,
        to: r.to,
        totals: r.totals,
        exportsTotal: r.exportsTotal,
        b2bInvoiceCount: r.b2b.length,
        b2cGroupCount: r.b2c.length,
        exportInvoiceCount: r.exports.length,
        creditNoteCount: r.creditNotes.length,
      };
    }
    case "get_gstr3b_summary": {
      if (!input?.from || !input?.to) throw new Error("from and to are required.");
      return computeGstr3b(organizationId, new Date(input.from), new Date(input.to));
    }
    case "get_stock_summary": {
      const items = await prisma.item.findMany({
        where: {
          organizationId,
          deletedAt: null,
          ...(input?.itemName
            ? {
                OR: [
                  { name: { contains: String(input.itemName), mode: "insensitive" } },
                  { sku: { contains: String(input.itemName), mode: "insensitive" } },
                ],
              }
            : {}),
        },
        include: { itemStocks: true },
      });
      // itemStocks.averageCost is the authoritative weighted-average figure
      // and a close blend for FIFO orgs too (see ItemStock comment in
      // schema.prisma) — not necessarily identical to the FIFO-lot-exact
      // figure the Stock Valuation report computes.
      const rows = items
        .map((it) => {
          const qty = it.itemStocks.reduce((s, sl) => s + Number(sl.quantityOnHand), 0);
          const value = it.itemStocks.reduce((s, sl) => s + Number(sl.quantityOnHand) * Number(sl.averageCost), 0);
          return { sku: it.sku, name: it.name, uom: it.uom, quantityOnHand: qty, estimatedValue: Math.round(value * 100) / 100 };
        })
        .filter((r) => r.quantityOnHand !== 0);
      return {
        itemCount: rows.length,
        totalEstimatedValue: Math.round(rows.reduce((s, r) => s + r.estimatedValue, 0) * 100) / 100,
        items: rows.slice(0, 100),
      };
    }
    case "list_recent_sales_invoices": {
      const limit = clampLimit(input?.limit, 20, 50);
      const invoices = await prisma.salesInvoice.findMany({
        where: {
          organizationId,
          ...(input?.customerName ? { businessPartner: { name: { contains: String(input.customerName), mode: "insensitive" } } } : {}),
        },
        include: { businessPartner: { select: { name: true } } },
        orderBy: { invoiceDate: "desc" },
        take: limit,
      });
      return invoices.map((i) => ({ invoiceNumber: i.invoiceNumber, date: i.invoiceDate, customer: i.businessPartner.name, grandTotal: Number(i.grandTotal) }));
    }
    case "list_recent_purchase_bills": {
      const limit = clampLimit(input?.limit, 20, 50);
      const bills = await prisma.purchaseBill.findMany({
        where: {
          organizationId,
          ...(input?.vendorName ? { businessPartner: { name: { contains: String(input.vendorName), mode: "insensitive" } } } : {}),
        },
        include: { businessPartner: { select: { name: true } } },
        orderBy: { billDate: "desc" },
        take: limit,
      });
      return bills.map((b) => ({ billNumber: b.billNumber, date: b.billDate, vendor: b.businessPartner.name, grandTotal: Number(b.grandTotal), status: b.status }));
    }
    case "list_outstanding_balances": {
      const limit = clampLimit(input?.limit, 20, 50);
      return listOutstandingBalances(organizationId, input?.bpType, limit);
    }
    case "list_sales_orders": {
      const limit = clampLimit(input?.limit, 20, 50);
      const where: any = { organizationId };
      if (input?.status) where.status = String(input.status);
      if (input?.customerName) where.businessPartner = { name: { contains: String(input.customerName), mode: "insensitive" } };
      const [statusCounts, orders] = await Promise.all([
        prisma.salesOrder.groupBy({ by: ["status"], where: { organizationId }, _count: { _all: true } }),
        prisma.salesOrder.findMany({ where, include: { businessPartner: { select: { name: true } } }, orderBy: { soDate: "desc" }, take: limit }),
      ]);
      return {
        totalCount: statusCounts.reduce((s, c) => s + c._count._all, 0),
        countsByStatus: Object.fromEntries(statusCounts.map((c) => [c.status, c._count._all])),
        orders: orders.map((o) => ({ soNumber: o.soNumber, date: o.soDate, customer: o.businessPartner.name, status: o.status, grandTotal: Number(o.grandTotal) })),
      };
    }
    case "list_purchase_orders": {
      const limit = clampLimit(input?.limit, 20, 50);
      const where: any = { organizationId };
      if (input?.status) where.status = String(input.status);
      if (input?.vendorName) where.businessPartner = { name: { contains: String(input.vendorName), mode: "insensitive" } };
      const [statusCounts, orders] = await Promise.all([
        prisma.purchaseOrder.groupBy({ by: ["status"], where: { organizationId }, _count: { _all: true } }),
        prisma.purchaseOrder.findMany({ where, include: { businessPartner: { select: { name: true } } }, orderBy: { poDate: "desc" }, take: limit }),
      ]);
      return {
        totalCount: statusCounts.reduce((s, c) => s + c._count._all, 0),
        countsByStatus: Object.fromEntries(statusCounts.map((c) => [c.status, c._count._all])),
        orders: orders.map((o) => ({ poNumber: o.poNumber, date: o.poDate, vendor: o.businessPartner.name, status: o.status, grandTotal: Number(o.grandTotal) })),
      };
    }
    case "list_goods_receipt_notes": {
      const limit = clampLimit(input?.limit, 20, 50);
      const where: any = { organizationId };
      if (input?.vendorName) where.businessPartner = { name: { contains: String(input.vendorName), mode: "insensitive" } };
      const [totalCount, grns] = await Promise.all([
        prisma.goodsReceiptNote.count({ where: { organizationId } }),
        prisma.goodsReceiptNote.findMany({ where, include: { businessPartner: { select: { name: true } } }, orderBy: { grnDate: "desc" }, take: limit }),
      ]);
      return { totalCount, goodsReceiptNotes: grns.map((g) => ({ grnNumber: g.grnNumber, date: g.grnDate, vendor: g.businessPartner.name })) };
    }
    case "list_delivery_notes": {
      const limit = clampLimit(input?.limit, 20, 50);
      const where: any = { organizationId };
      if (input?.customerName) where.businessPartner = { name: { contains: String(input.customerName), mode: "insensitive" } };
      const [totalCount, dns] = await Promise.all([
        prisma.deliveryNote.count({ where: { organizationId } }),
        prisma.deliveryNote.findMany({ where, include: { businessPartner: { select: { name: true } } }, orderBy: { dnDate: "desc" }, take: limit }),
      ]);
      return { totalCount, deliveryNotes: dns.map((d) => ({ dnNumber: d.dnNumber, date: d.dnDate, customer: d.businessPartner.name })) };
    }
    case "list_sales_returns": {
      const limit = clampLimit(input?.limit, 20, 50);
      const where: any = { organizationId };
      if (input?.customerName) where.businessPartner = { name: { contains: String(input.customerName), mode: "insensitive" } };
      const [agg, returns] = await Promise.all([
        prisma.salesReturn.aggregate({ where: { organizationId }, _count: { _all: true }, _sum: { grandTotal: true } }),
        prisma.salesReturn.findMany({ where, include: { businessPartner: { select: { name: true } } }, orderBy: { returnDate: "desc" }, take: limit }),
      ]);
      return {
        totalCount: agg._count._all,
        totalValue: Number(agg._sum.grandTotal ?? 0),
        returns: returns.map((r) => ({ returnNumber: r.returnNumber, date: r.returnDate, customer: r.businessPartner.name, grandTotal: Number(r.grandTotal) })),
      };
    }
    case "list_purchase_returns": {
      const limit = clampLimit(input?.limit, 20, 50);
      const where: any = { organizationId };
      if (input?.vendorName) where.businessPartner = { name: { contains: String(input.vendorName), mode: "insensitive" } };
      const [agg, returns] = await Promise.all([
        prisma.purchaseReturn.aggregate({ where: { organizationId }, _count: { _all: true }, _sum: { grandTotal: true } }),
        prisma.purchaseReturn.findMany({ where, include: { businessPartner: { select: { name: true } } }, orderBy: { returnDate: "desc" }, take: limit }),
      ]);
      return {
        totalCount: agg._count._all,
        totalValue: Number(agg._sum.grandTotal ?? 0),
        returns: returns.map((r) => ({ returnNumber: r.returnNumber, date: r.returnDate, vendor: r.businessPartner.name, grandTotal: Number(r.grandTotal) })),
      };
    }
    case "list_items": {
      const limit = clampLimit(input?.limit, 30, 100);
      const where: any = { organizationId, deletedAt: null };
      if (!input?.includeInactive) where.isActive = true;
      if (input?.search) {
        where.OR = [
          { name: { contains: String(input.search), mode: "insensitive" } },
          { sku: { contains: String(input.search), mode: "insensitive" } },
        ];
      }
      const [totalCount, items] = await Promise.all([
        prisma.item.count({ where }),
        prisma.item.findMany({ where, orderBy: { name: "asc" }, take: limit }),
      ]);
      return {
        totalCount,
        items: items.map((it) => ({
          sku: it.sku,
          name: it.name,
          uom: it.uom,
          isActive: it.isActive,
          salesRate: it.salesRate != null ? Number(it.salesRate) : null,
          purchaseRate: it.purchaseRate != null ? Number(it.purchaseRate) : null,
        })),
      };
    }
    case "list_business_partners": {
      const limit = clampLimit(input?.limit, 30, 100);
      const where: any = { organizationId, deletedAt: null };
      if (input?.bpType === "CUSTOMER" || input?.bpType === "VENDOR") where.bpType = input.bpType;
      else where.bpType = { in: ["CUSTOMER", "VENDOR"] }; // exclude the internal "ITEM" bpType rows (see Item.businessPartnerId)
      if (!input?.includeInactive) where.isActive = true;
      if (input?.search) where.name = { contains: String(input.search), mode: "insensitive" };

      const [countsByType, partners] = await Promise.all([
        prisma.businessPartner.groupBy({ by: ["bpType"], where: { organizationId, deletedAt: null, bpType: { in: ["CUSTOMER", "VENDOR"] } }, _count: { _all: true } }),
        prisma.businessPartner.findMany({ where, orderBy: { name: "asc" }, take: limit }),
      ]);
      return {
        totalCount: countsByType.reduce((s, c) => s + c._count._all, 0),
        countsByType: Object.fromEntries(countsByType.map((c) => [c.bpType, c._count._all])),
        partners: partners.map((p) => ({ name: p.name, bpType: p.bpType, gstin: p.gstin, phone: p.phone, isActive: p.isActive })),
      };
    }
    case "list_journal_entries": {
      const limit = clampLimit(input?.limit, 20, 50);
      const where: any = { organizationId };
      if (input?.from || input?.to) {
        where.entryDate = { ...(input?.from ? { gte: new Date(input.from) } : {}), ...(input?.to ? { lte: new Date(input.to) } : {}) };
      }
      if (input?.narrationContains) where.narration = { contains: String(input.narrationContains), mode: "insensitive" };

      const [totalCount, entries] = await Promise.all([
        prisma.journalEntry.count({ where }),
        prisma.journalEntry.findMany({ where, include: { journalLines: { select: { debit: true } } }, orderBy: { entryDate: "desc" }, take: limit }),
      ]);
      return {
        totalCount,
        entries: entries.map((e) => ({
          date: e.entryDate,
          narration: e.narration,
          voucherNumber: e.voucherNumber,
          referenceType: e.referenceType,
          amount: e.journalLines.reduce((s, l) => s + Number(l.debit), 0),
        })),
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Net balance per customer/vendor against the org's control accounts (Trade
// Receivables / Trade Payables) — same debit/credit convention
// computeTrialBalance (lib/reports.ts) uses. Not extracted there since no
// existing report page shows this per-partner cut yet — the Ledger page
// (GET /journal/ledger) covers one partner at a time; this ranks all of
// them, purpose-built for the chatbot.
async function listOutstandingBalances(organizationId: string, bpTypeFilter: unknown, limit: number) {
  const wantedBpTypes: ("CUSTOMER" | "VENDOR")[] = bpTypeFilter === "CUSTOMER" || bpTypeFilter === "VENDOR" ? [bpTypeFilter] : ["CUSTOMER", "VENDOR"];

  const [accounts, partners] = await Promise.all([
    prisma.account.findMany({ where: { organizationId, deletedAt: null, isControlAccount: true, defaultBpType: { in: wantedBpTypes } } }),
    prisma.businessPartner.findMany({ where: { organizationId, deletedAt: null, bpType: { in: wantedBpTypes } } }),
  ]);
  if (accounts.length === 0 || partners.length === 0) return { balances: [] };

  const sums = await prisma.journalLine.groupBy({
    by: ["accountId", "businessPartnerId"] as const,
    where: { accountId: { in: accounts.map((a) => a.id) }, businessPartnerId: { in: partners.map((p) => p.id) } },
    _sum: { debit: true, credit: true },
  });
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const movementByPartner = new Map<string, number>();
  for (const s of sums) {
    const account = accountById.get(s.accountId);
    if (!account || !s.businessPartnerId) continue;
    const debitFirst = account.accountType === "ASSET"; // Trade Receivables; Trade Payables (LIABILITY) is credit-first
    const movement = debitFirst ? Number(s._sum.debit ?? 0) - Number(s._sum.credit ?? 0) : Number(s._sum.credit ?? 0) - Number(s._sum.debit ?? 0);
    movementByPartner.set(s.businessPartnerId, (movementByPartner.get(s.businessPartnerId) ?? 0) + movement);
  }

  const balances = partners
    .map((p) => {
      const debitFirst = p.bpType === "CUSTOMER";
      let opening = Number(p.openingBalance ?? 0);
      if (p.openingBalanceType === "CREDIT") opening = -opening;
      if (!debitFirst) opening = -opening;
      const total = opening + (movementByPartner.get(p.id) ?? 0);
      return { name: p.name, bpType: p.bpType, balance: Math.round(total * 100) / 100 };
    })
    .filter((r) => Math.abs(r.balance) >= 0.01)
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
    .slice(0, limit);

  return { balances };
}
