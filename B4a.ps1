$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Depreciation policy: schema, helper, bill line...' -ForegroundColor Cyan

function Set-FileText($rel, $text) {
  $p = Join-Path $repo $rel
  $dir = Split-Path $p -Parent
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::WriteAllText($p, $text.Replace([string][char]13, ''), (New-Object Text.UTF8Encoding $false))
  Write-Host "  wrote  $rel"
}
function Edit-FileText($rel, $old, $new) {
  $p = Join-Path $repo $rel
  if (-not (Test-Path -LiteralPath $p)) { throw "Missing file: $rel" }
  $old = $old.Replace([string][char]13, '')
  $new = $new.Replace([string][char]13, '')
  $t = [IO.File]::ReadAllText($p).Replace([string][char]13, '')
  if ($t.Contains($new)) { Write-Host "  skip   $rel"; return }
  $i = $t.IndexOf($old)
  if ($i -lt 0) { throw "Anchor not found in $rel." }
  if ($t.IndexOf($old, $i + 1) -ge 0) { throw "Anchor is not unique in $rel." }
  $t = $t.Substring(0, $i) + $new + $t.Substring($i + $old.Length)
  [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
  Write-Host "  edit   $rel"
}

Set-FileText 'backend/src/lib/depreciationPolicy.ts' 'import { prisma } from "../db";

// The depreciation method in force, and how it changes.
//
// The method is a company policy, not a per-asset choice — it is what a
// company declares once in its significant accounting policies and applies
// across the entity. Schedule II is silent on method; it prescribes useful
// lives. So the life belongs to the asset and the method belongs here.
//
// Changing it is permitted and PROSPECTIVE. Under AS 10 (revised) and
// Ind AS 16 a change of depreciation method is a change in accounting
// ESTIMATE, applied going forward — charges already posted stand and are
// never restated. (The superseded AS 6 required retrospective recomputation,
// which is why a lot of older material says the opposite.)
//
// Prospective application needs no rebasing step, because every charge is
// computed from the opening carrying amount, the months of life remaining,
// and the residual:
//
//   SLM  charge = (opening - residual) / remaining
//   WDV  charge = opening * (1 - (residual / opening) ^ (1 / remaining))
//
// Both land exactly on the residual at the end of the life, from wherever
// they start. A switch mid-life is therefore just the other formula from the
// effective month onward, in either direction, and nothing already posted is
// touched.

export type DepreciationMethod = "SLM" | "WDV";

export function isDepreciationMethod(v: unknown): v is DepreciationMethod {
  return v === "SLM" || v === "WDV";
}

// "YYYY-MM" or "YYYY-MM-DD" -> the first of that month in UTC.
export function monthStart(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})(-\d{2})?$/.exec(value);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-01T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}

// The method that applies to a given month: the to_method of the latest
// change effective on or before it, falling back to the organization''s own
// setting when there is none.
//
// Read per month rather than stamped onto each asset, which is what lets a
// change be dated forward — a change recorded in August to start in November
// must not alter September and October.
export async function methodInForce(
  organizationId: string,
  month: Date,
): Promise<DepreciationMethod> {
  const change = await prisma.depreciationMethodChange.findFirst({
    where: { organizationId, effectiveMonth: { lte: month } },
    orderBy: { effectiveMonth: "desc" },
    select: { toMethod: true },
  });
  if (change && isDepreciationMethod(change.toMethod)) return change.toMethod;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { depreciationMethod: true },
  });
  return isDepreciationMethod(org?.depreciationMethod) ? org!.depreciationMethod as DepreciationMethod : "SLM";
}

// The month of the most recently posted depreciation charge, or null if
// nothing has ever posted. A method change cannot take effect on or before
// this month: those charges are history, and a change in estimate does not
// reach backwards.
export async function lastPostedChargeMonth(organizationId: string): Promise<Date | null> {
  const run = await prisma.fixedAssetDepreciationRun.findFirst({
    where: { fixedAsset: { organizationId } },
    orderBy: { periodMonth: "desc" },
    select: { periodMonth: true },
  });
  return run?.periodMonth ?? null;
}
'

Edit-FileText 'backend/prisma/schema.prisma' '  // this at the route level) and never editable after, because every
  // ItemStock/StockLot row that follows is computed under this rule.
  costingMethod       String?   @map("costing_method") @db.VarChar(20)
  domainLockedAt      DateTime? @map("domain_locked_at")
  // Company Master data — for statutory filings (AOC-4 etc.), not used by
  // any transactional posting anywhere. All nullable and unvalidated in' '  // this at the route level) and never editable after, because every
  // ItemStock/StockLot row that follows is computed under this rule.
  costingMethod       String?   @map("costing_method") @db.VarChar(20)
  // The company''s depreciation policy. Schedule II prescribes useful lives,
  // not methods, so the method is the company''s own choice, declared once and
  // disclosed. Changing it is a change in accounting estimate and applies
  // prospectively — see lib/depreciationPolicy.ts and migration_036.
  depreciationMethod String @default("SLM") @map("depreciation_method") @db.VarChar(3)
  domainLockedAt      DateTime? @map("domain_locked_at")
  // Company Master data — for statutory filings (AOC-4 etc.), not used by
  // any transactional posting anywhere. All nullable and unvalidated in'

Edit-FileText 'backend/prisma/schema.prisma' '  prepaidSchedules PrepaidSchedule[]
  assetClasses     AssetClass[]
  fixedAssets      FixedAsset[]
  stockAdjustments StockAdjustment[]
  salesReturns     SalesReturn[]
  purchaseReturns  PurchaseReturn[]' '  prepaidSchedules PrepaidSchedule[]
  assetClasses     AssetClass[]
  fixedAssets      FixedAsset[]
  depreciationMethodChanges DepreciationMethodChange[]
  stockAdjustments StockAdjustment[]
  salesReturns     SalesReturn[]
  purchaseReturns  PurchaseReturn[]'

Edit-FileText 'backend/prisma/schema.prisma' '  @@map("fixed_assets")
}

model FixedAssetDepreciationRun {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  fixedAssetId   String   @map("fixed_asset_id") @db.Uuid' '  @@map("fixed_assets")
}

// Every time the company changed its depreciation method, and why.
//
// Not an audit convenience — this is what the engine reads. The method in
// force for a month is the toMethod of the latest change effective on or
// before it, falling back to Organization.depreciationMethod. Reading it per
// month rather than stamping it onto each asset is what lets a change be
// dated forward without altering the months in between.
//
// reason is required: a change in accounting estimate has to be disclosed.
model DepreciationMethodChange {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId String   @map("organization_id") @db.Uuid
  fromMethod     String   @map("from_method") @db.VarChar(3)
  toMethod       String   @map("to_method") @db.VarChar(3)
  // First of the month the new method starts applying from.
  effectiveMonth DateTime @map("effective_month") @db.Date
  reason         String   @db.VarChar(500)
  changedBy      String?  @map("changed_by") @db.Uuid
  createdAt      DateTime @default(now()) @map("created_at")

  organization Organization @relation(fields: [organizationId], references: [id])

  @@unique([organizationId, effectiveMonth])
  @@map("depreciation_method_changes")
}

model FixedAssetDepreciationRun {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  fixedAssetId   String   @map("fixed_asset_id") @db.Uuid'

Edit-FileText 'backend/src/index.ts' 'import recurringExpensesRoutes from "./routes/recurringExpenses";
import prepaidSchedulesRoutes from "./routes/prepaidSchedules";
import assetClassesRoutes from "./routes/assetClasses";
import integrationConnectionsRoutes from "./routes/integrationConnections";
import integrationApiRoutes from "./routes/integrationApi";
import chatbotRoutes from "./routes/chatbot";' 'import recurringExpensesRoutes from "./routes/recurringExpenses";
import prepaidSchedulesRoutes from "./routes/prepaidSchedules";
import assetClassesRoutes from "./routes/assetClasses";
import depreciationPolicyRoutes from "./routes/depreciationPolicy";
import integrationConnectionsRoutes from "./routes/integrationConnections";
import integrationApiRoutes from "./routes/integrationApi";
import chatbotRoutes from "./routes/chatbot";'

Edit-FileText 'backend/src/index.ts' 'app.use("/recurring-expenses", recurringExpensesRoutes);
app.use("/prepaid-schedules", prepaidSchedulesRoutes);
app.use("/asset-classes", assetClassesRoutes);
app.use("/chatbot", chatbotRoutes);
// Mounted at two different paths, most-specific first — both routers
// apply their auth middleware via a path-less `router.use(...)`, so if' 'app.use("/recurring-expenses", recurringExpensesRoutes);
app.use("/prepaid-schedules", prepaidSchedulesRoutes);
app.use("/asset-classes", assetClassesRoutes);
app.use("/depreciation-policy", depreciationPolicyRoutes);
app.use("/chatbot", chatbotRoutes);
// Mounted at two different paths, most-specific first — both routers
// apply their auth middleware via a path-less `router.use(...)`, so if'

Edit-FileText 'backend/src/routes/purchaseBills.ts' '  TRADE_PAYABLES_CODE, CGST_INPUT_CODE, SGST_INPUT_CODE, IGST_INPUT_CODE, CUSTOMS_DUTY_PAYABLE_CODE,
} from "../lib/billPosting";
import { isInterState, round2, splitGst } from "../lib/discountGst";
import { isSupportedCurrency } from "../lib/currencies";
import { upload } from "../lib/upload";
import { extractInvoiceData } from "../lib/invoiceExtraction";' '  TRADE_PAYABLES_CODE, CGST_INPUT_CODE, SGST_INPUT_CODE, IGST_INPUT_CODE, CUSTOMS_DUTY_PAYABLE_CODE,
} from "../lib/billPosting";
import { isInterState, round2, splitGst } from "../lib/discountGst";
import { methodInForce } from "../lib/depreciationPolicy";
import { isSupportedCurrency } from "../lib/currencies";
import { upload } from "../lib/upload";
import { extractInvoiceData } from "../lib/invoiceExtraction";'

Edit-FileText 'backend/src/routes/purchaseBills.ts' '  // "YYYY-MM-DD". When the asset was put to use, which is what Schedule II
  // charges from — not the purchase date. Cannot precede the bill date.
  inUseDate?: string;
  // Schedule II prescribes lives, not methods: Part A never names one and
  // Part C''s Notes ask only that the method used be disclosed. Omitted means
  // the class''s default. WDV requires a residual value — its rate is
  // 1 - (residual/cost)^(1/n), which at zero residual is 1.
  method?: string;
  // Schedule II permits a different life where a company can justify one.
  // Omitted means the class''s default.
  usefulLifeMonths?: number;' '  // "YYYY-MM-DD". When the asset was put to use, which is what Schedule II
  // charges from — not the purchase date. Cannot precede the bill date.
  inUseDate?: string;
  // NOTE: there is deliberately no `method` here. The depreciation method is
  // a company policy (Organization.depreciationMethod and its change
  // history), not a per-purchase choice — see lib/depreciationPolicy.ts. The
  // useful life below is the opposite: Schedule II is about the life of a
  // particular asset, so that one does belong on the line.
  //
  // Schedule II permits a different life where a company can justify one.
  // Omitted means the class''s default.
  usefulLifeMonths?: number;'

Edit-FileText 'backend/src/routes/purchaseBills.ts' '  // type and go back onto the asset without a cast.
  type AssetClassRow = Awaited<ReturnType<typeof prisma.assetClass.findMany>>[number];
  const assetClassById = new Map<string, AssetClassRow>();

  if (capitalIdx.length > 0) {
    if (!billDay) {' '  // type and go back onto the asset without a cast.
  type AssetClassRow = Awaited<ReturnType<typeof prisma.assetClass.findMany>>[number];
  const assetClassById = new Map<string, AssetClassRow>();
  // Resolved once during validation and reused at creation, so the asset is
  // stamped with exactly the method the line was checked against.
  const capitalMethod = new Map<number, string>();

  if (capitalIdx.length > 0) {
    if (!billDay) {'

Edit-FileText 'backend/src/routes/purchaseBills.ts' '        itemId: string; quantity: number; lineSubtotal: number;
        capitalise?: boolean; prepaid?: boolean; assetClassId?: string;
        assetName?: string; inUseDate?: string; usefulLifeMonths?: number;
        method?: string; usefulLifeNote?: string; capitaliseGst?: boolean;
      };
      const item = itemById.get(l.itemId)!;
' '        itemId: string; quantity: number; lineSubtotal: number;
        capitalise?: boolean; prepaid?: boolean; assetClassId?: string;
        assetName?: string; inUseDate?: string; usefulLifeMonths?: number;
        usefulLifeNote?: string; capitaliseGst?: boolean; method?: string;
      };
      const item = itemById.get(l.itemId)!;
'

Edit-FileText 'backend/src/routes/purchaseBills.ts' '        }
      }

      const method = String(l.method ?? cls.defaultMethod).toUpperCase();
      if (method !== "SLM" && method !== "WDV") {
        return res.status(400).json({ message: `${item.sku}: depreciation method must be SLM or WDV.` });
      }
      // fixed_assets_wdv_residual_ck says the same thing. The reason it is
      // said twice is that the consequence of it being wrong — the entire
      // cost written off in the first period — is not something to discover
      // from a constraint violation.
      if (method === "WDV" && !(Number(cls.defaultResidualPct) > 0)) {
        return res.status(400).json({ message: `${cls.name}: written-down value needs a residual percentage above zero — its rate is derived from the residual, and at zero the whole cost would be written off at once.` });
      }

      // The deviation is measured against what Schedule II PRESCRIBES, not' '        }
      }

      // The method is the company''s, not this line''s — and it is the method
      // in force in the month the asset is put to use, which is not
      // necessarily the method in force today: a change may already be dated
      // forward. Rejecting a line the policy would refuse is the point of
      // looking it up here rather than at posting time.
      const method = await methodInForce(organizationId, new Date(`${String(l.inUseDate).slice(0, 7)}-01T00:00:00.000Z`));
      capitalMethod.set(i, method);
      // fixed_assets_wdv_residual_ck says the same thing. The reason it is
      // said twice is that the consequence of it being wrong — the entire
      // cost written off in the first period — is not something to discover
      // from a constraint violation.
      if (method === "WDV" && !(Number(cls.defaultResidualPct) > 0)) {
        return res.status(400).json({ message: `${cls.name} has no residual percentage, and the company depreciates on written-down value from ${String(l.inUseDate).slice(0, 7)}. That rate is derived from the residual, and at zero the whole cost would be written off at once — give the class a residual, or change the policy.` });
      }

      // The deviation is measured against what Schedule II PRESCRIBES, not'

Edit-FileText 'backend/src/routes/purchaseBills.ts' '        const l = computed[i] as {
          itemId: string; quantity: number; lineSubtotal: number;
          assetClassId?: string; assetName?: string; inUseDate?: string;
          usefulLifeMonths?: number; method?: string; usefulLifeNote?: string;
        };
        const item = itemById.get(l.itemId)!;
        const cls = assetClassById.get(String(l.assetClassId))!;' '        const l = computed[i] as {
          itemId: string; quantity: number; lineSubtotal: number;
          assetClassId?: string; assetName?: string; inUseDate?: string;
          usefulLifeMonths?: number; usefulLifeNote?: string;
        };
        const item = itemById.get(l.itemId)!;
        const cls = assetClassById.get(String(l.assetClassId))!;'

Edit-FileText 'backend/src/routes/purchaseBills.ts' '            gstCapitalised: false,
            purchaseDate: new Date(billDate),
            inUseDate: new Date(`${l.inUseDate}T00:00:00.000Z`),
            method: String(l.method ?? cls.defaultMethod).toUpperCase(),
            usefulLifeMonths: Number(l.usefulLifeMonths ?? cls.defaultUsefulLifeMonths),
            // Snapshot, so "does this asset depart from Schedule II" stays
            // answerable after the class is edited.' '            gstCapitalised: false,
            purchaseDate: new Date(billDate),
            inUseDate: new Date(`${l.inUseDate}T00:00:00.000Z`),
            // A record of what the policy was when this asset was
            // capitalised. The engine reads the policy per month rather than
            // this column, because a later change applies to this asset too.
            method: capitalMethod.get(i) ?? "SLM",
            usefulLifeMonths: Number(l.usefulLifeMonths ?? cls.defaultUsefulLifeMonths),
            // Snapshot, so "does this asset depart from Schedule II" stays
            // answerable after the class is edited.'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green