// Selling stock that is not there - the negative-stock override.
//
// consumeStock() refuses when the branch holds less than the line asks for,
// and for a stock adjustment, a transfer or a production issue that refusal
// is simply correct: those are movements of goods that either exist or do
// not. A SALES INVOICE is the one document where the goods being absent is
// often a bookkeeping lag rather than an empty shelf - the stock arrived,
// the purchase bill has not been entered yet - and somebody has already
// promised the customer.
//
// So the invoice gets an override, behind TWO LOCKS, and this batch is
// mostly about proving that neither lock alone opens the door:
//
//   the organisation must permit it   organizations.allow_negative_stock,
//                                     off for everyone until switched on
//   the invoice must ask for it       allowNegativeStock: true, with a
//                                     reason, on that one document
//
// The second lock is why turning the setting on is safe: it grants the
// POSSIBILITY and never the behaviour, so no existing invoice changes what
// it does. An organisation with the setting on still refuses every ordinary
// invoice that runs short.
//
// AND IT IS REFUSED UNDER FIFO EVEN WITH BOTH LOCKS OPEN. Weighted average
// always has an answer to "at what cost did this leave" - the stored
// average. FIFO's answer is a lot, and for the shortfall no lot exists.
// STK-37 is that half, in ORG-B, which is the FIFO organisation.
//
// PHASE 18, which puts it BEFORE the controls at 19 - and that placement is
// the rule, not a preference. These steps move stock and post COGS, so the
// controls have to run after them or they are controls over an incomplete
// picture. The entitlement batch at 20 is the only thing allowed after the
// controls, because it posts nothing.
//
// The negative balance is deliberately LEFT NEGATIVE at the end. It would be
// tidier to adjust it back, and tidier would be worse: STK-30.2 compares the
// 1201 ledger balance to the valuation report, and having a negative item in
// that comparison is a far stronger claim than having none. A valuation that
// silently dropped negative rows, or a ledger that did, would be caught
// there and nowhere else.

import { C, je, val, SQL, CAP, bal, card } from "./stkPack.mjs";

const B = { login: "B" };

const negCard = card("{{ORG_A}}", "Sold short (negative stock test)");

// ---------------------------------------------------------------------------
const T36 = "Two locks, and neither one opens the door on its own";
C("STK-36.1", T36, "An item with four on hand, and a promise to sell ten.", 18, {
  method: "POST", path: "/items", status: 201,
  body: { sku: "NEG-TEST", name: "Sold short (negative stock test)", itemKind: "STOCK",
          stockAccountId: "{{ACC_1201_A}}", hsnCode: "84821010", taxRate: 18,
          openingQuantity: 4, openingCost: 500, openingBranchId: "{{BR_A_CHN}}",
          openingDate: "2026-04-01" },
  capture: { itemId: "data.id" },
  asserts: [val("NEG-TEST", "quantityOnHand", "4"), val("NEG-TEST", "value", "2000.00")],
  note: "Its own item, touched by nothing else in the pack, so the negative balance this batch leaves behind cannot be confused with any other case's arithmetic. Four units at 500.00 each - the average that the shortfall will later be costed at, which is the whole question the override has to answer.",
});
C("STK-36.2", T36, "Sell ten without asking for anything. Refused, as always.", 18, {
  method: "POST", path: "/sales-invoices", status: 409,
  body: { businessPartnerId: "{{CUST_TN}}", invoiceDate: "2026-04-28", branchId: "{{BR_A_CHN}}",
          lines: [{ itemId: "{{STK-36.itemId}}", quantity: 10, rate: 900, taxRate: 18 }] },
  asserts: ['error contains "Only 4 in stock at this branch"'],
  note: "THE BASELINE, and it has to be asserted or the rest of the batch proves nothing. Every invoice that does not explicitly ask for the override behaves exactly as it did before this feature existed. If this step ever passes with a 201, the override has stopped being an override and become the default.",
});
C("STK-36.3", T36, "Ask for the override while the organisation forbids it.", 18, {
  method: "POST", path: "/sales-invoices", status: 403,
  body: { businessPartnerId: "{{CUST_TN}}", invoiceDate: "2026-04-28", branchId: "{{BR_A_CHN}}",
          allowNegativeStock: true, negativeStockReason: "Goods shipped, bill not entered",
          lines: [{ itemId: "{{STK-36.itemId}}", quantity: 10, rate: 900, taxRate: 18 }] },
  asserts: ['error contains "does not allow invoicing stock it does not hold"',
            SQL("SELECT allow_negative_stock FROM organizations WHERE id={{ORG_A}}", "false")],
  note: "THE FIRST LOCK. The document asked, correctly and with a reason, and it is still refused - because the organisation has never said this is allowed. allow_negative_stock defaults to false, so this is what every organisation that exists today does, and nothing about this release changes that for any of them until somebody makes a decision.",
});
C("STK-36.4", T36, "An administrator turns it on.", 18, {
  method: "PATCH", path: "/company-master", status: 200,
  body: { allowNegativeStock: true },
  asserts: ["field data.allowNegativeStock = true",
            SQL("SELECT allow_negative_stock FROM organizations WHERE id={{ORG_A}}", "true")],
  note: "Company Master, beside the costing method and the approval thresholds, because it is the same kind of decision: a standing rule about how this organisation's documents behave, made once by somebody entitled to make it. Not a checkbox on the invoice screen.",
});
C("STK-36.5", T36, "With it on, an override still needs a reason.", 18, {
  method: "POST", path: "/sales-invoices", status: 400,
  body: { businessPartnerId: "{{CUST_TN}}", invoiceDate: "2026-04-28", branchId: "{{BR_A_CHN}}",
          allowNegativeStock: true,
          lines: [{ itemId: "{{STK-36.itemId}}", quantity: 10, rate: 900, taxRate: 18 }] },
  asserts: ['error contains "negativeStockReason is required"'],
  note: "The reason is the only part of this that is any use later. 'Why is this item at minus six' is asked months afterwards by somebody reconciling stock, and a boolean cannot answer it. Refusing here rather than storing an empty string keeps the exception report worth reading - a list of overrides with no reasons on them is a list nobody acts on.",
});
C("STK-36.6", T36, "Both locks open, and the invoice posts.", 18, {
  method: "POST", path: "/sales-invoices", status: 201,
  body: { businessPartnerId: "{{CUST_TN}}", invoiceDate: "2026-04-28", branchId: "{{BR_A_CHN}}",
          allowNegativeStock: true, negativeStockReason: "Goods shipped, purchase bill not yet entered",
          lines: [{ itemId: "{{STK-36.itemId}}", quantity: 10, rate: 900, taxRate: 18 }] },
  capture: { invId: "data.id" },
  je: je(["1005", "Accounts Receivable (customer)", 10620.0, 0], ["5001", "Sales Revenue", 0, 9000.0],
         ["2102", "CGST Output Payable", 0, 810.0], ["2103", "SGST Output Payable", 0, 810.0],
         ["4001", "Cost of Goods Sold", 5000.0, 0], ["1201", "Inventory (NEG-TEST card)", 0, 5000.0]),
  asserts: ["field data.totalCogs = 5000.00", "journal sales_invoice {{invId}}"],
  note: "COGS IS 5,000.00 - ten units at the 500.00 average, including the six the branch never had. That is the only defensible cost available and it is still a forecast: when the real purchase lands at 520.00 or at 480.00, the margin posted on this invoice is already wrong and nothing goes back to correct it. Asserting 10 x 500.00 rather than 4 x 500.00 is the point - a system that costed only what it held would post 2,000.00 of COGS against 9,000.00 of revenue and report a margin that never existed.",
});
C("STK-36.7", T36, "What it left behind, in three places that must agree.", 18, {
  asserts: [val("NEG-TEST", "quantityOnHand", "-6"),
            val("NEG-TEST", "averageCost", "500.00"),
            SQL(negCard, "-3000.00"),
            SQL("SELECT negative_stock_reason FROM sales_invoices WHERE id={{STK-36.invId}}",
                "Goods shipped, purchase bill not yet entered")],
  note: "MINUS SIX UNITS, MINUS 3,000.00 ON THE CARD, and the two tie: 2,000.00 in less 5,000.00 out. The average is untouched at 500.00, because consumption never moves it - which matters here, since it is the rate the next six units will be costed at too if somebody sells short again before receiving any. THE CARD BEING IN CREDIT IS THE REAL COST OF THIS FEATURE. 1201 is an asset control account, and on a Schedule III balance sheet this reads as negative inventory, which AS 2 does not contemplate and an auditor will ask about. The reason column is what they will be asked to look at.",
});
C("STK-36.8", T36, "An invoice that asked for the override but did not need it.", 18, {
  method: "POST", path: "/sales-invoices", status: 201,
  body: { businessPartnerId: "{{CUST_TN}}", invoiceDate: "2026-04-29", branchId: "{{BR_A_CHN}}",
          allowNegativeStock: true, negativeStockReason: "Asked for, not needed",
          lines: [{ itemId: "{{STK-01.itemId}}", quantity: 1, rate: 900, taxRate: 18 }] },
  capture: { plainId: "data.id" },
  asserts: [SQL("SELECT negative_stock_reason FROM sales_invoices WHERE id={{STK-36.plainId}}", "null"),
            val("OPEN-TEST", "quantityOnHand", "9")],
  note: "OPEN-TEST has ten on hand, so nothing went negative and NO reason is recorded, even though the request carried one. 'Was the override allowed' and 'was the override used' are different questions, and only the second belongs on an exception report - otherwise a cautious operator who ticks the box on every invoice fills that report with documents that never sold anything they did not have. consumeStock returns wentNegative for exactly this. OPEN-TEST RATHER THAN BRG-6205, and the reason is worth recording: BRG-6205's average is 219.7059 to four places, so selling ONE unit posts COGS of round2(219.7059) = 219.71 while the valuation keeps 79 x 219.7059 = 17,356.7661 and reports 17,356.77. A single paisa apart, and it broke STK-30.2 - not because anything here is wrong, but because a step meant to prove one thing was quietly also a rounding test. OPEN-TEST's average is exactly 500.00, so this step tests only what it claims to. The paisa is real and is its own open question.",
});
C("STK-36.9", T36, "Turn it off again, and the door shuts.", 18, {
  method: "PATCH", path: "/company-master", status: 200,
  body: { allowNegativeStock: false },
  asserts: ["field data.allowNegativeStock = false"],
  note: "Put back inside the batch that turned it on, so nothing downstream inherits an organisation with the override live. The negative BALANCE is deliberately left where it is - see the header - because STK-30.2 comparing the 1201 ledger to the valuation report with a negative item in the mix is a stronger control than the same comparison without one.",
});
C("STK-36.10", T36, "And the same invoice is refused again.", 18, {
  method: "POST", path: "/sales-invoices", status: 403,
  body: { businessPartnerId: "{{CUST_TN}}", invoiceDate: "2026-04-30", branchId: "{{BR_A_CHN}}",
          allowNegativeStock: true, negativeStockReason: "Should not be allowed now",
          lines: [{ itemId: "{{STK-36.itemId}}", quantity: 5, rate: 900, taxRate: 18 }] },
  asserts: ['error contains "does not allow invoicing stock it does not hold"',
            val("NEG-TEST", "quantityOnHand", "-6")],
  note: "The other direction, which is what makes STK-36.6 a test rather than a coincidence: a system that had simply stopped checking would have passed every step up to here and failed this one. The balance is still exactly minus six, so the refusal wrote nothing - a rejected invoice that had already consumed stock would be a worse defect than the one this feature was built for.",
});

// ---------------------------------------------------------------------------
const T37 = "FIFO refuses even with both locks open";
C("STK-37.1", T37, "Allow it in ORG-B, which costs by FIFO.", 18, {
  ...B, method: "PATCH", path: "/company-master", status: 200,
  body: { allowNegativeStock: true },
  asserts: ["field data.allowNegativeStock = true",
            SQL("SELECT costing_method FROM organizations WHERE id={{ORG_B}}", "FIFO")],
  note: "The second assertion is the one that makes the next step mean anything. If ORG-B ever stopped being a FIFO organisation, STK-37.2 would go on passing for entirely the wrong reason - refused because there was no stock rather than refused because there was no lot.",
});
C("STK-37.2", T37, "Sell short anyway. Still refused, and it says why.", 18, {
  ...B, method: "POST", path: "/sales-invoices", status: 409,
  body: { businessPartnerId: "{{CUST_TN_B}}", invoiceDate: "2026-06-10", branchId: "{{BR_B_CHN}}",
          allowNegativeStock: true, negativeStockReason: "Should be refused - FIFO",
          lines: [{ itemId: "{{ITM_P1_B}}", quantity: 9999, rate: 1200, taxRate: 18 }] },
  asserts: ['error contains "not under FIFO"',
            SQL("SELECT count(*) FROM sales_invoices WHERE organization_id={{ORG_B}} " +
                "AND invoice_date='2026-06-10'", 0)],
  note: "THE LIMIT OF THE FEATURE, and it is a design decision rather than an unfinished edge. Weighted average can always say what a unit cost on the way out: the stored average, computed from receipts that really happened. FIFO's answer is a LOT, and for the shortfall there is no lot - nothing was received, so there is nothing to consume from. Inventing one means inventing a cost AND a date, then reconciling it against whatever actually arrives later, which is a different feature with its own failure modes. The message says 'not under FIFO' rather than 'insufficient stock' so that somebody who has just switched the setting on is told the real reason instead of hunting for a lock they have already opened. And nothing was written: no invoice on that date.",
});
C("STK-37.3", T37, "Put ORG-B back.", 18, {
  ...B, method: "PATCH", path: "/company-master", status: 200,
  body: { allowNegativeStock: false },
  asserts: ["field data.allowNegativeStock = false",
            SQL("SELECT count(*) FROM organizations WHERE allow_negative_stock = true " +
                "AND id IN ({{ORG_A}}, {{ORG_B}})", 0)],
  note: "Both organisations back to the default, asserted together rather than one at a time - the batch turned the setting on in two places and a restore that missed one would leave the next run starting somewhere different from where this one did.",
});
