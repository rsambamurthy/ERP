// SmartERP - Charge Master.
//
// Script 1 of 12: db/migration_055_charge_types.sql.
//
// Writes the file only. RUN THE SQL before deploying the rest - the API
// references charge_types and sales_invoice_charges.charge_type_id the
// moment it starts.
//
// Save this as backend/tests/cmA.mjs and run it from backend/:
//   node tests/cmA.mjs
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
function create(file, text, done) {
  if (fs.existsSync(at(file)) && read(file).includes(done)) { already++; return; }
  fs.mkdirSync(path.dirname(at(file)), { recursive: true });
  save(file, text);
  applied++;
}

create("../db/migration_055_charge_types.sql", L(
    "-- migration_055: a master for invoice charges.",
    "--",
    "-- migration_054 gave a charge a label, an account and an amount, and let the",
    "-- user type the label freehand on every invoice. That works and it drifts:",
    "-- \"Delivery charges\", \"Delivery Charges\", \"Delivery\", \"Frieght\" all end up on",
    "-- the same account, and any report that groups by label fragments into four",
    "-- rows that are one thing. The account was always the stable key; the label",
    "-- never was.",
    "--",
    "-- So the label stops being typed and starts being CHOSEN. A charge type is a",
    "-- label bound to an income account, once, per organisation. The invoice picks",
    "-- one and enters an amount.",
    "--",
    "-- WHAT THIS DOES NOT CHANGE. sales_invoice_charges still stores its own label",
    "-- and account_id, and those remain what the document means - the same pinning",
    "-- as party_gstin on a sales invoice (migration_031). Renaming a charge type in",
    "-- March must not restate an invoice raised in January. charge_type_id is added",
    "-- alongside as a nullable link, so a report can group by TYPE across a rename",
    "-- while each document keeps saying what it said when it was posted.",
    "--",
    "-- Statements stand alone - run them one at a time.",
    "-- Idempotent: safe to re-run.",
    "",
    "",
    "-- 1. The master. Per organisation, because one org's \"Delivery charges\" is",
    "--    another's \"Freight out\", and neither should have to accept the other's",
    "--    vocabulary.",
    "CREATE TABLE IF NOT EXISTS charge_types (",
    "  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),",
    "  organization_id UUID NOT NULL REFERENCES organizations(id),",
    "  label           VARCHAR(60) NOT NULL,",
    "  account_id      UUID NOT NULL REFERENCES accounts(id),",
    "  is_active       BOOLEAN NOT NULL DEFAULT true,",
    "  sort_order      INTEGER NOT NULL DEFAULT 0,",
    "  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()",
    ");",
    "",
    "CREATE INDEX IF NOT EXISTS charge_types_org_idx ON charge_types (organization_id);",
    "",
    "",
    "-- 2. THE CONSTRAINT THAT IS THE WHOLE POINT OF THIS MIGRATION. Unique on the",
    "--    LOWERCASED label, so \"Delivery charges\" and \"Delivery Charges\" cannot",
    "--    both exist. A plain unique index would have permitted exactly the drift",
    "--    this table was created to stop.",
    "CREATE UNIQUE INDEX IF NOT EXISTS charge_types_org_label_uk",
    "  ON charge_types (organization_id, lower(label));",
    "",
    "",
    "-- 3. The link from a posted charge back to the type it was chosen from.",
    "--    Nullable: charges raised before this migration have no type, and no",
    "--    back-fill can honestly invent one. RESTRICT rather than CASCADE - a",
    "--    type that has been used on a document is deactivated, never deleted,",
    "--    and the foreign key is what makes that true rather than a convention",
    "--    somebody remembers.",
    "ALTER TABLE sales_invoice_charges",
    "  ADD COLUMN IF NOT EXISTS charge_type_id UUID REFERENCES charge_types(id);",
    "",
    "",
    "-- 4. Seed the standard three for every organisation that has the heads",
    "--    migration_054 created. Derived from accounts rather than named here, so",
    "--    an organisation whose 5002 is called something else keeps its own name.",
    "INSERT INTO charge_types (organization_id, label, account_id, sort_order)",
    "SELECT a.organization_id, 'Delivery charges', a.id, 10",
    "  FROM accounts a",
    " WHERE a.account_code = '5002'",
    "   AND NOT EXISTS (",
    "         SELECT 1 FROM charge_types c",
    "          WHERE c.organization_id = a.organization_id",
    "            AND lower(c.label) = 'delivery charges');",
    "",
    "",
    "-- 5.",
    "INSERT INTO charge_types (organization_id, label, account_id, sort_order)",
    "SELECT a.organization_id, 'Packing & forwarding', a.id, 20",
    "  FROM accounts a",
    " WHERE a.account_code = '5003'",
    "   AND NOT EXISTS (",
    "         SELECT 1 FROM charge_types c",
    "          WHERE c.organization_id = a.organization_id",
    "            AND lower(c.label) = 'packing & forwarding');",
    "",
    "",
    "-- 6.",
    "INSERT INTO charge_types (organization_id, label, account_id, sort_order)",
    "SELECT a.organization_id, 'Transit insurance', a.id, 30",
    "  FROM accounts a",
    " WHERE a.account_code = '5004'",
    "   AND NOT EXISTS (",
    "         SELECT 1 FROM charge_types c",
    "          WHERE c.organization_id = a.organization_id",
    "            AND lower(c.label) = 'transit insurance');",
    "",
    "",
    "-- 7. And link up whatever charges already exist, where the pairing is",
    "--    unambiguous - same organisation, same account, same label ignoring",
    "--    case. Anything that does not match exactly is left null rather than",
    "--    guessed at: a wrong link is worse than no link, because a report would",
    "--    then quietly attribute a charge to a type nobody chose.",
    "UPDATE sales_invoice_charges sic",
    "   SET charge_type_id = ct.id",
    "  FROM sales_invoices i, charge_types ct",
    " WHERE sic.sales_invoice_id = i.id",
    "   AND ct.organization_id = i.organization_id",
    "   AND ct.account_id = sic.account_id",
    "   AND lower(ct.label) = lower(sic.label)",
    "   AND sic.charge_type_id IS NULL;",
    "",
    "",
    "-- Verify:",
    "--   SELECT o.name, c.label, a.account_code, a.account_name, c.is_active",
    "--   FROM charge_types c",
    "--   JOIN organizations o ON o.id = c.organization_id",
    "--   JOIN accounts a ON a.id = c.account_id",
    "--   ORDER BY o.name, c.sort_order, c.label;",
    "--",
    "--   -- What a charge type has actually earned, which is the question the",
    "--   -- separate heads existed for in the first place:",
    "--   SELECT ct.label, a.account_code, count(*) AS times, sum(sic.amount) AS recovered",
    "--   FROM sales_invoice_charges sic",
    "--   JOIN charge_types ct ON ct.id = sic.charge_type_id",
    "--   JOIN accounts a ON a.id = ct.account_id",
    "--   GROUP BY ct.label, a.account_code",
    "--   ORDER BY recovered DESC;",
    "--",
    "--   -- Charges raised before the master existed, if any:",
    "--   SELECT count(*) FROM sales_invoice_charges WHERE charge_type_id IS NULL;"
),
  "charge_types_org_label_uk");

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["../db/migration_055_charge_types.sql"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}