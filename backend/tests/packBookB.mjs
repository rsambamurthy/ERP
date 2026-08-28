// The test pack workbook, part B of two.
//
//   cd backend
//   node tests/packBookB.mjs
//   node tests/buildWorkbook.mjs
//
// Run packBookA.mjs first. This replaces the sentinel line it left at the end
// of tests/buildWorkbook.mjs with the Summary section and the tail.
//
// If it says the sentinel is missing, either part A has not run or part B has
// already run. The hash at the end tells you which: if it matches the one I
// gave you, the file is complete and there is nothing to do.

import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const at = (f) => path.join(here, "..", f);
const L = (...lines) => lines.join("\n");
const TARGET = "tests/buildWorkbook.mjs";

const SENTINEL = "// ---- packBookB.mjs appends the rest below this line ----";

const PART_B = L(
  "const built = MODULES.map(buildSheet);",
  "",
  "// ---- Summary, written last so the ranges are known ------------------------",
  "band(\"SmartERP \u2014 test pack and results\");",
  "line(\"Workbook generated\", undefined, new Date().toISOString().slice(0, 16).replace(\"T\", \" \"));",
  "if (orgs) {",
  "  line(\"Runs drove ORG-A\", undefined, orgs.A);",
  "  line(\"Runs drove ORG-B\", undefined, orgs.B);",
  "  line(\"\", undefined,",
  "    \"The seed makes a NEW pair every time, on purpose - see the last section. If a \" +",
  "    \"module's results predate the pair named here, they were recorded against a \" +",
  "    \"different organisation and its figures do not describe this one.\");",
  "}",
  "r++;",
  "",
  "const WHY = [",
  "  [\"Pass\", \"Ran, and every assertion held.\"],",
  "  [\"Fail\", \"Ran, and something did not hold. Column J says what.\"],",
  "  [\"Manual\", \"Needs a person or a browser: a UI drill-down, or a path the seed cannot reach.\"],",
  "  [\"Skipped\", \"Waiting on a period that has not ended. It runs by itself once the calendar catches up.\"],",
  "  [\"Deferred\", \"Written as a scenario, deliberately not yet specified for the runner. The Note column says what it is waiting on.\"],",
  "  [\"Not run\", \"No verdict in the results file for a step that should have one. If this is not zero, the run did not finish.\"],",
  "];",
  "",
  "for (const m of built) {",
  "  band(`${m.sheet} \u2014 how the last run went`);",
  "  line(\"\", undefined, m.blurb).height = 30;",
  "  if (m.missing) {",
  "    line(\"No cases yet\", undefined,",
  "      `tests/${m.cases} does not exist, so there is no sheet for this module.`).height = 28;",
  "    r++; continue;",
  "  }",
  "  if (!m.results.length) {",
  "    line(\"Not run yet\", undefined,",
  "      `tests/${m.results} does not exist. Every row on the ${m.sheet} sheet reads \"Not run\".`).height = 28;",
  "  }",
  "  for (const [label, why] of WHY) {",
  "    // COUNTIF rather than a number baked in here: change a verdict on the",
  "    // module's sheet and this follows. Excel recalculates on open.",
  "    line(label, { formula: `COUNTIF(${m.range},\"${label}\")` }, why, true);",
  "  }",
  "  line(\"Total steps\", { formula: `COUNTA(${m.range})` }, undefined, true);",
  "  if (m.results.length) line(\"Recorded\", undefined, String(m.results[0].at ?? \"\"));",
  "  r++;",
  "}",
  "",
  "band(\"What is not covered, and why\");",
  "for (const [t, d] of [",
  "  [\"Depreciation \u2014 three manual steps\",",
  "   \"DEP-01.3 and DEP-19.4 are sub-ledger drill-downs in the UI. DEP-13.3 is the run-time \" +",
  "   \"WDV_NEEDS_RESIDUAL block, which needs an asset capitalised under SLM and then moved to WDV \" +",
  "   \"afterwards \u2014 the seed cannot produce that ordering, so it is recorded as a gap, not faked.\"],",
  "  [\"Depreciation \u2014 four skipped steps\",",
  "   \"That pack's calendar is pinned to April\u2013October 2026. The engine correctly refuses to post a \" +",
  "   \"period that has not ended, so anything past the current month waits. Anchoring the pack to the \" +",
  "   \"run date instead would remove this.\"],",
  "  [\"Stock \u2014 one manual step\",",
  "   \"STK-30.5 is a per-branch drill-down into the item cards under 1201 / 1301 / 1303. It is the \" +",
  "   \"same comparison STK-30.2 makes in aggregate, done card by card, which is a screen job.\"],",
  "  [\"Stock \u2014 two deferred steps\",",
  "   \"STK-07.2 needs a production order and STK-09.3 needs a second purchase return in ORG-B. Both \" +",
  "   \"are specified with batch 2 rather than written as something that cannot run.\"],",
  "  [\"Stock \u2014 batches 2 to 4\",",
  "   \"Production (STK-10\u201316), branch transfers (STK-17\u201325) and reconciliation plus the GST \" +",
  "   \"returns (STK-26\u201329) are written as scenarios but not yet specified as cases. Until they \" +",
  "   \"exist, STK-30.3's assertion that Work in Progress and Stock in Transit are both nil is true \" +",
  "   \"because nothing has moved them \u2014 which is worth knowing when reading it.\"],",
  "]) line(t, undefined, d, true).height = 44;",
  "r++;",
  "",
  "band(\"Running it again\");",
  "for (const t of [",
  "  \"cd backend\",",
  "  \"npm run test:seed              a FRESH pair of organisations, recorded in tests/.testorgs.json\",",
  "  \"npm run test:dep               depreciation \u2192 tests/SmartERP-Test-Results.json\",",
  "  \"npm run test:stk               stock       \u2192 tests/SmartERP-Test-Results-STK.json\",",
  "  \"node tests/buildWorkbook.mjs   rebuilds this workbook from whatever of those exist\",",
  "  \"\",",
  "  \"Both modules should run against the SAME seeded pair, in that order, before the workbook is\",",
  "  \"rebuilt - otherwise the two sheets describe two different organisations and the Summary above\",",
  "  \"will be naming only the later one.\",",
  "  \"\",",
  "  \"The seed makes new organisations every time on purpose. The packs assert exact figures, and those\",",
  "  \"hold only where nothing else has ever happened \u2014 depreciation cannot be un-posted, so a second run\",",
  "  \"against the same organisation charges two laptops and every number is wrong for a reason that has\",",
  "  \"nothing to do with the software. Nothing is deleted; the old test organisations are left behind.\",",
  "]) {",
  "  const row = sum.getRow(r++);",
  "  row.getCell(1).value = t;",
  "  row.font = { name: /^(cd|npm|node) /.test(t) ? \"Consolas\" : FONT, size: 10 };",
  "  sum.mergeCells(row.number, 1, row.number, 6);",
  "}",
  "sum.views = [{ state: \"frozen\", ySplit: 1 }];",
  "",
  "// Excel keeps an exclusive lock on an open workbook, and Windows reports that",
  "// as EBUSY. The stack trace that comes back says \"resource busy or locked\",",
  "// which is true and tells you nothing about what to do, so say it plainly and",
  "// leave the existing file alone.",
  "try {",
  "  await wb.xlsx.writeFile(out);",
  "} catch (e) {",
  "  if (e && (e.code === \"EBUSY\" || e.code === \"EPERM\")) {",
  "    console.error(`Cannot write ${path.basename(out)} - it is open in Excel.`);",
  "    console.error(\"Close it and run this again. The previous workbook is untouched.\");",
  "    process.exit(1);",
  "  }",
  "  throw e;",
  "}",
  "console.log(`wrote ${path.relative(process.cwd(), out)}`);",
  "for (const m of built) {",
  "  if (m.missing) { console.log(`  ${m.sheet.padEnd(18)} no cases file - sheet skipped`); continue; }",
  "  const n = (o) => m.results.filter((x) => x.outcome === o).length;",
  "  console.log(`  ${m.sheet.padEnd(18)} ${String(m.steps).padStart(3)} steps` + (m.results.length",
  "    ? `   ${n(\"PASS\")} pass / ${n(\"FAIL\")} fail / ${n(\"MANUAL\")} manual / ${n(\"SKIPPED\")} skipped`",
  "    : \"   (no results file yet)\"));",
  "}");

const cur = fs.readFileSync(at(TARGET), "utf8").replace(/\r\n/g, "\n");
if (!cur.includes(SENTINEL)) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(TARGET))).digest("hex");
  console.log("sentinel not found - part A has not run, or part B already has.");
  console.log("  buildWorkbook.mjs   " + h.toUpperCase());
} else {
  const done = cur.replace(SENTINEL + "\n", PART_B.replace(/\n*$/, "\n"));
  fs.writeFileSync(at(TARGET), done.replace(/\n*$/, "\n"));
  console.log("part B appended - buildWorkbook.mjs is complete");
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(TARGET))).digest("hex");
  console.log("  buildWorkbook.mjs   " + h.toUpperCase());
}