// Stock Management batch 3 - branch transfers, all in ORG-B.
//
// ORG-B exists for this. Its five branches were seeded with GSTINs and state
// codes chosen so that one organisation produces every case:
//
//   Chennai    33AAACW5678B1Z9  state 33   head office
//   Tiruppur   33AAACW5678B1Z9  state 33   SAME GSTIN - a second place of
//                                          business under one registration,
//                                          so a transfer to it is NOT a supply
//   Coimbatore 33AAACW5678B2Z8  state 33   different registration, same state
//                                          - taxable, CGST + SGST
//   Bengaluru  29AAACW5678B1Z5  state 29   different state - taxable, IGST
//   Hyderabad  36AAACW5678B1Z2  RESTRICTED - taxable transfers refused
//
// THE POINT OF THE WHOLE DESIGN is that a dispatch and a receipt are two
// events, not one. Goods that left on Monday and arrive on Thursday are at
// NEITHER branch in between, and 1304 Stock in Transit is where a balance
// sheet drawn on Wednesday says so. Every case here checks both ends and the
// middle.
//
// ORG-B is FIFO, so each item is laid down as ONE lot at a round rate. That
// is not tidiness: under FIFO the transfer cost is summed across lots at
// their own costs, and a second lot would make every figure below a quotient
// with four decimal places for no gain in what is being tested.

import { C, je, adj, L, val, SQL, CAP, bal, card } from "./stkPack.mjs";

const B = { login: "B" };
const cardB = (name, code) =>
  card("{{ORG_B}}", name) + " AND l.account_id IN " +
  `(SELECT id FROM accounts WHERE organization_id={{ORG_B}} AND account_code='${code}')`;
// Every GST head a transfer can touch, netted across the transfer documents
// only - ORG-B's purchase bill in batch 1 also debited 1102 and 1103, and
// this has to measure the transfers rather than the organisation.
const TRANSFER_GST =
  "SELECT round(coalesce(sum(l.debit-l.credit),0),2) FROM journal_lines l " +
  "JOIN journal_entries e ON e.id=l.journal_entry_id JOIN accounts a ON a.id=l.account_id " +
  "WHERE e.organization_id={{ORG_B}} AND e.reference_type LIKE 'stock_transfer%' " +
  "AND a.account_code IN ";

// ---------------------------------------------------------------------------
const T16 = "Stock and an invoice series, before anything can move";
C("STK-16.1", T16, "Bring four items into Chennai, one FIFO lot each.", 13, {
  ...B, method: "POST", path: "/stock-adjustments", status: 201,
  body: adj("2026-05-01", "{{BR_B_CHN}}", "Opening the transfer fixtures", [
    L("{{ITM_P1_B}}", "IN", 40, 1000), L("{{ITM_P2_B}}", "IN", 40, 1500),
    L("{{ITM_P3_B}}", "IN", 40, 2000), L("{{ITM_GSK_B}}", "IN", 100, 50)]),
  capture: { adjD: "data.id" },
  je: je(["1303", "Finished Goods (four item cards)", 185000.0, 0],
         ["4002", "Inventory Adjustments", 0, 185000.0]),
  asserts: ["journal stock_adjustment {{adjD}}", val("PUMP-P1", "quantityOnHand", "40"),
            val("PUMP-P3", "averageCost", "2000.00"), SQL(bal("{{ORG_B}}", "1303"), "185000.00")],
  note: "40,000 + 60,000 + 80,000 + 5,000 = 185,000.00. All four sit on 1303, so the journal folds to one debit - the per-item split is on the sub-ledger cards, which the cases below check individually. Nothing in this batch takes value out of the organisation, so 1303 must still read 185,000.00 at the end.",
});
C("STK-16.2", T16, "Configure the tax-invoice series for the sending branch.", 13, {
  ...B, method: "PUT", path: "/stock-transfers/series", status: 200,
  body: { branchId: "{{BR_B_CHN}}", prefix: "BT", financialYear: "2026-27" },
  asserts: ["field data.prefix = BT", "field data.nextNumber = 1"],
  note: "Rule 46(b) wants a consecutive serial number on a tax invoice, and there is no sensible number to invent - so a taxable transfer from a branch with no series is REFUSED rather than numbered arbitrarily. An untaxed transfer needs none of this: it moves under a delivery challan.",
});

// ---------------------------------------------------------------------------
const T17 = "Same GSTIN, so moving goods is not a supply";
C("STK-17.1", T17, "Dispatch 10 pumps from Chennai to Tiruppur.", 13, {
  ...B, method: "POST", path: "/stock-transfers", status: 201,
  body: { fromBranchId: "{{BR_B_CHN}}", toBranchId: "{{BR_B_TIR}}", transferDate: "2026-05-05",
          lines: [{ itemId: "{{ITM_P1_B}}", quantity: 10 }] },
  capture: { tr1: "data.id" },
  je: je(["1304", "Stock in Transit", 10000.0, 0], ["1303", "Finished Goods (PUMP-P1 card)", 0, 10000.0]),
  asserts: ["field data.taxTreatment = NONE", "field data.total = 10000.00",
            "field data.taxTotal = 0", "field data.documentNumber = null",
            "journal stock_transfer_dispatch {{tr1}}"],
  note: "Both branches carry 33AAACW5678B1Z9. One legal person moving its own goods between its own godowns is not a supply - Rule 55 delivery challan and nothing else. No invoice number, no tax, and documentNumber is null because none was needed.",
});
C("STK-17.2", T17, "Mid-transit: the goods are at neither branch.", 13, {
  ...B,
  asserts: [SQL(bal("{{ORG_B}}", "1304"), "10000.00"),
            SQL(cardB("Pump P1 (untaxed transfer)", "1303"), "30000.00"),
            val("PUMP-P1", "quantityOnHand", "30")],
  note: "THE REASON 1304 EXISTS. Chennai has given the goods up and Tiruppur has not got them, so on a balance sheet drawn today they are in transit - 10,000.00 of stock the organisation owns and no branch holds. The valuation report shows 30 because it counts what branches hold; the 10 in transit are on 1304 instead.",
});
C("STK-17.3", T17, "They arrive three days later.", 13, {
  ...B, method: "POST", path: "/stock-transfers/{{STK-17.tr1}}/receive", status: 200,
  body: { receivedDate: "2026-05-08" },
  je: je(["1303", "Finished Goods (PUMP-P1 card)", 10000.0, 0], ["1304", "Stock in Transit", 0, 10000.0]),
  asserts: ["field data.received = true", "field data.total = 10000.00", "field data.taxTotal = 0",
            "journal stock_transfer_receipt {{STK-17.tr1}}"],
  note: "ONE entry, because one registration keeps one trial balance. The receiving branch takes the goods at the SENDING branch's cost - nothing is revalued in transit, so a transfer can never create or destroy value.",
});
C("STK-17.4", T17, "Where the stock actually is now.", 13, {
  ...B, method: "GET", path: "/inventory/valuation?branchId={{BR_B_TIR}}", status: 200,
  asserts: ["field data.rows[item.sku=PUMP-P1].quantityOnHand = 10",
            "field data.rows[item.sku=PUMP-P1].value = 10000.00",
            SQL(bal("{{ORG_B}}", "1304"), 0), SQL(bal("{{ORG_B}}", "1303"), "185000.00")],
  note: "Ten at Tiruppur, thirty at Chennai, 1304 empty and 1303 unchanged at 185,000.00. Value moved between branches, not into or out of the business - which is exactly what an untaxed transfer is supposed to do to a ledger.",
});

// ---------------------------------------------------------------------------
const T18 = "Different registrations in the same state - taxable, CGST + SGST";
C("STK-18.1", T18, "Dispatch 10 pumps from Chennai to Coimbatore.", 14, {
  ...B, method: "POST", path: "/stock-transfers", status: 201,
  body: { fromBranchId: "{{BR_B_CHN}}", toBranchId: "{{BR_B_CBE}}", transferDate: "2026-05-10",
          lines: [{ itemId: "{{ITM_P3_B}}", quantity: 10 }] },
  capture: { tr2: "data.id" },
  je: je(["1304", "Stock in Transit", 20000.0, 0], ["1305", "Inter-Branch (Coimbatore)", 3600.0, 0],
         ["1303", "Finished Goods (PUMP-P3 card)", 0, 20000.0],
         ["2102", "CGST Output Payable", 0, 1800.0], ["2103", "SGST Output Payable", 0, 1800.0]),
  asserts: ["field data.taxTreatment = TAXABLE", "field data.total = 20000.00",
            "field data.taxTotal = 3600.00", "field data.documentNumber = BT",
            "journal stock_transfer_dispatch {{tr2}}"],
  note: "Section 25(4) makes two registrations DISTINCT PERSONS, and Schedule I paragraph 2 makes a supply between distinct persons taxable even with no consideration. So this needs a tax invoice, goes in Chennai's GSTR-1 as an outward supply, and carries 18% on the Rule 28 second-proviso value - which is cost, 20,000.00, giving 3,600.00 split CGST 1,800.00 / SGST 1,800.00 because both branches are in state 33. Note what 1305 carries at THIS point: the tax only. The cost half joins it when the goods land.",
});
C("STK-18.2", T18, "They arrive, and the receiving branch takes its credit.", 14, {
  ...B, method: "POST", path: "/stock-transfers/{{STK-18.tr2}}/receive", status: 200,
  body: { receivedDate: "2026-05-13" },
  je: je(["1303", "Finished Goods (PUMP-P3 card)", 20000.0, 0],
         ["1102", "CGST Input Credit", 1800.0, 0], ["1103", "SGST Input Credit", 1800.0, 0],
         ["2106", "Inter-Branch Payable (Chennai)", 0, 23600.0]),
  asserts: ["field data.received = true", "field data.taxTotal = 3600.00",
            "journal stock_transfer_receipt {{STK-18.tr2}}"],
  note: "Section 16(2)(b) is why the credit is taken HERE and not at dispatch: only receipt of the goods entitles it. Coimbatore owes Chennai the goods at cost plus the tax on them, 23,600.00, and that single figure is what sits on 2106.",
});
C("STK-18.3", T18, "And the sending branch's transit asset becomes a receivable.", 14, {
  ...B,
  je: je(["1305", "Inter-Branch (Coimbatore)", 20000.0, 0], ["1304", "Stock in Transit", 0, 20000.0]),
  asserts: ["journal stock_transfer_transit {{STK-18.tr2}}"],
  note: "A THIRD journal entry, on the sending branch, because two registrations keep two trial balances and neither may post to the other's accounts. Coimbatore's entry above cannot touch Chennai's 1304, so Chennai clears it itself. This is the entry that makes the taxable case three entries where the untaxed case is one.",
});
C("STK-18.4", T18, "The two sides of the inter-branch account agree.", 14, {
  ...B,
  asserts: [SQL(bal("{{ORG_B}}", "1304"), 0), SQL(bal("{{ORG_B}}", "1305"), "23600.00"),
            SQL(bal("{{ORG_B}}", "2106"), "-23600.00")],
  note: "1305 holds 3,600.00 of tax from the dispatch plus 20,000.00 of cost from the clearing entry. 2106 is the mirror. They are the same transaction seen from two registrations, and across the organisation they must cancel - which is what STK-25 checks once every transfer is done.",
});

// ---------------------------------------------------------------------------
const T19 = "Across a state line - the same rate, different heads";
C("STK-19.1", T19, "Dispatch 10 pumps from Chennai to Bengaluru.", 14, {
  ...B, method: "POST", path: "/stock-transfers", status: 201,
  body: { fromBranchId: "{{BR_B_CHN}}", toBranchId: "{{BR_B_BLR}}", transferDate: "2026-05-11",
          lines: [{ itemId: "{{ITM_P2_B}}", quantity: 10 }] },
  capture: { tr3: "data.id" },
  je: je(["1304", "Stock in Transit", 15000.0, 0], ["1305", "Inter-Branch (Bengaluru)", 2700.0, 0],
         ["1303", "Finished Goods (PUMP-P2 card)", 0, 15000.0],
         ["2104", "IGST Output Payable", 0, 2700.0]),
  asserts: ["field data.taxTreatment = TAXABLE", "field data.total = 15000.00",
            "field data.taxTotal = 2700.00", "journal stock_transfer_dispatch {{tr3}}"],
  note: "THE CASE THAT PROVES PLACE OF SUPPLY DRIVES THE HEADS. Same 18%, same kind of document, same clearing accounts - and the tax lands on 2104 IGST alone instead of splitting across CGST and SGST, because state 33 to state 29 is inter-state. Get this wrong and the money is right while the GSTR-1 is wrong, which is the harder error to find.",
});
C("STK-19.2", T19, "They arrive at Bengaluru.", 14, {
  ...B, method: "POST", path: "/stock-transfers/{{STK-19.tr3}}/receive", status: 200,
  body: { receivedDate: "2026-05-14" },
  je: je(["1303", "Finished Goods (PUMP-P2 card)", 15000.0, 0], ["1104", "IGST Input Credit", 2700.0, 0],
         ["2106", "Inter-Branch Payable (Chennai)", 0, 17700.0]),
  asserts: ["field data.received = true", "field data.taxTotal = 2700.00",
            "journal stock_transfer_receipt {{STK-19.tr3}}"],
  note: "IGST out at one registration is IGST in at the other. Bengaluru owes 15,000.00 + 2,700.00.",
});
C("STK-19.3", T19, "Chennai clears its transit asset for this one too.", 14, {
  ...B,
  je: je(["1305", "Inter-Branch (Bengaluru)", 15000.0, 0], ["1304", "Stock in Transit", 0, 15000.0]),
  asserts: ["journal stock_transfer_transit {{STK-19.tr3}}", SQL(bal("{{ORG_B}}", "1304"), 0)],
  note: "Two transfers received, and 1304 is empty again. It is only ever non-nil while something is genuinely on a lorry.",
});
C("STK-19.4", T19, "Check the GST landed on the right heads and nowhere else.", 14, {
  ...B,
  asserts: [SQL(TRANSFER_GST + "('2104')", "-2700.00"), SQL(TRANSFER_GST + "('1104')", "2700.00"),
            SQL(TRANSFER_GST + "('2102','2103')", "-3600.00"),
            SQL(TRANSFER_GST + "('1102','1103')", "3600.00")],
  note: "Filtered to stock_transfer entries on purpose: ORG-B's batch 1 purchase bill also debited 1102 and 1103, and this step is measuring the transfers rather than the organisation. IGST carries the Bengaluru transfer and only that; CGST and SGST carry Coimbatore's and only that.",
});

// ---------------------------------------------------------------------------
const T20 = "A dispatch cancelled while the goods are still in transit";
C("STK-20.1", T20, "Send 5 more pumps to Coimbatore.", 15, {
  ...B, method: "POST", path: "/stock-transfers", status: 201,
  body: { fromBranchId: "{{BR_B_CHN}}", toBranchId: "{{BR_B_CBE}}", transferDate: "2026-05-18",
          lines: [{ itemId: "{{ITM_P3_B}}", quantity: 5 }] },
  capture: { tr4: "data.id" },
  asserts: ["pre " + CAP(bal("{{ORG_B}}", "1305"), "b1305"),
            "pre " + CAP(cardB("Pump P3 (intra-state transfer)", "1303"), "b1303p3"),
            "field data.total = 10000.00", "field data.taxTotal = 1800.00",
            SQL(bal("{{ORG_B}}", "1304"), "10000.00")],
  note: "The two `pre` captures are what make the next-but-one step honest. They read 1305 and the PUMP-P3 card BEFORE this dispatch touches either, so 'back where it started' is asserted against what was actually there rather than against figures computed by hand - which is how STK-20.3 was wrong twice, once on each of them.",
});
C("STK-20.2", T20, "The lorry turns back.", 15, {
  ...B, method: "POST", path: "/stock-transfers/{{STK-20.tr4}}/cancel", status: 200,
  body: { entryDate: "2026-05-19" },
  je: je(["1303", "Finished Goods (PUMP-P3 card)", 10000.0, 0],
         ["2102", "CGST Output reversed", 900.0, 0], ["2103", "SGST Output reversed", 900.0, 0],
         ["1304", "Stock in Transit", 0, 10000.0],
         ["1305", "Inter-Branch (Coimbatore)", 0, 1800.0]),
  asserts: ["field data.cancelled = true", "field data.total = 10000.00",
            "field data.creditNoteNumber = CN-0001", "journal stock_transfer_cancel {{STK-20.tr4}}"],
  note: "The supply did not happen, so the output tax comes back out of the liability it was credited into and the receivable stops being recoverable. CN-0001 IS THE INTERESTING FIELD. A tax invoice was issued and numbered, and un-posting it silently is not something GST allows - section 34 undoes an issued invoice with a CREDIT NOTE, itself a numbered document that goes in Table 9B of the return for the month it is raised. The cancellation now allocates one, in the same updateMany as the status so the note and the cancellation it documents commit together. Counted per organisation like SalesReturn.returnNumber, so there is no series to configure and a cancellation can never be refused because nobody set a prefix up.",
});
C("STK-20.3", T20, "Everything is back where it started.", 15, {
  ...B,
  asserts: [SQL(bal("{{ORG_B}}", "1304"), 0), SQL(bal("{{ORG_B}}", "1305"), "{{b1305}}"),
            SQL(cardB("Pump P3 (intra-state transfer)", "1303"), "{{b1303p3}}"),
            val("PUMP-P3", "quantityOnHand", "40"),
            SQL("SELECT status FROM stock_transfers WHERE id={{STK-20.tr4}}", "CANCELLED")],
  note: "MEASURED, NOT ASSERTED AS A CONSTANT, and this step earned that the hard way - it was wrong twice, on two different constants, while the software was right both times. 1305 was said to be 23,600.00, the Coimbatore transfer's own mark on it; the Bengaluru transfer had added 2,700.00 of tax and 15,000.00 of cost in between, so 41,300.00 was correct. The PUMP-P3 card was said to be 60,000.00, which assumed the card holds what CHENNAI has; it does not. 1303 carries one card per ITEM, not per item per branch, so the 20,000.00 that went to Coimbatore came straight back onto the same card when it arrived, and all 40 pumps sit there at 80,000.00 wherever they physically are. That is the same fact STK-25.4 depends on when it says 1303 is still 185,000.00. Reading both figures before the dispatch and requiring them back after the cancellation asks what the case actually means - did this document leave any trace - and cannot be wrong about a number I did not have to work out.",
});

// ---------------------------------------------------------------------------
const T22 = "A cancellation in the month AFTER the dispatch";
C("STK-22.1", T22, "Dispatch 4 pumps to Coimbatore near the end of May.", 15, {
  ...B, method: "POST", path: "/stock-transfers", status: 201,
  body: { fromBranchId: "{{BR_B_CHN}}", toBranchId: "{{BR_B_CBE}}", transferDate: "2026-05-28",
          lines: [{ itemId: "{{ITM_P1_B}}", quantity: 4 }] },
  capture: { tr6: "data.id" },
  asserts: ["field data.total = 4000.00", "field data.taxTotal = 720.00",
            "field data.documentNumber = BT"],
  note: "4 x 1,000.00 with CGST 360.00 and SGST 360.00. The point of this one is the calendar: the invoice is a May document and the credit note will be a June one.",
});
C("STK-22.2", T22, "Cancel it in June.", 15, {
  ...B, method: "POST", path: "/stock-transfers/{{STK-22.tr6}}/cancel", status: 200,
  body: { entryDate: "2026-06-03" },
  asserts: ["field data.cancelled = true", "field data.creditNoteNumber = CN-0002",
            "field data.total = 4000.00", SQL(bal("{{ORG_B}}", "1304"), 0)],
  note: "THE CASE THE TIMING RULE EXISTS FOR, and the one every figure in batch 4 was blind to before it. A supply was made and invoiced in May; it is credited in June. Section 34 does not un-happen the May supply - it credits it in the period the note is raised. So May declares 4,000.00 of outward supply the group never actually completed, June reverses it, and only across the two months does it come to nothing. The old treatment dropped a cancelled transfer from every period at once, which is arithmetically identical while both dates sit in one month and understates the dispatch month by a whole invoice when they do not.",
});

// ---------------------------------------------------------------------------
const T21 = "What a transfer refuses";
C("STK-21.1", T21, "Cancel one that has already been received.", 15, {
  ...B, method: "POST", path: "/stock-transfers/{{STK-18.tr2}}/cancel", status: 409,
  asserts: ['error contains "Send the goods back with a transfer the other way"'],
  note: "Coimbatore is holding those pumps. Cancelling now would take stock off a branch that has it and put it back on one that does not - inventing 10 pumps at Chennai and destroying 10 at Coimbatore. The way back is another transfer, which is a document somebody signs.",
});
C("STK-21.2", T21, "Send goods to a branch that cannot claim full input credit.", 15, {
  ...B, method: "POST", path: "/stock-transfers", status: 400,
  body: { fromBranchId: "{{BR_B_CHN}}", toBranchId: "{{BR_B_HYD}}", transferDate: "2026-05-20",
          lines: [{ itemId: "{{ITM_P1_B}}", quantity: 1 }] },
  asserts: ['error contains "cannot claim full input tax credit"'],
  note: "Hyderabad is RESTRICTED. Without full ITC at the receiving end the second proviso to Rule 28 is unavailable, the tax stops being revenue-neutral and becomes a COST that AS 2 requires be capitalised into that branch's inventory. That is a different design, not a different number - so it is refused rather than posted on an assumption that is wrong for this branch.",
});
C("STK-21.3", T21, "Put an item with no HSN on a TAXABLE transfer.", 15, {
  ...B, method: "POST", path: "/stock-transfers", status: 400,
  body: { fromBranchId: "{{BR_B_CHN}}", toBranchId: "{{BR_B_CBE}}", transferDate: "2026-05-20",
          lines: [{ itemId: "{{ITM_GSK_B}}", quantity: 5 }] },
  asserts: ['error contains "no HSN code"'],
  note: "Rule 46(g) needs the HSN on the face of the invoice and the NIC portal rejects an e-way bill without one. Caught here rather than at the portal, after the lorry has left.",
});
C("STK-21.4", T21, "The SAME item on an UNTAXED transfer is fine.", 15, {
  ...B, method: "POST", path: "/stock-transfers", status: 201,
  body: { fromBranchId: "{{BR_B_CHN}}", toBranchId: "{{BR_B_TIR}}", transferDate: "2026-05-20",
          lines: [{ itemId: "{{ITM_GSK_B}}", quantity: 20 }] },
  capture: { tr5: "data.id" },
  asserts: ["field data.taxTreatment = NONE", "field data.total = 1000.00"],
  note: "THE PAIR IS THE TEST. The same item, the same day, the same organisation - refused one way and accepted the other, because the HSN is needed for an INVOICE and a delivery challan is not one. A blanket 'items need an HSN' rule would have blocked this legitimate movement, and a blanket 'never mind' would have let the invoice through.",
});
C("STK-21.5", T21, "Send goods from a branch to itself.", 15, {
  ...B, method: "POST", path: "/stock-transfers", status: 400,
  body: { fromBranchId: "{{BR_B_CHN}}", toBranchId: "{{BR_B_CHN}}", transferDate: "2026-05-20",
          lines: [{ itemId: "{{ITM_P1_B}}", quantity: 1 }] },
  asserts: ['error contains "must be different"'],
});
C("STK-21.6", T21, "Confirm the three refusals wrote nothing.", 15, {
  ...B,
  asserts: [SQL("SELECT count(*) FROM stock_transfers WHERE organization_id={{ORG_B}} " +
                "AND transfer_date='2026-05-20'", 1),
            val("PUMP-P1", "quantityOnHand", "40")],
  note: "One transfer dated 2026-05-20 - the gasket challan that was supposed to succeed - and not one of the three refusals left a row behind. PUMP-P1 is untouched at 40, so the Hyderabad and self-transfer attempts consumed nothing.",
});
C("STK-21.7", T21, "Receive the gasket challan, so nothing is left in transit.", 15, {
  ...B, method: "POST", path: "/stock-transfers/{{STK-21.tr5}}/receive", status: 200,
  body: { receivedDate: "2026-05-21" },
  asserts: ["field data.received = true", SQL(bal("{{ORG_B}}", "1304"), 0)],
});

// ---------------------------------------------------------------------------
const T25 = "The reconciliation this clearing design exists to make checkable";
C("STK-25.1", T25, "Ask the transfer reconciliation where things stand.", 16, {
  ...B, method: "GET", path: "/stock-transfers/reconciliation?asOf=2026-06-30", status: 200,
  asserts: ["field data.balanced = true", "field data.difference = 0",
            "field data.expected = 0", "field count(data.inTransit) = 0"],
  note: "30 June rather than 31 May, and the date matters: STK-22 dispatched on 28 May and was not cancelled until 3 June, so on 31 May it was genuinely still in transit and this report would rightly have said so. Nothing is on a lorry by the end of June, so the clearing accounts must net to nil. The endpoint states the identity and reports the parts alongside it, so a break can be read straight off rather than recomputed by hand.",
});
C("STK-25.2", T25, "Ask it again as at a date when goods WERE in transit.", 16, {
  ...B, method: "GET", path: "/stock-transfers/reconciliation?asOf=2026-05-06", status: 200,
  asserts: ["field count(data.inTransit) = 1",
            "field data.inTransit[0].transferNumber = TR-0001",
            "field data.inTransit[0].cost = 10000",
            "field data.inTransit[0].status = RECEIVED",
            "field data.accounts.transit = 10000", "field data.expected = 10000",
            "field data.balanced = true"],
  note: "THE HALF THAT MAKES IT A TEST. A reconciliation that only ever reports nil proves nothing. On 6 May the Tiruppur transfer had left and not arrived, so it must appear - and it appears with status RECEIVED, because the status is what the transfer is NOW while the question was about THEN. That distinction is the difference between a report you can hand an auditor and one you cannot. AND IT STILL BALANCES: both sides are scoped to the date, the ledger by entryDate <= asOf and the expected figure by which transfers had left and not arrived. A control scoped on one side only would read 'balanced' today and nonsense for every historical date, which is precisely when somebody asks it.",
});
C("STK-25.3", T25, "As at a date when TWO taxable transfers were mid-flight.", 16, {
  ...B, method: "GET", path: "/stock-transfers/reconciliation?asOf=2026-05-12", status: 200,
  asserts: ["field count(data.inTransit) = 2", "field data.accounts.transit = 35000",
            "field data.accounts.receivable = 6300", "field data.accounts.payable = 0",
            "field data.expected = 41300", "field data.difference = 0",
            "field data.balanced = true"],
  note: "The hardest date to be right about. On 12 May the Coimbatore and Bengaluru transfers had both left and neither had arrived, so 1304 holds their cost, 35,000.00, and 1305 holds their TAX ALONE, 3,600.00 + 2,700.00 = 6,300.00 - the cost half has not joined it yet because that happens on receipt. 2106 is still nil because neither receiving branch has taken anything. 35,000 + 6,300 + 0 = 41,300.00, and the two invoice values are 23,600.00 and 17,700.00, which is the same 41,300.00. Three accounts, two transfers, one identity, and it has to hold on a date in the middle of both.",
});
C("STK-25.4", T25, "The inter-branch accounts cancel across the organisation.", 16, {
  ...B,
  asserts: [SQL(bal("{{ORG_B}}", "1304"), 0),
            SQL("SELECT round(coalesce(sum(l.debit-l.credit),0),2) FROM journal_lines l " +
                "JOIN journal_entries e ON e.id=l.journal_entry_id JOIN accounts a ON a.id=l.account_id " +
                "WHERE e.organization_id={{ORG_B}} AND a.account_code IN ('1305','2106')", 0),
            SQL(TRANSFER_GST + "('1102','1103','1104','2102','2103','2104')", 0),
            SQL(bal("{{ORG_B}}", "1303"), "185000.00")],
  note: "Four identities, and every one of them has to hold at once. 1304 nil because nothing is in transit. 1305 and 2106 cancel because they are one transaction seen from two registrations. The GST on transfers nets to nil across the organisation - which is what 'revenue-neutral' means in ledger terms, and the whole reason the second proviso to Rule 28 lets cost be the value. And 1303 is still 185,000.00: four branches now hold the goods instead of one, and not a rupee entered or left the business.",
});
