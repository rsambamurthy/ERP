import { Router } from "express";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate);

// Not built yet. Budget vs. Committed vs. Actual per project.
// See PRD Section 6.7 (prd-r1-pilot.docx) for the functional spec.
// Deliberately mounted (not left out of index.ts) so the route surface
// is visible/discoverable rather than silently missing.
router.all("*", (_req, res) => {
  res.status(501).json({
    message: "Cost Visibility is not implemented yet — see PRD Section 6.7.",
  });
});

export default router;
