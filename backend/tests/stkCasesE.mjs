// Stock Management batch 4 - the GST returns, in ORG-B.
//
// Batch 3 proved the branch transfers are right IN THE LEDGER. This asks the
// separate question: do they appear correctly ON A RETURN. Those are not the
// same test and a system can pass one while failing the other - a transfer
// posted to the correct accounts with the tax under the wrong head, or filed
// against the wrong GSTIN, has a ledger that balances and a GSTR-1 that is
// wrong. The money is right and the filing is not, which is the harder error
// to find and the more expensive one to have.
//
// EVERY FIGURE HERE IS ALREADY KNOWN, because batch 3 put it there:
//
//   TR-0002  10-May  Chennai to Coimbatore  20,000.00  CGST 1,800 + SGST 1,800
//   TR-0003  11-May  Chennai to Bengaluru   15,000.00  IGST 2,700
//   TR-0004  18-May  Chennai to Coimbatore  10,000.00  CGST   900 + SGST   900
//                    cancelled 19-May, CREDIT NOTE CN-0001, also May
//   TR-0006  28-May  Chennai to Coimbatore   4,000.00  CGST   360 + SGST   360
//                    cancelled 03-Jun, CREDIT NOTE CN-0002, a JUNE document
//   TR-0001  05-May  Chennai to Tiruppur    10,000.00  untaxed, one GSTIN
//   TR-0005  20-May  Chennai to Tiruppur     1,000.00  untaxed, one GSTIN
//
// So May is a transfers-only month for ORG-B: its purchase bill and its sales
// invoice are both dated April, and June holds nothing at all but one credit
// note. That is what makes these figures readable - every rupee in the May
// return came from a branch transfer, and nothing else is mixed in to explain
// away a discrepancy.
//
// THE TWO CANCELLATIONS ARE THE POINT OF THE BATCH. Section 34 does not
// un-happen a supply that was invoiced; it credits it, in the period the note
// was raised. TR-0004's invoice and note are both May, so the two net inside
// one return and it reads as it always did. TR-0006's straddle the month end,
// and that is the case every figure below was blind to before: May must
// declare a supply the group never completed, and June must reverse it.

import { C, je, adj, L, val, SQL, CAP, bal, card } from "./stkPack.mjs";

const B = { login: "B" };
const MAY = "from=2026-05-01&to=2026-05-31";
const JUN = "from=2026-06-01&to=2026-06-30";
const BOTH = "from=2026-05-01&to=2026-06-30";
const APR = "from=2026-04-01&to=2026-04-30";
const CBE_GSTIN = "33AAACW5678B2Z8";
const BLR_GSTIN = "29AAACW5678B1Z5";

// ---------------------------------------------------------------------------
const T26 = "A branch transfer is an ordinary B2B supply on the sender's GSTR-1";
C("STK-26.1", T26, "Ask for Chennai's GSTR-1 for May.", 17, {
  ...B, method: "GET", path: `/gst/gstr1?${MAY}&branchId={{BR_B_CHN}}`, status: 200,
  asserts: ["field count(data.b2b) = 4", "field count(data.b2c) = 0",
            "field count(data.exports) = 0",
            "field data.totals.taxableValue = 49000.00",
            "field data.totals.cgst = 3060.00", "field data.totals.sgst = 3060.00",
            "field data.totals.igst = 2700.00",
            "field data.totals.invoiceValue = 57820.00"],
  note: "The GSTN has no 'branch transfer' category. Section 25(4) makes two registrations distinct persons, so these are ordinary Table 4A B2B supplies against the receiving branch's GSTIN - which is precisely what lets that branch's GSTR-2B pick them up and match the credit. FOUR rows, not two: every taxable invoice ISSUED in May is here, the two that were later cancelled included, because each was undone by a credit note rather than by pretending it never existed. 20,000 + 15,000 + 10,000 + 4,000 = 49,000.00. The untaxed challans are not supplies and are not here. invoiceValue is the gross of the same four documents, 57,820.00 - it is built from the transfers actually pushed into 4A, so it cannot drift away from the taxable value it is meant to summarise.",
});
C("STK-26.2", T26, "Check each row names the right registration and place of supply.", 17, {
  ...B, method: "GET", path: `/gst/gstr1?${MAY}&branchId={{BR_B_CHN}}`, status: 200,
  asserts: [`field count(data.b2b[gstin=${CBE_GSTIN}]) = 3`,
            `field sum(data.b2b[gstin=${CBE_GSTIN}].taxableValue) = 34000.00`,
            `field sum(data.b2b[gstin=${CBE_GSTIN}].cgst) = 3060.00`,
            `field sum(data.b2b[gstin=${CBE_GSTIN}].sgst) = 3060.00`,
            `field sum(data.b2b[gstin=${CBE_GSTIN}].igst) = 0`,
            `field sum(data.b2b[gstin=${CBE_GSTIN}].invoiceValue) = 40120.00`,
            `field distinct(data.b2b[gstin=${CBE_GSTIN}].placeOfSupply) = 1`,
            "field sum(data.b2b[placeOfSupply=33].taxableValue) = 34000.00",
            "field sum(data.b2b[placeOfSupply=29].taxableValue) = 15000.00",
            `field data.b2b[gstin=${BLR_GSTIN}].taxableValue = 15000.00`,
            `field data.b2b[gstin=${BLR_GSTIN}].igst = 2700.00`,
            `field data.b2b[gstin=${BLR_GSTIN}].cgst = 0`,
            `field data.b2b[gstin=${BLR_GSTIN}].placeOfSupply = 29`,
            `field data.b2b[gstin=${BLR_GSTIN}].invoiceValue = 17700.00`],
  note: "THE FILING HALF OF THE CASE BATCH 3 PROVED IN THE LEDGER. Same 18%, and the return has to put Coimbatore's under CGST+SGST with place of supply 33 and Bengaluru's under IGST with place of supply 29. A system that posted both to the right accounts but filed both against one GSTIN, or with one place of supply, would balance perfectly and file wrongly. SUMMED RATHER THAN LOOKED UP, and that is not cosmetic: three of the four invoices now go to Coimbatore, and a selector that finds a row by GSTIN alone returns whichever it meets first. The old assertions would have gone on passing against one row out of three and said nothing about the other two. The place-of-supply pair asserts the grouping straight against the money instead of trusting a label on a single row.",
});
C("STK-26.3", T26, "The HSN summary reconciles to the supply tables.", 17, {
  ...B, method: "GET", path: `/gst/gstr1?${MAY}&branchId={{BR_B_CHN}}`, status: 200,
  asserts: ["field count(data.hsn) = 1", "field data.hsn[0].hsnCode = 84137010",
            "field data.hsn[0].rate = 18", "field data.hsn[0].quantity = 29",
            "field data.hsn[0].taxableValue = 49000.00",
            "field data.hsn[0].cgst = 3060.00", "field data.hsn[0].igst = 2700.00"],
  note: "PUMP-P1, PUMP-P2 and PUMP-P3 all share HSN 84137010 at 18%, so table 12 folds them into ONE row - 10 + 10 + 5 + 4 = 29 units, 49,000.00, and the tax split preserved across the two states. That figure has to equal totals.taxableValue from STK-26.1, and it does. Two sheets of one return that do not reconcile is the first thing a portal rejects, and the credit-note change is exactly the kind of change that could have broken it: the HSN row is written inside the same line loop that decides whether a supply counts, so a transfer added to one and not the other is a one-line mistake.",
});
C("STK-26.4", T26, "The RECEIVING branch's GSTR-1 shows none of it.", 17, {
  ...B, method: "GET", path: `/gst/gstr1?${MAY}&branchId={{BR_B_CBE}}`, status: 200,
  asserts: ["field count(data.b2b) = 0", "field data.totals.taxableValue = 0",
            "field data.totals.cgst = 0"],
  note: "A GSTR-1 is a return of OUTWARD supplies, and Coimbatore made none. The same transfer reaches it as an inward supply in its GSTR-2B, from the sender's filing. If it appeared in both, one movement of goods would be declared as a supply twice.",
});

// ---------------------------------------------------------------------------
const T27 = "The credit note that undoes a cancelled invoice";
C("STK-27.1", T27, "May's Table 9B carries CN-0001, against the invoice it reverses.", 17, {
  ...B, method: "GET", path: `/gst/gstr1?${MAY}&branchId={{BR_B_CHN}}`, status: 200,
  asserts: ["field count(data.creditNotes) = 1",
            "field data.creditNotes[0].noteNumber = CN-0001",
            "field data.creditNotes[0].noteDate = 2026-05-19",
            "field data.creditNotes[0].originalInvoiceNumber = BT",
            `field data.creditNotes[0].gstin = ${CBE_GSTIN}`,
            "field data.creditNotes[0].placeOfSupply = 33",
            "field data.creditNotes[0].rate = 18",
            "field data.creditNotes[0].taxableValue = 10000.00",
            "field data.creditNotes[0].cgst = 900.00",
            "field data.creditNotes[0].sgst = 900.00",
            "field count(data.cancelledTransfers) = 0"],
  note: "STK-20 cancelled TR-0004 while the goods were still on the lorry, and the ledger reversal was complete. The return now says so in the way GST requires: section 34(1) undoes an ISSUED invoice with a CREDIT NOTE, a numbered document that goes in Table 9B naming the invoice it reverses. SmartERP used to raise none, so the supply was quietly dropped from the tables and the invoice number listed under cancelledTransfers for somebody to deal with by hand. That list is now empty, which is the whole point of the change - an invoice number vanishing out of a consecutive series is exactly what an auditor asks about, and the answer is a document, not a footnote. The SAME table already carries sales-return credit notes, so this follows a path in your own code rather than inventing a second one.",
});
C("STK-27.2", T27, "The supply and its credit note both appear, and the sheets still agree.", 17, {
  ...B, method: "GET", path: `/gst/gstr1?${MAY}&branchId={{BR_B_CHN}}`, status: 200,
  asserts: ["field data.totals.taxableValue = 49000.00", "field data.hsn[0].quantity = 29",
            "field data.hsn[0].taxableValue = 49000.00",
            "field sum(data.b2b[rate=18].taxableValue) = 49000.00",
            "field sum(data.creditNotes[rate=18].taxableValue) = 10000.00"],
  note: "THE CONSISTENCY THAT MATTERS, restated for the new treatment. 49,000.00 of pumps were dispatched under a tax invoice in May, and 10,000.00 of that was credited in May - so 4A and table 12 must BOTH read 49,000.00 and 29 units, with the reversal sitting in 9B rather than netted into either. Under the old rule both sheets read 35,000.00; what could never be allowed is 49,000.00 on one and 35,000.00 on the other, a return whose own two sheets disagree by exactly the value of a cancelled document. The B2B assertion adds the rows up rather than looking for an invoice number and finding it - a presence proved by a name is worth as little as an absence proved by one, because a name I got wrong would break either.",
});
C("STK-27.3", T27, "June is a credit note and nothing else.", 17, {
  ...B, method: "GET", path: `/gst/gstr1?${JUN}&branchId={{BR_B_CHN}}`, status: 200,
  asserts: ["field count(data.b2b) = 0", "field count(data.hsn) = 0",
            "field data.totals.taxableValue = 0",
            "field count(data.cancelledTransfers) = 0",
            "field count(data.creditNotes) = 1",
            "field data.creditNotes[0].noteNumber = CN-0002",
            "field data.creditNotes[0].noteDate = 2026-06-03",
            `field data.creditNotes[0].gstin = ${CBE_GSTIN}`,
            "field data.creditNotes[0].taxableValue = 4000.00",
            "field data.creditNotes[0].cgst = 360.00",
            "field data.creditNotes[0].sgst = 360.00"],
  note: "THE CASE THE TIMING RULE EXISTS FOR. TR-0006 went out on 28 May under a May invoice and was cancelled on 3 June. Its supply belongs to May - it is one of the four rows in STK-26.1 - and its credit note belongs to June, because that is the period the note was raised in. So June's GSTR-1 has no outward supply at all and one entry in 9B. The transfer is in scope for this return by its NOTE date and by nothing else, which is why the b2b and HSN tables must stay empty: pulling a May invoice into a June return because its note landed there would declare the same supply twice.",
});

// ---------------------------------------------------------------------------
const T28 = "GSTR-3B, where the two sides of a transfer land in different months";
C("STK-28.1", T28, "The sending branch owes the tax from the day it dispatched.", 17, {
  ...B, method: "GET", path: `/gst/gstr3b?${MAY}&branchId={{BR_B_CHN}}`, status: 200,
  asserts: ["field data.outward.taxableValue = 39000.00",
            "field data.outward.cgst = 2160.00", "field data.outward.sgst = 2160.00",
            "field data.outward.igst = 2700.00", "field data.outward.total = 7020.00",
            "field data.itc.total = 0", "field data.netPayable.total = 7020.00"],
  note: "Section 12 puts the time of supply at the issue of the invoice, so the liability is Chennai's from the dispatch date whether or not the goods have arrived. 49,000.00 was invoiced in May and 10,000.00 of it was credited in May, leaving 39,000.00 - and TR-0006's 4,000.00 stays in, because its credit note is a June document and this is May's return. THAT IS THE CHANGE. The old code dropped a cancelled transfer from every period at once, which gives the same answer as this whenever the invoice and the note share a month and understates the dispatch month by a whole invoice when they do not. Chennai received nothing in May, so it has no credit to set against the 7,020.00.",
});
C("STK-28.2", T28, "The receiving branch takes the credit only when the goods land.", 17, {
  ...B, method: "GET", path: `/gst/gstr3b?${MAY}&branchId={{BR_B_CBE}}`, status: 200,
  asserts: ["field data.outward.taxableValue = 0", "field data.outward.total = 0",
            "field data.itc.taxableValue = 20000.00",
            "field data.itc.cgst = 1800.00", "field data.itc.sgst = 1800.00",
            "field data.itc.igst = 0", "field data.netPayable.total = 0"],
  note: "Section 16(2)(b) allows the credit only on RECEIPT of the goods, so this is keyed on receivedDate and toBranchId while the liability above is keyed on transferDate and fromBranchId. The 20,000.00 is TR-0002 alone. Neither cancelled transfer ever arrived, so neither is here - a credit is claimed against goods received, and the credit note at the other end is what unwinds the sender's side. A transfer that crosses a month end therefore pays in one return and claims in the next - revenue-neutral over the year, not within the month, and the commonest question anybody will ask about these figures.",
});
C("STK-28.3", T28, "Bengaluru's credit is IGST, not CGST and SGST.", 17, {
  ...B, method: "GET", path: `/gst/gstr3b?${MAY}&branchId={{BR_B_BLR}}`, status: 200,
  asserts: ["field data.itc.taxableValue = 15000.00", "field data.itc.igst = 2700.00",
            "field data.itc.cgst = 0", "field data.itc.sgst = 0",
            "field data.outward.total = 0"],
  note: "The head follows the place of supply at both ends. IGST out at Chennai is IGST in at Bengaluru - if the credit came back as CGST+SGST the two registrations could never reconcile, and the receiving branch would be claiming a credit under heads the sender never paid.",
});
C("STK-28.4", T28, "June's 3B is a NEGATIVE outward supply, and it is not an error.", 17, {
  ...B, method: "GET", path: `/gst/gstr3b?${JUN}&branchId={{BR_B_CHN}}`, status: 200,
  asserts: [SQL("SELECT count(*) FROM sales_invoices WHERE organization_id={{ORG_B}} " +
                "AND invoice_date BETWEEN '2026-06-01' AND '2026-06-30'", 0),
            SQL("SELECT count(*) FROM purchase_bills WHERE organization_id={{ORG_B}} " +
                "AND bill_date BETWEEN '2026-06-01' AND '2026-06-30'", 0),
            "field data.outward.taxableValue = -4000.00",
            "field data.outward.cgst = -360.00", "field data.outward.sgst = -360.00",
            "field data.outward.igst = 0", "field data.outward.total = -720.00",
            "field data.itc.total = 0", "field data.netPayable.total = 0"],
  note: "THE OTHER HALF OF STK-27.3, on the return where the money actually moves. June has one document in it, a credit note, so 3.1(a) is negative - which is what table 3.1(a) is for and what every taxpayer with more credit notes than invoices in a month files. A report that clamped this to zero, or refused it, would strand the reversal and leave May's 7,020.00 paid on a supply that never completed. netPayable IS clamped, and rightly: a negative liability is not a refund, it is carried forward, so 3B says nil is due and the credit stays in the ledger. The two SQL controls come first so the figures above mean what they claim - June holds no invoice and no bill, so every rupee here came from the credit note and nothing is quietly offsetting anything.",
});

// ---------------------------------------------------------------------------
const T29 = "Across the whole organisation, transfer tax nets to nothing";
C("STK-29.1", T29, "May alone, org-wide, does NOT net to nil any more.", 17, {
  ...B, method: "GET", path: `/gst/gstr3b?${MAY}`, status: 200,
  asserts: ["field data.outward.taxableValue = 39000.00", "field data.itc.taxableValue = 35000.00",
            "field data.outward.total = 7020.00", "field data.itc.total = 6300.00",
            "field data.netPayable.cgst = 360.00", "field data.netPayable.sgst = 360.00",
            "field data.netPayable.igst = 0", "field data.netPayable.total = 720.00"],
  note: "AND THIS STEP EXISTS TO SAY SO OUT LOUD. Under the old treatment every transfer figure netted to nil inside a single month, because a cancelled one vanished from both sides at once. It cannot now: TR-0006's supply is declared in May and credited in June, so May carries 4,000.00 of outward supply with no matching credit and the group owes 720.00 - exactly the tax on that one invoice. That is not a defect. It is the correct filing position for a supply that was invoiced in May, and the 720.00 comes straight back in June. A pack that only ever asserted nil would pass just as happily against software that had silently dropped the invoice.",
});
C("STK-29.2", T29, "May and June together, where it does.", 17, {
  ...B, method: "GET", path: `/gst/gstr3b?${BOTH}`, status: 200,
  asserts: ["field data.outward.taxableValue = 35000.00", "field data.itc.taxableValue = 35000.00",
            "field data.outward.total = 6300.00", "field data.itc.total = 6300.00",
            "field data.netPayable.total = 0"],
  note: "THE RETURN-SIDE TWIN OF STK-25.4. That step proved the transfer GST nets to nil in the LEDGER; this proves it nets to nil in the RETURN - over the period in which both halves of every document fall, which is now two months rather than one. 49,000.00 invoiced less 14,000.00 credited is 35,000.00 out, and the 35,000.00 received by Coimbatore and Bengaluru inside May is the credit against it. That is what 'revenue-neutral' means in filing terms, and it is the whole reason the second proviso to Rule 28 permits cost as the value - if the tax were a real cost to the group, valuing at cost would be a concession nobody could justify. It is neutral across periods, not within one, and STK-29.1 is the proof that the pack knows the difference.",
});
C("STK-29.3", T29, "April, a month with no transfers in it at all.", 17, {
  ...B, method: "GET", path: `/gst/gstr3b?${APR}`, status: 200,
  asserts: ["pre " + CAP("SELECT round(coalesce(sum(subtotal),0),2) FROM purchase_bills " +
                         "WHERE organization_id={{ORG_B}} AND status='POSTED' " +
                         "AND bill_date BETWEEN '2026-04-01' AND '2026-04-30'", "aprBills"),
            "field data.outward.taxableValue = 48000.00",
            "field data.outward.cgst = 4320.00", "field data.outward.sgst = 4320.00",
            "field data.itc.taxableValue = {{aprBills}}",
            SQL("SELECT count(*) FROM stock_transfers WHERE organization_id={{ORG_B}} " +
                "AND tax_treatment='TAXABLE' AND (transfer_date <= '2026-04-30' " +
                "OR received_date <= '2026-04-30' OR credit_note_date <= '2026-04-30')", 0)],
  note: "A CONTROL ON THE CONTROL: if April's figures moved when batches 3 and 4 were added, a transfer had leaked into a period it does not belong to. The last assertion says that directly - no taxable transfer was dispatched, received or CREDITED on or before 30 April - which is the claim, rather than a figure that happens to follow from it. The credit-note date is in there because it is now a third way a transfer can be pulled into a return period, and a control that predates a new date column silently stops covering what it was written to cover. THE ITC SIDE IS MEASURED, and this step is why. It first asserted 13,000.00, the STK-08 purchase bill, and got 133,000.00: the DEPRECIATION pack shares these organisations and runs first, and DEP-11.1 posts a 120,000.00 capital purchase bill in ORG-B on 1 April. Its 21,600.00 of GST is claimable in full in the month of receipt under section 16 and belongs in this return - the software was right and the test had forgotten who else writes to this database. Reading the posted bills for the period and requiring the ITC section to equal them asserts something better anyway: with no purchase returns and no transfers in April, 4(A) must be exactly the bills.",
});
C("STK-29.4", T29, "A period with no data at all reads as nil, not as an error.", 17, {
  ...B, method: "GET", path: "/gst/gstr3b?from=2026-03-01&to=2026-03-31", status: 200,
  asserts: ["field data.outward.taxableValue = 0", "field data.itc.taxableValue = 0",
            "field data.netPayable.total = 0"],
  note: "March is before the organisation traded. A return for an empty period is a legitimate question with a legitimate answer - nil - and a report that threw, or omitted the sections, would be unusable for the first month of any business and for any month a branch happened to be idle.",
});
