import { Router } from "express";
import { prisma } from "../db";

const router = Router();

// GET /domain-types — powers the multi-select screen
router.get("/", async (_req, res) => {
  const domainTypes = await prisma.domainType.findMany({
    orderBy: { name: "asc" },
  });
  res.json(
    domainTypes.map((d) => ({
      code: d.code,
      name: d.name,
      description: d.description,
    }))
  );
});

export default router;
