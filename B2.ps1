$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Capitalising a Purchase Bill line...' -ForegroundColor Cyan

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

$F = 'backend/src/routes/purchaseBills.ts'

Edit-FileText $F 'import { isSupportedCurrency } from "../lib/currencies";
import { upload } from "../lib/upload";
import { extractInvoiceData } from "../lib/invoiceExtraction";

const router = Router();
router.use(authenticate, requireActiveSubscription);' 'import { isSupportedCurrency } from "../lib/currencies";
import { upload } from "../lib/upload";
import { extractInvoiceData } from "../lib/invoiceExtraction";

// Leaves room for the " — FA-0001" suffix the sub-ledger card adds, inside
// the VarChar(200) that business_partners.name and fixed_assets.name both
// carry.
const MAX_ASSET_NAME_LEN = 150;

// What the asset is called, in the register and on its sub-ledger card.
// Truncated rather than rejected when it is derived rather than typed: an
// item name long enough to overflow is not something the person entering
// this bill can do anything about. A name they typed themselves is length-
// checked and refused instead, so it is never silently shortened.
function assetNameFor(
  l: { quantity: number; assetName?: string },
  item: { name: string },
): string {
  const typed = String(l.assetName ?? "").trim();
  if (typed) return typed.slice(0, MAX_ASSET_NAME_LEN);
  const derived = l.quantity > 1 ? `${item.name} (${l.quantity} nos)` : item.name;
  return derived.slice(0, MAX_ASSET_NAME_LEN);
}

const router = Router();
router.use(authenticate, requireActiveSubscription);'

Edit-FileText $F '  prepaidStartMonth?: string;
  // How many monthly instalments, 1..600.
  prepaidMonths?: number;
}

' '  prepaidStartMonth?: string;
  // How many monthly instalments, 1..600.
  prepaidMonths?: number;
  // ── Capital asset (migration_034) ────────────────────────────────────
  // Set on a line that buys a fixed asset rather than an expense. The line
  // then debits the asset class''s cost account instead of the item''s own
  // head, gets its own sub-ledger card, and opens a row in the fixed asset
  // register that depreciation runs against.
  //
  // ONE LINE IS ONE ASSET, whatever the quantity — fixed_assets carries a
  // unique index on purchase_bill_line_id. Three laptops that need three
  // register entries (because they will be disposed of separately) go on
  // three lines. Ten identical chairs bought and retired together are
  // legitimately one asset, and the quantity is carried into its name.
  capitalise?: boolean;
  // Which asset class — supplies the accounts, useful life, method and
  // residual percentage. All of them are copied onto the asset, never read
  // from the class again.
  assetClassId?: string;
  // Defaults to the item''s name. Worth setting when the item is generic
  // ("Server") and the asset is not ("Rack server — Chennai DC").
  assetName?: string;
  // "YYYY-MM-DD". When the asset was put to use, which is what Schedule II
  // charges from — not the purchase date. Cannot precede the bill date.
  inUseDate?: string;
  // Schedule II permits a different life where a company can justify one.
  // Omitted means the class''s default.
  usefulLifeMonths?: number;
}

'
Edit-FileText $F '    prepaidAccountId = prepaidAccount.id;
  }

  const count = await prisma.purchaseBill.count({ where: { organizationId } });
  const billNumber = `PB-${String(count + 1).padStart(4, "0")}`;
' '    prepaidAccountId = prepaidAccount.id;
  }

  // ── Capital asset lines ──────────────────────────────────────────────
  // Same shape as the prepaid block above and validated for the same
  // reason: everything that can be rejected is rejected before a single
  // row is written, so a bill can never post with a broken asset beside it.
  const capitalIdx: number[] = [];
  computed.forEach((l, i) => {
    if ((l as { capitalise?: boolean }).capitalise) capitalIdx.push(i);
  });

  // The day the bill lands on once Prisma has written it to a DATE column,
  // which is the UTC day of the parsed instant. purchaseDate below is
  // new Date(billDate), so deriving the guard from the same instant is what
  // makes the route''s check and fixed_assets_dates_ck agree. Comparing the
  // raw request string instead would disagree with the database whenever
  // billDate carries a timezone offset or an unpadded month.
  const billInstant = new Date(billDate);
  const billDay = isNaN(billInstant.getTime()) ? null : billInstant.toISOString().slice(0, 10);


  // The rows as Prisma returns them, so the Decimal columns keep their own
  // type and go back onto the asset without a cast.
  type AssetClassRow = Awaited<ReturnType<typeof prisma.assetClass.findMany>>[number];
  const assetClassById = new Map<string, AssetClassRow>();

  if (capitalIdx.length > 0) {
    if (!billDay) {
      return res.status(400).json({ message: "billDate isn''t a date I can read." });
    }
    if (linkedPo) {
      return res.status(400).json({ message: "A Purchase-Order-linked bill can''t carry a capital asset line." });
    }
    if (isForeign) {
      // An imported asset''s cost includes customs duty and depends on which
      // exchange rate the standard says to capitalise at. Both are real
      // questions and neither gets answered silently inside this route.
      return res.status(400).json({ message: "Capitalising isn''t supported on a foreign-currency bill yet." });
    }

    const classIds = Array.from(new Set(capitalIdx.map((i) => String((computed[i] as { assetClassId?: string }).assetClassId ?? ""))));
    const classes = await prisma.assetClass.findMany({
      // isActive matters here, not just in the picker: GET /asset-classes
      // hides a retired class from the UI, which does nothing to stop an
      // API caller naming its id directly.
      where: { id: { in: classIds.filter(Boolean) }, organizationId, isActive: true },
    });
    for (const c of classes) assetClassById.set(c.id, c);

    for (const i of capitalIdx) {
      const l = computed[i] as {
        itemId: string; quantity: number; lineSubtotal: number;
        capitalise?: boolean; prepaid?: boolean; assetClassId?: string;
        assetName?: string; inUseDate?: string; usefulLifeMonths?: number;
        capitaliseGst?: boolean;
      };
      const item = itemById.get(l.itemId)!;

      if (String(l.assetName ?? "").trim().length > MAX_ASSET_NAME_LEN) {
        return res.status(400).json({ message: `${item.sku}: an asset name can be at most ${MAX_ASSET_NAME_LEN} characters.` });
      }

      if (l.prepaid) {
        return res.status(400).json({ message: `${item.sku}: a line is either prepaid or capitalised, not both.` });
      }
      // A stock item''s line already debits a stock control account and moves
      // inventory. Capitalising it would put the same purchase in two places
      // at once — the register and the stock ledger.
      if (item.itemKind !== "SERVICE") {
        return res.status(400).json({ message: `Only a non-stock item can be capitalised — ${item.sku} is a stock item.` });
      }
      if (l.capitaliseGst) {
        // Section 17(5) blocked credits genuinely need this. It also means
        // the tax must be excluded from GSTR-3B''s input credit, which
        // reaches into the GST returns — so it is refused outright rather
        // than accepted and quietly ignored.
        return res.status(400).json({ message: "Capitalising GST isn''t supported yet — the input credit is claimed instead." });
      }
      const cls = assetClassById.get(String(l.assetClassId ?? ""));
      if (!cls) {
        return res.status(400).json({ message: `${item.sku}: pick an asset class to capitalise against.` });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(l.inUseDate ?? ""))) {
        return res.status(400).json({ message: `${item.sku}: a "put to use" date is required, as YYYY-MM-DD.` });
      }
      // fixed_assets_dates_ck enforces this at the database too. Catching it
      // here turns a 23514 into a sentence someone can act on.
      if (String(l.inUseDate) < billDay) {
        return res.status(400).json({ message: `${item.sku}: an asset can''t be in use before the bill date.` });
      }
      if (!(l.lineSubtotal > 0)) {
        return res.status(400).json({ message: `${item.sku}: a capitalised line needs an amount greater than zero.` });
      }
      // Writing a zero residual here instead would depreciate the asset all
      // the way down over its whole life — the opposite of what the class
      // says — and nothing would ever surface it. Refuse instead.
      if (Number(cls.defaultResidualPct) >= 100) {
        return res.status(400).json({ message: `${cls.name}: the class''s residual percentage is ${Number(cls.defaultResidualPct)}% — fix the asset class before capitalising against it.` });
      }
      if (l.usefulLifeMonths !== undefined && l.usefulLifeMonths !== null) {
        const life = Number(l.usefulLifeMonths);
        if (!Number.isInteger(life) || life < 1 || life > 1200) {
          return res.status(400).json({ message: `${item.sku}: useful life must be a whole number of months between 1 and 1200.` });
        }
      }
    }
  }

  const count = await prisma.purchaseBill.count({ where: { organizationId } });
  const billNumber = `PB-${String(count + 1).padStart(4, "0")}`;
'

Edit-FileText $F '        });
        prepaidCard.set(i, card.id);
        l.debitAccountIdOverride = prepaidAccountId!;
        l.debitPartnerIdOverride = card.id;
      }
' '        });
        prepaidCard.set(i, card.id);
        l.debitAccountIdOverride = prepaidAccountId!;
        l.debitPartnerIdOverride = card.id;
      }

      // Each capitalised line gets its own card too, for the same reason and
      // in the same place: the journal line has to be tagged to it. The card
      // is tagged on the cost account here and on the accumulated
      // depreciation account by every monthly charge, so one asset''s gross
      // block, accumulated depreciation and net book value are all readable
      // from the ledger itself.
      //
      // A capitalised line can only be on a non-PO bill, and only a PO-linked
      // bill is ever held for approval, so these are mutually exclusive
      // today. The guard is here because the cost of being wrong is an asset
      // depreciating against a gross block no journal entry ever debited.
      const capitalNow = requiresApproval ? [] : capitalIdx;
      const assetCard = new Map<number, string>();
      const assetCode = new Map<number, string>();
      let assetSeq = capitalNow.length > 0 ? await tx.fixedAsset.count({ where: { organizationId } }) : 0;
      for (const i of capitalNow) {
        const l = computed[i] as { itemId: string; quantity: number; assetClassId?: string; assetName?: string } & Record<string, unknown>;
        const item = itemById.get(l.itemId)!;
        const cls = assetClassById.get(String(l.assetClassId))!;
        const name = assetNameFor(l, item);
        assetSeq += 1;
        const code = `FA-${String(assetSeq).padStart(4, "0")}`;
        assetCode.set(i, code);
        const card = await tx.businessPartner.create({
          data: { organizationId, bpType: "ASSET", name: `${name} — ${code}` },
        });
        assetCard.set(i, card.id);
        // Overwriting a prepaid override would post the debit to 1401 while
        // leaving a schedule pointing at a 1105 card that was never debited
        // — wrong, and silent. The prepaid/capitalise check above already
        // prevents it; this is what makes a regression there loud.
        if (l.debitAccountIdOverride) {
          throw Object.assign(new Error(`${item.sku}: a line is either prepaid or capitalised, not both.`), { status: 400 });
        }
        l.debitAccountIdOverride = cls.assetAccountId;
        l.debitPartnerIdOverride = card.id;
      }
'

Edit-FileText $F '            totalAmount: l.lineSubtotal,
            startMonth: new Date(`${l.prepaidStartMonth}-01T00:00:00.000Z`),
            months: Number(l.prepaidMonths),
            createdBy: req.user!.userId,
          },
        });' '            totalAmount: l.lineSubtotal,
            startMonth: new Date(`${l.prepaidStartMonth}-01T00:00:00.000Z`),
            months: Number(l.prepaidMonths),
            createdBy: req.user!.userId,
          },
        });
      }

      // The register rows. Every account, life, method and rate is copied
      // off the class rather than referenced: re-pointing a class later must
      // change what future assets do, never redirect the remaining charges
      // of an asset already part-depreciated. Same reasoning as the expense
      // account on a prepaid schedule.
      for (const i of capitalNow) {
        const l = computed[i] as {
          itemId: string; quantity: number; lineSubtotal: number;
          assetClassId?: string; assetName?: string; inUseDate?: string;
          usefulLifeMonths?: number;
        };
        const item = itemById.get(l.itemId)!;
        const cls = assetClassById.get(String(l.assetClassId))!;
        const code = assetCode.get(i)!;
        const name = assetNameFor(l, item);
        // Residual is a percentage of cost, floored to two decimals so
        // gross - residual is always an exact rupee amount to spread.
        const residual = round2(l.lineSubtotal * Number(cls.defaultResidualPct) / 100);
        await tx.fixedAsset.create({
          data: {
            organizationId, branchId: resolvedBranchId,
            assetClassId: cls.id,
            purchaseBillId: created.id, purchaseBillLineId: lineIds[i],
            businessPartnerId: assetCard.get(i)!,
            assetCode: code, name,
            assetAccountId: cls.assetAccountId,
            accumDepAccountId: cls.accumDepAccountId,
            depExpenseAccountId: cls.depExpenseAccountId,
            grossCost: l.lineSubtotal,
            // fixed_assets_residual_ck requires residual < gross. A class at
            // 100% is refused above, so this can only bite on a rounding
            // edge at a very small line value.
            residualValue: residual < l.lineSubtotal ? residual : 0,
            // The input credit was claimed on this bill, so the GST is not
            // in the cost. See the capitaliseGst rejection above.
            gstCapitalised: false,
            purchaseDate: new Date(billDate),
            inUseDate: new Date(`${l.inUseDate}T00:00:00.000Z`),
            method: cls.defaultMethod,
            usefulLifeMonths: Number(l.usefulLifeMonths ?? cls.defaultUsefulLifeMonths),
            // Pinned but unused: income tax depreciation is out of scope, and
            // these columns are NOT NULL. Nothing reads them today.
            itBlockCode: cls.defaultItBlockCode,
            itRate: cls.defaultItRate,
            createdBy: req.user!.userId,
          },
        });'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green