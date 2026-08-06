import { prisma } from "../db";

export class ProvisioningError extends Error {}

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
      })),
      skipDuplicates: true,
    });
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
