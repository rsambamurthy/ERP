// SmartERP - Charge Master.
//
// Script 2 of 12: the Prisma model, provisioning, and the route mount.
//
// Run npx prisma generate after this one, with the dev server STOPPED.
//
// Save this as backend/tests/cmB.mjs and run it from backend/:
//   node tests/cmB.mjs
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
    "  currencyRates    CurrencyRate[]",
    "  integrationConnection IntegrationConnection?"),
  L(
    "  currencyRates    CurrencyRate[]",
    "  chargeTypes      ChargeType[]",
    "  integrationConnection IntegrationConnection?"),
  "chargeTypes      ChargeType[]");

edit("prisma/schema.prisma",
  L(
    "  invoiceCharges SalesInvoiceCharge[]",
    "  itemsUsingAsStockAccount Item[]"),
  L(
    "  invoiceCharges SalesInvoiceCharge[]",
    "  chargeTypes    ChargeType[]",
    "  itemsUsingAsStockAccount Item[]"),
  "chargeTypes    ChargeType[]");

edit("prisma/schema.prisma",
  L(
    "  createdAt      DateTime @default(now()) @map(\"created_at\")",
    "",
    "  salesInvoice SalesInvoice @relation(fields: [salesInvoiceId], references: [id], onDelete: Cascade)"),
  L(
    "  createdAt      DateTime @default(now()) @map(\"created_at\")",
    "  // The master row this charge was chosen from - migration_055. Nullable",
    "  // because charges raised before the master existed have no type, and",
    "  // inventing one for them would be a guess a report would then trust.",
    "  // label and accountId above stay authoritative for the DOCUMENT: renaming",
    "  // a charge type must not restate an invoice already issued.",
    "  chargeTypeId   String?  @map(\"charge_type_id\") @db.Uuid",
    "",
    "  salesInvoice SalesInvoice @relation(fields: [salesInvoiceId], references: [id], onDelete: Cascade)"),
  "// label and accountId above stay authoritative for the DOCUMENT: renaming");

edit("prisma/schema.prisma",
  L(
    "  account      Account      @relation(fields: [accountId], references: [id])",
    ""),
  L(
    "  account      Account      @relation(fields: [accountId], references: [id])",
    "  chargeType   ChargeType?  @relation(fields: [chargeTypeId], references: [id])",
    ""),
  "chargeType   ChargeType?  @relation(fields: [chargeTypeId], references: [id])");

edit("prisma/schema.prisma",
  L(
    "",
    "model PurchaseBill {"),
  L(
    "",
    "// A charge the organisation can put on an invoice: a label bound to an",
    "// income account, chosen rather than typed.",
    "//",
    "// migration_054 let the label be free text and it drifted - \"Delivery",
    "// charges\", \"Delivery Charges\", \"Freight\" on one account, fragmenting every",
    "// report that grouped by it. There is no rate here for the same reason there",
    "// is none on SalesInvoiceCharge: a charge is prorated into the goods lines",
    "// and taxed at THEIR rate, so it never has one of its own.",
    "//",
    "// Deactivated, never deleted. A type that has been used is referenced by",
    "// documents, and is_active is what takes it out of the picker without",
    "// rewriting history.",
    "model ChargeType {",
    "  id             String   @id @default(dbgenerated(\"gen_random_uuid()\")) @db.Uuid",
    "  organizationId String   @map(\"organization_id\") @db.Uuid",
    "  label          String   @db.VarChar(60)",
    "  accountId      String   @map(\"account_id\") @db.Uuid",
    "  isActive       Boolean  @default(true) @map(\"is_active\")",
    "  sortOrder      Int      @default(0) @map(\"sort_order\")",
    "  createdAt      DateTime @default(now()) @map(\"created_at\")",
    "",
    "  organization Organization          @relation(fields: [organizationId], references: [id])",
    "  account      Account               @relation(fields: [accountId], references: [id])",
    "  charges      SalesInvoiceCharge[]",
    "",
    "  @@index([organizationId])",
    "  @@map(\"charge_types\")",
    "}",
    "",
    "model PurchaseBill {"),
  "account      Account               @relation(fields: [accountId], references: [id])");

edit("src/lib/provisioning.ts",
  L(
    "",
    "  // Enable each selected domain's default modules."),
  L(
    "",
    "  // Charge Master. The standard three, bound to the recovered-income heads",
    "  // migration_054 provides. Same shape as the asset classes above: keyed off",
    "  // account codes, skipped when the chart predates them, and safe to re-run.",
    "  //",
    "  // Seeded rather than left empty because an organisation with no charge",
    "  // types cannot put delivery on an invoice at all - the master-only rule",
    "  // means an empty master is a closed door, and nobody should have to",
    "  // discover that mid-invoice. The labels are a starting point, freely",
    "  // renamed on the Charge Master screen.",
    "  const chargeAccounts = await prisma.account.findMany({",
    "    where: { organizationId, accountCode: { in: [\"5002\", \"5003\", \"5004\"] } },",
    "    select: { id: true, accountCode: true },",
    "  });",
    "  const chargeIdByCode = new Map(chargeAccounts.map((a) => [a.accountCode, a.id]));",
    "  const chargeSeed: { code: string; label: string; sortOrder: number }[] = [",
    "    { code: \"5002\", label: \"Delivery charges\", sortOrder: 10 },",
    "    { code: \"5003\", label: \"Packing & forwarding\", sortOrder: 20 },",
    "    { code: \"5004\", label: \"Transit insurance\", sortOrder: 30 },",
    "  ];",
    "  const existingChargeTypes = await prisma.chargeType.findMany({",
    "    where: { organizationId }, select: { label: true },",
    "  });",
    "  const takenLabels = new Set(existingChargeTypes.map((c) => c.label.toLowerCase()));",
    "  const chargeRows = chargeSeed.flatMap((c) => {",
    "    const accountId = chargeIdByCode.get(c.code);",
    "    if (!accountId || takenLabels.has(c.label.toLowerCase())) return [];",
    "    return [{ organizationId, label: c.label, accountId, sortOrder: c.sortOrder }];",
    "  });",
    "  if (chargeRows.length > 0) {",
    "    await prisma.chargeType.createMany({ data: chargeRows, skipDuplicates: true });",
    "  }",
    "",
    "  // Enable each selected domain's default modules."),
  "const takenLabels = new Set(existingChargeTypes.map((c) => c.label.toLowerCase()));");

edit("src/index.ts",
  L(
    "import currencyRatesRoutes from \"./routes/currencyRates\";",
    "import recurringExpensesRoutes from \"./routes/recurringExpenses\";"),
  L(
    "import currencyRatesRoutes from \"./routes/currencyRates\";",
    "import chargeTypesRoutes from \"./routes/chargeTypes\";",
    "import recurringExpensesRoutes from \"./routes/recurringExpenses\";"),
  "import chargeTypesRoutes from \"./routes/chargeTypes\";");

edit("src/index.ts",
  L(
    "app.use(\"/currency-rates\", currencyRatesRoutes);",
    "app.use(\"/recurring-expenses\", recurringExpensesRoutes);"),
  L(
    "app.use(\"/currency-rates\", currencyRatesRoutes);",
    "app.use(\"/charge-types\", chargeTypesRoutes);",
    "app.use(\"/recurring-expenses\", recurringExpensesRoutes);"),
  "app.use(\"/charge-types\", chargeTypesRoutes);");

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["prisma/schema.prisma","src/lib/provisioning.ts","src/index.ts"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}