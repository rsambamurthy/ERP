// Seeds the reference/config tables: domain_types, modules, domain_modules,
// coa_templates. Run once against a fresh DB (after registration_schema_v2.sql):
//   npx prisma db seed
// Safe to re-run — upserts by natural key where the schema has one; for
// coa_templates (whose unique constraint doesn't dedupe NULL domain_type_id
// rows, a known gap noted in the design spec) it checks-then-creates instead.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const trading = await prisma.domainType.upsert({
    where: { code: "TRADING" },
    update: {},
    create: {
      code: "TRADING",
      name: "Trading",
      description: "Buy, sell, and track inventory — retail, wholesale, distribution.",
    },
  });

  const manufacturing = await prisma.domainType.upsert({
    where: { code: "MANUFACTURING" },
    update: {},
    create: {
      code: "MANUFACTURING",
      name: "Manufacturing",
      description: "Production with a bill of materials — raw materials to finished goods.",
    },
  });

  const moduleDefs = [
    { code: "ACCOUNTING", name: "Accounting" },
    { code: "SALES", name: "Sales" },
    { code: "PURCHASE", name: "Purchase" },
    { code: "INVENTORY", name: "Inventory" },
    { code: "BOM", name: "Bill of Materials" },
  ];
  const modules: Record<string, string> = {};
  for (const m of moduleDefs) {
    const row = await prisma.module.upsert({
      where: { code: m.code },
      update: {},
      create: m,
    });
    modules[m.code] = row.id;
  }

  const domainModuleDefs: [string, string][] = [
    [trading.id, "ACCOUNTING"],
    [trading.id, "SALES"],
    [trading.id, "PURCHASE"],
    [trading.id, "INVENTORY"],
    [manufacturing.id, "ACCOUNTING"],
    [manufacturing.id, "SALES"],
    [manufacturing.id, "PURCHASE"],
    [manufacturing.id, "INVENTORY"],
    [manufacturing.id, "BOM"],
  ];
  for (const [domainTypeId, moduleCode] of domainModuleDefs) {
    await prisma.domainModule.upsert({
      where: {
        domainTypeId_moduleId: { domainTypeId, moduleId: modules[moduleCode] },
      },
      update: {},
      create: { domainTypeId, moduleId: modules[moduleCode] },
    });
  }

  type CoaRow = {
    domainTypeId: string | null;
    accountCode: string;
    accountName: string;
    accountType: string;
    isControlAccount?: boolean;
    defaultBpType?: string;
    // Default Schedule III Balance Sheet head — see lib/scheduleIII.ts.
    // Left undefined for INCOME/EXPENSE rows (Schedule III P&L formatting
    // isn't built yet).
    scheduleIiiHead?: string;
  };

  const coaRows: CoaRow[] = [
    // core — applied to every org regardless of domain
    { domainTypeId: null, accountCode: "1001", accountName: "Cash in Hand", accountType: "ASSET", scheduleIiiHead: "CASH_AND_CASH_EQUIVALENTS" },
    { domainTypeId: null, accountCode: "1002", accountName: "Bank Account", accountType: "ASSET", scheduleIiiHead: "CASH_AND_CASH_EQUIVALENTS" },
    { domainTypeId: null, accountCode: "4008", accountName: "Administrative", accountType: "EXPENSE" },
    // Trade Receivables/Payables used to be Trading-only, but a
    // Manufacturing org sells finished goods and buys raw materials from
    // vendors too — every org needs them regardless of which domain(s) it
    // selected, so they moved here from the Trading overlay below.
    {
      domainTypeId: null,
      accountCode: "1005",
      accountName: "Trade Receivables",
      accountType: "ASSET",
      isControlAccount: true,
      defaultBpType: "CUSTOMER",
      scheduleIiiHead: "TRADE_RECEIVABLES",
    },
    {
      domainTypeId: null,
      accountCode: "2001",
      accountName: "Trade Payables",
      accountType: "LIABILITY",
      isControlAccount: true,
      defaultBpType: "VENDOR",
      scheduleIiiHead: "TRADE_PAYABLES",
    },
    // Sales/Purchase/Inventory v1 — see routes/salesInvoices.ts,
    // purchaseBills.ts, stockAdjustments.ts for how these get posted to.
    // Legacy single-account GST — kept in the COA for orgs with historical
    // postings against them (trial balance integrity), but Sales
    // Invoice/Purchase Bill no longer post new transactions here — see the
    // CGST/SGST/IGST split accounts below.
    { domainTypeId: null, accountCode: "1101", accountName: "GST Input Credit", accountType: "ASSET", scheduleIiiHead: "OTHER_CURRENT_ASSETS" },
    { domainTypeId: null, accountCode: "2101", accountName: "GST Output Payable", accountType: "LIABILITY", scheduleIiiHead: "OTHER_CURRENT_LIABILITIES" },
    // CGST/SGST/IGST split — see routes/salesInvoices.ts and
    // routes/purchaseBills.ts for the intra-state (CGST+SGST) vs
    // inter-state (IGST) determination this feeds.
    { domainTypeId: null, accountCode: "1102", accountName: "CGST Input Credit", accountType: "ASSET", scheduleIiiHead: "OTHER_CURRENT_ASSETS" },
    { domainTypeId: null, accountCode: "1103", accountName: "SGST Input Credit", accountType: "ASSET", scheduleIiiHead: "OTHER_CURRENT_ASSETS" },
    { domainTypeId: null, accountCode: "1104", accountName: "IGST Input Credit", accountType: "ASSET", scheduleIiiHead: "OTHER_CURRENT_ASSETS" },
    { domainTypeId: null, accountCode: "2102", accountName: "CGST Output Payable", accountType: "LIABILITY", scheduleIiiHead: "OTHER_CURRENT_LIABILITIES" },
    { domainTypeId: null, accountCode: "2103", accountName: "SGST Output Payable", accountType: "LIABILITY", scheduleIiiHead: "OTHER_CURRENT_LIABILITIES" },
    { domainTypeId: null, accountCode: "2104", accountName: "IGST Output Payable", accountType: "LIABILITY", scheduleIiiHead: "OTHER_CURRENT_LIABILITIES" },
    // Import Purchase Bills only — Basic Customs Duty + import IGST both
    // credit here instead of Trade Payables, since neither is actually
    // owed to the foreign vendor (both are owed to customs/government,
    // typically via a clearing agent) — see routes/purchaseBills.ts.
    { domainTypeId: null, accountCode: "2105", accountName: "Customs Duty Payable", accountType: "LIABILITY", scheduleIiiHead: "OTHER_CURRENT_LIABILITIES" },
    // Prepaid Expenses — a control account, so its balance breaks down one
    // card per schedule rather than sitting as a single lump. See
    // migration_032, which also backfills this into existing organizations.
    {
      domainTypeId: null,
      accountCode: "1105",
      accountName: "Prepaid Expenses",
      accountType: "ASSET",
      isControlAccount: true,
      defaultBpType: "PREPAID",
      scheduleIiiHead: "OTHER_CURRENT_ASSETS",
    },
    { domainTypeId: null, accountCode: "4001", accountName: "Cost of Goods Sold", accountType: "EXPENSE" },
    // Gross-method Sales Invoice discount posting: Sales Revenue posts at
    // full pre-discount value, this contra account absorbs everything taken
    // off (line-level + invoice-level discount combined) — see
    // routes/salesInvoices.ts.
    { domainTypeId: null, accountCode: "4003", accountName: "Discount Allowed", accountType: "EXPENSE" },
    // Both directions of Stock Adjustment post here — a write-off debits
    // it (a real loss), a found-stock/opening correction credits it (a
    // contra that nets the expense down). One account, either direction,
    // same convention a lot of small-business systems use for "Inventory
    // Shrinkage/Adjustment" rather than inventing a separate other-income
    // account for the inward case.
    { domainTypeId: null, accountCode: "4002", accountName: "Inventory Adjustments", accountType: "EXPENSE" },
    { domainTypeId: null, accountCode: "5001", accountName: "Sales Revenue", accountType: "INCOME" },
    // ── Fixed assets and depreciation (migration_034) ──────────────────
    // Five asset classes and five matching contra accounts. Accumulated
    // depreciation is a SEPARATE contra-asset account, never a credit against
    // the asset: Schedule III requires gross block, accumulated depreciation
    // and net block to be shown separately, and netting them at posting time
    // destroys that information for good.
    //
    // All ten are control accounts for the ASSET sub-ledger — each asset gets
    // its own card, tagged on both its cost and its contra, so one asset's
    // net book value is readable from the ledger rather than only from the
    // fixed_assets table.
    { domainTypeId: null, accountCode: "1401", accountName: "Land & Buildings", accountType: "ASSET", isControlAccount: true, defaultBpType: "ASSET", scheduleIiiHead: "FIXED_ASSETS" },
    { domainTypeId: null, accountCode: "1402", accountName: "Plant & Machinery", accountType: "ASSET", isControlAccount: true, defaultBpType: "ASSET", scheduleIiiHead: "FIXED_ASSETS" },
    { domainTypeId: null, accountCode: "1403", accountName: "Furniture & Fixtures", accountType: "ASSET", isControlAccount: true, defaultBpType: "ASSET", scheduleIiiHead: "FIXED_ASSETS" },
    { domainTypeId: null, accountCode: "1404", accountName: "Vehicles", accountType: "ASSET", isControlAccount: true, defaultBpType: "ASSET", scheduleIiiHead: "FIXED_ASSETS" },
    { domainTypeId: null, accountCode: "1405", accountName: "Computers & Equipment", accountType: "ASSET", isControlAccount: true, defaultBpType: "ASSET", scheduleIiiHead: "FIXED_ASSETS" },
    { domainTypeId: null, accountCode: "1451", accountName: "Accumulated Depreciation - Buildings", accountType: "ASSET", isControlAccount: true, defaultBpType: "ASSET", scheduleIiiHead: "FIXED_ASSETS" },
    { domainTypeId: null, accountCode: "1452", accountName: "Accumulated Depreciation - Plant & Machinery", accountType: "ASSET", isControlAccount: true, defaultBpType: "ASSET", scheduleIiiHead: "FIXED_ASSETS" },
    { domainTypeId: null, accountCode: "1453", accountName: "Accumulated Depreciation - Furniture", accountType: "ASSET", isControlAccount: true, defaultBpType: "ASSET", scheduleIiiHead: "FIXED_ASSETS" },
    { domainTypeId: null, accountCode: "1454", accountName: "Accumulated Depreciation - Vehicles", accountType: "ASSET", isControlAccount: true, defaultBpType: "ASSET", scheduleIiiHead: "FIXED_ASSETS" },
    { domainTypeId: null, accountCode: "1455", accountName: "Accumulated Depreciation - Computers", accountType: "ASSET", isControlAccount: true, defaultBpType: "ASSET", scheduleIiiHead: "FIXED_ASSETS" },
    { domainTypeId: null, accountCode: "4020", accountName: "Depreciation & Amortisation", accountType: "EXPENSE" },
    { domainTypeId: null, accountCode: "4021", accountName: "Loss on Disposal of Assets", accountType: "EXPENSE" },
    { domainTypeId: null, accountCode: "5010", accountName: "Gain on Disposal of Assets", accountType: "INCOME" },
    // Trading overlay
    {
      domainTypeId: trading.id,
      accountCode: "1201",
      accountName: "Inventory",
      accountType: "ASSET",
      isControlAccount: true,
      defaultBpType: "ITEM",
      scheduleIiiHead: "INVENTORIES",
    },
    // Manufacturing overlay
    {
      domainTypeId: manufacturing.id,
      accountCode: "1301",
      accountName: "Raw Materials",
      accountType: "ASSET",
      isControlAccount: true,
      defaultBpType: "ITEM",
      scheduleIiiHead: "INVENTORIES",
    },
    {
      domainTypeId: manufacturing.id,
      accountCode: "1302",
      accountName: "Work in Progress",
      accountType: "ASSET",
      scheduleIiiHead: "INVENTORIES",
    },
    {
      domainTypeId: manufacturing.id,
      accountCode: "1303",
      accountName: "Finished Goods",
      accountType: "ASSET",
      isControlAccount: true,
      defaultBpType: "ITEM",
      scheduleIiiHead: "INVENTORIES",
    },
  ];

  for (const row of coaRows) {
    const existing = await prisma.coaTemplate.findFirst({
      where: { domainTypeId: row.domainTypeId, accountCode: row.accountCode },
    });
    if (!existing) {
      await prisma.coaTemplate.create({ data: row });
    }
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
