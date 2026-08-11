import { Router } from "express";
import { prisma } from "../db";
import { hashPassword, verifyPassword } from "../lib/password";
import { signToken } from "../lib/jwt";

const router = Router();

const DEFAULT_COST_CATEGORIES = ["MATERIAL", "LABOUR", "SUBCONTRACT", "OVERHEAD", "OTHER"];

// POST /auth/register — creates a new Organization + the first User as
// SUPER_ADMIN. R1 has no self-serve invite flow yet (Section 6.1); every
// other user for this org is created directly for now.
router.post("/register", async (req, res) => {
  const { organizationName, name, email, password } = req.body ?? {};
  if (!organizationName || !email || !password) {
    return res.status(400).json({ message: "organizationName, email and password are required." });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ message: "An account with this email already exists." });
  }

  const passwordHash = await hashPassword(password);

  const result = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({ data: { name: organizationName } });
    const user = await tx.user.create({ data: { name, email, passwordHash } });
    const orgUser = await tx.orgUser.create({
      data: { organizationId: organization.id, userId: user.id, role: "SUPER_ADMIN" },
    });
    // Seed the native cost category master (Section 6.1) — same
    // "provision defaults at org creation" convention SmartERP uses for
    // its Chart of Accounts templates.
    await tx.costCategory.createMany({
      data: DEFAULT_COST_CATEGORIES.map((name) => ({ organizationId: organization.id, name })),
    });
    return { organization, user, orgUser };
  });

  const token = signToken({
    userId: result.user.id,
    orgUserId: result.orgUser.id,
    organizationId: result.organization.id,
    role: result.orgUser.role,
  });

  res.status(201).json({
    data: {
      token,
      organization: { id: result.organization.id, name: result.organization.name },
      user: { id: result.user.id, name: result.user.name, email: result.user.email },
    },
  });
});

// POST /auth/login — R1 assumes one org per user (Section 13
// Assumptions); if a user is ever a member of more than one, this picks
// the first membership found, same simplification the schema's
// OrgUser.@@unique([organizationId, userId]) already implies isn't the
// common case for a pilot.
router.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ message: "email and password are required." });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { orgUsers: { where: { status: "ACTIVE" }, take: 1 } },
  });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ message: "Invalid email or password." });
  }
  const orgUser = user.orgUsers[0];
  if (!orgUser) {
    return res.status(403).json({ message: "This account isn't active on any organisation." });
  }

  const token = signToken({ userId: user.id, orgUserId: orgUser.id, organizationId: orgUser.organizationId, role: orgUser.role });
  res.json({ data: { token, user: { id: user.id, name: user.name, email: user.email }, role: orgUser.role } });
});

export default router;
