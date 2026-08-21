$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Prisma + provisioning + asset classes...' -ForegroundColor Cyan

function Edit-FileText($rel, $old, $new) {
  $p = Join-Path $repo $rel
  if (-not (Test-Path -LiteralPath $p)) { throw "Missing file: $rel" }
  $old = $old.Replace([string][char]13, '')
  $new = $new.Replace([string][char]13, '')
  $t = [IO.File]::ReadAllText($p).Replace([string][char]13, '')
  if ($t.Contains($new)) { Write-Host "  skip   $rel"; return }
  $i = $t.IndexOf($old)
  if ($i -lt 0) { throw "Anchor not found in $rel." }
  if ($t.IndexOf($old, $i + 1) -ge 0) { throw "Anchor is not unique in $rel." }
  $t = $t.Substring(0, $i) + $new + $t.Substring($i + $old.Length)
  [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
  Write-Host "  edit   $rel"
}

Edit-FileText 'backend/prisma/schema.prisma' '  accumDepAccountId       String   @map("accum_dep_account_id") @db.Uuid
  depExpenseAccountId     String   @map("dep_expense_account_id") @db.Uuid
  defaultUsefulLifeMonths Int      @map("default_useful_life_months")
  defaultMethod           String   @default("SLM") @map("default_method") @db.VarChar(3)
  // 5% is the Schedule II ceiling ("shall not be more than five per cent of
  // the original cost"), not a requirement — hence a default, not a constant.' '  accumDepAccountId       String   @map("accum_dep_account_id") @db.Uuid
  depExpenseAccountId     String   @map("dep_expense_account_id") @db.Uuid
  defaultUsefulLifeMonths Int      @map("default_useful_life_months")
  // The life Schedule II actually prescribes, kept apart from the default
  // above because the default is editable and this is not. Part A paragraph
  // 3(i) measures a deviation against the statute, so editing a class must
  // never move the yardstick. See migration_035.
  scheduleIiLifeMonths    Int      @map("schedule_ii_life_months")
  defaultMethod           String   @default("SLM") @map("default_method") @db.VarChar(3)
  // 5% is the Schedule II ceiling ("shall not be more than five per cent of
  // the original cost"), not a requirement — hence a default, not a constant.'

Edit-FileText 'backend/prisma/schema.prisma' '  // What depreciation runs from — Schedule II charges pro rata "from the date
  // of such addition", and an asset still in its crate is not in use.
  inUseDate             DateTime  @map("in_use_date") @db.Date
  method                String    @default("SLM") @db.VarChar(3)
  usefulLifeMonths      Int       @map("useful_life_months")
  // Pinned per asset: block rates change with each Finance Act, and an asset
  // keeps computing at the rate it was capitalised under.
  itBlockCode           String    @map("it_block_code") @db.VarChar(30)' '  // What depreciation runs from — Schedule II charges pro rata "from the date
  // of such addition", and an asset still in its crate is not in use.
  inUseDate             DateTime  @map("in_use_date") @db.Date
  // Schedule II prescribes lives, not methods — Part A never names one, and
  // Part C''s Notes require only that the method used be disclosed. WDV must
  // carry a residual: its rate is 1 - (residual/cost)^(1/n), which at zero
  // residual writes the whole cost off in one period.
  method                String    @default("SLM") @db.VarChar(3)
  usefulLifeMonths      Int       @map("useful_life_months")
  // Snapshotted from the class at capitalisation, so the register can answer
  // "which assets depart from Schedule II" even after a class is edited.
  scheduleIiLifeMonths  Int       @map("schedule_ii_life_months")
  // Part A paragraph 3(i): a life different from the prescribed one must be
  // disclosed and justified with technical advice. NOT NULL is wrong here —
  // most assets do not deviate — so the requirement is a CHECK instead:
  // fixed_assets_life_note_ck refuses a deviation with no note.
  usefulLifeNote        String?   @map("useful_life_note") @db.VarChar(500)
  // Pinned per asset: block rates change with each Finance Act, and an asset
  // keeps computing at the rate it was capitalised under.
  itBlockCode           String    @map("it_block_code") @db.VarChar(30)'

Edit-FileText 'backend/src/lib/provisioning.ts' 'import { prisma } from "../db";

export class ProvisioningError extends Error {}

// Seeds the org''s chart of accounts (core + each selected domain''s overlay),
// enables each selected domain''s default modules, and creates the' 'import { prisma } from "../db";

export class ProvisioningError extends Error {}

// The fixed-asset classes every organization starts with — the same twelve
// migration_034 seeded onto organizations that already existed. Without this,
// an org provisioned after migration_034 would get the asset accounts but no
// classes, and capitalising a Purchase Bill line would have nothing to pick.
//
// Lives are Schedule II. They are seeded into BOTH defaultUsefulLifeMonths
// and scheduleIiLifeMonths: the first is the org''s own default and editable,
// the second records what the statute prescribes and is not, because Part A
// paragraph 3(i) measures a deviation against the statute rather than
// against a class someone has since adjusted.
//
// itBlockCode / itRate are filled because the columns are NOT NULL. Income
// tax depreciation is out of scope and nothing reads them.
const ASSET_CLASS_SEED: {
  name: string; assetCode: string; accumCode: string;
  lifeMonths: number; itBlock: string; itRate: number; sortOrder: number;
}[] = [
  { name: "Buildings - factory",            assetCode: "1401", accumCode: "1451", lifeMonths: 360, itBlock: "BUILDING_10", itRate: 10, sortOrder: 10 },
  { name: "Buildings - other (RCC frame)",  assetCode: "1401", accumCode: "1451", lifeMonths: 720, itBlock: "BUILDING_10", itRate: 10, sortOrder: 20 },
  { name: "Buildings - residential",        assetCode: "1401", accumCode: "1451", lifeMonths: 720, itBlock: "BUILDING_05", itRate: 5,  sortOrder: 30 },
  { name: "Plant & machinery - general",    assetCode: "1402", accumCode: "1452", lifeMonths: 180, itBlock: "PM_15",       itRate: 15, sortOrder: 40 },
  { name: "Electrical installations",       assetCode: "1402", accumCode: "1452", lifeMonths: 120, itBlock: "PM_15",       itRate: 15, sortOrder: 50 },
  { name: "Furniture & fittings",           assetCode: "1403", accumCode: "1453", lifeMonths: 120, itBlock: "FF_10",       itRate: 10, sortOrder: 60 },
  { name: "Vehicles - commercial",          assetCode: "1404", accumCode: "1454", lifeMonths: 72,  itBlock: "MV_15",       itRate: 15, sortOrder: 70 },
  { name: "Vehicles - other",               assetCode: "1404", accumCode: "1454", lifeMonths: 96,  itBlock: "MV_15",       itRate: 15, sortOrder: 80 },
  { name: "Motorcycles & scooters",         assetCode: "1404", accumCode: "1454", lifeMonths: 120, itBlock: "MV_15",       itRate: 15, sortOrder: 90 },
  { name: "Computers - servers & networks", assetCode: "1405", accumCode: "1455", lifeMonths: 72,  itBlock: "COMP_40",     itRate: 40, sortOrder: 100 },
  { name: "Computers - desktops & laptops", assetCode: "1405", accumCode: "1455", lifeMonths: 36,  itBlock: "COMP_40",     itRate: 40, sortOrder: 110 },
  { name: "Office equipment",               assetCode: "1405", accumCode: "1455", lifeMonths: 60,  itBlock: "OE_15",       itRate: 15, sortOrder: 120 },
];

// Seeds the org''s chart of accounts (core + each selected domain''s overlay),
// enables each selected domain''s default modules, and creates the'

Edit-FileText 'backend/src/lib/provisioning.ts' '    });
  }

  // Enable each selected domain''s default modules.
  const domainModules = await prisma.domainModule.findMany({
    where: { domainTypeId: { in: domainTypeIds } },' '    });
  }

  // Fixed-asset classes. After the accounts above, because each class points
  // at three of them. skipDuplicates plus the (organization_id, name) unique
  // means re-provisioning an existing org adds nothing and breaks nothing.
  const assetAccounts = await prisma.account.findMany({
    where: { organizationId, accountCode: { in: ["1401", "1402", "1403", "1404", "1405", "1451", "1452", "1453", "1454", "1455", "4020"] } },
    select: { id: true, accountCode: true },
  });
  const accountIdByCode = new Map(assetAccounts.map((a) => [a.accountCode, a.id]));
  const depExpenseId = accountIdByCode.get("4020");
  if (depExpenseId) {
    const classRows = ASSET_CLASS_SEED.flatMap((c) => {
      const assetId = accountIdByCode.get(c.assetCode);
      const accumId = accountIdByCode.get(c.accumCode);
      // An org whose chart predates the depreciation accounts simply gets no
      // classes rather than a half-built one. Re-running provisioning after
      // Sync from Templates fills them in.
      if (!assetId || !accumId) return [];
      return [{
        organizationId,
        name: c.name,
        assetAccountId: assetId,
        accumDepAccountId: accumId,
        depExpenseAccountId: depExpenseId,
        defaultUsefulLifeMonths: c.lifeMonths,
        scheduleIiLifeMonths: c.lifeMonths,
        defaultItBlockCode: c.itBlock,
        defaultItRate: c.itRate,
        sortOrder: c.sortOrder,
      }];
    });
    if (classRows.length > 0) {
      await prisma.assetClass.createMany({ data: classRows, skipDuplicates: true });
    }
  }

  // Enable each selected domain''s default modules.
  const domainModules = await prisma.domainModule.findMany({
    where: { domainTypeId: { in: domainTypeIds } },'

Edit-FileText 'backend/src/routes/assetClasses.ts' '      // 30 months for some moulds) and monthly is the granularity the charge
      // is computed at anyway.
      defaultUsefulLifeMonths: c.defaultUsefulLifeMonths,
      defaultMethod: c.defaultMethod,
      defaultResidualPct: Number(c.defaultResidualPct),
      assetAccount: c.assetAccount,' '      // 30 months for some moulds) and monthly is the granularity the charge
      // is computed at anyway.
      defaultUsefulLifeMonths: c.defaultUsefulLifeMonths,
      // What Schedule II prescribes, as opposed to what this org''s class
      // says. The screen needs both: it warns when the two differ, and a
      // deviation from THIS one is what requires a justification.
      scheduleIiLifeMonths: c.scheduleIiLifeMonths,
      defaultMethod: c.defaultMethod,
      defaultResidualPct: Number(c.defaultResidualPct),
      assetAccount: c.assetAccount,'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green