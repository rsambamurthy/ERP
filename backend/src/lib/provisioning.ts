import { prisma } from "../db";

export class ProvisioningError extends Error {}

// The fixed-asset classes every organization starts with — the same twelve
// migration_034 seeded onto organizations that already existed. Without this,
// an org provisioned after migration_034 would get the asset accounts but no
// classes, and capitalising a Purchase Bill line would have nothing to pick.
//
// Lives are Schedule II. They are seeded into BOTH defaultUsefulLifeMonths
// and scheduleIiLifeMonths: the first is the org's own default and editable,
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

// Seeds the org's chart of accounts (core + each selected domain's overlay),
// enables each selected domain's default modules, and creates the
// head-office branch if the org doesn't have one yet. Does not touch
// org_domains.domain_locked_at — that's set automatically by the
// trg_lock_org_domains trigger the moment a journal_entry is posted, not
// by provisioning itself.
export async function provisionOrganization(organizationId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { orgDomains: { include: { domainType: true } } },
  });
  if (!org) throw new ProvisioningError("Organization not found.");
  if (org.orgDomains.length === 0) {
    throw new ProvisioningError("No domains selected yet — call /onboarding/domain first.");
  }

  const domainTypeIds = org.orgDomains.map((d) => d.domainTypeId);

  // Core (domain_type_id NULL) + each selected domain's overlay.
  const coreTemplates = await prisma.coaTemplate.findMany({
    where: { domainTypeId: null },
  });
  const domainTemplates = await prisma.coaTemplate.findMany({
    where: { domainTypeId: { in: domainTypeIds } },
  });

  const existingAccounts = await prisma.account.findMany({
    where: { organizationId },
    select: { accountCode: true },
  });
  const existingCodes = new Set(existingAccounts.map((a) => a.accountCode));

  const toCreate = [...coreTemplates, ...domainTemplates].filter(
    (t) => !existingCodes.has(t.accountCode)
  );
  // De-dupe in case core/domain overlays ever collide on account_code.
  const seen = new Set<string>();
  const accountRows = toCreate.filter((t) => {
    if (seen.has(t.accountCode)) return false;
    seen.add(t.accountCode);
    return true;
  });

  if (accountRows.length > 0) {
    await prisma.account.createMany({
      data: accountRows.map((t) => ({
        organizationId,
        accountCode: t.accountCode,
        accountName: t.accountName,
        accountType: t.accountType,
        isControlAccount: t.isControlAccount,
        defaultBpType: t.defaultBpType,
        scheduleIiiHead: t.scheduleIiiHead,
        // Templated accounts are the org's standard COA — protected from
        // structural edits/deletes (see accounts.ts), same as SmartAppt's
        // is_system convention.
        isSystem: true,
      })),
      skipDuplicates: true,
    });
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

  // Enable each selected domain's default modules.
  const domainModules = await prisma.domainModule.findMany({
    where: { domainTypeId: { in: domainTypeIds } },
  });
  if (domainModules.length > 0) {
    await prisma.orgModule.createMany({
      data: domainModules.map((dm) => ({
        organizationId,
        moduleId: dm.moduleId,
      })),
      skipDuplicates: true,
    });
  }

  // Head-office branch, created once, from the first domain's GSTIN.
  const existingBranch = await prisma.branch.findFirst({
    where: { organizationId, isHeadOffice: true },
  });
  if (!existingBranch) {
    const firstDetails = org.orgDomains[0]?.domainDetails as
      | { gstin?: string }
      | null
      | undefined;
    await prisma.branch.create({
      data: {
        organizationId,
        code: "HO",
        name: `${org.name} — Head Office`,
        gstin: firstDetails?.gstin,
        isHeadOffice: true,
      },
    });
  }

  await prisma.organization.update({
    where: { id: organizationId },
    data: { status: "ACTIVE" },
  });

  await prisma.onboardingState.update({
    where: { organizationId },
    data: { step: "PROVISIONED", provisionedAt: new Date() },
  });
}
