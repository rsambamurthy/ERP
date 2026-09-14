import { Router } from "express";
import { prisma } from "../db";
import { provisionOrganization, ProvisioningError } from "../lib/provisioning";
import { sendEmail } from "../lib/email";

const router = Router();

// Base URL the verification link is built against — the frontend's own
// origin, since that's where /verify-email?token=... is served from. Falls
// back to localhost so a dev box with no env var set still produces a
// clickable (if locally-scoped) link rather than a broken one.
const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");

// POST /onboarding/domain — for a still-pending (unverified) registration:
// stages the domain selection onto pending_registrations.domains (no
// org_domains row exists yet, because no organization exists yet) and sends
// the verification email. This is "go till the last but don't create
// workspace" (step 3) followed by "send a verification email" (step 4) from
// the flow the user specified — the actual organization/org_domains rows
// aren't written until POST /auth/verify-email consumes the token.
router.post("/domain", async (req, res) => {
  const { pendingRegistrationId, domains } = req.body ?? {};
  if (!pendingRegistrationId || !domains || typeof domains !== "object") {
    return res.status(400).json({ message: "pendingRegistrationId and domains are required." });
  }

  const pending = await prisma.pendingRegistration.findUnique({ where: { id: pendingRegistrationId } });
  if (!pending) return res.status(404).json({ message: "Registration not found." });
  if (pending.consumedAt) {
    return res.status(409).json({ message: "This registration has already been verified." });
  }
  if (pending.expiresAt < new Date()) {
    return res.status(410).json({ message: "This registration has expired — please sign up again." });
  }

  const codes = Object.keys(domains);
  if (codes.length === 0) {
    return res.status(400).json({ message: "Select at least one domain." });
  }

  const domainTypes = await prisma.domainType.findMany({ where: { code: { in: codes } } });
  if (domainTypes.length !== codes.length) {
    return res.status(400).json({ message: "Unknown domain code." });
  }

  await prisma.pendingRegistration.update({
    where: { id: pendingRegistrationId },
    data: { domains },
  });

  const verifyLink = `${FRONTEND_URL}/verify-email?token=${pending.token}`;
  void sendEmail(
    pending.email,
    "Verify your SmartERP registration",
    `Hi ${pending.name},\n\nClick the link below to verify your email and create your SmartERP workspace for ${pending.businessName}. This link expires in 24 hours.\n\n${verifyLink}\n\nIf you didn't request this, you can ignore this email.`
  );

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
