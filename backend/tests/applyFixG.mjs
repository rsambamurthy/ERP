// FixG - two runner bugs, and nine cases pointed at fields that exist.
//
//   node backend/tests/applyFixG.mjs
//
// The 47/66 run was the first trustworthy one, and it found real things:
//
//  * postedPeriods was keyed by date alone, so ORG-B's quarterly posting was
//    handed ORG-A's reply and asserted ORG-A's figures. DEP-11.3 and DEP-11.4.
//  * the period-posting branch never substituted placeholders, so DEP-17.2
//    posted the literal text {{CURRENT_MONTH_START}}.
//  * GET /fixed-assets/:id/schedule returns data.periods, each flagged
//    posted:true. There is no data.runs - six assertions addressed a field
//    that has never existed.
//  * phase order posts April at DEP-07.2 and June at DEP-07.4, so DEP-08.2,
//    DEP-14.4 and DEP-16.4 were reading /due one period too late. They now
//    read the schedule, which is durable and order-independent.
//  * a fully depreciated asset is excluded at load (status ACTIVE), so it is
//    in neither list. DEP-14.5 asserted a blocked reason that cannot occur.
//  * DEP-21.2 queried every organisation in the database - that is where the
//    stray 1301 came from.

import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, "..", f), "utf8").replace(/\r\n/g, "\n");
const write = (f, t) => fs.writeFileSync(path.join(here, "..", f), t);

let applied = 0, already = 0;
function edit(file, from, to, done) {
  const t = read(file);
  if (t.includes(done)) { already++; write(file, t); return; }
  const n = t.split(from).length - 1;
  if (n === 0) throw new Error(`anchor not found in ${file}: ${from.slice(0, 60)}`);
  if (n > 1) throw new Error(`anchor is not unique in ${file}: ${from.slice(0, 60)}`);
  write(file, t.replace(from, to));
  applied++;
}

const L = (...lines) => lines.join("\n");

const EDITS = [
["tests/runCases.ts",
 "    if (step.needsPeriod && !postedPeriods.has(step.needsPeriod)) {",
 "    if (step.needsPeriod && !postedPeriods.has(`${step.login}:${step.needsPeriod}`)) {",
 "postedPeriods.has(`${step.login}:${step.needsPeriod}`)"],
["tests/runCases.ts",
 L(
  "        for (const p of periods) {",
  "          if (wantsSuccess && postedPeriods.has(p)) { ctx.reply = postedPeriods.get(p)!; continue; }",
  "          const reply = await request(step.login, \"POST\", path, { periodStart: p });",
  "          ctx.reply = reply;",
  "          if (reply.status === 200) postedPeriods.set(p, reply);"),
 L(
  "        for (const raw of periods) {",
  "          // SUBSTITUTE. This branch bypassed substituteDeep, so a step whose",
  "          // period is a placeholder - DEP-17.2 uses {{CURRENT_MONTH_START}} -",
  "          // sent the braces to the server verbatim and was refused for the",
  "          // wrong reason entirely.",
  "          const p = substitute(raw, ctx);",
  "          // KEYED BY ORGANISATION. April in ORG-A and April in ORG-B are two",
  "          // different postings; keying on the date alone handed ORG-B the",
  "          // ORG-A reply, and the quarterly case then asserted ORG-A's figures",
  "          // against ORG-B's expectations.",
  "          const k = `${step.login}:${p}`;",
  "          if (wantsSuccess && postedPeriods.has(k)) { ctx.reply = postedPeriods.get(k)!; continue; }",
  "          const reply = await request(step.login, \"POST\", path, { periodStart: p });",
  "          ctx.reply = reply;",
  "          if (reply.status === 200) postedPeriods.set(k, reply);"),
 "const k = `${step.login}:${p}`;"],
["tests/assertions.ts",
 "    const reply = period ? ctx.postedPeriods.get(period) : ctx.reply;",
 L(
  "    // Same key the runner writes: the posting belongs to one organisation.",
  "    const reply = period ? ctx.postedPeriods.get(`${ctx.step.login}:${period}`) : ctx.reply;"),
 "ctx.postedPeriods.get(`${ctx.step.login}:${period}`)"],
];

for (const [f, a, b, m] of EDITS) edit(f, a, b, m);

// ---- the case pack -------------------------------------------------------
const cf = path.join(here, "depCases.json");
const cases = JSON.parse(fs.readFileSync(cf, "utf8"));
const by = new Map(cases.map((x) => [x.key, x]));
const set = (k, o) => {
  const s = by.get(k);
  if (!s) throw new Error(`${k} is not in depCases.json`);
  for (const [a, v] of Object.entries(o)) { if (v === undefined) delete s[a]; else s[a] = v; }
};

set("DEP-07.5", { asserts: [
 "field count(data.periods[posted=true]) = 3",
 "field data.periods[2].closingWdv = 114300.00",
 "field data.periods[0].amount = 1900.00"] });
set("DEP-20.3", { asserts: [
 "GET /fixed-assets/{{DEP-01.assetId}}/schedule :: field data.periods[1].periodStart = 2026-05-01",
 "GET /fixed-assets/{{DEP-01.assetId}}/schedule :: field data.periods[1].amount = 1900.00"] });
set("DEP-10.4", { asserts: [
 "field count(data.periods[posted=true]) = 4",
 "field data.periods[0].periodStart = 2026-04-01",
 "field data.periods[3].closingWdv = 112400.00",
 "sql \"SELECT count(DISTINCT journal_entry_id) FROM fixed_asset_depreciation_runs WHERE fixed_asset_id={{DEP-10.assetId}}\" = 1"] });
set("DEP-15.3", { asserts: [
 "field data.periods[6].closingWdv = 1000.00",
 "field sum(data.periods[].amount) = 9000.00"] });

by.get("DEP-08.1").capture = {
  billId: "data.id",
  assetId: "GET /fixed-assets :: data[name=Laptop 14in - part month].id" };
set("DEP-08.2", { asserts: [
 "GET /fixed-assets/{{DEP-08.assetId}}/schedule :: field data.periods[0].daysCharged = 15",
 "GET /fixed-assets/{{DEP-08.assetId}}/schedule :: field data.periods[0].daysInPeriod = 30",
 "GET /fixed-assets/{{DEP-08.assetId}}/schedule :: field data.periods[0].amount = 950.00",
 "journal depreciation_run period=2026-04-01 branch={{BR_A_D08}}"] });

set("DEP-14.4", { asserts: [
 "GET /fixed-assets/{{DEP-14.assetId}}/schedule :: field data.periods[2].closingWdv = 1200.00",
 "GET /fixed-assets :: field data[id={{DEP-14.assetId}}].status = FULLY_DEPRECIATED",
 "journal depreciation_run period=2026-06-01 branch={{BR_A_D14}}"] });
set("DEP-16.4", { asserts: [
 "GET /fixed-assets/{{DEP-16.assetId}}/schedule :: field data.periods[2].amount = 7850.41",
 "journal depreciation_run period=2026-06-01 branch={{BR_A_D16}}"] });

set("DEP-14.5", { asserts: [
 "field count(data.assets[id={{DEP-14.assetId}}]) = 0",
 "field count(data.blocked[id={{DEP-14.assetId}}]) = 0"],
 note: "It is in NEITHER list: loadAssets filters status ACTIVE, so a finished asset simply stops appearing. BLOCKED_TEXT.FULLY_DEPRECIATED is therefore unreachable - raised as a question, not asserted." });

set("DEP-21.2", { asserts: [
 "sql \"SELECT a.account_code FROM journal_lines l JOIN journal_entries e ON e.id=l.journal_entry_id JOIN accounts a ON a.id=l.account_id WHERE e.organization_id={{ORG_A}} AND e.reference_type='purchase_return' AND l.credit>0 AND a.account_type='ASSET'\" = 1405"] });

fs.writeFileSync(cf, JSON.stringify(cases, null, 1) + "\n");

console.log(`${applied} edit(s) applied, ${already} already there; 9 cases re-anchored`);
for (const f of ["tests/runCases.ts", "tests/assertions.ts", "tests/depCases.json"]) {
  const h = crypto.createHash("sha256")
    .update(fs.readFileSync(path.join(here, "..", f))).digest("hex");
  console.log(`  ${path.basename(f).padEnd(16)} ${h.toUpperCase()}`);
}