// Stock Management batch 1, part A - the costing chain on BRG-6205 in ORG-A.
//
// Phase order is the dependency order: each case asserts the balance it
// inherits from the one before. 2 found stock, 3 purchase, 4 sale,
// 5 shrinkage, 6 the refused over-issue.

import { C, je, adj, L, val, SQL, CAP, bal, card } from "./stkPack.mjs";

// ---------------------------------------------------------------------------
const T1 = "Opening balance at item creation moves stock but NOT the ledger";
C("STK-01.1", T1, "Create an item with an opening balance.", 1, {
  method: "POST", path: "/items", status: 201,
  body: { sku: "OPEN-TEST", name: "Opening balance test", itemKind: "STOCK",
          stockAccountId: "{{ACC_1201_A}}", hsnCode: "84821010", taxRate: 18,
          openingQuantity: 10, openingCost: 500, openingBranchId: "{{BR_A_CHN}}",
          openingDate: "2026-04-01" },
  capture: { itemId: "data.id" },
  asserts: [val("OPEN-TEST", "quantityOnHand", "10"), val("OPEN-TEST", "value", "5000.00")],
  note: "The movement written is ADJUSTMENT_IN with referenceType item_opening_balance - NOT PURCHASE, which is what the scenario used to say.",
});
C("STK-01.2", T1, "Look for the journal entry that should have accompanied it.", 1, {
  asserts: [SQL("SELECT count(*) FROM journal_entries WHERE organization_id={{ORG_A}} " +
                "AND reference_type='item_opening_balance'", 1)],
  note: "Was the first defect this batch found: items.ts called receiveStock and posted nothing, so 5,000.00 of stock existed with no ledger balance behind it. Fixed - postOpeningStock() now runs inside the same transaction as the receipt, on the single-item path AND the bulk-upload path.",
});
C("STK-01.3", T1, "Quantify it against account 1201.", 1, {
  asserts: [SQL(card("{{ORG_A}}", "Opening balance test"), "5000.00")],
  note: "The item card under 1201 carries 10 x 500.00. This is the debit half of the entry above, on the item's own sub-ledger card, exactly as a Stock Adjustment IN would post it.",
});
C("STK-01.4", T1, "Check the credit half landed in equity, not in income.", 1, {
  asserts: [SQL(bal("{{ORG_A}}", "3003"), "-5000.00"),
            SQL("SELECT round(coalesce(sum(l.debit-l.credit),0),2) FROM journal_lines l " +
                "JOIN journal_entries e ON e.id=l.journal_entry_id " +
                "WHERE e.organization_id={{ORG_A}} AND e.reference_type='item_opening_balance'", 0)],
  je: je(["1201", "Inventory (OPEN-TEST card)", 5000.0, 0], ["3003", "Opening Balance Equity", 0, 5000.0]),
  note: "3003 is credited, so the balance reads -5,000.00 under sum(debit-credit). The account did not exist until migration_050 - coa_templates carried no EQUITY rows at all, which is also why no organisation could draw a balance sheet. Crediting 4002 Inventory Adjustments instead would have reported every rupee of opening stock as first-year profit. Second assert: the entry balances.",
});

const T7 = "A service item has no stock to adjust";
C("STK-07.1", T7, "Try to put a service item on a Stock Adjustment.", 1, {
  method: "POST", path: "/stock-adjustments", status: 400,
  body: adj("2026-04-01", "{{BR_A_CHN}}", "Service on an adjustment", [L("{{ITM_SVC_A}}", "IN", 1, 1000)]),
  asserts: ['error contains "invalid for this organization"'],
  note: "The route filters to itemKind STOCK, so the API refuses it too - not just the picker. The other half of this scenario - issuing a service item to a production order - is STK-13.2, which lives in phase 12 because it needs an order to exist first.",
});

const T2 = "Inward stock adjustment - found stock";
C("STK-02.1", T2, "Post a Stock Adjustment, direction IN.", 2, {
  method: "POST", path: "/stock-adjustments", status: 201,
  body: adj("2026-04-01", "{{BR_A_CHN}}", "Opening stock", [L("{{ITM_BRG_A}}", "IN", 100, 200)]),
  capture: { adjId: "data.id" },
  je: je(["1201", "Inventory (BRG-6205 card)", 20000.0, 0], ["4002", "Inventory Adjustments", 0, 20000.0]),
  asserts: ["journal stock_adjustment {{adjId}}", val("BRG-6205", "quantityOnHand", "100"),
            val("BRG-6205", "value", "20000.00"), val("BRG-6205", "averageCost", "200.00")],
});
C("STK-02.2", T2, "Check the item's sub-ledger card under 1201.", 2, {
  asserts: [SQL(card("{{ORG_A}}", "Bearing 6205") + " AND l.account_id IN " +
                "(SELECT id FROM accounts WHERE organization_id={{ORG_A}} AND account_code='1201')", "20000.00")],
  note: "1201 is a control account with one card per item.",
});

const T3 = "Purchase bill recomputes the weighted average";
C("STK-03.1", T3, "Create a Purchase Bill (not PO-linked).", 3, {
  method: "POST", path: "/purchase-bills", status: 201,
  body: { businessPartnerId: "{{VENDOR_TN}}", billDate: "2026-04-05", branchId: "{{BR_A_CHN}}",
          lines: [{ itemId: "{{ITM_BRG_A}}", quantity: 50, rate: 260, taxRate: 18 }] },
  capture: { billId: "data.id" },
  je: je(["1201", "Inventory (BRG-6205 card)", 13000.0, 0], ["1102", "CGST Input Credit", 1170.0, 0],
         ["1103", "SGST Input Credit", 1170.0, 0], ["2001", "Accounts Payable (vendor)", 0, 15340.0]),
  asserts: ["journal purchase_bill {{billId}}"],
});
C("STK-03.2", T3, "Confirm the average moved and nothing was restated.", 3, {
  asserts: [val("BRG-6205", "quantityOnHand", "150"), val("BRG-6205", "averageCost", "220.00"),
            val("BRG-6205", "value", "33000.00")],
  note: "(100 x 200 + 50 x 260) / 150 = 220.00. The 20,000.00 already in the ledger is untouched.",
});

const T4 = "Sale takes cost out at the weighted average, not at the sale price";
C("STK-04.1", T4, "Raise a Sales Invoice.", 4, {
  method: "POST", path: "/sales-invoices", status: 201,
  body: { businessPartnerId: "{{CUST_TN}}", invoiceDate: "2026-04-10", branchId: "{{BR_A_CHN}}",
          lines: [{ itemId: "{{ITM_BRG_A}}", quantity: 60, rate: 400, taxRate: 18 }] },
  capture: { invId: "data.id" },
  je: je(["1005", "Accounts Receivable (customer)", 28320.0, 0], ["5001", "Sales Revenue", 0, 24000.0],
         ["2102", "CGST Output Payable", 0, 2160.0], ["2103", "SGST Output Payable", 0, 2160.0],
         ["4001", "Cost of Goods Sold", 13200.0, 0], ["1201", "Inventory (BRG-6205 card)", 0, 13200.0]),
  asserts: ["journal sales_invoice {{invId}}"],
  note: "ONE entry carries both halves: the revenue side and the cost side. COGS is 60 x 220.00 = 13,200.00 - the cost the engine consumed, never the invoice rate.",
});
C("STK-04.2", T4, "Confirm consumption did not move the average.", 4, {
  asserts: [val("BRG-6205", "quantityOnHand", "90"), val("BRG-6205", "averageCost", "220.00"),
            val("BRG-6205", "value", "19800.00")],
});
C("STK-04.3", T4, "Check gross margin.", 4, {
  asserts: [SQL("SELECT round(coalesce(sum(CASE WHEN a.account_code='5001' THEN l.credit-l.debit " +
                "WHEN a.account_code='4001' THEN l.debit-l.credit END),0),2) FROM journal_lines l " +
                "JOIN journal_entries e ON e.id=l.journal_entry_id JOIN accounts a ON a.id=l.account_id " +
                "WHERE e.organization_id={{ORG_A}} AND e.reference_type='sales_invoice'", "37200.00")],
  note: "Revenue 24,000.00 plus COGS 13,200.00 read as positives sums to 37,200.00; the margin is 10,800.00. If COGS ever equals the sale value the costing engine has been bypassed.",
});

const T5 = "Outward stock adjustment - shrinkage, costed by the engine";
C("STK-05.1", T5, "Post a Stock Adjustment, direction OUT, with NO unit cost.", 5, {
  method: "POST", path: "/stock-adjustments", status: 201,
  body: adj("2026-04-15", "{{BR_A_CHN}}", "Physical count shortfall", [L("{{ITM_BRG_A}}", "OUT", 10)]),
  capture: { adjId: "data.id" },
  je: je(["4002", "Inventory Adjustments", 2200.0, 0], ["1201", "Inventory (BRG-6205 card)", 0, 2200.0]),
  asserts: ["journal stock_adjustment {{adjId}}", val("BRG-6205", "quantityOnHand", "80"),
            val("BRG-6205", "value", "17600.00")],
  note: "10 x 220.00 = 2,200.00, costed by the engine. An operator who could supply a cost on an OUT line could make a write-off say anything.",
});
C("STK-05.2", T5, "Post one document with an IN line and an OUT line together.", 5, {
  method: "POST", path: "/stock-adjustments", status: 201,
  body: adj("2026-04-16", "{{BR_A_CHN}}", "Recount",
            [L("{{ITM_BRG_A}}", "IN", 5, 300), L("{{ITM_BRG_A}}", "OUT", 5)]),
  capture: { adjId2: "data.id" },
  je: je(["1201", "Inventory - IN leg", 1500.0, 0], ["4002", "Inventory Adjustments - write-off", 1123.53, 0],
         ["1201", "Inventory - OUT leg", 0, 1123.53], ["4002", "Inventory Adjustments - found stock", 0, 1500.0]),
  asserts: ["journal stock_adjustment {{adjId2}}", val("BRG-6205", "quantityOnHand", "80"),
            val("BRG-6205", "value", "17976.47")],
  note: "The IN is processed first, so the OUT consumes at the NEW average: (80x220 + 5x300)/85 = 224.7059, and 5 x that is 1,123.53. The entry carries BOTH a debit and a credit to 4002 - gross, not netted.",
});

const T6 = "Cannot take out more than is on hand";
C("STK-06.1", T6, "Post a Stock Adjustment OUT for more than the balance.", 6, {
  method: "POST", path: "/stock-adjustments", status: 409,
  body: adj("2026-04-17", "{{BR_A_CHN}}", "Over-issue", [L("{{ITM_BRG_A}}", "OUT", 200)]),
  asserts: ['error contains "in stock at this branch"'],
});
C("STK-06.2", T6, "Confirm nothing at all was written.", 6, {
  asserts: [SQL("SELECT count(*) FROM stock_movements WHERE organization_id={{ORG_A}} AND movement_date='2026-04-17'", 0),
            SQL("SELECT count(*) FROM journal_entries WHERE organization_id={{ORG_A}} AND entry_date='2026-04-17'", 0)],
});
C("STK-06.3", T6, "Post a two-line document where the SECOND line fails.", 6, {
  method: "POST", path: "/stock-adjustments", status: 409,
  body: adj("2026-04-18", "{{BR_A_CHN}}", "Line 2 fails",
            [L("{{ITM_BRG_A}}", "IN", 10, 250), L("{{ITM_BRG_A}}", "OUT", 500)]),
  asserts: ['error contains "in stock at this branch"', val("BRG-6205", "quantityOnHand", "80"),
            val("BRG-6205", "value", "17976.47")],
  note: "Line 1 must be rolled back with line 2. If the quantity reads 90 the document was not one transaction.",
});
