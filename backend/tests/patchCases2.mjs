// Second patch for depCases.json - the pack bugs the 25-Aug run exposed.
//
//   node backend/tests/patchCases2.mjs
//
// These are all the PACK addressing fields that do not exist. I wrote the
// assertions from what the response ought to look like instead of from what
// depreciationRuns.ts actually sends, and the run found every one of them.
// Idempotent: a second run reports 0 replacements and changes nothing.

import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, "depCases.json");
let text = fs.readFileSync(file, "utf8");

// [what, with, how many times it must appear]
//
// 1-2. The /due asset row carries `branch` as an OBJECT, and its per-period
//      array is called `periods`. `final` and `method` describe the LAST
//      charge and sit on the asset, not on each period entry.
// 3.   DEP-17.4 counted both organisations - ORG-B's quarter also starts on
//      01-Apr, so the answer was always 2, never 1.
// 4.   BR-A-CHN has no April charge any more: DEP-02 is expensed below the
//      threshold, DEP-12 is not yet in use, and DEP-13 is now refused at
//      capitalisation. Anchor the 4020 line to a branch that has an asset,
//      and count the asset cards across the whole run rather than one branch.
// 5.   DEP-19 - see the note added below.
const REPLACE = [
  // 3 in DEP-08.2 (daysCharged, daysInPeriod, amount) and 2 in DEP-10.2.
  [".assets[branchId=",                     ".assets[branch.id=", 5],
  ["].charges[0].daysCharged",              "].periods[0].daysCharged", 1],
  ["].charges[0].daysInPeriod",             "].periods[0].daysInPeriod", 1],
  ["].charges) = 4",                        "].periods) = 4", 1],
  [".assetId}}].charges[0].final",          ".assetId}}].final", 1],
  [".assetId}}].charges[0].closingWdv",     ".assetId}}].closingWdv", 1],
  [".assetId}}].charges[0].method",         ".assetId}}].method", 1],
  [".assetId}}].charges[0].amount",         ".assetId}}].periods[0].amount", 1],
  ["WHERE period_start='2026-04-01'",
   "WHERE organization_id={{ORG_A}} AND period_start='2026-04-01'", 1],
  ["e.branch_id={{BR_A_CHN}} AND a.account_code='4020'",
   "e.branch_id={{BR_A_D07}} AND a.account_code='4020'", 1],
  ["AND e.entry_date='2026-04-30' AND e.branch_id={{BR_A_CHN}} AND l.credit>0",
   "AND e.entry_date='2026-04-30' AND e.organization_id={{ORG_A}} AND l.credit>0", 1],
  ["e.entry_date<='2026-06-30'", "e.entry_date<='2026-07-31'", 2],
];

let hits = 0;
for (const [from, to, expected] of REPLACE) {
  const found = text.split(from).length - 1;
  if (found === 0) continue;                       // already applied
  if (found !== expected) {
    throw new Error(`expected ${expected} of "${from}", found ${found} - stopping ` +
                    `rather than half-applying.`);
  }
  text = text.split(from).join(to);
  hits += found;
}

const cases = JSON.parse(text);
const by = new Map(cases.map((c) => [c.key, c]));
const set = (key, fields) => {
  const c = by.get(key);
  if (!c) throw new Error(`${key} is not in depCases.json`);
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) delete c[k]; else c[k] = v;
  }
};

// DEP-11.1 asserted `journal purchase_bill` with no expected Debit/Credit
// rows - the same mistake as DEP-15.1 and DEP-16.1, missed the first time.
set("DEP-11.1", { asserts: undefined });

// DEP-15.3 reads the schedule after October is posted. Today is August, so
// October cannot be posted and the step has nothing to say. needsPeriod makes
// the runner report it SKIPPED instead of red.
set("DEP-15.3", { needsPeriod: "2026-10-01" });

// DEP-19 - RECONCILE ON ONE BASIS.
//
// It totalled the register by the period a charge BELONGS TO and the ledger by
// the date it POSTED. Those cannot agree once a catch-up run exists: DEP-10
// charges April to June inside an entry dated 31-Jul, because you cannot post
// into a closed month. That is not a bug in either number - it is two
// different questions, and a reconciliation has to ask one of them twice.
//
// Both sides now total by posting date. The register still has to be able to
// answer the other question, by period, for the fixed asset schedule.
set("DEP-19.1", {
  asserts: ["sql \"SELECT coalesce(sum(r.amount),0) FROM fixed_asset_depreciation_runs r " +
            "JOIN journal_entries e ON e.id=r.journal_entry_id " +
            "WHERE e.organization_id={{ORG_A}} AND e.entry_date<='2026-07-31'\" capture regTotal"],
  note: "Totalled by the date the charge POSTED, not by the period it belongs to. A " +
        "catch-up run charges April-June in a July-dated entry, so the two bases differ " +
        "by design and only one of them can reconcile to the ledger.",
});

fs.writeFileSync(file, JSON.stringify(cases, null, 1) + "\n");
console.log(`${hits} text replacement(s), 3 step(s) rewritten, ${cases.length} steps total`);
const sha = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
console.log(`SHA256 ${sha.toUpperCase()}`);