import { Router } from "express";
import { prisma } from "../db";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate);

// GET /cost-categories — the five seeded at registration (Section 6.1).
// Read-only in R1; no route to add custom ones yet.
router.get("/", async (req, res) => {
  const categories = await prisma.costCategory.findMany({
    where: { organizationId: req.user!.organizationId },
    orderBy: { name: "asc" },
  });
  res.json({ data: categories });
});

export default router;
