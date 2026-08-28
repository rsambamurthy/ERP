// The test pack workbook, part A of two - REPLACES tests/buildWorkbook.mjs.
//
//   cd backend
//   node tests/packBookA.mjs      <- writes the first half, then stops
//   node tests/packBookB.mjs      <- appends the second half
//   node tests/buildWorkbook.mjs
//
// Run BOTH, in that order, before running the workbook builder. Part A leaves
// the file deliberately incomplete and ending in a sentinel line; part B
// replaces that line with the rest. Running the builder in between will fail
// with a syntax error, which is the intended behaviour - a half-written
// generator should not produce a workbook.
//
// WHAT CHANGED. The old builder knew about depreciation only, and its Summary
// said stock had no cases because at the time it had none. There are 37 now.
// Rather than bolt a second copy of the sheet code alongside the first, the
// per-sheet work is a function and the modules are a two-row table: adding a
// third module later is a row in that table and nothing else.
//
// It also splits "Deferred" out from "Not run". A step marked "Not yet" in the
// Automated column was never specified for the runner; calling that "Not run"
// reads as an omission when it was a decision. "Not run" now means only what
// it says - a step that should have a verdict and has none, which is how you
// spot a run that died half way.

import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const at = (f) => path.join(here, "..", f);
const L = (...lines) => lines.join("\n");
const TARGET = "tests/buildWorkbook.mjs";

const PART_A = L(
  "// Builds the test pack as a workbook, with the last run's verdict on every row.",
  "//",
  "//   node backend/tests/buildWorkbook.mjs",
  "//",
  "// Everything it needs is already on your disk:",
  "//   tests/depCases.json                    depreciation: what each step calls",
  "//   tests/stkCases.json                    stock: the same",
  "//   tests/SmartERP-Test-Results.json       the last depreciation run",
  "//   tests/SmartERP-Test-Results-STK.json   the last stock run",
  "//   tests/.testorgs.json                   which organisations those runs drove",
  "//",
  "// The request body IS the test data and the assertions ARE the expected",
  "// result, so nothing has to be shipped alongside. That is also why this is",
  "// the truer record: a prose description of what a step expects can drift away",
  "// from what it actually checks, and these cannot.",
  "//",
  "// A module with no cases file is skipped and says so. A module with cases but",
  "// no results renders every row as \"Not run\" rather than pretending.",
  "//",
  "// Writes backend/SmartERP-Test-Pack.xlsx - NOT tests/SmartERP-Test-Scenarios.xlsx,",
  "// deliberately. harness.readCases() prefers that exact path over the JSON, so a",
  "// workbook sitting there would quietly become the suite's source of truth, and",
  "// this one has no Automation sheet: the next run would die on",
  "// \"No 'Automation' sheet\".",
  "",
  "import fs from \"fs\";",
  "import path from \"path\";",
  "import { fileURLToPath } from \"url\";",
  "import ExcelJS from \"exceljs\";",
  "import { plain, requestText, jeText } from \"./packRender.mjs\";",
  "",
  "const here = path.dirname(fileURLToPath(import.meta.url));",
  "const out = path.join(here, \"..\", \"SmartERP-Test-Pack.xlsx\");",
  "",
  "const FONT = \"Arial\";",
  "const HEAD = \"FF1F3864\", WARN = \"FFFFF2CC\";",
  "const PASS = \"FFE2EFDA\", FAIL = \"FFFCE4EC\", SKIP = \"FFF2F2F2\";",
  "const VERDICT_COL = 9;",
  "",
  "const read = (f, dflt) => {",
  "  const p = path.join(here, f);",
  "  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, \"utf8\")) : dflt;",
  "};",
  "",
  "// The two modules, and the one line each needs to describe itself. Adding a",
  "// third means adding a row here and nothing else.",
  "const MODULES = [",
  "  { key: \"DEP\", sheet: \"Depreciation\", cases: \"depCases.json\",",
  "    results: \"SmartERP-Test-Results.json\",",
  "    blurb: \"Capitalisation, the schedule, monthly and quarterly posting, the \" +",
  "           \"method change, disposal and the purchase-return rescission.\" },",
  "  { key: \"STK\", sheet: \"Stock Management\", cases: \"stkCases.json\",",
  "    results: \"SmartERP-Test-Results-STK.json\",",
  "    blurb: \"The costing chain on one item - found stock, purchase, sale, \" +",
  "           \"shrinkage, a refused over-issue, both returns - plus FIFO in ORG-B \" +",
  "           \"and the reconciliation controls. Production, transfers and the GST \" +",
  "           \"returns are batches 2 to 4.\" },",
  "];",
  "",
  "const orgs = read(\".testorgs.json\", null);",
  "",
  "const AUTO = { YES: \"Yes\", PARTIAL: \"Partly\", NO: \"No\", TBD: \"Not yet\" };",
  "const OUTCOME = { PASS: \"Pass\", FAIL: \"Fail\", MANUAL: \"Manual\", SKIPPED: \"Skipped\" };",
  "const VERDICT_FILL = { Pass: PASS, Fail: FAIL, Skipped: SKIP, Manual: WARN,",
  "                       Deferred: SKIP, \"Not run\": SKIP };",
  "",
  "const wb = new ExcelJS.Workbook();",
  "wb.creator = \"SmartERP test runner\";",
  "wb.created = new Date();",
  "",
  "const sum = wb.addWorksheet(\"Summary\");",
  "sum.columns = [{ width: 28 }, { width: 10 }, ...Array(4).fill({ width: 26 })];",
  "let r = 1;",
  "const band = (text) => {",
  "  const row = sum.getRow(r++);",
  "  row.getCell(1).value = text;",
  "  row.font = { name: FONT, size: 11, bold: true, color: { argb: \"FFFFFFFF\" } };",
  "  row.fill = { type: \"pattern\", pattern: \"solid\", fgColor: { argb: HEAD } };",
  "  sum.mergeCells(row.number, 1, row.number, 6);",
  "  row.height = 22; r++;",
  "};",
  "const line = (a, b, c, bold) => {",
  "  const row = sum.getRow(r++);",
  "  row.font = { name: FONT, size: 10 };",
  "  row.getCell(1).value = a;",
  "  row.getCell(1).font = { name: FONT, size: 10, bold: !!bold };",
  "  row.getCell(1).alignment = { vertical: \"top\" };",
  "  if (b !== undefined) { row.getCell(2).value = b; row.getCell(2).alignment = { horizontal: \"center\" }; }",
  "  if (c !== undefined) {",
  "    row.getCell(3).value = c;",
  "    row.getCell(3).alignment = { wrapText: true, vertical: \"top\" };",
  "    sum.mergeCells(row.number, 3, row.number, 6);",
  "  }",
  "  return row;",
  "};",
  "",
  "const COLS = [",
  "  [\"Case\", 10], [\"Scenario\", 30], [\"Step\", 6], [\"What you do\", 34],",
  "  [\"The call, and the data\", 46], [\"What must be true afterwards\", 58],",
  "  [\"Expected ledger\", 32], [\"Automated\", 11], [\"Result\", 10],",
  "  [\"What the run reported\", 44], [\"Note\", 30],",
  "];",
  "",
  "// One sheet per module. Returns what the Summary needs to describe it.",
  "function buildSheet(mod) {",
  "  const cases = read(mod.cases, null);",
  "  if (!cases) return { ...mod, missing: true };",
  "  const results = read(mod.results, []);",
  "  const resultBy = new Map(results.map((x) => [x.key, x]));",
  "",
  "  const ws = wb.addWorksheet(mod.sheet, {",
  "    views: [{ state: \"frozen\", ySplit: 1 }],",
  "    pageSetup: { orientation: \"landscape\", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },",
  "  });",
  "  ws.columns = COLS.map(([header, width]) => ({ header, width }));",
  "  const head = ws.getRow(1);",
  "  head.font = { name: FONT, size: 10, bold: true, color: { argb: \"FFFFFFFF\" } };",
  "  head.fill = { type: \"pattern\", pattern: \"solid\", fgColor: { argb: HEAD } };",
  "  head.alignment = { vertical: \"middle\", wrapText: true };",
  "  head.height = 30;",
  "",
  "  let lastCase = null;",
  "  for (const s of cases) {",
  "    const res = resultBy.get(s.key);",
  "    const first = s.caseId !== lastCase;",
  "    const row = ws.addRow([",
  "      first ? s.caseId : \"\", first ? s.caseTitle : \"\",",
  "      s.key.split(\".\")[1], s.action,",
  "      requestText(s),",
  "      (s.asserts ?? []).map(plain).join(\"\\n\\n\") ||",
  "        (s.capture ? \"Reads values the later steps need. Nothing is checked here.\" : \"\"),",
  "      jeText(s.je),",
  "      AUTO[s.auto] ?? s.auto,",
  "      // A step with no result is not all one thing. \"Not yet\" in the Automated",
  "      // column means it was never specified for the runner, and calling that",
  "      // \"Not run\" reads as an omission rather than a decision.",
  "      res ? OUTCOME[res.outcome] ?? res.outcome : s.auto === \"TBD\" ? \"Deferred\" : \"Not run\",",
  "      res ? res.detail : \"\",",
  "      [s.note, s.needsPeriod ? `Only runs once ${s.needsPeriod} has been posted.` : \"\"]",
  "        .filter(Boolean).join(\"\\n\"),",
  "    ]);",
  "    row.font = { name: FONT, size: 10 };",
  "    row.alignment = { vertical: \"top\", wrapText: true };",
  "    // A rule across the top of each scenario. Without it 66 rows is a wall.",
  "    if (first) {",
  "      row.border = { top: { style: \"thin\", color: { argb: \"FF8EA9DB\" } } };",
  "      for (const c of [1, 2]) row.getCell(c).font = { name: FONT, size: 10, bold: true };",
  "    }",
  "    const v = row.getCell(VERDICT_COL);",
  "    v.alignment = { vertical: \"top\", horizontal: \"center\" };",
  "    const fill = VERDICT_FILL[v.value];",
  "    if (fill) v.fill = { type: \"pattern\", pattern: \"solid\", fgColor: { argb: fill } };",
  "    if (v.value === \"Fail\") v.font = { name: FONT, size: 10, bold: true, color: { argb: \"FFC00000\" } };",
  "    lastCase = s.caseId;",
  "  }",
  "  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLS.length } };",
  "",
  "  return { ...mod, steps: cases.length, results,",
  "           range: `'${mod.sheet}'!$I$2:$I$${cases.length + 1}` };",
  "}",
  "",
 "// ---- packBookB.mjs appends the rest below this line ----");

fs.writeFileSync(at(TARGET), PART_A.replace(/\n*$/, "\n"));
console.log("part A written - the file is INCOMPLETE until you run packBookB.mjs");
console.log("  " + PART_A.split("\n").length + " lines so far");