// Writes tests/stkCases.json - Stock Management, batches 1 to 4.
//
//   node backend/tests/makeStkCases.mjs
//
// Part B: FIFO in ORG-B, the purchase return, and the controls - including
// two cases that are not in the original 30. Both came out of reading the
// routes rather than running anything. See their notes.
//
// stkCasesA.mjs is the costing chain, phases 1 to 6.
// stkCasesC.mjs is batch 2, production orders, phases 10 to 12.
// stkCasesD.mjs is batch 3, branch transfers in ORG-B, phases 13 to 16.
// stkCasesE.mjs is batch 4, the GST returns in ORG-B, phase 17.
// This file is phases 7 to 9, and the controls, which stay last at 18.

import { C, je, adj, L, val, SQL, CAP, bal, card, writeCases } from "./stkPack.mjs";
import "./stkCasesA.mjs";
import "./stkCasesC.mjs";
import "./stkCasesD.mjs";
import "./stkCasesE.mjs";

const T8 = "FIFO consumes the oldest layer first";
C("STK-08.1", T8, "Lay down layer 1.", 7, {
  login: "B", method: "POST", path: "/stock-adjustments", status: 201,
  body: adj("2026-04-01", "{{BR_B_CHN}}", "Layer 1", [L("{{ITM_BRG_B}}", "IN", 100, 200)]),
  capture: { adjB: "data.id" },
  je: je(["1201", "Inventory (BRG-6205 card)", 20000.0, 0], ["4002", "Inventory Adjustments", 0, 20000.0]),
  asserts: ["journal stock_adjustment {{adjB}}"],
});
C("STK-08.2", T8, "Lay down layer 2 at a different cost.", 7, {
  login: "B", method: "POST", path: "/purchase-bills", status: 201,
  body: { businessPartnerId: "{{VENDOR_TN_B}}", billDate: "2026-04-05", branchId: "{{BR_B_CHN}}",
          lines: [{ itemId: "{{ITM_BRG_B}}", quantity: 50, rate: 260, taxRate: 18 }] },
  capture: { billB: "data.id" },
  je: je(["1201", "Inventory (BRG-6205 card)", 13000.0, 0], ["1102", "CGST Input Credit", 1170.0, 0],
         ["1103", "SGST Input Credit", 1170.0, 0], ["2001", "Accounts Payable", 0, 15340.0]),
  asserts: ["journal purchase_bill {{billB}}"],
});
C("STK-08.3", T8, "Sell across both layers.", 7, {
  login: "B", method: "POST", path: "/sales-invoices", status: 201,
  body: { businessPartnerId: "{{CUST_TN_B}}", invoiceDate: "2026-04-10", branchId: "{{BR_B_CHN}}",
          lines: [{ itemId: "{{ITM_BRG_B}}", quantity: 120, rate: 400, taxRate: 18 }] },
  capture: { invB: "data.id" },
  asserts: [SQL("SELECT round(coalesce(sum(l.debit),0),2) FROM journal_lines l " +
                "JOIN journal_entries e ON e.id=l.journal_entry_id JOIN accounts a ON a.id=l.account_id " +
                "WHERE e.organization_id={{ORG_B}} AND a.account_code='4001'", "25200.00")],
  note: "100 x 200.00 + 20 x 260.00 = 25,200.00. Weighted average would have given 120 x 220.00 = 26,400.00. THIS is the case that proves the organisation's costing method is actually honoured - a 1,200.00 difference.",
});
C("STK-08.4", T8, "Check the lots directly.", 7, {
  login: "B",
  asserts: [SQL("SELECT quantity_remaining FROM stock_lots WHERE item_id={{ITM_BRG_B}} ORDER BY received_at LIMIT 1", 0),
            SQL("SELECT quantity_remaining FROM stock_lots WHERE item_id={{ITM_BRG_B}} ORDER BY received_at DESC LIMIT 1", 30)],
  note: "Lot 1 drained to nil, lot 2 down to 30. If lot 2 went first the ORDER BY received_at has regressed.",
});

const T9 = "Purchase return credits the ORIGINAL bill rate, not the current average";
C("STK-09.0", T9, "Look up the bill line to return against.", 8, {
  method: "GET", path: "/purchase-returns/bill/{{STK-03.billId}}/lines", status: 200,
  capture: { billLineA: "data.lines[0].id" },
});
C("STK-09.1", T9, "Raise a Purchase Return against the STK-03 bill.", 8, {
  method: "POST", path: "/purchase-returns", status: 201,
  body: { purchaseBillId: "{{STK-03.billId}}", returnDate: "2026-04-20", branchId: "{{BR_A_CHN}}",
          lines: [{ purchaseBillLineId: "{{STK-09.billLineA}}", quantity: 10 }] },
  capture: { retA: "data.id" },
  je: je(["2001", "Accounts Payable (vendor)", 3068.0, 0], ["1201", "Inventory (BRG-6205 card)", 0, 2600.0],
         ["1102", "CGST Input Credit reversed", 0, 234.0], ["1103", "SGST Input Credit reversed", 0, 234.0]),
  asserts: ["journal purchase_return {{retA}}", val("BRG-6205", "quantityOnHand", "70"),
            val("BRG-6205", "value", "15376.47"), val("BRG-6205", "averageCost", "219.6639")],
  note: "Credited at the BILL rate of 260.00, not the current average. A bill brings stock in at an explicit rate, so reversing it credits that same rate back - the average would drift from what was actually paid. THE AVERAGE MOVES, though, and that was the second defect: 2,600.00 of value left at a rate that is not the average, so the average of what remains cannot be what it was. 80 x 224.7059 - 2,600.00 = 15,376.47 over 70 units is 219.6639. costing.ts held averageCost still - the same convention consumeStock uses, where it is right because consumption leaves at the average.",
});
C("STK-09.2", T9, "Does the valuation report still tie to the ledger for this item?", 8, {
  asserts: [CAP("SELECT round(coalesce(sum(s.quantity_on_hand * s.average_cost),0),2) FROM item_stock s " +
                "WHERE s.item_id={{ITM_BRG_A}}", "valA"),
            SQL(card("{{ORG_A}}", "Bearing 6205") + " AND l.account_id IN " +
                "(SELECT id FROM accounts WHERE organization_id={{ORG_A}} AND account_code='1201')", "{{valA}}")],
  note: "THE CONTROL FOR THE STEP ABOVE, and the reason the average has to move. Both sides must read 15,376.47. Before the fix the ledger read 15,376.47 and the valuation 15,729.41 - a gap of 352.94, which is 10 x (260.00 - 224.7059), the difference between the rate credited and the rate the valuation removed. It is deliberately measured rather than asserted as a constant: this step reads whatever the valuation says and requires the ledger to agree, so it stays honest if the figures upstream ever change.",
});
C("STK-09.3", T9, "Same test in ORG-B, where FIFO must drain the lot that bill created.", 8, {
  login: "B", auto: "TBD", note: "Deferred: needs the ORG-B bill line lookup and one more return. Specified with batch 2.",
});

// ---------------------------------------------------------------------------
// Two cases that are not in the original 30. Both came out of reading the
// routes, not out of running anything.
// ---------------------------------------------------------------------------
const T31 = "Stock ledger direction - a receipt must not read as an issue";
C("STK-31.0", T31, "Look up the invoice line to return against.", 9, {
  method: "GET", path: "/sales-returns/invoice/{{STK-04.invId}}/lines", status: 200,
  capture: { invLine: "data.lines[0].id" },
});
C("STK-31.1", T31, "Take 10 units back from the customer.", 9, {
  method: "POST", path: "/sales-returns", status: 201,
  body: { salesInvoiceId: "{{STK-04.invId}}", returnDate: "2026-04-22", branchId: "{{BR_A_CHN}}",
          lines: [{ salesInvoiceLineId: "{{STK-31.invLine}}", quantity: 10, condition: "GOOD" }] },
  capture: { srId: "data.id" },
  asserts: [val("BRG-6205", "quantityOnHand", "80"), val("BRG-6205", "value", "17576.47")],
  note: "A SALES_RETURN_IN movement. Stock genuinely comes back: 70 on hand becomes 80, at the cost the invoice consumed (220.00), so (70 x 219.6639 + 10 x 220.00) / 80 = 219.7059 and the value is 17,576.47. The ledger debits 1201 by the COGS reversed, 10 x 220.00 = 2,200.00, and 15,376.47 + 2,200.00 is the same 17,576.47.",
});
C("STK-31.2", T31, "Read the stock ledger and check which way the return moved.", 9, {
  method: "GET", path: "/inventory/stock-ledger?itemId={{ITM_BRG_A}}", status: 200,
  asserts: ["field data.rows[movementType=SALES_RETURN_IN].quantity = 10",
            "field data.rows[movementType=SALES_RETURN_IN].balance = 80"],
  note: "The third defect. inventory.ts decided direction with `inward = movementType === 'PURCHASE' || movementType === 'ADJUSTMENT_IN'`, and ten types exist. TRANSFER_IN, SALES_RETURN_IN and PRODUCTION_IN are all receipts and all got -qty, so on the report an auditor reads to trace an item, a branch receipt, a customer return and a finished-goods receipt each showed stock going OUT. The valuation report is computed separately and was right, which is worse: the two disagreed and only one of them was wrong. Fixed with an INWARD set of all five receipt types.",
});

// The opening-balance rewrite is checked three ways, because the fix has to do
// more than stop being wrong at D07 - it has to still be RIGHT at Chennai.
// After the rewrite openingQuantity is nil whenever there is no `from`, so
// 32.1 on its own would pass for a reason that has nothing to do with the
// branch filter. 32.2 and 32.3 are what make it a test.
const T32 = "Stock ledger opening balance is the balance brought into the window";
C("STK-32.1", T32, "Ask for the OPEN-TEST ledger at a branch that never held any.", 9, {
  method: "GET", path: "/inventory/stock-ledger?itemId={{STK-01.itemId}}&branchId={{BR_A_D07}}", status: 200,
  asserts: ["field data.openingQuantity = 0", "field count(data.rows) = 0"],
  note: "The fourth defect. openingQuantity was read from a column on Item that has no branch at all, while ?branchId= filtered the ROWS by branch - so Test Branch D07, which never held one unit, opened at 10 and every balance in that column was wrong by the same amount. Worse on the OWNING branch: creating an item with an opening balance already writes an ADJUSTMENT_IN, so Chennai counted the 10 twice, once as the opening figure and again as the movement below it.",
});
C("STK-32.2", T32, "Ask for the same item at Chennai, from a date AFTER the opening.", 9, {
  method: "GET", path: "/inventory/stock-ledger?itemId={{STK-01.itemId}}&branchId={{BR_A_CHN}}&from=2026-05-01",
  status: 200,
  asserts: ["field data.openingQuantity = 10", "field count(data.rows) = 0"],
  note: "THE OTHER HALF, and the one that would catch a fix that simply returned nil. The opening movement is dated 2026-04-01 and falls outside the window, so it must appear as 10 brought forward and NOT as a row. Nothing else has happened to OPEN-TEST, so the window itself is empty.",
});
C("STK-32.3", T32, "Brought-forward on BRG-6205 mid-stream, where every movement type appears.", 9, {
  method: "GET", path: "/inventory/stock-ledger?itemId={{ITM_BRG_A}}&branchId={{BR_A_CHN}}&from=2026-04-10",
  status: 200,
  asserts: ["field data.openingQuantity = 150", "field data.rows[0].balance = 90"],
  note: "100 found on 04-01 plus 50 bought on 04-05 is 150 carried in; the first row inside the window is the 04-10 sale of 60, leaving 90. Proves the brought-forward respects the date window and signs receipts and issues the same way the rows do - a ledger whose opening is computed one way and whose rows another is a ledger that does not add up.",
});

// PHASE 18, LAST OF ALL - and that is the whole point of this block.
//
// Steps run phase, then case, then step. STK-30 sorts before STK-31, so at
// phase 9 the reconciliation control ran BEFORE the sales return that STK-31
// posts, and the one step that proves stock ties to the accounts was blind to
// the last stock movement in the batch. It tied at 20,376.47 and said nothing
// about the 2,200.00 that arrived after it.
//
// A control has to be the last thing that runs, or it is not controlling the
// thing you think it is. Batch 2 put production in phases 10 to 12 and this
// moved to 13; batch 3 put transfers in 13 to 16 and it moved to 17, and
// batch 4's returns took 17 so it is now 18. Three times. The number is not
// the rule; being last is the rule.
const T30 = "Stock valuation ties to the ledger";
C("STK-30.1", T30, "Read the ledger balance on 1201 for ORG-A.", 18, {
  asserts: [CAP(bal("{{ORG_A}}", "1201"), "led1201")],
});
C("STK-30.2", T30, "Compare it to the valuation report.", 18, {
  method: "GET", path: "/inventory/valuation", status: 200,
  asserts: ["field sum(data.rows[stockAccount.accountCode=1201].value) = {{led1201}}"],
  note: "THE HEADLINE CONTROL: stock on the report equals stock in the accounts, 22,576.47 either way - BRG-6205 at 17,576.47 after the sales return, plus OPEN-TEST at 5,000.00. Before this batch it failed by 5,352.94, and that number is the whole reason to run it: 5,000.00 of opening stock sat on the report with nothing behind it in the ledger, and 352.94 was the purchase return leaving the ledger at the bill rate while the valuation moved at the average. Two independent defects, and only this one step said anything was wrong. It read 20,376.47 while it sat in phase 9, because it ran before the sales return - see the note above.",
});
C("STK-30.3", T30, "Check the WIP and in-transit control accounts are flat.", 18, {
  asserts: [SQL(bal("{{ORG_A}}", "1302"), 0), SQL(bal("{{ORG_A}}", "1304"), 0)],
  note: "1302 Work in Progress should equal the WIP of orders still OPEN, and 1304 Stock in Transit the cost of transfers still IN_TRANSIT. Nothing in this batch opens either, so both must be nil. Batch 2 and batch 3 are what make them move.",
});
C("STK-30.4", T30, "Prove the whole ledger balances, in both organisations.", 18, {
  asserts: [SQL("SELECT round(coalesce(sum(l.debit-l.credit),0),2) FROM journal_lines l " +
                "JOIN journal_entries e ON e.id=l.journal_entry_id WHERE e.organization_id={{ORG_A}}", 0),
            SQL("SELECT round(coalesce(sum(l.debit-l.credit),0),2) FROM journal_lines l " +
                "JOIN journal_entries e ON e.id=l.journal_entry_id WHERE e.organization_id={{ORG_B}}", 0)],
  note: "Total debits equal total credits, to the paisa. If this ever fails, stop everything else.",
});
C("STK-30.6", T30, "The manufacturing accounts tie too, not just 1201.", 18, {
  method: "GET", path: "/inventory/valuation", status: 200,
  asserts: ["field sum(data.rows[stockAccount.accountCode=1301].value) = 33750.00",
            "field sum(data.rows[stockAccount.accountCode=1303].value) = 21000.00",
            SQL(bal("{{ORG_A}}", "1301"), "33750.00"), SQL(bal("{{ORG_A}}", "1303"), "21000.00")],
  note: "Batch 2 made 1301 Raw Materials and 1303 Finished Goods live, so the control that only ever asked about 1201 now asks about all three inventory heads. 1301: 45,000.00 of castings in, 9,000.00 issued to PO-0001 and 2,250.00 to the cancelled PO-0002, leaving 75 units at 450.00. 1303: the whole 21,000.00 pool absorbed into 9 pumps. Both sides of both, because a tie proved on one account says nothing about the other two.",
});
C("STK-30.7", T30, "And the abnormal loss is where it should be.", 18, {
  asserts: [SQL(bal("{{ORG_A}}", "4003"), "2250.00"),
            SQL("SELECT count(*) FROM production_orders WHERE organization_id={{ORG_A}} " +
                "AND status='OPEN'", 0)],
  note: "1302 being nil (STK-30.3) is only meaningful if no order is still open - an open order with a balance would make the same assertion fail, which is the point. Here both orders are finished: one completed, one cancelled with its 2,250.00 written off to 4003 rather than absorbed into a pump that was never made.",
});
C("STK-30.5", T30, "Check each item card against its stock value.", 18, {
  auto: "NO",
  asserts: ["manual: drill into 1201 / 1301 / 1303 in the UI and compare each ITEM card to that item's " +
            "quantity x average cost, per branch. Under FIFO compare it to the sum of quantity remaining x " +
            "unit cost across that item's open lots instead."],
});


writeCases();
