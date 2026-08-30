// SmartERP - freight, packing and insurance on a sales invoice.
//
// Script 2 of 7: the Prisma model and the invoice PDF.
//
// Run npx prisma generate after this one, with the dev server STOPPED -
// it replaces query_engine-windows.dll.node and a running server holds it.
//
// Save this as backend/tests/chgB.mjs and run it from backend/:
//   node tests/chgB.mjs
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

edit("prisma/schema.prisma",
  L(
    "  journalLines JournalLine[]",
    "  itemsUsingAsStockAccount Item[]"),
  L(
    "  journalLines JournalLine[]",
    "  invoiceCharges SalesInvoiceCharge[]",
    "  itemsUsingAsStockAccount Item[]"),
  "invoiceCharges SalesInvoiceCharge[]");

edit("prisma/schema.prisma",
  L(
    "  lines           SalesInvoiceLine[]",
    "  returns         SalesReturn[]"),
  L(
    "  lines           SalesInvoiceLine[]",
    "  // Freight, packing, insurance and the like. Document-level amounts that",
    "  // are PRORATED across the lines for GST - see migration_054 and",
    "  // lib/discountGst.ts - so each one is taxed at the rate of the goods it",
    "  // accompanies, which is what section 8(a) requires of a composite",
    "  // supply. Each carries its own income account so recovered freight can",
    "  // be set against freight paid.",
    "  charges         SalesInvoiceCharge[]",
    "  returns         SalesReturn[]"),
  "// Freight, packing, insurance and the like. Document-level amounts that");

edit("prisma/schema.prisma",
  L(
    "",
    "model PurchaseBill {"),
  L(
    "",
    "// A charge on a sales invoice: freight, packing, insurance, handling.",
    "//",
    "// amount is EXCLUSIVE of tax, and there is deliberately no tax column.",
    "// The tax on a charge lives in the invoice LINES, because the charge is",
    "// prorated into their taxable values before GST is computed - which is",
    "// how a composite supply gets taxed at the rate of the principal supply",
    "// without anybody having to choose a rate for the freight. A tax column",
    "// here would be the same rupee stored twice, in two places free to",
    "// disagree.",
    "model SalesInvoiceCharge {",
    "  id             String   @id @default(dbgenerated(\"gen_random_uuid()\")) @db.Uuid",
    "  salesInvoiceId String   @map(\"sales_invoice_id\") @db.Uuid",
    "  label          String   @db.VarChar(60)",
    "  // Its own INCOME head - 5002 Freight & Delivery Recovered and friends,",
    "  // added by migration_054. Never Sales Revenue: the point of separating",
    "  // them is that recovered freight can be read against freight paid.",
    "  accountId      String   @map(\"account_id\") @db.Uuid",
    "  amount         Decimal  @db.Decimal(14, 2)",
    "  sortOrder      Int      @default(0) @map(\"sort_order\")",
    "  createdAt      DateTime @default(now()) @map(\"created_at\")",
    "",
    "  salesInvoice SalesInvoice @relation(fields: [salesInvoiceId], references: [id], onDelete: Cascade)",
    "  account      Account      @relation(fields: [accountId], references: [id])",
    "",
    "  @@index([salesInvoiceId])",
    "  @@map(\"sales_invoice_charges\")",
    "}",
    "",
    "model PurchaseBill {"),
  "salesInvoice SalesInvoice @relation(fields: [salesInvoiceId], references: [id], onDelete: Cascade)");

edit("src/lib/salesInvoicePdf.ts",
  L(
    "    lineTotal: number;",
    "  }[];"),
  L(
    "    lineTotal: number;",
    "  }[];",
    "  // Freight, packing, insurance. No tax column, deliberately: the tax on",
    "  // a charge is already inside the line figures above, because the charge",
    "  // was prorated into their taxable values. A tax column here would read",
    "  // as additional tax, which it is not.",
    "  charges?: { label: string; amount: number }[];"),
  "// a charge is already inside the line figures above, because the charge");

edit("src/lib/salesInvoicePdf.ts",
  "  if (data.discountTotal > 0) totalLine(\"Discount\", `- ${money(data.discountTotal)}`);",
  L(
    "  if (data.discountTotal > 0) totalLine(\"Discount\", `- ${money(data.discountTotal)}`);",
    "  // Between the discount and the tax, which is where they belong in the",
    "  // arithmetic: a charge increases the value the tax is then computed on.",
    "  for (const c of data.charges ?? []) totalLine(c.label, money(c.amount));"),
  "// arithmetic: a charge increases the value the tax is then computed on.");

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["prisma/schema.prisma","src/lib/salesInvoicePdf.ts"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}