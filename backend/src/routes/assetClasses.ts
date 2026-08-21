import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requireActiveSubscription, resolveOrgId } from "../middleware/auth";

// Asset classes — the defaults a fixed asset is created from.
//
// Seeded per organization by migration_034 and editable, deliberately NOT
// hardcoded: Schedule II lets a company justify a different useful life for
// its own circumstances. What stops that editability from rewriting history
// is that every asset pins its own life and accounts at capitalisation —
// this table supplies a starting point and is never read again afterwards.
//
// Read-only for now. Creating and editing classes belongs with the rest of
// the masters UI; nothing needs it before an asset can be capitalised.
//
// Income tax depreciation (Section 32, block of assets) is OUT OF SCOPE.
// The it_block_code / it_rate columns still exist on asset_classes and
// fixed_assets and are still pinned onto every asset at capitalisation —
// they are NOT NULL, and dropping them would mean a migration now and
// another one to restore them when block depreciation is built. They are
// deliberately not returned here: an endpoint should not advertise a basis
// the product does not compute. Nothing reads them today.
//
// Depreciation is therefore Schedule II only — per asset, useful life,
// straight line, pro rata from the in-use date, posted to the ledger.

const router = Router();
router.use(authenticate, requireActiveSubscription);

// GET /asset-classes — everything the Purchase Bill line picker needs to
// show a class and preview what capitalising against it would do, without a
// second round trip per class.
router.get("/", async (req, res) => {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    return res.status(400).json({ message: "organizationId is required." });
  }

  const includeInactive = String(req.query.includeInactive ?? "") === "true";

  const classes = await prisma.assetClass.findMany({
    where: { organizationId, ...(includeInactive ? {} : { isActive: true }) },
    include: {
      assetAccount: { select: { id: true, accountCode: true, accountName: true } },
      accumDepAccount: { select: { id: true, accountCode: true, accountName: true } },
      depExpenseAccount: { select: { id: true, accountCode: true, accountName: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  res.json({
    data: classes.map((c) => ({
      id: c.id,
      name: c.name,
      isActive: c.isActive,
      // Months rather than years, because Schedule II lives are not all whole
      // years (a 5-year life and a 6-year life are both common, but so is
      // 30 months for some moulds) and monthly is the granularity the charge
      // is computed at anyway.
      defaultUsefulLifeMonths: c.defaultUsefulLifeMonths,
      defaultMethod: c.defaultMethod,
      defaultResidualPct: Number(c.defaultResidualPct),
      assetAccount: c.assetAccount,
      accumDepAccount: c.accumDepAccount,
      depExpenseAccount: c.depExpenseAccount,
    })),
  });
});

export default router;
