// Builds the test pack as a workbook, with the last run's verdict on every row.
//
//   node backend/tests/buildWorkbook.mjs
//
// Everything it needs is already on your disk:
//   tests/depCases.json                    depreciation: what each step calls
//   tests/stkCases.json                    stock: the same
//   tests/SmartERP-Test-Results.json       the last depreciation run
//   tests/SmartERP-Test-Results-STK.json   the last stock run
//   tests/.testorgs.json                   which organisations those runs drove
//
// The request body IS the test data and the assertions ARE the expected
// result, so nothing has to be shipped alongside. That is also why this is
// the truer record: a prose description of what a step expects can drift away
// from what it actually checks, and these cannot.
//
// A module with no cases file is skipped and says so. A module with cases but
// no results renders every row as "Not run" rather than pretending.
//
// Writes backend/SmartERP-Test-Pack.xlsx - NOT tests/SmartERP-Test-Scenarios.xlsx,
// deliberately. harness.readCases() prefers that exact path over the JSON, so a
// workbook sitting there would quietly become the suite's source of truth, and
// this one has no Automation sheet: the next run would die on
// "No 'Automation' sheet".

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ExcelJS from "exceljs";
import { plain, requestText, jeText } from "./packRender.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "SmartERP-Test-Pack.xlsx");

const FONT = "Arial";
const HEAD = "FF1F3864", WARN = "FFFFF2CC";
const PASS = "FFE2EFDA", FAIL = "FFFCE4EC", SKIP = "FFF2F2F2";
const VERDICT_COL = 9;

const read = (f, dflt) => {
  const p = path.join(here, f);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : dflt;
};

// The two modules, and the one line each needs to describe itself. Adding a
// third means adding a row here and nothing else.
const MODULES = [
  { key: "DEP", sheet: "Depreciation", cases: "depCases.json",
    results: "SmartERP-Test-Results.json",
    blurb: "Capitalisation, the schedule, monthly and quarterly posting, the " +
           "method change, disposal and the purchase-return rescission." },
  { key: "STK", sheet: "Stock Management", cases: "stkCases.json",
    results: "SmartERP-Test-Results-STK.json",
    blurb: "The costing chain on one item - found stock, purchase, sale, " +
           "shrinkage, a refused over-issue, both returns - plus FIFO in ORG-B " +
           "and the reconciliation controls. Production, transfers and the GST " +
           "returns are batches 2 to 4." },
];

const orgs = read(".testorgs.json", null);

const AUTO = { YES: "Yes", PARTIAL: "Partly", NO: "No", TBD: "Not yet" };
const OUTCOME = { PASS: "Pass", FAIL: "Fail", MANUAL: "Manual", SKIPPED: "Skipped" };
const VERDICT_FILL = { Pass: PASS, Fail: FAIL, Skipped: SKIP, Manual: WARN,
                       Deferred: SKIP, "Not run": SKIP };

const wb = new ExcelJS.Workbook();
wb.creator = "SmartERP test runner";
wb.created = new Date();

const sum = wb.addWorksheet("Summary");
sum.columns = [{ width: 28 }, { width: 10 }, ...Array(4).fill({ width: 26 })];
let r = 1;
const band = (text) => {
  const row = sum.getRow(r++);
  row.getCell(1).value = text;
  row.font = { name: FONT, size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } };
  sum.mergeCells(row.number, 1, row.number, 6);
  row.height = 22; r++;
};
const line = (a, b, c, bold) => {
  const row = sum.getRow(r++);
  row.font = { name: FONT, size: 10 };
  row.getCell(1).value = a;
  row.getCell(1).font = { name: FONT, size: 10, bold: !!bold };
  row.getCell(1).alignment = { vertical: "top" };
  if (b !== undefined) { row.getCell(2).value = b; row.getCell(2).alignment = { horizontal: "center" }; }
  if (c !== undefined) {
    row.getCell(3).value = c;
    row.getCell(3).alignment = { wrapText: true, vertical: "top" };
    sum.mergeCells(row.number, 3, row.number, 6);
  }
  return row;
};

const COLS = [
  ["Case", 10], ["Scenario", 30], ["Step", 6], ["What you do", 34],
  ["The call, and the data", 46], ["What must be true afterwards", 58],
  ["Expected ledger", 32], ["Automated", 11], ["Result", 10],
  ["What the run reported", 44], ["Note", 30],
];

// One sheet per module. Returns what the Summary needs to describe it.
function buildSheet(mod) {
  const cases = read(mod.cases, null);
  if (!cases) return { ...mod, missing: true };
  const results = read(mod.results, []);
  const resultBy = new Map(results.map((x) => [x.key, x]));

  const ws = wb.addWorksheet(mod.sheet, {
    views: [{ state: "frozen", ySplit: 1 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = COLS.map(([header, width]) => ({ header, width }));
  const head = ws.getRow(1);
  head.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } };
  head.alignment = { vertical: "middle", wrapText: true };
  head.height = 30;

  let lastCase = null;
  for (const s of cases) {
    const res = resultBy.get(s.key);
    const first = s.caseId !== lastCase;
    const row = ws.addRow([
      first ? s.caseId : "", first ? s.caseTitle : "",
      s.key.split(".")[1], s.action,
      requestText(s),
      (s.asserts ?? []).map(plain).join("\n\n") ||
        (s.capture ? "Reads values the later steps need. Nothing is checked here." : ""),
      jeText(s.je),
      AUTO[s.auto] ?? s.auto,
      // A step with no result is not all one thing. "Not yet" in the Automated
      // column means it was never specified for the runner, and calling that
      // "Not run" reads as an omission rather than a decision.
      res ? OUTCOME[res.outcome] ?? res.outcome : s.auto === "TBD" ? "Deferred" : "Not run",
      res ? res.detail : "",
      [s.note, s.needsPeriod ? `Only runs once ${s.needsPeriod} has been posted.` : ""]
        .filter(Boolean).join("\n"),
    ]);
    row.font = { name: FONT, size: 10 };
    row.alignment = { vertical: "top", wrapText: true };
    // A rule across the top of each scenario. Without it 66 rows is a wall.
    if (first) {
      row.border = { top: { style: "thin", color: { argb: "FF8EA9DB" } } };
      for (const c of [1, 2]) row.getCell(c).font = { name: FONT, size: 10, bold: true };
    }
    const v = row.getCell(VERDICT_COL);
    v.alignment = { vertical: "top", horizontal: "center" };
    const fill = VERDICT_FILL[v.value];
    if (fill) v.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    if (v.value === "Fail") v.font = { name: FONT, size: 10, bold: true, color: { argb: "FFC00000" } };
    lastCase = s.caseId;
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLS.length } };

  return { ...mod, steps: cases.length, results,
           range: `'${mod.sheet}'!$I$2:$I$${cases.length + 1}` };
}

const built = MODULES.map(buildSheet);

// ---- Summary, written last so the ranges are known ------------------------
band("SmartERP — test pack and results");
line("Workbook generated", undefined, new Date().toISOString().slice(0, 16).replace("T", " "));
if (orgs) {
  line("Runs drove ORG-A", undefined, orgs.A);
  line("Runs drove ORG-B", undefined, orgs.B);
  line("", undefined,
    "The seed makes a NEW pair every time, on purpose - see the last section. If a " +
    "module's results predate the pair named here, they were recorded against a " +
    "different organisation and its figures do not describe this one.");
}
r++;

const WHY = [
  ["Pass", "Ran, and every assertion held."],
  ["Fail", "Ran, and something did not hold. Column J says what."],
  ["Manual", "Needs a person or a browser: a UI drill-down, or a path the seed cannot reach."],
  ["Skipped", "Waiting on a period that has not ended. It runs by itself once the calendar catches up."],
  ["Deferred", "Written as a scenario, deliberately not yet specified for the runner. The Note column says what it is waiting on."],
  ["Not run", "No verdict in the results file for a step that should have one. If this is not zero, the run did not finish."],
];

for (const m of built) {
  band(`${m.sheet} — how the last run went`);
  line("", undefined, m.blurb).height = 30;
  if (m.missing) {
    line("No cases yet", undefined,
      `tests/${m.cases} does not exist, so there is no sheet for this module.`).height = 28;
    r++; continue;
  }
  if (!m.results.length) {
    line("Not run yet", undefined,
      `tests/${m.results} does not exist. Every row on the ${m.sheet} sheet reads "Not run".`).height = 28;
  }
  for (const [label, why] of WHY) {
    // COUNTIF rather than a number baked in here: change a verdict on the
    // module's sheet and this follows. Excel recalculates on open.
    line(label, { formula: `COUNTIF(${m.range},"${label}")` }, why, true);
  }
  line("Total steps", { formula: `COUNTA(${m.range})` }, undefined, true);
  if (m.results.length) line("Recorded", undefined, String(m.results[0].at ?? ""));
  r++;
}

band("What is not covered, and why");
for (const [t, d] of [
  ["Depreciation — three manual steps",
   "DEP-01.3 and DEP-19.4 are sub-ledger drill-downs in the UI. DEP-13.3 is the run-time " +
   "WDV_NEEDS_RESIDUAL block, which needs an asset capitalised under SLM and then moved to WDV " +
   "afterwards — the seed cannot produce that ordering, so it is recorded as a gap, not faked."],
  ["Depreciation — four skipped steps",
   "That pack's calendar is pinned to April–October 2026. The engine correctly refuses to post a " +
   "period that has not ended, so anything past the current month waits. Anchoring the pack to the " +
   "run date instead would remove this."],
  ["Stock — one manual step",
   "STK-30.5 is a per-branch drill-down into the item cards under 1201 / 1301 / 1303. It is the " +
   "same comparison STK-30.2 makes in aggregate, done card by card, which is a screen job."],
  ["Stock — two deferred steps",
   "STK-07.2 needs a production order and STK-09.3 needs a second purchase return in ORG-B. Both " +
   "are specified with batch 2 rather than written as something that cannot run."],
  ["Stock — batches 2 to 4",
   "Production (STK-10–16), branch transfers (STK-17–25) and reconciliation plus the GST " +
   "returns (STK-26–29) are written as scenarios but not yet specified as cases. Until they " +
   "exist, STK-30.3's assertion that Work in Progress and Stock in Transit are both nil is true " +
   "because nothing has moved them — which is worth knowing when reading it."],
]) line(t, undefined, d, true).height = 44;
r++;

band("Running it again");
for (const t of [
  "cd backend",
  "npm run test:seed              a FRESH pair of organisations, recorded in tests/.testorgs.json",
  "npm run test:dep               depreciation → tests/SmartERP-Test-Results.json",
  "npm run test:stk               stock       → tests/SmartERP-Test-Results-STK.json",
  "node tests/buildWorkbook.mjs   rebuilds this workbook from whatever of those exist",
  "",
  "Both modules should run against the SAME seeded pair, in that order, before the workbook is",
  "rebuilt - otherwise the two sheets describe two different organisations and the Summary above",
  "will be naming only the later one.",
  "",
  "The seed makes new organisations every time on purpose. The packs assert exact figures, and those",
  "hold only where nothing else has ever happened — depreciation cannot be un-posted, so a second run",
  "against the same organisation charges two laptops and every number is wrong for a reason that has",
  "nothing to do with the software. Nothing is deleted; the old test organisations are left behind.",
]) {
  const row = sum.getRow(r++);
  row.getCell(1).value = t;
  row.font = { name: /^(cd|npm|node) /.test(t) ? "Consolas" : FONT, size: 10 };
  sum.mergeCells(row.number, 1, row.number, 6);
}
sum.views = [{ state: "frozen", ySplit: 1 }];

// Excel keeps an exclusive lock on an open workbook, and Windows reports that
// as EBUSY. The stack trace that comes back says "resource busy or locked",
// which is true and tells you nothing about what to do, so say it plainly and
// leave the existing file alone.
try {
  await wb.xlsx.writeFile(out);
} catch (e) {
  if (e && (e.code === "EBUSY" || e.code === "EPERM")) {
    console.error(`Cannot write ${path.basename(out)} - it is open in Excel.`);
    console.error("Close it and run this again. The previous workbook is untouched.");
    process.exit(1);
  }
  throw e;
}
console.log(`wrote ${path.relative(process.cwd(), out)}`);
for (const m of built) {
  if (m.missing) { console.log(`  ${m.sheet.padEnd(18)} no cases file - sheet skipped`); continue; }
  const n = (o) => m.results.filter((x) => x.outcome === o).length;
  console.log(`  ${m.sheet.padEnd(18)} ${String(m.steps).padStart(3)} steps` + (m.results.length
    ? `   ${n("PASS")} pass / ${n("FAIL")} fail / ${n("MANUAL")} manual / ${n("SKIPPED")} skipped`
    : "   (no results file yet)"));
}
