// FixD, part 2 of 2 - seed.ts.
//
//   node backend/tests/applyFixE.mjs
//
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
// FIRST. Some anchors are a prefix of their own replacement, so "is the
// anchor still there?" cannot tell applied from not-applied - it would
// cheerfully apply the same edit twice.
function edit(file, from, to, done) {
  const t = read(file);
  if (t.includes(done)) { already++; return; }
  const n = t.split(from).length - 1;
  if (n === 0) throw new Error(`anchor not found in ${file}: ${from.slice(0, 60)}`);
  if (n > 1) throw new Error(`anchor is not unique in ${file}: ${from.slice(0, 60)}`);
  write(file, t.replace(from, to));
  applied++;
}

const L = (...lines) => lines.join("\n");

const EDITS = [
["tests/seed.ts",
 L(
  "import { PrismaClient } from \"@prisma/client\";",
  "",
  "const prisma"),
 L(
  "import { PrismaClient } from \"@prisma/client\";",
  "import { freshOrgs, orgCreds, readTestOrgs, writeTestOrgs, ORGS_FILE } from \"./testOrgs\";",
  "",
  "const prisma"),
 "writeTestOrgs, ORGS_FILE } from \"./testOrgs\""],
["tests/seed.ts",
 L(
  "const PASSWORD = process.env.TEST_SEED_PASSWORD ?? \"TestPass!2026\";",
  ""),
 L(
  "const REUSE = process.argv.includes(\"--reuse\");",
  "const PASSWORD = process.env.TEST_SEED_PASSWORD ?? \"TestPass!2026\";",
  "",
  "// A FRESH PAIR EVERY TIME, unless told otherwise. See testOrgs.ts for why:",
  "// the pack asserts exact figures, and those hold only where nothing else has",
  "// ever happened. Nothing is deleted - the previous test organisations are",
  "// simply left behind, which is what makes this safe against a real database.",
  "function chooseOrgs(): { A: string; B: string } {",
  "  const envA = process.env.TEST_ORG_A_EMAIL, envB = process.env.TEST_ORG_B_EMAIL;",
  "  if (envA && envB) {",
  "    console.log(`${GREY}using TEST_ORG_A_EMAIL / TEST_ORG_B_EMAIL${OFF}`);",
  "    return { A: envA, B: envB };",
  "  }",
  "  const existing = readTestOrgs();",
  "  if (REUSE && existing) {",
  "    console.log(`${YELLOW}--reuse:${OFF} keeping ${existing.A} / ${existing.B}`);",
  "    console.log(`${YELLOW}!${OFF} figures already posted in these organisations still ` +",
  "                `count. Drop --reuse for a run whose numbers can be trusted.`);",
  "    return existing;",
  "  }",
  "  const made = freshOrgs(PASSWORD);",
  "  writeTestOrgs(made);",
  "  console.log(`${GREEN}+${OFF} new organisations for this run: ${made.A} / ${made.B}`);",
  "  return made;",
  "}",
  ""),
 "function chooseOrgs()"],
["tests/seed.ts",
 L(
  "  { key: \"A\", businessName: \"Vaigai Pumps Pvt Ltd\",   email: process.env.TEST_ORG_A_EMAIL ?? \"test-org-a@smarterp.local\", costingMethod: \"WEIGHTED_AVG\", frequency: \"MONTHLY\" },",
  "  { key: \"B\", businessName: \"Vaigai Exports Pvt Ltd\", email: process.env.TEST_ORG_B_EMAIL ?? \"test-org-b@smarterp.local\", costingMethod: \"FIFO\",         frequency: \"QUARTERLY\" },"),
 L(
  "  // email is filled in by chooseOrgs() at the top of main().",
  "  { key: \"A\", businessName: \"Vaigai Pumps Pvt Ltd\",   email: \"\", costingMethod: \"WEIGHTED_AVG\", frequency: \"MONTHLY\" },",
  "  { key: \"B\", businessName: \"Vaigai Exports Pvt Ltd\", email: \"\", costingMethod: \"FIFO\",         frequency: \"QUARTERLY\" },"),
 "chooseOrgs() at the top of main()"],
["tests/seed.ts",
 "  if (PRINT_ONLY) { await printOnly(); await prisma.$disconnect(); return; }",
 L(
  "  if (PRINT_ONLY) {",
  "    for (const plan of ORGS) plan.email = orgCreds(plan.key).email;",
  "    await printOnly();",
  "    await prisma.$disconnect();",
  "    return;",
  "  }",
  "",
  "  const chosen = chooseOrgs();",
  "  for (const plan of ORGS) plan.email = chosen[plan.key];"),
 "const chosen = chooseOrgs();"],
["tests/seed.ts",
 L(
  "  console.log(`\\n${BOLD}Put these in your environment before running the pack:${OFF}`);",
  "  for (const plan of ORGS) {",
  "    console.log(`  TEST_ORG_${plan.key}_EMAIL=${plan.email}`);",
  "    console.log(`  TEST_ORG_${plan.key}_PASSWORD=${PASSWORD}`);",
  "  }"),
 L(
  "  // Nothing to copy into an environment: the pack reads the same file. Shown",
  "  // so a failure two minutes from now can be traced to the right rows.",
  "  console.log(`\\n${BOLD}This run drives:${OFF}`);",
  "  for (const plan of ORGS) console.log(`  ORG-${plan.key}  ${plan.email}`);",
  "  console.log(`${GREY}recorded in ${ORGS_FILE}${OFF}`);"),
 "This run drives:"],
];

for (const [f, a, b, m] of EDITS) edit(f, a, b, m);
console.log(`${applied} edit(s) applied, ${already} already there`);

for (const f of ["tests/seed.ts"]) {
  const p = path.join(here, "..", f);
  if (!fs.existsSync(p)) throw new Error(`${f} is missing - save tests/testOrgs.ts first.`);
  const h = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  console.log(`  ${path.basename(f).padEnd(14)} ${h.toUpperCase()}`);
}