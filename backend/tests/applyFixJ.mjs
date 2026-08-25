// FixH, part 3 of 3 - the pack now describes the fixed behaviour.
//
//   node backend/tests/applyFixJ.mjs
//
// DEP-21 asserted the defect; it now asserts the rescission, and is no longer
// titled KNOWN DEFECT - a green result under that heading would read as a
// contradiction to whoever opens the pack next.
//
// DEP-14.4 gains the other half of show-it-once: June is posted by then, so
// the due period is July and the asset that just finished should be on that
// screen. DEP-14.5 checks it is gone again by the run after.
//
// Idempotent - it replaces whole cases by key.

import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, "depCases.json");
const cases = JSON.parse(fs.readFileSync(file, "utf8"));

// Split only between JSON tokens, never inside a string, so the pieces can be
// concatenated back without any escaping games.
const PATCH = JSON.parse([
 "{\"DEP-14.4\":{\"key\":\"DEP-14.4\",\"caseId\":\"DEP-14\",\"caseTitle\":\"End of life \\u2014 the last period is a balancing figure\"",
 ",\"action\":\"Post June 2026 \\u2014 the last period.\",\"je\":[{\"code\":\"4020\",\"name\":\"Depreciation & Amortisation\"",
 ",\"debit\":3600,\"credit\":0},{\"code\":\"1454\",\"name\":\"Accumulated Depreciation - Vehicles (asset card)\"",
 ",\"debit\":0,\"credit\":3600}],\"phase\":4,\"login\":\"A\",\"method\":\"POST\",\"path\":\"/depreciation-runs/post\"",
 ",\"body\":{\"periodStart\":\"2026-06-01\"},\"status\":200,\"asserts\":[\"GET /fixed-assets/{{DEP-14.assetId}}/schedule :: field data.periods[2].closingWdv = 1200.00\"",
 ",\"GET /fixed-assets :: field data[id={{DEP-14.assetId}}].status = FULLY_DEPRECIATED\",\"GET /depreciation-runs/due :: field data.blocked[id={{DEP-14.assetId}}].reason = FULLY_DEPRECIATED\"",
 ",\"journal depreciation_run period=2026-06-01 branch={{BR_A_D14}}\"],\"auto\":\"YES\",\"note\":\"Same posting as DEP-07.4.\"",
 "},\"DEP-14.5\":{\"key\":\"DEP-14.5\",\"caseId\":\"DEP-14\",\"caseTitle\":\"End of life \\u2014 the last period is a balancing figure\"",
 ",\"action\":\"Open Depreciation > Due after July is posted.\",\"phase\":5,\"login\":\"A\",\"method\":\"GET\",",
 "\"path\":\"/depreciation-runs/due\",\"status\":200,\"asserts\":[\"field count(data.assets[id={{DEP-14.assetId}}]) = 0\"",
 ",\"field count(data.blocked[id={{DEP-14.assetId}}]) = 0\"],\"auto\":\"YES\",\"note\":\"The other half of show-it-once: July is posted by now, so the asset that finished in June is in NEITHER list and stays that way.\"",
 "},\"DEP-21.0\":{\"key\":\"DEP-21.0\",\"caseId\":\"DEP-21\",\"caseTitle\":\"Purchase return of a capitalised line \\u2014 a rescission, not a disposal\"",
 ",\"action\":\"(setup lookup for the step that follows)\",\"phase\":7,\"login\":\"A\",\"method\":\"GET\",\"path\"",
 ":\"/purchase-returns/bill/{{DEP-01.billId}}/lines\",\"status\":200,\"capture\":{\"billLineId\":\"data.lines[0].id\"",
 "},\"auto\":\"YES\"},\"DEP-21.1\":{\"key\":\"DEP-21.1\",\"caseId\":\"DEP-21\",\"caseTitle\":\"Purchase return of a capitalised line \\u2014 a rescission, not a disposal\"",
 ",\"action\":\"Raise a Purchase Return against the DEP-01 bill for the capitalised laptop.\",\"phase\"",
 ":7,\"login\":\"A\",\"method\":\"POST\",\"path\":\"/purchase-returns\",\"body\":{\"purchaseBillId\":\"{{DEP-01.billId}}\"",
 ",\"returnDate\":\"2026-04-20\",\"branchId\":\"{{BR_A_D07}}\",\"lines\":[{\"purchaseBillLineId\":\"{{DEP-21.billLineId}}\"",
 ",\"quantity\":1}]},\"status\":201,\"capture\":{\"returnId\":\"data.id\"},\"auto\":\"YES\",\"note\":\"Full line only: one asset was created for the line, so half of it cannot come back.\"",
 ",\"asserts\":[\"field data.grandTotal = 141600.00\",\"sql \\\"SELECT coalesce(sum(l.debit-l.credit),0) FROM journal_lines l JOIN journal_entries e ON e.id=l.journal_entry_id JOIN accounts a ON a.id=l.account_id WHERE e.organization_id={{ORG_A}} AND e.reference_type='purchase_return'\\\" = 0\"",
 "]},\"DEP-21.2\":{\"key\":\"DEP-21.2\",\"caseId\":\"DEP-21\",\"caseTitle\":\"Purchase return of a capitalised line \\u2014 a rescission, not a disposal\"",
 ",\"action\":\"Read the journal entry that was written.\",\"je\":[{\"code\":\"2001\",\"name\":\"Accounts Payable (Sundar Systems)\"",
 ",\"debit\":141600,\"credit\":0},{\"code\":\"1405\",\"name\":\"Computers & Equipment (asset card) - cost reversed\"",
 ",\"debit\":0,\"credit\":120000},{\"code\":\"1102\",\"name\":\"CGST Input Credit reversed\",\"debit\":0,\"credit\"",
 ":10800},{\"code\":\"1103\",\"name\":\"SGST Input Credit reversed\",\"debit\":0,\"credit\":10800},{\"code\":\"1455\"",
 ",\"name\":\"Accumulated Depreciation - depreciation reversed\",\"debit\":7600,\"credit\":0},{\"code\":\"4020\"",
 ",\"name\":\"Depreciation & Amortisation - reversed\",\"debit\":0,\"credit\":7600}],\"phase\":7,\"login\":\"A\"",
 ",\"asserts\":[\"sql \\\"SELECT a.account_code FROM journal_lines l JOIN journal_entries e ON e.id=l.journal_entry_id JOIN accounts a ON a.id=l.account_id WHERE e.organization_id={{ORG_A}} AND e.reference_type='purchase_return' AND l.credit>0 AND a.account_type='ASSET'\\\" = 1405\"",
 ",\"sql \\\"SELECT coalesce(sum(l.debit),0) FROM journal_lines l JOIN journal_entries e ON e.id=l.journal_entry_id JOIN accounts a ON a.id=l.account_id WHERE e.organization_id={{ORG_A}} AND e.reference_type='purchase_return' AND a.account_code='1455'\\\" = 7600.00\"",
 ",\"sql \\\"SELECT coalesce(sum(l.credit),0) FROM journal_lines l JOIN journal_entries e ON e.id=l.journal_entry_id JOIN accounts a ON a.id=l.account_id WHERE e.organization_id={{ORG_A}} AND e.reference_type='purchase_return' AND a.account_code='4020'\\\" = 7600.00\"",
 "],\"auto\":\"YES\",\"note\":\"RESCISSION, not disposal: the purchase is undone, so no gain is booked and the depreciation charged in error comes back out.\"",
 "},\"DEP-21.3\":{\"key\":\"DEP-21.3\",\"caseId\":\"DEP-21\",\"caseTitle\":\"Purchase return of a capitalised line \\u2014 a rescission, not a disposal\"",
 ",\"action\":\"Open Depreciation > Due and look for the returned asset.\",\"phase\":7,\"login\":\"A\",\"method\"",
 ":\"GET\",\"path\":\"/depreciation-runs/due\",\"status\":200,\"asserts\":[\"field count(data.assets[id={{DEP-01.assetId}}]) = 0\"",
 ",\"field count(data.blocked[id={{DEP-01.assetId}}]) = 0\",\"GET /fixed-assets :: field count(data[id={{DEP-01.assetId}}]) = 0\"",
 ",\"sql \\\"SELECT status FROM fixed_assets WHERE id={{DEP-01.assetId}}\\\" = RETURNED\"],\"auto\":\"YES\"",
 ",\"note\":\"RETURNED, not DISPOSED - an auditor reading the disposals schedule should not find a disposal that never happened.\"",
 "}}"
].join(""));

for (const [k, v] of Object.entries(PATCH)) {
  const i = cases.findIndex((c) => c.key === k);
  if (i < 0) throw new Error(`${k} is not in depCases.json`);
  cases[i] = v;
}

fs.writeFileSync(file, JSON.stringify(cases, null, 1) + "\n");
console.log(`${Object.keys(PATCH).length} case(s) rewritten, ${cases.length} steps total`);
const sha = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
console.log(`SHA256 ${sha.toUpperCase()}`);