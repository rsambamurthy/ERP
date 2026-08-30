// negE - move the phases, and wire the batch in. Run negD first.
//
// The negative-stock batch posts stock, so it has to run BEFORE the
// controls. That means everything after it shifts by one:
//
//   18  selling into negative stock   (new)
//   19  controls and reconciliation   (was 18)
//   20  module entitlement            (was 19)
//
// STK-30 has now moved 9 -> 10 -> 13 -> 17 -> 18 -> 19 across five batches.
// The number has never been the rule; being last before the entitlement
// batch is. And the entitlement batch is only allowed after the controls
// because it posts nothing.
//
// The renumbering is done by a COUNTED regular expression rather than by
// twenty separate anchors: it asserts how many phase numbers it expected to
// find and refuses to write anything if the count is wrong, which is a
// better guarantee than twenty chances to mistype a line.
//
// Then: node tests/makeStkCases.mjs && npx tsc --noEmit -p tests/tsconfig.json
// Expect 136 steps across 34 cases, 135 runnable.
//
// Save this as backend/tests/negE.mjs and run it from backend/:
//   node tests/negE.mjs
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

// Phase numbers move as batches are inserted before the controls. Done by
// a COUNTED regular expression rather than one anchor per case: it asserts
// how many it expected to find and writes nothing if the count is wrong,
// which is a better guarantee than twenty chances to mistype a line.
function renumber(file, re, newPhase, expect, done) {
  const t = read(file);
  if (t.includes(done)) { already++; save(file, t); return; }
  const n = (t.match(re) || []).length;
  if (n !== expect) throw new Error(file + ": expected " + expect + " phase numbers, found " + n);
  save(file, t.replace(re, (m, a, b) => a + newPhase + b));
  applied++;
}

edit("tests/runCases.ts",
  L(
    "        \"GST returns - GSTR-1 and GSTR-3B\", \"controls and reconciliation\",",
    "        \"module entitlement\"],"),
  L(
    "        \"GST returns - GSTR-1 and GSTR-3B\", \"selling into negative stock\",",
    "        \"controls and reconciliation\", \"module entitlement\"],"),
  "\"selling into negative stock\","
);

edit("tests/makeStkCases.mjs",
  L(
    "// stkCasesF.mjs is module entitlement, phase 19 - the only batch that runs",
    "// AFTER the controls, because it posts nothing and puts back the one"),
  L(
    "// stkCasesG.mjs is the negative-stock override, phase 18 - BEFORE the",
    "// controls, because it moves stock and posts COGS.",
    "// stkCasesF.mjs is module entitlement, phase 20 - the only batch that runs",
    "// AFTER the controls at 19, because it posts nothing and puts back the one"),
  "// stkCasesG.mjs is the negative-stock override, phase 18"
);

edit("tests/makeStkCases.mjs",
  "import \"./stkCasesE.mjs\";",
  L(
    "import \"./stkCasesE.mjs\";",
    "import \"./stkCasesG.mjs\";"),
  "import \"./stkCasesG.mjs\";"
);

renumber("tests/makeStkCases.mjs",
  /(C\("STK-30\.\d+", T30, "[^"]*", )18(,)/g, 19, 7,
  "C(\"STK-30.1\", T30, \"Read the ledger balance on 1201 for ORG-A.\", 19,");

renumber("tests/stkCasesF.mjs",
  /(C\("STK-3[345]\.\d+", T3[345], "[^"]*", )19(,)/g, 20, 14,
  "C(\"STK-33.1\", T33, \"Take ORG-A's BOM row away entirely - not cancel it, remove it.\", 20,");

edit("tests/stkCasesF.mjs",
  "// Phase 19, which is AFTER the controls at 18, and that is deliberate rather",
  "// Phase 20, which is AFTER the controls at 19, and that is deliberate rather",
  "// Phase 20, which is AFTER the controls at 19"
);

edit("tests/stkCasesF.mjs",
  "// have to go before 18.",
  "// have to go before 19 - which is where the negative-stock batch sits.",
  "// have to go before 19 - which is where the negative-stock batch sits."
);

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["tests/runCases.ts","tests/makeStkCases.mjs","tests/stkCasesF.mjs"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}