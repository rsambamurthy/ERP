// FixD, part 1 of 2 - harness.ts and runCases.ts.
//
//   node backend/tests/applyFixD.mjs
//
// Save tests/testOrgs.ts BEFORE running this: harness.ts imports it.
// Idempotent - each edit carries a marker that exists only once it is applied.

import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, "..", f), "utf8");
const write = (f, t) => fs.writeFileSync(path.join(here, "..", f), t);

let applied = 0, already = 0;

// `done` is a fragment that exists ONLY after the edit, and it is checked
// FIRST. Three of these anchors are a prefix of their own replacement, so
// "is the anchor still there?" cannot tell applied from not-applied - it
// would cheerfully apply the same edit twice.
function edit(file, from, to, done) {
  const t = read(file);
  if (t.includes(done)) { already++; return; }
  const n = t.split(from).length - 1;
  if (n === 0) throw new Error(`anchor not found in ${file}: ${from.slice(0, 60)}`);
  if (n > 1) throw new Error(`anchor is not unique in ${file}: ${from.slice(0, 60)}`);
  write(file, t.replace(from, to));
  applied++;
}

// L() joins single lines with newlines. The payloads are written that way so
// no line here is longer than it needs to be - a 1,600-character string
// literal does not survive being pasted through a chat window, which is the
// only channel this has.
const L = (...lines) => lines.join("\n");

const EDITS = [
["tests/harness.ts",
 L(
  "import { PrismaClient } from \"@prisma/client\";",
  "",
  "export const prisma"),
 L(
  "import { PrismaClient } from \"@prisma/client\";",
  "import { orgCreds } from \"./testOrgs\";",
  "",
  "export const prisma"),
 "orgCreds } from \"./testOrgs\""],
["tests/harness.ts",
 L(
  "  orgA: { email: process.env.TEST_ORG_A_EMAIL ?? \"\", password: process.env.TEST_ORG_A_PASSWORD ?? \"\" },",
  "  orgB: { email: process.env.TEST_ORG_B_EMAIL ?? \"\", password: process.env.TEST_ORG_B_PASSWORD ?? \"\" },"),
 L(
  "  //",
  "  // Read from whatever the last seed registered, unless the environment says",
  "  // otherwise. See testOrgs.ts for why each seed makes a NEW pair.",
  "  orgA: orgCreds(\"A\"),",
  "  orgB: orgCreds(\"B\"),"),
 "orgA: orgCreds(\"A\")"],
["tests/harness.ts",
 "`No credentials for ORG-${org}. Set TEST_ORG_${org}_EMAIL and TEST_ORG_${org}_PASSWORD.`,",
 L(
  "`No credentials for ORG-${org}. Run 'npm run test:seed' first - it registers a ` +",
  "      `fresh pair of organisations and records them in tests/.testorgs.json. ` +",
  "      `(Or set TEST_ORG_${org}_EMAIL and TEST_ORG_${org}_PASSWORD to drive an existing pair.)`,"),
 "records them in tests/.testorgs.json"],
["tests/harness.ts",
 L(
  "  action: string;",
  "  // where to write the result back"),
 L(
  "  action: string;",
  "  // A step that only means anything once a given period has been posted.",
  "  // When that period was refused because the month is not over yet, this",
  "  // step is SKIPPED rather than failed - it has nothing to say, and saying",
  "  // it in red buries the failures that are about the software.",
  "  needsPeriod: string | null;",
  "  // where to write the result back"),
 "needsPeriod: string | null;"],
["tests/harness.ts",
 "je: r.je ?? [], action: r.action ?? \"\",",
 "je: r.je ?? [], action: r.action ?? \"\", needsPeriod: r.needsPeriod ?? null,",
 "needsPeriod: r.needsPeriod ?? null"],
["tests/harness.ts",
 L(
  "      action: m?.action ?? \"\",",
  "      sheet:"),
 L(
  "      action: m?.action ?? \"\",",
  "      needsPeriod: null,",
  "      sheet:"),
 "needsPeriod: null,\n      sheet:"],
["tests/runCases.ts",
 L(
  "    ctx.step = step;",
  "    ctx.reply = null;",
  ""),
 L(
  "    ctx.step = step;",
  "    ctx.reply = null;",
  "",
  "    // A step that only means something once a given period is on the ledger.",
  "    // When that period could not be posted because the month is not over yet,",
  "    // this step has nothing to say - and saying it in red buries the failures",
  "    // that are actually about the software.",
  "    if (step.needsPeriod && !postedPeriods.has(step.needsPeriod)) {",
  "      return done(\"SKIPPED\", `${step.needsPeriod} was never posted`);",
  "    }",
  ""),
 "was never posted"],
["tests/runCases.ts",
 "            return done(\"FAIL\", `POST ${p} returned ${reply.status}: ${reply.body?.message ?? \"\"}`);",
 L(
  "            const why = String(reply.body?.message ?? \"\");",
  "            // Refusing a period that has not ended is CORRECT, and it is the",
  "            // pack's calendar that is out of step, not the engine. Reporting",
  "            // that as a failure would be reporting the software for being",
  "            // right. The pack is pinned to Apr-Oct 2026; anchoring it to the",
  "            // run date instead is a separate job.",
  "            if (reply.status === 409 && /is not over yet/i.test(why)) {",
  "              return done(\"SKIPPED\", why);",
  "            }",
  "            return done(\"FAIL\", `POST ${p} returned ${reply.status}: ${why}`);"),
 "is not over yet/i.test(why)"],
];

for (const [f, a, b, m] of EDITS) edit(f, a, b, m);
console.log(`${applied} edit(s) applied, ${already} already there`);

for (const f of ["tests/testOrgs.ts", "tests/harness.ts", "tests/runCases.ts"]) {
  const p = path.join(here, "..", f);
  if (!fs.existsSync(p)) throw new Error(`${f} is missing - save tests/testOrgs.ts first.`);
  const h = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  console.log(`  ${path.basename(f).padEnd(14)} ${h.toUpperCase()}`);
}
console.log("\nNext: applyFixE.mjs, which does seed.ts.");