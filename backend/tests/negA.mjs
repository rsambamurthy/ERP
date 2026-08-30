// negA - migration_053 and the two schema fields.
//
// Creates db/migration_053_allow_negative_stock.sql. The migration is NOT
// run - you apply it yourself, as with 050 to 052.
//
// Two columns. organizations.allow_negative_stock, NOT NULL DEFAULT false,
// so every organisation that exists today is explicitly opted OUT rather
// than left null and ambiguous. And sales_invoices.negative_stock_reason,
// null on every invoice that did not use the override - which also makes
// it the filter for finding the ones that did.
//
// A sentence rather than a flag on the invoice, deliberately: 'why is this
// item at minus six' is the question asked three months later, and a
// boolean cannot answer it.
//
// Run the SQL, then `npx prisma generate`, before negB and negC.
//
// Save this as backend/tests/negA.mjs and run it from backend/:
//   node tests/negA.mjs
// Safe to run twice - a second run says 'already there' and changes nothing.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const at = (f) => path.join(here, "..", f);
const read = (f) => fs.readFileSync(at(f), "utf8").replace(/\r\n/g, "\n");
const L = (...ls) => ls.join("\n");
const save = (f, t) => fs.writeFileSync(at(f), t.replace(/\n*$/, "\n"));

let applied = 0, already = 0;
function edit(file, from, to, done) {
  const t = read(file);
  if (t.includes(done)) { already++; save(file, t); return; }
  const n = t.split(from).length - 1;
  if (n === 0) throw new Error("anchor not found in " + file + ": " + from.slice(0, 70));
  if (n > 1) throw new Error("anchor is not unique in " + file + ": " + from.slice(0, 70));
  save(file, t.replace(from, to));
  applied++;
}
function create(file, text, done) {
  if (fs.existsSync(at(file)) && read(file).includes(done)) { already++; return; }
  save(file, text);
  applied++;
}

create("../db/migration_053_allow_negative_stock.sql", L(
    "-- migration_053: selling stock you have not got, on purpose rather than by",
    "-- accident.",
    "--",
    "-- consumeStock() refuses when the branch holds less than the line asks for,",
    "-- and that refusal is correct for almost everything: a stock adjustment, a",
    "-- branch transfer, a production issue and a delivery note are all movements",
    "-- of goods that either exist or do not. A SALES INVOICE is different. By the",
    "-- time it is raised somebody has usually already promised the customer, and",
    "-- the shortfall is often a bookkeeping lag - the goods arrived, the purchase",
    "-- bill has not been entered yet - rather than an empty shelf.",
    "--",
    "-- So the invoice gets an override. TWO LOCKS, and both have to be open:",
    "--",
    "--   1. organizations.allow_negative_stock  the organisation permits it at",
    "--      all. Off by default, and off for every organisation that exists",
    "--      today, so nothing changes for anybody until somebody decides it",
    "--      should.",
    "--",
    "--   2. the invoice asks for it, explicitly, with a reason. Stored on the",
    "--      invoice in negative_stock_reason - not a flag, a sentence, because",
    "--      \"why did this go negative\" is the question somebody asks three months",
    "--      later and a boolean cannot answer it.",
    "--",
    "-- Neither lock alone is enough. An organisation with the setting on still",
    "-- refuses every ordinary invoice; an invoice that asks for the override in",
    "-- an organisation that has not enabled it is refused with a message saying",
    "-- so.",
    "--",
    "-- WHAT IT COSTS, stated plainly because somebody has to decide whether to",
    "-- turn it on:",
    "--",
    "--   * COGS on that invoice is posted at the CURRENT weighted average,",
    "--     including the part of the quantity the branch did not hold. When the",
    "--     real purchase lands at a different rate, the margin already posted is",
    "--     wrong and nothing goes back to fix it.",
    "--",
    "--   * The item's stock account goes into CREDIT for as long as the balance",
    "--     is negative. An inventory control account with a credit balance shows",
    "--     as a negative asset on a Schedule III balance sheet. AS 2 does not",
    "--     contemplate negative inventory, and an auditor will ask.",
    "--",
    "-- FIFO IS REFUSED EVEN WITH BOTH LOCKS OPEN. Weighted average always has an",
    "-- answer to \"at what cost did this leave\" - the stored average. FIFO's",
    "-- answer is a lot, and for the shortfall no lot exists. See lib/costing.ts.",
    "--",
    "-- Statements stand alone - run them one at a time.",
    "-- Idempotent: safe to re-run.",
    "",
    "",
    "-- 1. The organisation-level permission. NOT NULL DEFAULT false, so every",
    "--    existing organisation is explicitly opted out rather than left null and",
    "--    ambiguous - a nullable flag would make \"nobody has decided\" and \"no\"",
    "--    look the same to the code that reads it.",
    "ALTER TABLE organizations",
    "  ADD COLUMN IF NOT EXISTS allow_negative_stock BOOLEAN NOT NULL DEFAULT false;",
    "",
    "",
    "-- 2. Why this invoice was allowed to go negative. NULL on every invoice that",
    "--    did not use the override, which also makes it the filter: WHERE",
    "--    negative_stock_reason IS NOT NULL is the list of every invoice that",
    "--    ever did.",
    "ALTER TABLE sales_invoices",
    "  ADD COLUMN IF NOT EXISTS negative_stock_reason VARCHAR(200);",
    "",
    "",
    "-- Verify:",
    "--   SELECT name, allow_negative_stock FROM organizations ORDER BY created_at;",
    "--",
    "--   -- Every invoice raised against stock that was not there:",
    "--   SELECT invoice_number, invoice_date, negative_stock_reason",
    "--   FROM sales_invoices",
    "--   WHERE negative_stock_reason IS NOT NULL",
    "--   ORDER BY invoice_date;",
    "--",
    "--   -- The balances those invoices left behind. This is the list somebody",
    "--   -- has to clear, and it should normally be empty:",
    "--   SELECT i.sku, i.name, b.name AS branch, s.quantity_on_hand, s.average_cost",
    "--   FROM item_stock s",
    "--   JOIN items i ON i.id = s.item_id",
    "--   JOIN branches b ON b.id = s.branch_id",
    "--   WHERE s.quantity_on_hand < 0",
    "--   ORDER BY i.sku;"
),
  "allow_negative_stock BOOLEAN NOT NULL DEFAULT false");

edit("prisma/schema.prisma",
  "  soApprovalThreshold     Decimal?  @map(\"so_approval_threshold\") @db.Decimal(14, 2)",
  L(
    "  soApprovalThreshold     Decimal?  @map(\"so_approval_threshold\") @db.Decimal(14, 2)",
    "  // May a Sales Invoice be raised against stock the branch does not",
    "  // hold? Off for every organisation until somebody turns it on, and",
    "  // even then each invoice must ask for the override explicitly and give",
    "  // a reason - see migration_053 and lib/costing.ts. Refused under FIFO",
    "  // regardless, because the shortfall has no lot to come out of.",
    "  allowNegativeStock      Boolean   @default(false) @map(\"allow_negative_stock\")"),
  "allowNegativeStock      Boolean   @default(false)"
);

edit("prisma/schema.prisma",
  L(
    "  invoiceNumber     String   @map(\"invoice_number\") @db.VarChar(30)",
    "  invoiceDate       DateTime @map(\"invoice_date\") @db.Date",
    "  narration         String   @default(\"\") @db.VarChar(255)"),
  L(
    "  invoiceNumber     String   @map(\"invoice_number\") @db.VarChar(30)",
    "  invoiceDate       DateTime @map(\"invoice_date\") @db.Date",
    "  narration         String   @default(\"\") @db.VarChar(255)",
    "  // Set only when this invoice used the negative-stock override. NULL on",
    "  // every other invoice, which makes it the filter for \"show me every",
    "  // invoice that ever sold what we did not have\". A sentence rather than",
    "  // a flag on purpose: the question asked three months later is why, and",
    "  // a boolean cannot answer it.",
    "  negativeStockReason String? @map(\"negative_stock_reason\") @db.VarChar(200)"),
  "negativeStockReason String? @map(\"negative_stock_reason\")"
);

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["../db/migration_053_allow_negative_stock.sql","prisma/schema.prisma"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}