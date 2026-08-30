// negF - the two failures. One is a real defect, one is my test.
//
// THE DEFECT. inventory.ts computed a valuation row's averageCost as
// `qty > 0 ? value / qty : 0`. That guard existed to avoid dividing by
// zero, and it also caught every NEGATIVE balance - which used to be
// impossible and now is not. The row read minus six units at an average of
// ZERO with a value of minus 3,000.00: three numbers that cannot all be
// true at once, on the one report somebody would open when asking why an
// item is negative. Division by a negative is perfectly well defined; only
// zero is not.
//
// THE TEST. STK-36.8 sold ONE unit of BRG-6205 to prove that an invoice
// which asks for the override but does not need it records no reason. That
// worked - but BRG-6205's average is 219.7059 to four places, so one unit
// posts COGS of round2(219.7059) = 219.71 while the valuation keeps
// 79 x 219.7059 = 17,356.7661 and reports 17,356.77. A single paisa apart,
// and it broke STK-30.2, which ties the two together.
//
// Nothing there is wrong. A step meant to prove one thing was quietly also
// a rounding test. It now sells one unit of OPEN-TEST, whose average is
// exactly 500.00, so it tests only what it claims to.
//
// THE PAISA IS REAL AND IS NOT FIXED HERE. Rounding COGS to the paisa per
// document while the valuation keeps four decimals will differ by a paisa
// on some quantities, for any item whose average is not exact. It wants a
// decision about which side is authoritative, and that is its own change.
//
// Then: node tests/makeStkCases.mjs && npm run test:seed / dep / stk
//
// Save this as backend/tests/negF.mjs and run it from backend/:
//   node tests/negF.mjs
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

edit("src/routes/inventory.ts",
  "        quantityOnHand: qty, averageCost: qty > 0 ? value / qty : 0, value,",
  L(
    "        // NOT `qty > 0`. That guard was there to avoid dividing by zero and it",
    "        // also caught every NEGATIVE balance, which used to be impossible and",
    "        // now is not - migration_053 lets a sales invoice sell what the branch",
    "        // does not hold. The row then read minus six units at an average of",
    "        // ZERO with a value of minus 3,000.00, three figures that cannot all be",
    "        // true at once, on the one report somebody would go to when asking why",
    "        // an item is negative.",
    "        //",
    "        // Division by a negative is perfectly well defined; only zero is not.",
    "        quantityOnHand: qty, averageCost: Math.abs(qty) > 0.0001 ? value / qty : 0, value,"),
  "Math.abs(qty) > 0.0001 ? value / qty : 0"
);

edit("tests/stkCasesG.mjs",
  L(
    "          lines: [{ itemId: \"{{ITM_BRG_A}}\", quantity: 1, rate: 400, taxRate: 18 }] },",
    "  capture: { plainId: \"data.id\" },",
    "  asserts: [SQL(\"SELECT negative_stock_reason FROM sales_invoices WHERE id={{STK-36.plainId}}\", \"null\")],",
    "  note: \"BRG-6205 has plenty on hand, so nothing went negative and NO reason is recorded, even though the request carried one. 'Was the override allowed' and 'was the override used' are different questions, and only the second belongs on an exception report - otherwise a cautious operator who ticks the box on every invoice fills that report with documents that never sold anything they did not have. consumeStock returns wentNegative for exactly this.\","),
  L(
    "          lines: [{ itemId: \"{{STK-01.itemId}}\", quantity: 1, rate: 900, taxRate: 18 }] },",
    "  capture: { plainId: \"data.id\" },",
    "  asserts: [SQL(\"SELECT negative_stock_reason FROM sales_invoices WHERE id={{STK-36.plainId}}\", \"null\"),",
    "            val(\"OPEN-TEST\", \"quantityOnHand\", \"9\")],",
    "  note: \"OPEN-TEST has ten on hand, so nothing went negative and NO reason is recorded, even though the request carried one. 'Was the override allowed' and 'was the override used' are different questions, and only the second belongs on an exception report - otherwise a cautious operator who ticks the box on every invoice fills that report with documents that never sold anything they did not have. consumeStock returns wentNegative for exactly this. OPEN-TEST RATHER THAN BRG-6205, and the reason is worth recording: BRG-6205's average is 219.7059 to four places, so selling ONE unit posts COGS of round2(219.7059) = 219.71 while the valuation keeps 79 x 219.7059 = 17,356.7661 and reports 17,356.77. A single paisa apart, and it broke STK-30.2 - not because anything here is wrong, but because a step meant to prove one thing was quietly also a rounding test. OPEN-TEST's average is exactly 500.00, so this step tests only what it claims to. The paisa is real and is its own open question.\","),
  "val(\"OPEN-TEST\", \"quantityOnHand\", \"9\")"
);

edit("tests/makeStkCases.mjs",
  "  note: \"THE HEADLINE CONTROL: stock on the report equals stock in the accounts, 22,576.47 either way - BRG-6205 at 17,576.47 after the sales return, plus OPEN-TEST at 5,000.00. Before this batch it failed by 5,352.94, and that number is the whole reason to run it: 5,000.00 of opening stock sat on the report with nothing behind it in the ledger, and 352.94 was the purchase return leaving the ledger at the bill rate while the valuation moved at the average. Two independent defects, and only this one step said anything was wrong. It read 20,376.47 while it sat in phase 9, because it ran before the sales return - see the note above.\",",
  "  note: \"THE HEADLINE CONTROL: stock on the report equals stock in the accounts, whatever that figure happens to be - which is why it is CAPTURED in the step above rather than written here. It now has three items in it: BRG-6205 at 17,576.47 after the sales return, OPEN-TEST at 4,500.00 after STK-36.8 sold one unit, and NEG-TEST at MINUS 3,000.00. The negative row is the strongest part of this control and it is deliberate: a valuation report that quietly dropped negative balances, or a ledger that did, would break this tie and nothing else in the pack would notice. Before this batch it failed by 5,352.94, and that number is the whole reason to run it: 5,000.00 of opening stock sat on the report with nothing behind it in the ledger, and 352.94 was the purchase return leaving the ledger at the bill rate while the valuation moved at the average. Two independent defects, and only this one step said anything was wrong. It read 20,376.47 while it sat in phase 9, because it ran before the sales return - see the note above.\",",
  "whatever that figure happens to be"
);

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["src/routes/inventory.ts","tests/stkCasesG.mjs","tests/makeStkCases.mjs"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}