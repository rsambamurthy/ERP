// FixH, part 2 of 3 - the register, the run screen, and the migration.
//
//   node backend/tests/applyFixI.mjs
//   psql "$DATABASE_URL" -f db/migration_049_asset_returned.sql
//
// RETURNED is a new status, so the CHECK constraint has to allow it. This
// writes the migration but does NOT run it - that is yours to do.
//
// The register hides a RETURNED asset the way it hides a DISPOSED one:
// leaving it on would overstate the gross block by something the company does
// not own.
//
// And a fully depreciated asset is now shown on the run screen ONCE, in the
// period after it finishes. The month a charge drops is the month someone
// asks why it dropped; every month after that it would be noise.
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8").replace(/\r\n/g, "\n");
const write = (f, t) => fs.writeFileSync(path.join(root, f), t);

let applied = 0, already = 0;
function edit(file, from, to, done) {
  const f = "backend/" + file;
  const t = read(f);
  if (t.includes(done)) { already++; write(f, t); return; }
  const n = t.split(from).length - 1;
  if (n === 0) throw new Error(`anchor not found in ${file}: ${from.slice(0, 70)}`);
  if (n > 1) throw new Error(`anchor is not unique in ${file}: ${from.slice(0, 70)}`);
  write(f, t.replace(from, to));
  applied++;
}

const L = (...lines) => lines.join("\n");

const EDITS = [
["src/routes/fixedAssets.ts",
 L(
  "  if (!organizationId) return;",
  "",
  "  const includeDisposed = String(req.query.includeDisposed ?? \"\") === \"true\";",
  "",
  "  const assets = await prisma.fixedAsset.findMany({"),
 L(
  "  if (!organizationId) return;",
  "",
  "  // RETURNED belongs here too. An asset sent back to the vendor is gone in",
  "  // exactly the way a disposed one is, and leaving it on the register would",
  "  // overstate the gross block by something the company does not own.",
  "  const includeDisposed = String(req.query.includeDisposed ?? \"\") === \"true\";",
  "  const GONE = [\"DISPOSED\", \"RETURNED\"];",
  "",
  "  const assets = await prisma.fixedAsset.findMany({"),
 "// exactly the way a disposed one is, and leaving it on the register would"],
["src/routes/fixedAssets.ts",
 L(
  "      organizationId,",
  "      deletedAt: null,",
  "      ...(includeDisposed ? {} : { status: { not: \"DISPOSED\" } }),",
  "    },",
  "    include: {"),
 L(
  "      organizationId,",
  "      deletedAt: null,",
  "      ...(includeDisposed ? {} : { status: { notIn: GONE } }),",
  "    },",
  "    include: {"),
 "...(includeDisposed ? {} : { status: { notIn: GONE } }),"],
["src/routes/depreciationRuns.ts",
 L(
  "async function loadAssets(organizationId: string) {",
  "  return prisma.fixedAsset.findMany({",
  "    where: { organizationId, deletedAt: null, status: \"ACTIVE\" },",
  "    select: {",
  "      id: true, assetCode: true, name: true, branchId: true,"),
 L(
  "async function loadAssets(organizationId: string) {",
  "  return prisma.fixedAsset.findMany({",
  "    // FULLY_DEPRECIATED is loaded too, so that an asset which has just",
  "    // finished can be SHOWN once - see the blocked filter below. DISPOSED and",
  "    // RETURNED are gone for good and never come back.",
  "    where: {",
  "      organizationId, deletedAt: null,",
  "      status: { in: [\"ACTIVE\", \"FULLY_DEPRECIATED\"] },",
  "    },",
  "    select: {",
  "      id: true, assetCode: true, name: true, branchId: true,"),
 "// finished can be SHOWN once - see the blocked filter below. DISPOSED and"],
["src/routes/depreciationRuns.ts",
 L(
  "    // NOT_YET_IN_USE is the ordinary case for an asset bought after this",
  "    // period \u2014 not an exception worth reporting.",
  "    if (why && why !== \"NOT_YET_IN_USE\") blocked.push({ asset: a, reason: why });",
  "  });",
  ""),
 L(
  "    // NOT_YET_IN_USE is the ordinary case for an asset bought after this",
  "    // period \u2014 not an exception worth reporting.",
  "    if (!why || why === \"NOT_YET_IN_USE\") return;",
  "    // FULLY_DEPRECIATED is shown ONCE and then never again. The month a",
  "    // charge drops is exactly the month someone asks why it dropped, so the",
  "    // asset that stopped is worth a line on that run; every month afterwards",
  "    // it would be noise, and the register already carries it at residual.",
  "    //",
  "    // \"Finished last period\" is exact and frequency-agnostic: the period",
  "    // before this one always ends the day before this one starts.",
  "    if (why === \"FULLY_DEPRECIATED\") {",
  "      const lastCharge = a.runs.reduce<Date | null>(",
  "        (m, r) => (!m || r.periodEnd > m ? r.periodEnd : m), null);",
  "      const dayBefore = new Date(target.getTime() - 86400000);",
  "      if (!lastCharge || lastCharge.getTime() !== dayBefore.getTime()) return;",
  "    }",
  "    blocked.push({ asset: a, reason: why });",
  "  });",
  ""),
 "// asset that stopped is worth a line on that run; every month afterwards"],
];

for (const [f, a, b, m] of EDITS) edit(f, a, b, m);

const MIGRATION = L(
  "-- migration_049: a returned asset is not a disposed one.",
  "--",
  "-- A capitalised purchase bill line can be sent back to the vendor. That is a",
  "-- RESCISSION of the purchase, not a sale: the asset never really belonged to",
  "-- the company, the depreciation charged against it was charged in error, and",
  "-- both are reversed. Filing it as DISPOSED would show an auditor reading the",
  "-- disposals schedule a disposal that never happened, and would put a",
  "-- fictitious gain in the P&L equal to the depreciation already taken.",
  "--",
  "-- So the status gets its own value. fixed_assets_status_ck is the only thing",
  "-- that has to change; every read path that excludes DISPOSED already excludes",
  "-- anything that is not ACTIVE.",
  "",
  "ALTER TABLE fixed_assets",
  "  DROP CONSTRAINT IF EXISTS fixed_assets_status_ck;",
  "",
  "ALTER TABLE fixed_assets",
  "  ADD CONSTRAINT fixed_assets_status_ck",
  "  CHECK (status IN ('ACTIVE', 'FULLY_DEPRECIATED', 'DISPOSED', 'RETURNED'));",
  "",
  "-- Verify:",
  "--   SELECT pg_get_constraintdef(oid) FROM pg_constraint",
  "--   WHERE conname = 'fixed_assets_status_ck';",
  "");
const mp = path.join(root, "db", "migration_049_asset_returned.sql");
if (!fs.existsSync(mp)) { fs.writeFileSync(mp, MIGRATION); applied++; } else already++;

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["backend/src/routes/fixedAssets.ts", "backend/src/routes/depreciationRuns.ts", "db/migration_049_asset_returned.sql"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, f))).digest("hex");
  console.log(`  ${path.basename(f).padEnd(30)} ${h.toUpperCase()}`);
}
console.log("\nRun the migration, then applyFixJ.mjs for the case pack.");