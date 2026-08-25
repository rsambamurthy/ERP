// Which organisations this run is driving.
//
// WHY THIS FILE EXISTS. The pack asserts exact figures: "4020 is debited
// 1,900.00 for April". That is only true in an organisation where nothing
// else has ever happened. Depreciation cannot be un-posted and an asset
// cannot be deleted, so a second run against the same organisation charges
// two laptops, a third charges three, and every amount in the pack is wrong
// for a reason that has nothing to do with the software.
//
// So a clean slate is made STRUCTURAL rather than something to remember:
// `npm run test:seed` registers a NEW pair of organisations each time and
// writes their addresses here. Nothing is ever deleted - the old ones are
// simply left behind, which is also why this is safe to run against a
// database that has other things in it.
//
// To keep working against the pair you already seeded (a much faster loop
// while chasing one case), either run `npm run test:seed -- --reuse`, or set
// TEST_ORG_A_EMAIL / TEST_ORG_B_EMAIL, which override this file entirely.

import fs from "fs";
import path from "path";

export interface TestOrgs {
  createdAt: string;
  password: string;
  A: string;
  B: string;
}

export const ORGS_FILE = path.join(__dirname, ".testorgs.json");

export function readTestOrgs(): TestOrgs | null {
  if (!fs.existsSync(ORGS_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(ORGS_FILE, "utf8")) as TestOrgs;
  } catch {
    return null;
  }
}

export function writeTestOrgs(o: TestOrgs): void {
  fs.writeFileSync(ORGS_FILE, JSON.stringify(o, null, 2) + "\n");
}

// A stamp that sorts, reads as a date, and is legal in an email local part.
export function runStamp(now = new Date()): string {
  return now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

export function freshOrgs(password: string, now = new Date()): TestOrgs {
  const s = runStamp(now);
  return {
    createdAt: now.toISOString(),
    password,
    A: `test-a-${s}@smarterp.local`,
    B: `test-b-${s}@smarterp.local`,
  };
}

// The precedence every part of the suite agrees on: WHAT THE LAST SEED WROTE
// WINS, and the environment is only a fallback.
//
// It was the other way round for exactly one run, and that run was wasted.
// TEST_ORG_A_EMAIL was still set from the old flow, so the environment
// silently steered every command back to the worn-out organisation while the
// output said "new organisations for this run". A stale variable someone
// exported weeks ago must not outrank the file written thirty seconds ago.
export function orgCreds(key: "A" | "B"): { email: string; password: string } {
  const file = readTestOrgs();
  return {
    email: file?.[key] || process.env[`TEST_ORG_${key}_EMAIL`] || "",
    password: file?.password || process.env[`TEST_ORG_${key}_PASSWORD`] || "",
  };
}