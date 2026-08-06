import { Router } from "express";
import { prisma } from "../db";
import { provisionOrganization, ProvisioningError } from "../lib/provisioning";

const router = Router();

// POST /onboarding/domain — upsert org_domains (one or more), rejected once
// domain_locked_at is set.
router.post("/domain", async (req, res) => {
  const { organizationId, domains } = req.body ?? {};
  if (!organizationId || !domains || typeof domains !== "object") {
    return res.status(400).json({ message: "organizationId and domains are required." });
  }

  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) return res.status(404).json({ message: "Organization not found." });
  if (org.domainLockedAt) {
    return res.status(409).json({
      message: "This organization's domains are locked — it already has a posted transaction.",
    });
  }

  const codes = Object.keys(domains);
  if (codes.length === 0) {
    return res.status(400).json({ message: "Select at least one domain." });
  }

  const domainTypes = await prisma.domainType.findMany({ where: { code: { in: codes } } });
  if (domainTypes.length !== codes.length) {
    return res.status(400).json({ message: "Unknown domain code." });
  }

  await prisma.$transaction([
    ...domainTypes.map((dt) =>
      prisma.orgDomain.upsert({
        where: { organizationId_domainTypeId: { organizationId, domainTypeId: dt.id } },
        update: { domainDetails: domains[dt.code] },
        create: {
          organizationId,
          domainTypeId: dt.id,
          domainDetails: domains[dt.code],
        },
      })
    ),
    prisma.organization.update({
      where: { id: organizationId },
      data: { status: "PENDING_PROVISION" },
    }),
    prisma.onboardingState.update({
      where: { organizationId },
      data: { step: "DOMAIN_SELECTED" },
    }),
  ]);

  res.json({ ok: true });
});

// POST /onboarding/provision
router.post("/provision", async (req, res) => {
  const { organizationId } = req.body ?? {};
  if (!organizationId) return res.status(400).json({ message: "organizationId is required." });

  try {
    await provisionOrganization(organizationId);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof ProvisioningError) {
      return res.status(400).json({ message: err.message });
    }
    console.error(err);
    res.status(500).json({ message: "Provisioning failed." });
  }
});

// GET /onboarding/status?organizationId=...
router.get("/status", async (req, res) => {
  const organizationId = String(req.query.organizationId ?? "");
  if (!organizationId) return res.status(400).json({ message: "organizationId is required." });

  const state = await prisma.onboardingState.findUnique({ where: { organizationId } });
  if (!state) return res.status(404).json({ message: "Organization not found." });

  res.json({ organizationId, step: state.step });
});

export default router;
