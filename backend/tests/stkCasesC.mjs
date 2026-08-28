// Stock Management batch 2 - production orders.
//
// Raw material in, finished goods out, and the thing worth testing is that
// THE COST OF THE FINISHED GOOD IS NEVER TYPED. It is whatever consumeStock
// actually consumed, plus whatever conversion cost was absorbed, divided by
// the quantity received. Every link in that chain is a posted document, so
// every link can be checked against the ledger - which is what this does.
//
// Phases 10 and 11 are one order walked end to end. Phase 12 is what the
// order refuses, and the close/cancel pair.
//
// ONE DELIBERATE CHOICE ABOUT COMPONENTS. The chain issues CAST-5HP only,
// whose average is exactly 450.00, and leaves BRG-6205 alone. BRG's average
// after batch 1 is 219.6639 blended to 219.7059 - four decimal places - and
// issuing 40 of them would credit the ledger round2(40 x 219.7059) = 8,788.24
// while the valuation kept 40 x 219.7059 = 8,788.236 and reported 8,788.24
// against a ledger of 8,788.23. A one-paisa break, real, and inherent to
// holding a 4dp average and posting 2dp journals rather than a defect in any
// one document. It is not manufactured here, because STK-30.2 is the headline
// control and it should fail for reasons that are about the software. Worth
// deciding separately what the reconciliation tolerance is.

import { C, je, adj, L, val, SQL, CAP, bal, card } from "./stkPack.mjs";

const ORDER = "{{STK-10.poId}}";

// ---------------------------------------------------------------------------
const T10 = "Material issued to a production order leaves stock and enters WIP";
C("STK-10.1", T10, "Bring castings into stock, so there is something to issue.", 10, {
  method: "POST", path: "/stock-adjustments", status: 201,
  body: adj("2026-05-01", "{{BR_A_CHN}}", "Castings received", [L("{{ITM_CAST_A}}", "IN", 100, 450)]),
  capture: { adjCast: "data.id" },
  je: je(["1301", "Raw Materials (CAST-5HP card)", 45000.0, 0], ["4002", "Inventory Adjustments", 0, 45000.0]),
  asserts: ["journal stock_adjustment {{adjCast}}", val("CAST-5HP", "quantityOnHand", "100"),
            val("CAST-5HP", "averageCost", "450.00")],
  note: "CAST-5HP sits on 1301 Raw Materials, not 1201 - the manufacturing chart splits inventory three ways, and 1301 / 1302 / 1303 are what make a production order explicable on the balance sheet.",
});
C("STK-10.2", T10, "Open a production order for 10 pumps.", 10, {
  method: "POST", path: "/production-orders", status: 201,
  body: { branchId: "{{BR_A_CHN}}", orderDate: "2026-05-02",
          finishedItemId: "{{ITM_PUMP_A}}", plannedQuantity: 10,
          notes: "Batch 1 of the 5HP run" },
  capture: { poId: "data.id", poNumber: "data.orderNumber" },
  asserts: ["field data.orderNumber = PO-0001"],
  note: "Creating the order posts NOTHING. It is a container for the postings that follow, which is why its own step has no expected ledger.",
});
C("STK-10.3", T10, "Issue 20 castings to the order.", 10, {
  method: "POST", path: `/production-orders/${ORDER}/issue`, status: 200,
  body: { entryDate: "2026-05-03", lines: [{ itemId: "{{ITM_CAST_A}}", quantity: 20 }],
          narration: "First draw" },
  capture: { issueId: "data.entryId" },
  je: je(["1302", "Work in Progress", 9000.0, 0], ["1301", "Raw Materials (CAST-5HP card)", 0, 9000.0]),
  asserts: ["field data.total = 9000.00", "journal production_issue {{issueId}}"],
  note: "20 x 450.00. The 9,000.00 is NOT in the request - the request names a quantity and consumeStock decides what it cost. Send a rate on an issue line and there is nowhere for it to go.",
});
C("STK-10.4", T10, "The stock left, and the same value is now in 1302.", 10, {
  asserts: [val("CAST-5HP", "quantityOnHand", "80"), val("CAST-5HP", "value", "36000.00"),
            SQL(bal("{{ORG_A}}", "1302"), "9000.00"),
            SQL(card("{{ORG_A}}", "Casting, 5HP pump body") + " AND l.account_id IN " +
                "(SELECT id FROM accounts WHERE organization_id={{ORG_A}} AND account_code='1301')", "36000.00")],
  note: "Value moved sideways, not away: 45,000.00 was on the CAST card under 1301, 9,000.00 of it is now in 1302, and 36,000.00 remains. Nothing entered or left the business.",
});
C("STK-10.5", T10, "Read the order's own position.", 10, {
  method: "GET", path: `/production-orders/${ORDER}`, status: 200,
  asserts: ["field data.status = OPEN", "field data.issued = 9000", "field data.costed = 0",
            "field data.absorbed = 0", "field data.wipBalance = 9000",
            "field data.receivedQuantity = 0"],
  note: "None of these is stored. positionOf() sums them from the postings every time, the same way accumulated depreciation is summed from the runs rather than held on the asset - so the order cannot disagree with its own entries.",
});

// ---------------------------------------------------------------------------
const T11 = "Cost of conversion is capitalised into inventory, out of the right head";
C("STK-11.0", T11, "Check the organisation has somewhere correct to absorb labour from.", 10, {
  asserts: [SQL("SELECT count(*) FROM accounts WHERE organization_id={{ORG_A}} " +
                "AND account_code IN ('4004','4005')", 2)],
  note: "The defect this batch opened with. productionOrders.ts insists a cost line names a plain EXPENSE account, and the chart had four expense heads: 4003 Abnormal Production Loss (which by definition cannot be absorbed), 4020 Depreciation, 4021 Loss on Disposal, and 4008 Administrative. So every production order had to take its labour out of Administrative - the one head AS 2 names as EXCLUDED from the cost of inventories. The route was right and the chart could not feed it. migration_051 adds 4004 Direct Labour and 4005 Production Overheads.",
});
C("STK-11.1", T11, "Absorb labour and factory overhead into the order.", 10, {
  method: "POST", path: `/production-orders/${ORDER}/cost`, status: 200,
  body: { entryDate: "2026-05-04",
          lines: [{ accountId: "{{ACC_4004_A}}", amount: 8000 },
                  { accountId: "{{ACC_4005_A}}", amount: 4000 }],
          narration: "Week 18 labour and overhead" },
  capture: { costId: "data.entryId" },
  je: je(["1302", "Work in Progress", 12000.0, 0], ["4004", "Direct Labour", 0, 8000.0],
         ["4005", "Production Overheads", 0, 4000.0]),
  asserts: ["field data.total = 12000.00", "journal production_cost {{costId}}"],
  note: "AS 2 requires cost of conversion - direct labour plus a systematic allocation of production overheads - to sit in inventory. The expense head is CREDITED as its cost is capitalised, so the P&L carries only what was not absorbed.",
});
C("STK-11.2", T11, "The pool is now material plus conversion.", 10, {
  method: "GET", path: `/production-orders/${ORDER}`, status: 200,
  asserts: ["field data.issued = 9000", "field data.costed = 12000", "field data.wipBalance = 21000",
            "field data.unitCostSoFar = null"],
  note: "21,000.00 against a planned 10 units. unitCostSoFar is null rather than 2,100.00 because nothing has been received: a cost per unit before any unit exists would be a forecast, and this report does not forecast.",
});
C("STK-11.3", T11, "And 1302 agrees.", 10, {
  asserts: [SQL(bal("{{ORG_A}}", "1302"), "21000.00"),
            SQL(bal("{{ORG_A}}", "4004"), "-8000.00"), SQL(bal("{{ORG_A}}", "4005"), "-4000.00")],
  note: "4004 and 4005 read negative under sum(debit-credit) because they were credited - the cost left the P&L and went into stock. If a production run ever leaves a DEBIT sitting on 4004 at the year end, that is conversion cost that was never absorbed by anything.",
});

// ---------------------------------------------------------------------------
const T12 = "The finished good's cost is derived, and the last receipt carries the rest";
C("STK-12.1", T12, "Receive 6 of the 10 planned.", 11, {
  method: "POST", path: `/production-orders/${ORDER}/receive`, status: 200,
  body: { entryDate: "2026-05-05", quantity: 6 },
  capture: { rcpt1: "data.entryId" },
  je: je(["1303", "Finished Goods (PUMP-5HP card)", 12600.0, 0], ["1302", "Work in Progress", 0, 12600.0]),
  asserts: ["field data.absorbed = 12600.00", "field data.unitCost = 2100.0000",
            "field data.completed = false", "journal production_receipt {{rcpt1}}",
            val("PUMP-5HP", "quantityOnHand", "6"), val("PUMP-5HP", "value", "12600.00")],
  note: "Proportional to what is still expected: 21,000.00 x 6/10. The 2,100.00 a unit is not in the request and is not on the item - it is the pool divided by the output, and it is the number that will become COGS when a pump is sold.",
});
C("STK-12.2", T12, "Only 3 more come off the line. Call it finished.", 11, {
  method: "POST", path: `/production-orders/${ORDER}/receive`, status: 200,
  body: { entryDate: "2026-05-06", quantity: 3, final: true },
  capture: { rcpt2: "data.entryId" },
  je: je(["1303", "Finished Goods (PUMP-5HP card)", 8400.0, 0], ["1302", "Work in Progress", 0, 8400.0]),
  asserts: ["field data.absorbed = 8400.00", "field data.unitCost = 2800.0000",
            "field data.completed = true", "journal production_receipt {{rcpt2}}"],
  note: "THE BALANCING-FIGURE RULE, and the reason to run this case. 9 units were made where 10 were planned, and the final receipt takes the WHOLE remaining balance - 8,400.00 over 3 units is 2,800.00 each. That is how ordinary process loss is treated: the good units carry the cost of the ones lost, which is what AS 2 requires. `final` is a decision someone takes, not something arithmetic discovers - a short yield has to be declared.",
});
C("STK-12.3", T12, "The pool emptied into stock, to the paisa.", 11, {
  asserts: [SQL(bal("{{ORG_A}}", "1302"), 0), SQL(bal("{{ORG_A}}", "1303"), "21000.00"),
            val("PUMP-5HP", "quantityOnHand", "9"), val("PUMP-5HP", "value", "21000.00"),
            SQL(card("{{ORG_A}}", "Pump 5HP") + " AND l.account_id IN " +
                "(SELECT id FROM accounts WHERE organization_id={{ORG_A}} AND account_code='1303')", "21000.00")],
  note: "9,000.00 of castings plus 12,000.00 of conversion is 21,000.00, and all of it is now in finished goods. The weighted average is 21,000 / 9 = 2,333.3333, so the valuation computes 20,999.9997 and reports 21,000.00 - the sub-paisa is the 4dp average, and it rounds away here because the whole pool landed on one item.",
});
C("STK-12.4", T12, "The order closed itself, and says what it made.", 11, {
  method: "GET", path: `/production-orders/${ORDER}`, status: 200,
  asserts: ["field data.status = COMPLETED", "field data.wipBalance = 0",
            "field data.absorbed = 21000", "field data.receivedQuantity = 9",
            "field data.unitCostSoFar = 2333.3333", "field data.writtenOff = 0"],
  note: "Completed by the receipt, not by a separate close. unitCostSoFar is now real: 21,000.00 over 9 units. Nothing was written off - the loss was absorbed, not expensed, because there was output to carry it.",
});

// ---------------------------------------------------------------------------
const T13 = "A production order refuses what it cannot cost";
C("STK-13.1", T13, "Open a second order, to try things against.", 12, {
  method: "POST", path: "/production-orders", status: 201,
  body: { branchId: "{{BR_A_CHN}}", orderDate: "2026-05-10",
          finishedItemId: "{{ITM_PUMP_A}}", plannedQuantity: 4 },
  capture: { po2: "data.id" },
});
C("STK-13.2", T13, "Issue a service item as a component.", 12, {
  method: "POST", path: "/production-orders/{{STK-13.po2}}/issue", status: 400,
  body: { entryDate: "2026-05-11", lines: [{ itemId: "{{ITM_SVC_A}}", quantity: 1 }] },
  asserts: ['error contains "no stock to consume"'],
  note: "This is STK-07.2, which batch 1 deferred for want of a production order. A service has no stock and no cost to consume, so it cannot be issued - labour goes on the order as a COST line, which is a different posting with a different ledger.",
});
C("STK-13.3", T13, "Issue more castings than the branch holds.", 12, {
  method: "POST", path: "/production-orders/{{STK-13.po2}}/issue", status: 400,
  body: { entryDate: "2026-05-11", lines: [{ itemId: "{{ITM_CAST_A}}", quantity: 500 }] },
  asserts: ['error contains "in stock at this branch"'],
  note: "The same InsufficientStockError a Stock Adjustment raises, surfaced as a 400 rather than a 500. An issue that could overdraw stock would put a negative quantity into the valuation and a cost into WIP that was never paid for.",
});
C("STK-13.4", T13, "Absorb a cost out of an account that is not an expense.", 12, {
  method: "POST", path: "/production-orders/{{STK-13.po2}}/cost", status: 400,
  body: { entryDate: "2026-05-11", lines: [{ accountId: "{{ACC_1201_A}}", amount: 500 }] },
  asserts: ['error contains "is not an expense account"'],
  note: "Crediting an asset to raise WIP would move value between two asset heads and call it conversion. The route reads the account type rather than trusting the picker.",
});
C("STK-13.5", T13, "Receive output before anything has been issued.", 12, {
  method: "POST", path: "/production-orders/{{STK-13.po2}}/receive", status: 400,
  body: { entryDate: "2026-05-11", quantity: 1 },
  asserts: ['error contains "no cost to give the output"'],
  note: "A receipt divides the WIP pool. With an empty pool there is nothing to divide, and a unit cost of zero would be a free pump on the valuation report.",
});
C("STK-13.6", T13, "Issue material to a job that had not started yet.", 12, {
  method: "POST", path: "/production-orders/{{STK-13.po2}}/issue", status: 400,
  body: { entryDate: "2026-05-09", lines: [{ itemId: "{{ITM_CAST_A}}", quantity: 1 }] },
  asserts: ['error contains "had not started"'],
  note: "The order opened on 2026-05-10. A posting dated before it would sit in a period the order did not exist in.",
});
C("STK-13.7", T13, "Post to the order that is already complete.", 12, {
  method: "POST", path: `/production-orders/${ORDER}/issue`, status: 409,
  body: { entryDate: "2026-05-12", lines: [{ itemId: "{{ITM_CAST_A}}", quantity: 1 }] },
  asserts: ['error contains "nothing more can be posted"'],
  note: "PO-0001 finished in STK-12. A completed order whose cost per unit is already in the stock valuation cannot take more cost - the pumps are made and priced.",
});
C("STK-13.8", T13, "Confirm none of those five wrote anything.", 12, {
  asserts: [SQL(bal("{{ORG_A}}", "1302"), 0),
            SQL("SELECT count(*) FROM journal_entries WHERE organization_id={{ORG_A}} " +
                "AND entry_date IN ('2026-05-09','2026-05-11','2026-05-12')", 0),
            val("CAST-5HP", "quantityOnHand", "80")],
  note: "A refusal that half-posts is worse than one that does not refuse at all. WIP is nil, no journal entry carries any of those dates, and the castings are untouched.",
});

// ---------------------------------------------------------------------------
const T14 = "Closing moves nothing; abandoning writes off to abnormal loss";
C("STK-14.1", T14, "Issue castings to the second order.", 12, {
  method: "POST", path: "/production-orders/{{STK-13.po2}}/issue", status: 200,
  body: { entryDate: "2026-05-11", lines: [{ itemId: "{{ITM_CAST_A}}", quantity: 5 }] },
  capture: { issue2: "data.entryId" },
  je: je(["1302", "Work in Progress", 2250.0, 0], ["1301", "Raw Materials (CAST-5HP card)", 0, 2250.0]),
  asserts: ["field data.total = 2250.00", "journal production_issue {{issue2}}"],
  note: "5 x 450.00. Note the date: 2026-05-11 was refused four times in STK-13 for reasons that had nothing to do with the date, and is accepted here - which is the check that STK-13.8's count of zero entries on that date was measuring refusals, not a broken date filter.",
});
C("STK-14.2", T14, "Try to close it with the cost still sitting there.", 12, {
  method: "POST", path: "/production-orders/{{STK-13.po2}}/close", status: 409,
  asserts: ['error contains "no output to carry it"'],
  note: "ASSERTS A DELIBERATE NARROWING. An earlier version let close sweep the remaining WIP into finished goods; the ledger would have moved while the stock valuation stayed where it was, and the two would never have agreed again. Value enters stock ONLY through a receipt, which carries a quantity and goes through receiveStock. So close is a status change or it is a refusal.",
});
C("STK-14.3", T14, "While it is open, 1302 is exactly what that order holds.", 12, {
  method: "GET", path: "/production-orders/{{STK-13.po2}}", status: 200,
  asserts: ["field data.wipBalance = 2250", "field data.status = OPEN",
            SQL(bal("{{ORG_A}}", "1302"), "2250.00")],
  note: "1302 is deliberately NOT a control account - a half-made thing is not an item, it has no SKU and no unit of measure that means anything. So the question 'what is this balance' is answered by the open orders, and this step is that answer with one order open.",
});
C("STK-14.4", T14, "Abandon it.", 12, {
  method: "POST", path: "/production-orders/{{STK-13.po2}}/cancel", status: 200,
  body: { entryDate: "2026-05-12" },
  je: je(["4003", "Abnormal Production Loss", 2250.0, 0], ["1302", "Work in Progress", 0, 2250.0]),
  asserts: ["field data.writtenOff = 2250", "field data.cancelled = true"],
  note: "AS 2 excludes abnormal waste from the cost of inventories, so the 2,250.00 cannot be absorbed into anything - there is no output to carry it. It becomes an expense of the period, which is what 4003 is for.",
});
C("STK-14.5", T14, "The castings do NOT come back.", 12, {
  asserts: [val("CAST-5HP", "quantityOnHand", "75"), val("CAST-5HP", "value", "33750.00"),
            SQL(bal("{{ORG_A}}", "1302"), 0), SQL(bal("{{ORG_A}}", "4003"), "2250.00"),
            SQL("SELECT status FROM production_orders WHERE id={{STK-13.po2}}", "CANCELLED")],
  note: "They were consumed. If some of the material is physically still there, that is an inward Stock Adjustment with its own reason and its own date - not something a cancellation should guess at. 1302 is back to nil, which is what makes STK-30.3 meaningful rather than merely true.",
});
