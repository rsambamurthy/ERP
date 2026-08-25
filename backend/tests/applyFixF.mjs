// FixF - the one that makes the fresh organisation actually happen.
//
//   node backend/tests/applyFixF.mjs
//
// The 25-Aug run seeded nothing new: TEST_ORG_A_EMAIL was still set from the
// old flow and my precedence let it win, so four runs' worth of assets were
// still charging and every exact figure was wrong. The file the seed writes
// now outranks the environment, and the seed says out loud when it is
// ignoring a stale variable.
//
// Also normalises line endings to LF. testOrgs.ts came back CRLF from the
// editor, and an anchor that spans two lines does not match across \r\n.

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
["tests/testOrgs.ts",
 L(
  "// The precedence every part of the suite agrees on: an explicit environment",
  "// variable wins, then whatever the last seed wrote, then nothing.",
  "export function orgCreds(key: \"A\" | \"B\"): { email: string; password: string } {",
  "  const envEmail = process.env[`TEST_ORG_${key}_EMAIL`];",
  "  const envPassword = process.env[`TEST_ORG_${key}_PASSWORD`];",
  "  const file = readTestOrgs();",
  "  return {",
  "    email: envEmail || file?.[key] || \"\",",
  "    password: envPassword || file?.password || \"\",",
  "  };",
  "}"),
 L(
  "// The precedence every part of the suite agrees on: WHAT THE LAST SEED WROTE",
  "// WINS, and the environment is only a fallback.",
  "//",
  "// It was the other way round for exactly one run, and that run was wasted.",
  "// TEST_ORG_A_EMAIL was still set from the old flow, so the environment",
  "// silently steered every command back to the worn-out organisation while the",
  "// output said \"new organisations for this run\". A stale variable someone",
  "// exported weeks ago must not outrank the file written thirty seconds ago.",
  "export function orgCreds(key: \"A\" | \"B\"): { email: string; password: string } {",
  "  const file = readTestOrgs();",
  "  return {",
  "    email: file?.[key] || process.env[`TEST_ORG_${key}_EMAIL`] || \"\",",
  "    password: file?.password || process.env[`TEST_ORG_${key}_PASSWORD`] || \"\",",
  "  };",
  "}"),
 "WINS, and the environment is only a fallback"],
["tests/seed.ts",
 L(
  "  const envA = process.env.TEST_ORG_A_EMAIL, envB = process.env.TEST_ORG_B_EMAIL;",
  "  if (envA && envB) {",
  "    console.log(`${GREY}using TEST_ORG_A_EMAIL / TEST_ORG_B_EMAIL${OFF}`);",
  "    return { A: envA, B: envB };",
  "  }",
  "  const existing = readTestOrgs();"),
 L(
  "  const existing = readTestOrgs();",
  "  // A leftover TEST_ORG_A_EMAIL must not quietly win. It did once, and the run",
  "  // it produced looked fine and meant nothing. Say so and carry on.",
  "  if (process.env.TEST_ORG_A_EMAIL || process.env.TEST_ORG_B_EMAIL) {",
  "    console.log(`${YELLOW}!${OFF} TEST_ORG_A_EMAIL / TEST_ORG_B_EMAIL are set and are being ` +",
  "                `IGNORED. Pass --env to use them.`);",
  "  }",
  "  if (process.argv.includes(\"--env\")) {",
  "    const A = process.env.TEST_ORG_A_EMAIL, B = process.env.TEST_ORG_B_EMAIL;",
  "    if (!A || !B) throw new Error(\"--env needs both TEST_ORG_A_EMAIL and TEST_ORG_B_EMAIL.\");",
  "    console.log(`${YELLOW}--env:${OFF} ${A} / ${B}`);",
  "    return { A, B };",
  "  }"),
 "are being ` +"],
];

for (const [f, a, b, m] of EDITS) edit(f, a, b, m);

// DEP-12.3 posts September, which needs August posted, which cannot happen
// until August is over. Without this the step fails for the calendar rather
// than for anything it is testing.
const cf = path.join(here, "depCases.json");
const cases = JSON.parse(fs.readFileSync(cf, "utf8"));
const s = cases.find((c) => c.key === "DEP-12.3");
if (!s) throw new Error("DEP-12.3 is not in depCases.json");
if (s.needsPeriod !== "2026-08-01") {
  s.needsPeriod = "2026-08-01";
  fs.writeFileSync(cf, JSON.stringify(cases, null, 1) + "\n");
  applied++;
} else already++;

console.log(`${applied} edit(s) applied, ${already} already there`);
for (const f of ["tests/testOrgs.ts", "tests/seed.ts", "tests/depCases.json"]) {
  const h = crypto.createHash("sha256")
    .update(fs.readFileSync(path.join(here, "..", f))).digest("hex");
  console.log(`  ${path.basename(f).padEnd(14)} ${h.toUpperCase()}`);
}