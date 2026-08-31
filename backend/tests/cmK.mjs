// SmartERP - Charge Master.
//
// Script 11 of 12: tests/stkCasesH.mjs, part 1 of 2 - STK-38 and STK-39.
//
// Save this as backend/tests/cmK.mjs and run it from backend/:
//   node tests/cmK.mjs
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
function create(file, text, done) {
  if (fs.existsSync(at(file)) && read(file).includes(done)) { already++; return; }
  fs.mkdirSync(path.dirname(at(file)), { recursive: true });
  save(file, text);
  applied++;
}

create("tests/stkCasesH.mjs", L(
    "// Freight, packing and insurance on a sales invoice - and the master they",
    "// are chosen from.",
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
    "// THE SECOND HALF, and STK-40 is where it lives: the label is CHOSEN, not",
    "// typed. migration_054 shipped a free-text label and it drifts - \"Delivery",
    "// charges\", \"Delivery Charges\", \"Frieght\", all on 5002, and any report",
    "// grouping by label fragments into rows that are one thing. migration_055",
    "// binds the label to an income account once, per organisation, behind a",
    "// unique index on lower(label). The invoice sends a chargeTypeId and an",
    "// amount; the label and the account come from the master.",
    "//",
    "// Phase 18, beside the negative-stock batch and BEFORE the controls at 19,",
    "// because these steps post an invoice and consume stock.",
    "",
    "import { C, je, val, SQL, CAP, bal } from \"./stkPack.mjs\";",
    "",
    "// July, because ORG-A has no other sales invoice in it. Every figure in the",
    "// return steps below is therefore this one document and nothing else - a",
    "// control that has to share a month with two other invoices proves much less.",
    "const JUL = \"from=2026-07-01&to=2026-07-31\";",
    "",
    "const typeId = (label) =>",
    "  `SELECT id FROM charge_types WHERE organization_id={{ORG_A}} AND lower(label)='${label}'`;",
    "",
    "// ---------------------------------------------------------------------------",
    "const T38 = \"A charge is part of the supply, not a line beside it\";",
    "C(\"STK-38.1\", T38, \"The master arrived provisioned, pointing at the right heads.\", 18, {",
    "  method: \"GET\", path: \"/charge-types\", status: 200,",
    "  asserts: [\"field count(data) = 3\",",
    "            \"field data[label=Delivery charges].account.accountCode = 5002\",",
    "            \"field data[label=Transit insurance].account.accountCode = 5004\",",
    "            SQL(\"SELECT count(*) FROM accounts WHERE organization_id={{ORG_A}} \" +",
    "                \"AND account_code IN ('5002','5003','5004') AND account_type='INCOME'\", 3),",
    "            CAP(typeId(\"delivery charges\"), \"delivId\"),",
    "            CAP(typeId(\"transit insurance\"), \"insurId\")],",
    "  note: \"PROVISIONING SEEDS THIS, and that is a deliberate choice rather than a convenience. The master-only rule means an organisation with an empty Charge Master cannot put delivery on an invoice at all - an empty master is a closed door, and nobody should discover that mid-invoice with a customer waiting. So lib/provisioning.ts seeds the standard three off account codes 5002/5003/5004, exactly as it already seeds asset classes off 1401-1455, and migration_055 back-fills every organisation that existed before it. The labels are a starting point; the Charge Master screen renames them freely.\",",
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
    "          charges: [{ chargeTypeId: \"{{delivId}}\", amount: 500 },",
    "                    { chargeTypeId: \"{{insurId}}\", amount: 300 }] },",
    "  capture: { invId: \"data.id\" },",
    "  je: je([\"1005\", \"Accounts Receivable (customer)\", 5664.0, 0], [\"5001\", \"Sales Revenue\", 0, 4000.0],",
    "         [\"5002\", \"Freight & Delivery Recovered\", 0, 500.0],",
    "         [\"5004\", \"Insurance Recovered\", 0, 300.0],",
    "         [\"2102\", \"CGST Output Payable\", 0, 432.0], [\"2103\", \"SGST Output Payable\", 0, 432.0],",
    "         [\"4001\", \"Cost of Goods Sold\", 1000.0, 0], [\"1201\", \"Inventory (CHG-TEST card)\", 0, 1000.0]),",
    "  asserts: [\"journal sales_invoice {{invId}}\"],",
    "  note: \"EVERY FIGURE HERE IS THE POINT. Goods 4,000.00, charges 800.00, so the value of the supply is 4,800.00 and the tax is 18% OF THAT - 864.00, split 432.00 each way. Had the freight been billed as its own line at 5% under SAC 9965, the tax would have been 720.00 + 40.00 = 760.00, and this invoice would have understated output tax by 104.00. That is the error this design cannot make, because there is nowhere to put a rate for freight. Note what the request carried: two ids and two amounts. No label, no account - both came from the master, which is what stops the same charge being spelled two ways on two invoices. And the two charges credit 5002 and 5004 at their FULL amounts: the proration is a GST device deciding which line carries the tax, not a way of splitting the revenue.\",",
    "});",
    "C(\"STK-38.4\", T38, \"The charge is inside the LINE, and the label came from the master.\", 18, {",
    "  asserts: [SQL(\"SELECT round(sum(taxable_value),2) FROM sales_invoice_lines \" +",
    "                \"WHERE sales_invoice_id={{STK-38.invId}}\", \"4800.00\"),",
    "            SQL(\"SELECT round(subtotal,2) FROM sales_invoices WHERE id={{STK-38.invId}}\", \"4000.00\"),",
    "            SQL(\"SELECT round(sum(amount),2) FROM sales_invoice_charges \" +",
    "                \"WHERE sales_invoice_id={{STK-38.invId}}\", \"800.00\"),",
    "            SQL(\"SELECT count(*) FROM sales_invoice_charges \" +",
    "                \"WHERE sales_invoice_id={{STK-38.invId}} AND charge_type_id IS NOT NULL\", 2),",
    "            SQL(\"SELECT string_agg(label, ' | ' ORDER BY sort_order) FROM sales_invoice_charges \" +",
    "                \"WHERE sales_invoice_id={{STK-38.invId}}\", \"Delivery charges | Transit insurance\")],",
    "  note: \"THE IDENTITY THE WHOLE DESIGN RESTS ON: line taxable value equals goods net of discount PLUS charges. 4,000.00 + 800.00 = 4,800.00. subtotal stays at the goods figure because that is what Sales Revenue was credited with, and the charges are their own rows with their own heads. The last two assertions are the master half: every row carries a charge_type_id, AND its own copy of the label. Both, deliberately - the snapshot is what the document means, so renaming a charge type next year cannot restate this invoice, and the type id is what lets a report group across such a rename anyway. Same reasoning as party_gstin in migration_031.\",",
    "});",
    "C(\"STK-38.5\", T38, \"GSTR-1 picks it up with no GST code changed at all.\", 18, {",
    "  method: \"GET\", path: `/gst/gstr1?${JUL}`, status: 200,",
    "  asserts: [\"field data.totals.taxableValue = 4800.00\",",
    "            \"field data.totals.cgst = 432.00\", \"field data.totals.sgst = 432.00\",",
    "            \"field count(data.hsn) = 1\", \"field data.hsn[0].taxableValue = 4800.00\",",
    "            \"field data.hsn[0].quantity = 10\", \"field data.hsn[0].rate = 18\"],",
    "  note: \"NOT ONE LINE OF gstReports.ts WAS TOUCHED FOR THIS FEATURE, and this step is the proof. Because the charge was prorated into the line taxable values, the return simply reads what is there: 4,800.00 in the supply tables and the same 4,800.00 in table 12, against ten units of one HSN at 18%. A charge implemented as a separate line would have needed a SAC, its own HSN row, its own rate in the summary, and a decision about whether table 12 counts it as a quantity - and every one of those is a place to disagree with 4A. July is chosen because ORG-A raised no other invoice in it, so every rupee here is this one document.\","
),
  "The master arrived provisioned");

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["tests/stkCasesH.mjs"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}