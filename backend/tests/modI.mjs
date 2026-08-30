// modI - STK-33 rewritten. It was testing nothing.
//
// The two failures were both the same wrong constant of mine: STK-33.1
// asserted ORG-A has no BOM grant, reasoning that BOM belongs to the
// Manufacturing domain and ORG-A is a Trading org. ORG-A is BOTH.
// tests/seed.ts registers every organisation with
//   domains: { TRADING: {}, MANUFACTURING: {} }
// because the pack needs 1201 from one and 1301/1303 from the other. So
// every seeded org holds all five modules, and no seeded org can
// demonstrate absence at all.
//
// WHICH MEANS STK-33.2 PASSED FOR THE WRONG REASON. It reported that a
// BOM-gated endpoint answered for an organisation with no BOM row - but the
// organisation had an ACTIVE BOM row, so it exercised the ordinary allow
// path and called that evidence about absence. A green step proving nothing
// is worse than a red one.
//
// So the absence is now MADE rather than assumed: delete the row, check the
// endpoint still answers, put the row back. And STK-35.3's control changes
// to match - all five grants present and ACTIVE, which also catches a
// restore that duplicated a row instead of replacing it.
//
// Then: node tests/makeStkCases.mjs && npx tsc --noEmit -p tests/tsconfig.json
// Expect 123 steps across 32 cases, 122 runnable.
//
// Save this as backend/tests/modI.mjs and run it from backend/:
//   node tests/modI.mjs
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
  save(file, text);
  applied++;
}

create("tests/stkCasesF.mjs", L(
    "// Module entitlement - what an organisation loses when a subscription ends,",
    "// and more importantly what it must NOT lose.",
    "//",
    "// This is the first batch in either pack that asserts an ENTITLEMENT rather",
    "// than an accounting rule. Nothing here checks a balance. It checks that the",
    "// platform admin console's cancel button, which until now wrote CANCELLED to",
    "// org_modules and changed nothing else, actually reaches the API - and that",
    "// what it reaches is only the module that was cancelled.",
    "//",
    "// THE BUG THIS BATCH EXISTS FOR. A real organisation had BOM and Inventory",
    "// cancelled and went on seeing both in its menu and using both through the",
    "// API. Every read of org_modules lived inside routes/admin.ts; the console",
    "// reported a state nothing honoured. requireModule() is the missing half,",
    "// and an entitlement with no test is exactly the sort of thing that quietly",
    "// stops working again.",
    "//",
    "// THREE CLAIMS, and the middle one is the one that matters:",
    "//",
    "//   STK-33  An organisation with NO row for a module keeps it. Absence is",
    "//           not denial: a missing row is an organisation provisioned before",
    "//           these rows were written, not one anybody withdrew anything from.",
    "//           The row is deleted, the endpoint is checked, the row is put",
    "//           back - because every seeded org holds all five modules and the",
    "//           state this rule is about has to be made rather than found.",
    "//   STK-34  A WITHDRAWN module is refused - and the books are not. Stock",
    "//           movement stops; journals, bills, invoices, the item master and",
    "//           the GST returns carry on exactly as before.",
    "//   STK-35  Restoring the grant restores the access, in the same run.",
    "//",
    "// Phase 19, which is AFTER the controls at 18, and that is deliberate rather",
    "// than careless. The rule everywhere else in this pack is that a control is",
    "// the last thing to run, because a control that runs before the last posting",
    "// proves nothing. These steps post nothing: they read endpoints, and the one",
    "// thing they write - a status column on org_modules - is put back before the",
    "// batch ends. No accounting control could observe them, so nothing is",
    "// weakened by their running afterwards. Any step that DID move stock would",
    "// have to go before 18.",
    "",
    "import { C, SQL, CAP } from \"./stkPack.mjs\";",
    "",
    "const A = { login: \"A\" };",
    "",
    "// The grant, by module code. Written out rather than hidden in a helper",
    "// because the WHERE clause is the safety here - it names one organisation",
    "// and one module, and `= 1` below proves it matched exactly that.",
    "const grant = (code, status) =>",
    "  `UPDATE org_modules SET status='${status}' WHERE organization_id={{ORG_A}} ` +",
    "  `AND module_id=(SELECT id FROM modules WHERE code='${code}')`;",
    "",
    "const rowsFor = (code) =>",
    "  `SELECT count(*) FROM org_modules om JOIN modules m ON m.id=om.module_id ` +",
    "  `WHERE om.organization_id={{ORG_A}} AND m.code='${code}'`;",
    "",
    "const dropGrant = (code) =>",
    "  `DELETE FROM org_modules WHERE organization_id={{ORG_A}} ` +",
    "  `AND module_id=(SELECT id FROM modules WHERE code='${code}')`;",
    "",
    "const addGrant = (code) =>",
    "  `INSERT INTO org_modules (organization_id, module_id) ` +",
    "  `SELECT {{ORG_A}}, id FROM modules WHERE code='${code}'`;",
    "",
    "// ---------------------------------------------------------------------------",
    "const T33 = \"A module nobody recorded is not a module anybody withdrew\";",
    "C(\"STK-33.1\", T33, \"Take ORG-A's BOM row away entirely - not cancel it, remove it.\", 19, {",
    "  ...A,",
    "  asserts: [SQL(dropGrant(\"BOM\"), 1), SQL(rowsFor(\"BOM\"), 0), SQL(rowsFor(\"INVENTORY\"), 1)],",
    "  note: \"THE ABSENCE HAS TO BE MANUFACTURED, and this step exists because assuming it was already there is how this case was wrong the first time. It asserted that ORG-A had no BOM grant, on the reasoning that BOM belongs to the Manufacturing domain and ORG-A is a Trading org. ORG-A is BOTH: tests/seed.ts registers every organisation with `domains: { TRADING: {}, MANUFACTURING: {} }`, because the pack needs 1201 from one and 1301/1303 from the other. So every seeded org holds all five modules and no seeded org can demonstrate absence. Deleting the row makes the state the rule is about, rather than hoping the seed happens to produce it - and it is restored two steps below.\",",
    "});",
    "C(\"STK-33.2\", T33, \"With no row at all, the BOM endpoint still answers.\", 19, {",
    "  ...A, method: \"GET\", path: \"/production-orders\", status: 200,",
    "  note: \"THE RULE THAT KEEPS THIS CHANGE SAFE. An absent row is not a decision anybody made - it is an organisation provisioned before these rows were written. Reading absence as 'unsubscribed' would have locked working tenants out of screens they had used for months, on the strength of a table nothing had been maintaining. So the guard denies only what was explicitly withdrawn, and this step is what stops a later 'tidy-up' from quietly inverting that. The admin console's UNSUBSCRIBED filter DOES read no-rows as not-subscribed, which is right for a sales dashboard and wrong for an access check - the two questions look identical and are not. Note what the previous version of this step proved: nothing. It passed because ORG-A held an ACTIVE BOM grant, so it exercised the ordinary allow path and reported it as evidence about absence.\",",
    "});",
    "C(\"STK-33.3\", T33, \"Put the row back before anything else runs.\", 19, {",
    "  ...A,",
    "  asserts: [SQL(addGrant(\"BOM\"), 1), SQL(rowsFor(\"BOM\"), 1)],",
    "  note: \"Restored immediately, in the same case that removed it, so no later step inherits a half-provisioned organisation. status, starts_on and enabled_at all take their column defaults - the same values provisioning would have written - so the row is indistinguishable from the one that was there.\",",
    "});",
    "",
    "// ---------------------------------------------------------------------------",
    "const T34 = \"A withdrawn module is refused, and the books are not\";",
    "C(\"STK-34.1\", T34, \"Withdraw ORG-A's Inventory subscription.\", 19, {",
    "  ...A,",
    "  asserts: [SQL(grant(\"INVENTORY\", \"CANCELLED\"), 1)],",
    "  note: \"The same column the platform admin console writes when somebody clicks cancel. Done in SQL rather than through /admin/subscriptions because that endpoint needs a platform-admin login and this pack deliberately holds two ordinary org logins - what is under test is what the API does when the row says CANCELLED, not how the row came to say it. `= 1` is the safety: the statement must have hit exactly one row, so a wrong WHERE clause fails here rather than testing nothing three steps later.\",",
    "});",
    "C(\"STK-34.2\", T34, \"The stock ledger is refused, with a status somebody can act on.\", 19, {",
    "  ...A, method: \"GET\", path: \"/inventory/stock-ledger?itemId={{ITM_BRG_A}}\", status: 402,",
    "  asserts: ['error contains \"Inventory subscription is not active\"'],",
    "  note: \"402 Payment Required, not 403 Forbidden, and the difference is not pedantry. 403 tells a user they are not allowed to do this, which they cannot act on and which is not even true - their role permits it. 402 says the ORGANISATION's entitlement is the problem, which is a thing somebody can go and fix. It is the same status requireActiveSubscription() already returns for a suspended subscription, for the same reason.\",",
    "});",
    "C(\"STK-34.3\", T34, \"So are adjustments, transfers and valuation.\", 19, {",
    "  ...A, method: \"GET\", path: \"/stock-transfers\", status: 402,",
    "  note: \"The whole Inventory surface, not one endpoint of it. The guard is mounted on the router rather than sprinkled over handlers, so a route added to any of these files tomorrow is covered the day it is written - which is the only way a gate like this stays true.\",",
    "});",
    "C(\"STK-34.4\", T34, \"The BOOKS are untouched. This is the half that matters.\", 19, {",
    "  ...A, method: \"GET\", path: \"/journal\", status: 200,",
    "  note: \"AN ORGANISATION THAT GIVES UP INVENTORY IS GIVING UP STOCK MOVEMENT, NOT ITS ACCOUNTS. It keeps every journal entry it has ever posted and can post more. If cancelling a module could shut the ledger, no one could ever safely cancel one - and the first person to try would find their books unreachable at the worst possible moment.\",",
    "});",
    "C(\"STK-34.5\", T34, \"It can still buy, sell and file.\", 19, {",
    "  ...A, method: \"GET\", path: \"/purchase-bills\", status: 200,",
    "  note: \"Purchases, sales and the statutory reports are their own modules and their own subscriptions. Withdrawing Inventory must not touch them, and a guard applied one router too wide is exactly how it would.\",",
    "});",
    "C(\"STK-34.6\", T34, \"The item master stays open, because SERVICE items live there.\", 19, {",
    "  ...A, method: \"GET\", path: \"/items\", status: 200,",
    "  note: \"THE ONE ENDPOINT IT WOULD HAVE BEEN EASIEST TO GET WRONG. /items looks like an Inventory screen and is not: a SERVICE item holds no stock, debits an expense head, and is the one master a business without inventory needs MOST - it is how they record what they buy. Gate this and 'we cancelled Inventory' becomes 'the app stopped working'.\",",
    "});",
    "C(\"STK-34.7\", T34, \"A SERVICE item can still be created; a STOCK item cannot.\", 19, {",
    "  ...A, method: \"POST\", path: \"/items\", status: 402,",
    "  body: { sku: \"ENT-STK-1\", name: \"Stock item during cancellation\", uom: \"EA\",",
    "          hsnCode: \"84137010\", itemKind: \"STOCK\", stockAccountId: \"{{ACC_1201_A}}\",",
    "          taxRate: 18 },",
    "  asserts: ['error contains \"only service items can be added\"'],",
    "  note: \"The line the whole design sits on, and the reason the costing-method check moved inside a `kind === STOCK` branch. POST /items used to refuse EVERY item until the org had set a stock costing method - and setting one is now an Inventory operation. Left alone, an organisation without Inventory could set no method, so could create no item, so could raise no purchase bill: its books shut by an entitlement about stock. Now the costing method and the Inventory grant bind stock items only.\",",
    "});",
    "C(\"STK-34.8\", T34, \"The service half of that same pair.\", 19, {",
    "  ...A, method: \"POST\", path: \"/items\", status: 201,",
    "  body: { sku: \"ENT-SVC-1\", name: \"Service item during cancellation\", uom: \"EA\",",
    "          itemKind: \"SERVICE\", stockAccountId: \"{{ACC_4008}}\", taxRate: 18 },",
    "  asserts: [\"field data.itemKind = SERVICE\"],",
    "  note: \"THE PAIR IS THE TEST, exactly as STK-21.3 and STK-21.4 were for the HSN rule. Same endpoint, same organisation, same moment, one refused and one accepted - because the difference is the kind of item, not the endpoint. Either assertion alone would pass against software that had the rule backwards.\",",
    "});",
    "",
    "// ---------------------------------------------------------------------------",
    "const T35 = \"Restoring the grant restores the access\";",
    "C(\"STK-35.1\", T35, \"Reinstate the subscription.\", 19, {",
    "  ...A,",
    "  asserts: [SQL(grant(\"INVENTORY\", \"ACTIVE\"), 1)],",
    "  note: \"Put back inside the same batch that took it away, so the pack leaves the database exactly as it found it. A test that withdraws an entitlement and does not restore it poisons every run after it - and would be found the slow way, by a later batch failing for a reason that has nothing to do with what it was testing.\",",
    "});",
    "C(\"STK-35.2\", T35, \"And the stock ledger answers again.\", 19, {",
    "  ...A, method: \"GET\", path: \"/inventory/stock-ledger?itemId={{ITM_BRG_A}}\", status: 200,",
    "  note: \"The other direction, which is what makes STK-34 a test rather than a coincidence. A guard that refused everything always would have passed every assertion in STK-34 and failed here.\",",
    "});",
    "C(\"STK-35.3\", T35, \"Nothing else was changed on the way through.\", 19, {",
    "  ...A,",
    "  asserts: [SQL(rowsFor(\"BOM\"), 1),",
    "            SQL(\"SELECT count(*) FROM org_modules WHERE organization_id={{ORG_A}}\", 5),",
    "            SQL(\"SELECT count(*) FROM org_modules WHERE organization_id={{ORG_A}} \" +",
    "                \"AND status<>'ACTIVE'\", 0),",
    "            SQL(\"SELECT count(*) FROM items WHERE organization_id={{ORG_A}} \" +",
    "                \"AND sku='ENT-STK-1'\", 0)],",
    "  note: \"THE CONTROL ON THIS BATCH, and it has to be, because this batch is the only one in either pack that writes to the database directly. All five grants are present and ACTIVE - the BOM row STK-33 deleted is back, the INVENTORY row STK-34 cancelled is reinstated - so the organisation is exactly as provisioning left it and the next run starts from the same place this one did. The count of 5 is what catches a restore that inserted a duplicate rather than replacing what it removed. And the refused STOCK item wrote nothing: a 402 that had already created the row would be a far worse defect than the one this batch was written for, and 'the request failed' is not by itself evidence that it failed cleanly.\",",
    "});"
),
  "Take ORG-A's BOM row away entirely");

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["tests/stkCasesF.mjs"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}