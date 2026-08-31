// SmartERP - Charge Master.
//
// Script 12 of 12: tests/stkCasesH.mjs, part 2 of 2 - STK-40.
//
// Then, from backend/:  node tests/makeStkCases.mjs   (expect 153 steps)
//                       npx tsc --noEmit
//
// Save this as backend/tests/cmL.mjs and run it from backend/:
//   node tests/cmL.mjs
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

edit("tests/stkCasesH.mjs",
  L(
    "            \"field data.hsn[0].quantity = 10\", \"field data.hsn[0].rate = 18\"],",
    "  note: \"NOT ONE LINE OF gstReports.ts WAS TOUCHED FOR THIS FEATURE, and this step is the proof. Because the charge was prorated into the line taxable values, the return simply reads what is there: 4,800.00 in the supply tables and the same 4,800.00 in table 12, against ten units of one HSN at 18%. A charge implemented as a separate line would have needed a SAC, its own HSN row, its own rate in the summary, and a decision about whether table 12 counts it as a quantity - and every one of those is a place to disagree with 4A. July is chosen because ORG-A raised no other invoice in it, so every rupee here is this one document.\","),
  L(
    "            \"field data.hsn[0].quantity = 10\", \"field data.hsn[0].rate = 18\"],",
    "  note: \"NOT ONE LINE OF gstReports.ts WAS TOUCHED FOR THIS FEATURE, and this step is the proof. Because the charge was prorated into the line taxable values, the return simply reads what is there: 4,800.00 in the supply tables and the same 4,800.00 in table 12, against ten units of one HSN at 18%. A charge implemented as a separate line would have needed a SAC, its own HSN row, its own rate in the summary, and a decision about whether table 12 counts it as a quantity - and every one of those is a place to disagree with 4A. July is chosen because ORG-A raised no other invoice in it, so every rupee here is this one document.\",",
    "});",
    "",
    "// ---------------------------------------------------------------------------",
    "const T39 = \"The master is what stops the label drifting\";",
    "C(\"STK-39.1\", T39, \"A charge type that credits Sales Revenue.\", 18, {",
    "  method: \"POST\", path: \"/charge-types\", status: 400,",
    "  body: { label: \"Freight\", accountId: \"{{ACC_5001_A}}\" },",
    "  asserts: ['error contains \"cannot credit Sales Revenue\"'],",
    "  note: \"Refused at the MASTER, one step earlier than migration_054 refused it, and that is the improvement. Before, the same mistake was only caught when somebody tried to raise an invoice with it - which is to say, with a customer waiting. The rule itself has not moved: recovered freight inside Sales Revenue is a split that was never recorded, and no report can reconstruct it afterwards.\",",
    "});",
    "C(\"STK-39.2\", T39, \"A charge type that credits an EXPENSE account.\", 18, {",
    "  method: \"POST\", path: \"/charge-types\", status: 400,",
    "  body: { label: \"Freight\", accountId: \"{{ACC_4008}}\" },",
    "  asserts: ['error contains \"must credit an income account\"'],",
    "  note: \"Money coming IN from a customer is income. Crediting an expense head would net it against costs and quietly understate both sides of the P&L - the classic way a business ends up reporting neither its real revenue nor its real cost of delivery. The account must be INCOME and must exist in THIS organisation, which is one lookup doing both.\",",
    "});",
    "C(\"STK-39.3\", T39, \"The same label again, in different capitals.\", 18, {",
    "  method: \"POST\", path: \"/charge-types\", status: 409,",
    "  body: { label: \"DELIVERY CHARGES\", accountId: \"{{ACC_5002_A}}\" },",
    "  asserts: ['error contains \"already exists\"'],",
    "  note: \"THE STEP THIS WHOLE MIGRATION EXISTS FOR. 'Delivery charges' and 'DELIVERY CHARGES' are the same charge and must not both be creatable, or the master reproduces exactly the drift it was built to end - and does it with a straight face, because now the two spellings are blessed. The real guard is the unique index on lower(label) in migration_055; the route's own check exists only so the user gets a sentence instead of a constraint violation.\",",
    "});",
    "C(\"STK-39.4\", T39, \"A new head, and a charge type pointing at it.\", 18, {",
    "  method: \"POST\", path: \"/accounts\", status: 201,",
    "  body: { accountCode: \"5005\", accountName: \"Handling Recovered\", accountType: \"INCOME\" },",
    "  capture: { acc5005: \"data.id\" },",
    "  note: \"THE ANSWER TO 'HOW DO I ADD ANOTHER KIND OF CHARGE'. Two screens, in this order: Chart of Accounts for the head, Charge Master for the label that credits it. Nothing else has to be told - the invoice picker asks the master, and the master asks the chart. That is why the charge master is one table and not a hardcoded list of three.\",",
    "});",
    "C(\"STK-39.5\", T39, \"It can be created, and it shows up active.\", 18, {",
    "  method: \"POST\", path: \"/charge-types\", status: 201,",
    "  body: { label: \"Handling charges\", accountId: \"{{STK-39.acc5005}}\" },",
    "  capture: { retiredId: \"data.id\" },",
    "  asserts: [\"field data.isActive = true\", \"field data.account.accountCode = 5005\"],",
    "  note: \"Captured as retiredId because the very next step retires it - it exists in this pack to prove the round trip, not to be used. Note it comes back with its account expanded: the screen shows the user where a charge lands without a second call, and so does the invoice picker.\",",
    "});",
    "C(\"STK-39.6\", T39, \"Retire it. It leaves the picker and nothing else changes.\", 18, {",
    "  method: \"PATCH\", path: \"/charge-types/{{STK-39.retiredId}}/toggle\", status: 200,",
    "  asserts: [\"field data.isActive = false\",",
    "            \"GET /charge-types :: field count(data[label=Handling charges]) = 0\",",
    "            \"GET /charge-types?includeInactive=true :: field count(data[label=Handling charges]) = 1\",",
    "            SQL(\"SELECT count(*) FROM charge_types WHERE organization_id={{ORG_A}}\", 4)],",
    "  note: \"RETIRED, NOT DELETED, and the three assertions are the three things that has to mean. It is gone from the default list, which is what the invoice picker reads. It is still in the list the Charge Master screen reads, because that screen is the only place it can be brought back from. And the row is still there - four types, not three. There is deliberately no DELETE endpoint: a type that has been used is pointed at by documents, and deleting it would either fail on the foreign key or take the link with it and leave a report unable to say what a recovery was for.\",",
    "});",
    "C(\"STK-39.7\", T39, \"ORG-B got its own master, with its own ids.\", 18, {",
    "  login: \"B\",",
    "  asserts: [SQL(\"SELECT count(*) FROM charge_types WHERE organization_id={{ORG_B}}\", 3),",
    "            CAP(\"SELECT id FROM charge_types WHERE organization_id={{ORG_B}} \" +",
    "                \"AND lower(label)='delivery charges'\", \"orgBDeliv\")],",
    "  note: \"Per organisation, because one org's 'Delivery charges' is another's 'Freight out' and neither should have to accept the other's vocabulary. The id captured here is a real row that ORG-A must not be able to use - STK-40.2 is where that gets tested, and it is the only tenancy check in this batch that could not be written without two organisations to hand.\",",
    "});",
    "",
    "// ---------------------------------------------------------------------------",
    "const T40 = \"What a charge refuses\";",
    "C(\"STK-40.1\", T40, \"A charge naming no type at all.\", 18, {",
    "  method: \"POST\", path: \"/sales-invoices\", status: 400,",
    "  body: { businessPartnerId: \"{{CUST_TN}}\", invoiceDate: \"2026-07-06\", branchId: \"{{BR_A_CHN}}\",",
    "          lines: [{ itemId: \"{{STK-38.itemId}}\", quantity: 1, rate: 400, taxRate: 18 }],",
    "          charges: [{ amount: 100 }] },",
    "  asserts: ['error contains \"active charge type from the Charge Master\"'],",
    "  note: \"The shape of the request is now the guard. There is no label field and no account field to get wrong, so the only way to raise a charge is to name a type that exists in THIS organisation and is active - which is the master-only rule, enforced at the one place it has to be rather than in the screen where it can be bypassed by anything that speaks HTTP.\",",
    "});",
    "C(\"STK-40.2\", T40, \"A charge naming a type from another organisation.\", 18, {",
    "  method: \"POST\", path: \"/sales-invoices\", status: 400,",
    "  body: { businessPartnerId: \"{{CUST_TN}}\", invoiceDate: \"2026-07-06\", branchId: \"{{BR_A_CHN}}\",",
    "          lines: [{ itemId: \"{{STK-38.itemId}}\", quantity: 1, rate: 400, taxRate: 18 }],",
    "          charges: [{ chargeTypeId: \"{{orgBDeliv}}\", amount: 100 }] },",
    "  asserts: ['error contains \"active charge type from the Charge Master\"'],",
    "  note: \"THE TENANCY CHECK, and it is one lookup doing two jobs. ORG-B has a charge type of its own with the same seeded label, so this is a real id of a real row - it is simply not this organisation's. The findMany is scoped by organizationId, so a valid-looking id from next door resolves to nothing and the invoice is refused. An implementation that looked the type up by id alone and only then checked the org would have had a window between the two.\",",
    "});",
    "C(\"STK-40.3\", T40, \"A charge with no amount.\", 18, {",
    "  method: \"POST\", path: \"/sales-invoices\", status: 400,",
    "  body: { businessPartnerId: \"{{CUST_TN}}\", invoiceDate: \"2026-07-06\", branchId: \"{{BR_A_CHN}}\",",
    "          lines: [{ itemId: \"{{STK-38.itemId}}\", quantity: 1, rate: 400, taxRate: 18 }],",
    "          charges: [{ chargeTypeId: \"{{delivId}}\", amount: 0 }] },",
    "  asserts: ['error contains \"must be a positive amount\"'],",
    "  note: \"A zero charge is a row that says nothing and a negative one is a discount wearing a different name - and the invoice already has two honest ways to express a discount. A negative charge called 'Delivery charges' would reduce a taxable value without looking like a discount to anybody reading the document, which is exactly the shape of a thing that should not be possible. The CHECK constraint in migration_054 says the same thing at the table.\",",
    "});",
    "C(\"STK-40.4\", T40, \"A charge naming a RETIRED type.\", 18, {",
    "  method: \"POST\", path: \"/sales-invoices\", status: 400,",
    "  body: { businessPartnerId: \"{{CUST_TN}}\", invoiceDate: \"2026-07-06\", branchId: \"{{BR_A_CHN}}\",",
    "          lines: [{ itemId: \"{{STK-38.itemId}}\", quantity: 1, rate: 400, taxRate: 18 }],",
    "          charges: [{ chargeTypeId: \"{{retiredId}}\", amount: 100 }] },",
    "  asserts: ['error contains \"active charge type from the Charge Master\"'],",
    "  note: \"Retiring a charge type has to mean something, and this is what it means: it stops being offerable on a new document. It does NOT mean the invoices that already carry it change - STK-40.6 is the other half of that pair. A retired type that could still be posted to would make the Retire button decorative.\",",
    "});",
    "C(\"STK-40.5\", T40, \"None of those four wrote anything.\", 18, {",
    "  asserts: [SQL(\"SELECT count(*) FROM sales_invoices WHERE organization_id={{ORG_A}} \" +",
    "                \"AND invoice_date='2026-07-06'\", 0),",
    "            val(\"CHG-TEST\", \"quantityOnHand\", \"10\"),",
    "            SQL(bal(\"{{ORG_A}}\", \"5002\"), \"-500.00\"),",
    "            SQL(bal(\"{{ORG_A}}\", \"5004\"), \"-300.00\")],",
    "  note: \"THE CONTROL ON THE REFUSALS. Four invoices were rejected and not one of them left a document, consumed a unit of stock or credited a rupee of income. CHG-TEST is still at ten - twenty in, ten sold on the 5th, nothing on the 6th. The two income heads read as CREDITS under sum(debit-credit), which is what an income account should look like and is the same convention STK-11.3 uses for the conversion-cost heads. A refusal that half-posts is worse than no refusal at all, because the ledger then holds a document nobody can find.\",",
    "});"),
  "const T40 = ");

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["tests/stkCasesH.mjs"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}