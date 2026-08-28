// Shared machinery for the Stock Management case pack.
//
// The cases are generated rather than hand-written as JSON because the JSON is
// 27 KB and this is 200 readable lines that say WHY each step exists. Re-run
// it any time; it is deterministic.
//
// BATCH 1 is the costing chain: one item, BRG-6205, walked forward through
// found stock, a purchase, a sale, shrinkage, a refused over-issue and a
// return, with the ledger checked at every step. Everything else in the module
// needs stock to exist and be valued first. Production is batch 2, branch
// transfers batch 3, the GST returns batch 4.
//
// PHASE ORDER MATTERS MORE HERE THAN IT DID FOR DEPRECIATION. Each case
// asserts the balance it inherits from the one before, so the phases are the
// dependency order: 2 found stock, 3 purchase, 4 sale, 5 shrinkage, 6 refusal,
// 7 FIFO in ORG-B, 8 returns, 9 controls.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const K = [];
export function C(key, title, action, phase, o = {}) {
  const d = { key, caseId: key.split(".")[0], caseTitle: title, action, phase,
              login: o.login ?? "A" };
  if (o.je) d.je = o.je;
  for (const k of ["method", "path", "body", "status"]) if (o[k] !== undefined) d[k] = o[k];
  if (o.capture) d.capture = o.capture;
  if (o.asserts) d.asserts = o.asserts;
  d.auto = o.auto ?? "YES";
  if (o.note) d.note = o.note;
  K.push(d);
}
export const je = (...rows) => rows.map(([code, name, debit, credit]) => ({ code, name, debit, credit }));
export const adj = (adjustmentDate, branchId, narration, lines) =>
  ({ adjustmentDate, branchId, narration, lines });
export const L = (itemId, direction, quantity, unitCost) =>
  unitCost === undefined ? { itemId, direction, quantity } : { itemId, direction, quantity, unitCost };
export const val = (sku, field, want) =>
  `GET /inventory/valuation :: field data.rows[item.sku=${sku}].${field} = ${want}`;
export const SQL = (q, eq) => `sql "${q}" = ${eq}`;
export const CAP = (q, name) => `sql "${q}" capture ${name}`;
export const bal = (org, code) =>
  "SELECT round(coalesce(sum(l.debit-l.credit),0),2) FROM journal_lines l " +
  "JOIN journal_entries e ON e.id=l.journal_entry_id JOIN accounts a ON a.id=l.account_id " +
  `WHERE e.organization_id=${org} AND a.account_code='${code}'`;
// The item's sub-ledger card under a control account.
//
// It is matched by the item's NAME, not its SKU: items.ts creates the card
// with `name`, so BRG-6205's card is called "Bearing 6205". Getting this
// wrong is worse than it sounds - the query returns 0, which is also what a
// real break returns, so a case would go on "failing as predicted" long after
// the defect behind it was fixed. bpType pins it to an item card so a vendor
// of the same name cannot answer instead.
export const card = (org, itemName) =>
  "SELECT round(coalesce(sum(l.debit-l.credit),0),2) FROM journal_lines l " +
  "JOIN journal_entries e ON e.id=l.journal_entry_id " +
  "JOIN business_partners p ON p.id=l.business_partner_id " +
  `WHERE e.organization_id=${org} AND p.bp_type='ITEM' AND p.name='${itemName}'`;


export function writeCases() {
  fs.writeFileSync(path.join(here, "stkCases.json"), JSON.stringify(K, null, 1) + "\n");
  const runnable = K.filter((c) => c.auto !== "TBD").length;
  console.log("wrote tests/stkCases.json");
  console.log(`  ${K.length} steps across ${new Set(K.map((c) => c.caseId)).size} cases, ` +
              `${runnable} runnable, ${K.length - runnable} deferred to batch 2`);
}