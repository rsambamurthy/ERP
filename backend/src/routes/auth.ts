import { Router } from "express";
import { prisma } from "../db";
import { hashPassword } from "../lib/password";
import { generateOtp, otpExpiry, sendOtp } from "../lib/otp";

const router = Router();

// POST /auth/register — create user + org shell (status PENDING_VERIFICATION)
router.post("/register", async (req, res) => {
  const { businessName, email, phone, password } = req.body ?? {};
  if (!businessName || !password || (!email && !phone)) {
    return res.status(400).json({
      message: "businessName, password, and at least one of email/phone are required.",
    });
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [email ? { email } : undefined, phone ? { phone } : undefined].filter(Boolean) as any },
  });
  if (existing) {
    return res.status(409).json({ message: "An account with that email or phone already exists." });
  }

  const passwordHash = await hashPassword(password);
  const otp = generateOtp();

  const result = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name: businessName, status: "PENDING_VERIFICATION" },
    });
    const user = await tx.user.create({
      data: { email: email || null, phone: phone || null, passwordHash },
    });
    await tx.orgUser.create({
      data: { organizationId: organization.id, userId: user.id, role: "OWNER" },
    });
    await tx.onboardingState.create({
      data: {
        organizationId: organization.id,
        step: "SIGNUP",
        otpCode: otp,
        otpExpiresAt: otpExpiry(),
      },
    });
    return { organization, user };
  });

  sendOtp(email || phone, otp);

  res.status(201).json({
    organizationId: result.organization.id,
    userId: result.user.id,
  });
});

// POST /auth/verify-otp
router.post("/verify-otp", async (req, res) => {
  const { organizationId, otp } = req.body ?? {};
  if (!organizationId || !otp) {
    return res.status(400).json({ message: "organizationId and otp are required." });
  }

  const state = await prisma.onboardingState.findUnique({ where: { organizationId } });
  if (!state) return res.status(404).json({ message: "Organization not found." });
  if (!state.otpCode || state.otpCode !== otp) {
    return res.status(400).json({ message: "Incorrect OTP." });
  }
  if (!state.otpExpiresAt || state.otpExpiresAt < new Date()) {
    return res.status(400).json({ message: "OTP expired — request a new one." });
  }

  await prisma.$transaction([
    prisma.organization.update({
      where: { id: organizationId },
      data: { status: "PENDING_DOMAIN" },
    }),
    prisma.onboardingState.update({
      where: { organizationId },
      data: { step: "VERIFIED", otpCode: null, otpExpiresAt: null },
    }),
    prisma.user.updateMany({
      where: { orgUsers: { some: { organizationId } } },
      data: { isVerified: true },
    }),
  ]);

  res.json({ ok: true });
});

export default router;
