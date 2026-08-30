// SmartERP - freight, packing and insurance on a sales invoice.
//
// Script 7 of 7: the test batch - STK-38 and STK-39, phase 18.
//
// Then, from backend/:  node tests/makeStkCases.mjs   (expect 145 steps)
//                       npx tsc --noEmit
//
// Save this as backend/tests/chgG.mjs and run it from backend/:
//   node tests/chgG.mjs
// Safe to run twice - a second run says 'already there' and changes nothing.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const at = (f) => path.join(here, "..", f);
const read = (f) => fs.readFileSync(at(f), "utf8").replace(/\r\n/g, "\n");
const L = (...ls) => ls.join("\n");
const save = (f, t) => fs.writeFileSync(at(f), t.replace(/\n*$/, "\n"));

let applied = 0, already = 0;
function edit(file, from, to, done) {
  const t = read(file);
  if (t.includes(done)) { already++; save(file, t); return; }
  const n = t.split(from).length - 1;
  if (n === 0) throw new Error("anchor not found in " + file + ": " + from.slice(0, 70));
  if (n > 1) throw new Error("anchor is not unique in " + file + ": " + from.slice(0, 70));
  save(file, t.replace(from, to));
  applied++;
}
function create(file, text, done) {
  if (fs.existsSync(at(file)) && read(file).includes(done)) { already++; return; }
  save(file, text);
  applied++;
}

create("tests/stkCasesH.mjs", L(
    "// Freight, packing and insurance on a sales invoice.",
    "//",
    "// THE TAX POINT IS THE WHOLE BATCH. Section 15(2)(c) puts incidental",
    "// expenses - packing, and anything the supplier does in respect of the",
    "// supply at or before delivery - INSIDE the value of the supply. Section",
    "// 8(a) taxes a composite supply at the rate of the PRINCIPAL supply. So",
    "// delivery charged on an invoice for 18% goods is taxed at 18%, under the",
    "// goods' HSN, and not at 5% under SAC 9965.",
    "//",
    "// The implementation makes that true by construction rather than by rule:",
    "// a charge is a DOCUMENT-level amount prorated across the goods lines by",
    "// value, landing in each line's taxable value BEFORE GST is computed. There",
    "// is no rate box for freight anywhere in the system, because a charge never",
    "// has a rate of its own to get wrong.",
    "//",
    "// WHAT THAT BUYS, and STK-38.5 is the step that proves it: GSTR-1 and",
    "// GSTR-3B needed no change at all. The charge is already inside every line's",
    "// taxableValue, so Table 4A, the HSN summary and 3B's outward figure pick it",
    "// up with nothing added. A charge implemented as its own LINE would have",
    "// needed SAC handling in both, and would have been the wrong answer anyway.",
    "//",
    "// The other half is the LEDGER. Each charge posts to its own income head -",
    "// 5002 Freight & Delivery Recovered and friends, added by migration_054 -",
    "// and never to Sales Revenue. Recovered freight set against freight paid",
    "// answers \"is delivery costing us money\"; recovered freight buried in Sales",
    "// Revenue answers nothing.",
    "//",
    "// Phase 18, beside the negative-stock batch and BEFORE the controls at 19,",
    "// because these steps post an invoice and consume stock.",
    "",
    "import { C, je, val, SQL, bal } from \"./stkPack.mjs\";",
    "",
    "// July, because ORG-A has no other sales invoice in it. Every figure in the",
    "// return steps below is therefore this one document and nothing else - a",
    "// control that has to share a month with two other invoices proves much less.",
    "const JUL = \"from=2026-07-01&to=2026-07-31\";",
    "",
    "// ---------------------------------------------------------------------------",
    "const T38 = \"A charge is part of the supply, not a line beside it\";",
    "C(\"STK-38.1\", T38, \"The three recovered-income heads exist, and are not Sales Revenue.\", 18, {",
    "  asserts: [SQL(\"SELECT count(*) FROM accounts WHERE organization_id={{ORG_A}} \" +",
    "                \"AND account_code IN ('5002','5003','5004') AND account_type='INCOME'\", 3),",
    "            SQL(\"SELECT count(*) FROM accounts WHERE organization_id={{ORG_A}} \" +",
    "                \"AND account_code='5001'\", 1)],",
    "  note: \"migration_054 adds them as templates so new organisations get them, and back-fills every organisation that already has 5001 - which is every organisation that can raise a sales invoice at all. Separate heads are the entire reason a charge is a row with an account rather than one more column on the invoice: freight recovered from customers is only meaningful next to freight paid to transporters, and crediting it to Sales Revenue makes that comparison impossible to draw ever again.\",",
    "});",
    "C(\"STK-38.2\", T38, \"An item to sell, at a cost with no rounding in it.\", 18, {",
    "  method: \"POST\", path: \"/items\", status: 201,",
    "  body: { sku: \"CHG-TEST\", name: \"Charged with delivery\", itemKind: \"STOCK\",",
    "          stockAccountId: \"{{ACC_1201_A}}\", hsnCode: \"84821010\", taxRate: 18,",
    "          openingQuantity: 20, openingCost: 100, openingBranchId: \"{{BR_A_CHN}}\",",
    "          openingDate: \"2026-04-01\" },",
    "  capture: { itemId: \"data.id\" },",
    "  asserts: [val(\"CHG-TEST\", \"quantityOnHand\", \"20\")],",
    "  note: \"100.00 exactly, so the COGS below is 1,000.00 exactly. Deliberate: this batch is about where a charge lands in the tax and in the ledger, and a four-decimal average would drag a paisa of rounding into every figure and turn a clear test into an argument about the last digit. STK-36.8 learned that the hard way.\",",
    "});",
    "C(\"STK-38.3\", T38, \"Sell ten, with delivery and insurance on top.\", 18, {",
    "  method: \"POST\", path: \"/sales-invoices\", status: 201,",
    "  body: { businessPartnerId: \"{{CUST_TN}}\", invoiceDate: \"2026-07-05\", branchId: \"{{BR_A_CHN}}\",",
    "          lines: [{ itemId: \"{{STK-38.itemId}}\", quantity: 10, rate: 400, taxRate: 18 }],",
    "          charges: [{ label: \"Delivery charges\", accountId: \"{{ACC_5002_A}}\", amount: 500 },",
    "                    { label: \"Transit insurance\", accountId: \"{{ACC_5004_A}}\", amount: 300 }] },",
    "  capture: { invId: \"data.id\" },",
    "  je: je([\"1005\", \"Accounts Receivable (customer)\", 5664.0, 0], [\"5001\", \"Sales Revenue\", 0, 4000.0],",
    "         [\"5002\", \"Freight & Delivery Recovered\", 0, 500.0],",
    "         [\"5004\", \"Insurance Recovered\", 0, 300.0],",
    "         [\"2102\", \"CGST Output Payable\", 0, 432.0], [\"2103\", \"SGST Output Payable\", 0, 432.0],",
    "         [\"4001\", \"Cost of Goods Sold\", 1000.0, 0], [\"1201\", \"Inventory (CHG-TEST card)\", 0, 1000.0]),",
    "  asserts: [\"journal sales_invoice {{invId}}\"],",
    "  note: \"EVERY FIGURE HERE IS THE POINT. Goods 4,000.00, charges 800.00, so the value of the supply is 4,800.00 and the tax is 18% OF THAT - 864.00, split 432.00 each way. Had the freight been billed as its own line at 5% under SAC 9965, the tax would have been 720.00 + 40.00 = 760.00, and this invoice would have understated output tax by 104.00. That is the error this design cannot make, because there is nowhere to put a rate for freight. And the two charges credit 5002 and 5004 at their FULL amounts - the proration is a GST device deciding which line carries the tax, not a way of splitting the revenue.\",",
    "});",
    "C(\"STK-38.4\", T38, \"The charge is inside the LINE, which is what makes the tax right.\", 18, {",
    "  asserts: [SQL(\"SELECT round(sum(taxable_value),2) FROM sales_invoice_lines \" +",
    "                \"WHERE sales_invoice_id={{STK-38.invId}}\", \"4800.00\"),",
    "            SQL(\"SELECT round(subtotal,2) FROM sales_invoices WHERE id={{STK-38.invId}}\", \"4000.00\"),",
    "            SQL(\"SELECT round(sum(amount),2) FROM sales_invoice_charges \" +",
    "                \"WHERE sales_invoice_id={{STK-38.invId}}\", \"800.00\"),",
    "            SQL(\"SELECT count(*) FROM sales_invoice_charges \" +",
    "                \"WHERE sales_invoice_id={{STK-38.invId}}\", 2)],",
    "  note: \"THE IDENTITY THE WHOLE DESIGN RESTS ON: line taxable value equals goods net of discount PLUS charges. 4,000.00 + 800.00 = 4,800.00. subtotal stays at the goods figure because that is what Sales Revenue was credited with, and the charges are their own rows with their own heads. If these three ever stop tying, the GST on the invoice is wrong and so is the P&L, and this is the step that would say so.\",",
    "});",
    "C(\"STK-38.5\", T38, \"GSTR-1 picks it up with no GST code changed at all.\", 18, {",
    "  method: \"GET\", path: `/gst/gstr1?${JUL}`, status: 200,",
    "  asserts: [\"field data.totals.taxableValue = 4800.00\",",
    "            \"field data.totals.cgst = 432.00\", \"field data.totals.sgst = 432.00\",",
    "            \"field count(data.hsn) = 1\", \"field data.hsn[0].taxableValue = 4800.00\",",
    "            \"field data.hsn[0].quantity = 10\", \"field data.hsn[0].rate = 18\"],",
    "  note: \"NOT ONE LINE OF gstReports.ts WAS TOUCHED FOR THIS FEATURE, and this step is the proof. Because the charge was prorated into the line taxable values, the return simply reads what is there: 4,800.00 in the supply tables and the same 4,800.00 in table 12, against ten units of one HSN at 18%. A charge implemented as a separate line would have needed a SAC, its own HSN row, its own rate in the summary, and a decision about whether table 12 counts it as a quantity - and every one of those is a place to disagree with 4A. July is chosen because ORG-A raised no other invoice in it, so every rupee here is this one document.\",",
    "});",
    "",
    "// ---------------------------------------------------------------------------",
    "const T39 = \"What a charge refuses\";",
    "C(\"STK-39.1\", T39, \"A charge posted to Sales Revenue.\", 18, {",
    "  method: \"POST\", path: \"/sales-invoices\", status: 400,",
    "  body: { businessPartnerId: \"{{CUST_TN}}\", invoiceDate: \"2026-07-06\", branchId: \"{{BR_A_CHN}}\",",
    "          lines: [{ itemId: \"{{STK-38.itemId}}\", quantity: 1, rate: 400, taxRate: 18 }],",
    "          charges: [{ label: \"Delivery charges\", accountId: \"{{ACC_5001_A}}\", amount: 100 }] },",
    "  asserts: ['error contains \"cannot post to Sales Revenue\"'],",
    "  note: \"Refused, and the message says why rather than just saying no. Allowing it would be allowing the one thing separate heads exist to prevent: the moment recovered freight is inside Sales Revenue, nobody can ever again ask what delivery cost the business, and no report can reconstruct it because the split was never recorded.\",",
    "});",
    "C(\"STK-39.2\", T39, \"A charge posted to an EXPENSE account.\", 18, {",
    "  method: \"POST\", path: \"/sales-invoices\", status: 400,",
    "  body: { businessPartnerId: \"{{CUST_TN}}\", invoiceDate: \"2026-07-06\", branchId: \"{{BR_A_CHN}}\",",
    "          lines: [{ itemId: \"{{STK-38.itemId}}\", quantity: 1, rate: 400, taxRate: 18 }],",
    "          charges: [{ label: \"Delivery charges\", accountId: \"{{ACC_4008}}\", amount: 100 }] },",
    "  asserts: ['error contains \"must post to one of this organization\\'s income accounts\"'],",
    "  note: \"Money coming IN from a customer is income. Crediting an expense head would net it against costs and quietly understate both sides of the P&L - the classic way a business ends up reporting neither its real revenue nor its real cost of delivery. The account must be INCOME and must exist in THIS organisation, which is one lookup doing both.\",",
    "});",
    "C(\"STK-39.3\", T39, \"A charge with no amount, and one with no label.\", 18, {",
    "  method: \"POST\", path: \"/sales-invoices\", status: 400,",
    "  body: { businessPartnerId: \"{{CUST_TN}}\", invoiceDate: \"2026-07-06\", branchId: \"{{BR_A_CHN}}\",",
    "          lines: [{ itemId: \"{{STK-38.itemId}}\", quantity: 1, rate: 400, taxRate: 18 }],",
    "          charges: [{ label: \"Delivery charges\", accountId: \"{{ACC_5002_A}}\", amount: 0 }] },",
    "  asserts: ['error contains \"must be a positive amount\"'],",
    "  note: \"A zero charge is a row that says nothing and a negative one is a discount wearing a different name - and the invoice already has two honest ways to express a discount. A negative charge called 'Freight' would reduce a taxable value without looking like a discount to anybody reading the document, which is exactly the shape of a thing that should not be possible. The CHECK constraint in migration_054 says the same thing at the table.\",",
    "});",
    "C(\"STK-39.4\", T39, \"None of those three wrote anything.\", 18, {",
    "  asserts: [SQL(\"SELECT count(*) FROM sales_invoices WHERE organization_id={{ORG_A}} \" +",
    "                \"AND invoice_date='2026-07-06'\", 0),",
    "            val(\"CHG-TEST\", \"quantityOnHand\", \"10\"),",
    "            SQL(bal(\"{{ORG_A}}\", \"5002\"), \"-500.00\"),",
    "            SQL(bal(\"{{ORG_A}}\", \"5004\"), \"-300.00\")],",
    "  note: \"THE CONTROL ON THE REFUSALS. Three invoices were rejected and not one of them left a document, consumed a unit of stock or credited a rupee of income. CHG-TEST is still at ten - twenty in, ten sold on the 5th, nothing on the 6th. The two income heads read as CREDITS under sum(debit-credit), which is what an income account should look like and is the same convention STK-11.3 uses for the conversion-cost heads. A refusal that half-posts is worse than no refusal at all, because the ledger then holds a document nobody can find.\",",
    "});"
),
  "STK-38.5");

edit("tests/harness.ts",
  "  ACC_4005_A: { org: \"A\", kind: \"account\", match: \"4005\" },",
  L(
    "  ACC_4005_A: { org: \"A\", kind: \"account\", match: \"4005\" },",
    "  // Sales Revenue and the two recovered-income heads a charge posts to.",
    "  // 5001 is here to be REFUSED: STK-39.1 offers it as a charge account and",
    "  // the invoice must reject it, which is a thing that can only be tested by",
    "  // being able to name it. 5002 and 5004 arrive with migration_054.",
    "  ACC_5001_A: { org: \"A\", kind: \"account\", match: \"5001\" },",
    "  ACC_5002_A: { org: \"A\", kind: \"account\", match: \"5002\" },",
    "  ACC_5004_A: { org: \"A\", kind: \"account\", match: \"5004\" },"),
  "// the invoice must reject it, which is a thing that can only be tested by");

edit("tests/makeStkCases.mjs",
  "// controls, because it moves stock and posts COGS.",
  L(
    "// controls, because it moves stock and posts COGS.",
    "// stkCasesH.mjs is invoice charges, also phase 18 and for the same reason."),
  "// stkCasesH.mjs is invoice charges, also phase 18 and for the same reason.");

edit("tests/makeStkCases.mjs",
  "import \"./stkCasesG.mjs\";",
  L(
    "import \"./stkCasesG.mjs\";",
    "import \"./stkCasesH.mjs\";"),
  "import \"./stkCasesH.mjs\";");

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["tests/stkCasesH.mjs","tests/harness.ts","tests/makeStkCases.mjs"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}