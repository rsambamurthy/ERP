// One-shot patch for depCases.json - the seven case-pack corrections found by
// the first live run. Applied here rather than by shipping a whole new file,
// because the whole new file is 37 KB and could not be delivered intact.
//
//   node backend/tests/patchCases.mjs
//
// Idempotent: run it twice and nothing moves.
// Every change below is the PACK being wrong about the system, not the other
// way round - except DEP-13, which is noted where it happens.

import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, "depCases.json");
const cases = JSON.parse(fs.readFileSync(file, "utf8"));
const by = new Map(cases.map((c) => [c.key, c]));

const notes = [];
const set = (key, fields) => {
  const c = by.get(key);
  if (!c) throw new Error(`${key} is not in depCases.json - is this the right file?`);
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) delete c[k]; else c[k] = v;
  }
  notes.push(key);
};

// ---------------------------------------------------------------------------
// 1. GET /fixed-assets has no purchaseBill object on the row.
//
// It returns billNumber and the vendor NAME, flattened. So every filter of the
// form data[purchaseBill.id=...] matched nothing and every assetId capture
// resolved to undefined - which is most of what the first run reported. The
// asset is found by the name it was capitalised under instead; every assetName
// in the pack is unique, which is what makes that safe.
// ---------------------------------------------------------------------------
const byName = (n) => `data[name=${n}].id`;
const lookup = (n) => `GET /fixed-assets :: data[name=${n}].id`;

set("DEP-01.2", { capture: {
  assetId: byName("Laptop 14in - Finance"),
  assetCode: `data[name=Laptop 14in - Finance].assetCode`,
} });
set("DEP-02.2", { asserts: ["field count(data[name=Laptop - below threshold]) = 0"] });
set("DEP-10.1", { capture: { billId: "data.id", assetId: lookup("Laptop - backdated") } });
set("DEP-12.1", { capture: { billId: "data.id", assetId: lookup("Laptop - future use") } });
set("DEP-14.1", { capture: { billId: "data.id", assetId: lookup("Short-life test") } });
set("DEP-20.4", { capture: { assetId: lookup("Laptop - after class edit") } });

// ---------------------------------------------------------------------------
// 2. rateFc is required on a foreign-currency LINE, and is validated before
//    the capitalisation rules are reached. Without it DEP-06 was refused for
//    the wrong reason ("Every line needs itemId, quantity > 0, and rateFc >=
//    0") and proved nothing about capitalising in foreign currency.
// ---------------------------------------------------------------------------
{
  const c = by.get("DEP-06.1");
  c.body.lines[0].rateFc = 1500;
  notes.push("DEP-06.1");
}

// ---------------------------------------------------------------------------
// 3. A business partner id belongs to ONE organisation. DEP-11 runs as ORG-B
//    but the body carried {{VENDOR_TN}}, which resolves in ORG-A, so the bill
//    was refused. The seed creates the same three partners in both orgs; all
//    that was missing was a fixture that looks the name up in ORG-B, which
//    FixB added to harness.ts as VENDOR_TN_B.
// ---------------------------------------------------------------------------
{
  const c = by.get("DEP-11.1");
  c.body.businessPartnerId = "{{VENDOR_TN_B}}";
  notes.push("DEP-11.1");
}

// ---------------------------------------------------------------------------
// 4. DEP-15.1 and DEP-16.1 asserted `journal purchase_bill`, but neither step
//    carries Debit/Credit rows - and that assertion compares the ledger
//    against exactly those rows. Asserting a ledger effect from an empty
//    expectation tests nothing and reports a failure that is about the pack.
// ---------------------------------------------------------------------------
set("DEP-15.1", {
  capture: { billId: "data.id", assetId: lookup("Seven-month test") },
  asserts: undefined,
});
set("DEP-16.1", {
  capture: { billId: "data.id", assetId: lookup("Method-change test") },
  // The method assertion is the point of this step anyway: the asset is
  // stamped SLM at capitalisation even though a WDV change is already dated
  // forward to June.
  asserts: ["GET /fixed-assets/{{assetId}} :: field data.method = SLM"],
});

// ---------------------------------------------------------------------------
// 5. DEP-13 - THE ONE PLACE THE PACK WAS WRONG ABOUT THE RIGHT BEHAVIOUR.
//
// It was written as "the asset is created, then the run blocks it with
// WDV_NEEDS_RESIDUAL". What purchaseBills.ts actually does is refuse the LINE,
// so no asset is ever created. That is better: an asset that can never be
// depreciated has no business being in the register, and a blocked row on the
// run screen every month for ever is worse than a refusal at the moment
// someone can still fix it. So the case now asserts the refusal.
//
// The run-time WDV_NEEDS_RESIDUAL branch is still reachable, but only the long
// way round - capitalise under SLM, then move the policy to WDV afterwards.
// That ordering needs its own seed, and is recorded as a coverage gap rather
// than faked.
// ---------------------------------------------------------------------------
set("DEP-13.1", {
  action: "Try to capitalise against AC-6.",
  status: 400,
  capture: undefined,
  asserts: ['error contains "has no residual percentage"'],
});
set("DEP-13.2", {
  action: "Check that nothing was left behind.",
  method: undefined, path: undefined, status: undefined,
  asserts: ["sql \"SELECT count(*) FROM fixed_assets WHERE organization_id={{ORG_A}} " +
            "AND name='WDV no-residual test'\" = 0"],
  note: "The refusal must leave nothing behind - no asset, and so no journal entry either.",
});
set("DEP-13.3", {
  action: "The run-time block, for the record.",
  method: undefined, path: undefined, status: undefined, auto: "NO",
  asserts: ["manual: the run-time WDV_NEEDS_RESIDUAL block needs an asset capitalised " +
            "under SLM and then moved to WDV by a later policy change. Not reachable " +
            "from this seed; covered by inspection."],
});

// ---------------------------------------------------------------------------
// 6. DEP-20.3 and DEP-21.3 were anchored to /depreciation-runs/due, in phase 7
//    - by which time every period they talk about is long posted and /due has
//    moved on. Neither needs to post anything.
//
//    DEP-20.3 reads the SCHEDULE, which is the durable record and the stronger
//    claim: the posted history was not restated, rather than a screen still
//    showing the old figure.
//
//    DEP-21.3 asks the question it was really asking - is the returned asset
//    still queued to charge at all - without re-posting a period.
// ---------------------------------------------------------------------------
set("DEP-20.3", {
  action: "Open the asset's depreciation schedule and read the May row.",
  method: undefined, path: undefined, body: undefined, status: undefined, je: undefined,
  asserts: [
    "GET /fixed-assets/{{DEP-01.assetId}}/schedule :: field data.runs[1].periodStart = 2026-05-01",
    "GET /fixed-assets/{{DEP-01.assetId}}/schedule :: field data.runs[1].amount = 1900.00",
  ],
  note: "60 months, not 84: the life on an asset is fixed at capitalisation.",
});
set("DEP-21.3", {
  action: "Open Depreciation > Due and look for the returned asset.",
  method: "GET", path: "/depreciation-runs/due", body: undefined, status: 200,
  asserts: [
    "field count(data.assets[id={{DEP-01.assetId}}]) = 0",
    "field count(data.blocked[id={{DEP-01.assetId}}]) = 0",
  ],
  note: "ASSERTS THE CORRECT BEHAVIOUR - a returned asset should neither charge nor sit " +
        "blocked. Fails today.",
});

// ---------------------------------------------------------------------------
// 7. A purchase return line is identified by the BILL LINE it reverses, not by
//    the item: the quantity cap is per bill line and the stock leaves at that
//    line's own rate. The old body sent itemId/rate/taxRate and was refused
//    with "Every line needs purchaseBillLineId and quantity > 0."
//
//    So a new step DEP-21.0 looks the line id up first.
// ---------------------------------------------------------------------------
{
  const c = by.get("DEP-21.1");
  c.body.lines = [{ purchaseBillLineId: "{{DEP-21.billLineId}}", quantity: 1 }];
  notes.push("DEP-21.1");
}
if (!by.has("DEP-21.0")) {
  const sib = by.get("DEP-21.1");
  cases.splice(cases.indexOf(sib), 0, {
    key: "DEP-21.0", caseId: "DEP-21", caseTitle: sib.caseTitle,
    action: "(setup lookup for the step that follows)",
    phase: 7, login: "A",
    method: "GET", path: "/purchase-returns/bill/{{DEP-01.billId}}/lines", status: 200,
    capture: { billLineId: "data.lines[0].id" },
    auto: "YES",
  });
  notes.push("DEP-21.0 (new)");
}

fs.writeFileSync(file, JSON.stringify(cases, null, 1) + "\n");
console.log(`patched ${notes.length} step(s): ${notes.join(", ")}`);
console.log(`${cases.length} steps now in depCases.json`);
// The check that it arrived whole and ran the same way here as it did there.
const sha = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
console.log(`SHA256 ${sha.toUpperCase()}`);