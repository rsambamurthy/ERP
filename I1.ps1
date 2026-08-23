$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Inventory phase A: BOM backend...' -ForegroundColor Cyan

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

Edit-FileText 'backend/prisma/schema.prisma' '  organization  Organization @relation(fields: [organizationId], references: [id])
  finishedItem  Item         @relation("FinishedItem", fields: [finishedItemId], references: [id])
  componentItem Item         @relation("ComponentItem", fields: [componentItemId], references: [id])

  @@map("bom_lines")
}

model BusinessPartner {
' '  organization  Organization @relation(fields: [organizationId], references: [id])
  finishedItem  Item         @relation("FinishedItem", fields: [finishedItemId], references: [id])
  componentItem Item         @relation("ComponentItem", fields: [componentItemId], references: [id])

  // A component is listed once for a finished item, not twice — see
  // migration_041, which also adds the positive-quantity CHECK that Prisma
  // cannot express.
  @@unique([finishedItemId, componentItemId], map: "bom_lines_item_component_uq")
  @@index([organizationId, finishedItemId])
  @@map("bom_lines")
}

model BusinessPartner {
'

Edit-FileText 'backend/src/routes/items.ts' '      defaultDiscountPct: item.defaultDiscountPct,
      totalQuantityOnHand: item.itemStocks.reduce((s, st) => s + Number(st.quantityOnHand), 0),
    },
  });
});

// PATCH /items/:id/toggle — activate/deactivate. Deactivating keeps every
// stock movement and journal line intact; it only takes the item out of the
' '      defaultDiscountPct: item.defaultDiscountPct,
      totalQuantityOnHand: item.itemStocks.reduce((s, st) => s + Number(st.quantityOnHand), 0),
    },
  });
});

// ── Bill of materials ────────────────────────────────────────────────
//
// What a finished item is made of: a component and a quantity per unit. A
// recipe, not an event — it moves nothing and posts nothing. Its only job is
// to be exploded when a production order is opened, so the components arrive
// on the issue already listed and the user corrects them against what was
// actually taken to the shop floor.
//
// bom_lines has existed since the original schema and until now nothing read
// or wrote it. migration_041 gave it the unique index and the positive
// quantity check it needed before anything could.

// The deepest a bill of materials may nest. A sub-assembly made of
// sub-assemblies is normal; a hundred levels of them is a mistake, and a
// bound means the cycle check below can never run away even if the data is
// worse than the checks allow.
const MAX_BOM_DEPTH = 20;

// True when `target` appears anywhere beneath `startId` in the existing
// bill-of-materials graph. Used to refuse a component that would make the
// finished item its own ancestor: A made of B, B made of A, and a production
// order that explodes for ever.
async function bomReaches(organizationId: string, startId: string, target: string): Promise<boolean> {
  let frontier = [startId];
  const seen = new Set<string>([startId]);
  for (let depth = 0; depth < MAX_BOM_DEPTH && frontier.length > 0; depth++) {
    const lines = await prisma.bomLine.findMany({
      where: { organizationId, finishedItemId: { in: frontier } },
      select: { componentItemId: true },
    });
    const next: string[] = [];
    for (const l of lines) {
      if (l.componentItemId === target) return true;
      if (!seen.has(l.componentItemId)) { seen.add(l.componentItemId); next.push(l.componentItemId); }
    }
    frontier = next;
  }
  return false;
}

// GET /items/:id/bom — the components, with what they cost today.
//
// The costs are indicative, not a valuation. They are read from the item''s
// current weighted average (or the average of its remaining FIFO lots), so
// they answer "roughly what does one of these cost to make". What a
// production order actually charges is whatever consumeStock returns at the
// moment the material is issued, which is a different number on a different
// day. Saying so on the screen matters more than the figure itself.
router.get("/:id/bom", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const item = await prisma.item.findFirst({
    where: { id: req.params.id, organizationId, deletedAt: null },
    select: { id: true, sku: true, name: true, uom: true, isFinishedGood: true },
  });
  if (!item) return res.status(404).json({ message: "Item not found." });

  const lines = await prisma.bomLine.findMany({
    where: { organizationId, finishedItemId: item.id },
    include: {
      componentItem: {
        select: {
          id: true, sku: true, name: true, uom: true, isActive: true, itemKind: true,
          itemStocks: { select: { quantityOnHand: true, averageCost: true } },
        },
      },
    },
  });

  const rows = lines.map((l) => {
    const stocks = l.componentItem.itemStocks;
    const qty = stocks.reduce((s, x) => s + Number(x.quantityOnHand), 0);
    const value = stocks.reduce((s, x) => s + Number(x.quantityOnHand) * Number(x.averageCost), 0);
    // Weighted across branches. Zero when nothing is on hand anywhere, which
    // is honest — an unpriced component has no cost to show yet.
    const unitCost = qty > 0 ? Math.round((value / qty) * 10000) / 10000 : 0;
    const qtyPerUnit = Number(l.qtyPerUnit);
    return {
      id: l.id,
      component: {
        id: l.componentItem.id, sku: l.componentItem.sku, name: l.componentItem.name,
        uom: l.componentItem.uom, isActive: l.componentItem.isActive,
      },
      qtyPerUnit,
      unitCost,
      lineCost: Math.round(qtyPerUnit * unitCost * 100) / 100,
      quantityOnHand: qty,
    };
  }).sort((a, b) => a.component.sku.localeCompare(b.component.sku));

  res.json({
    data: {
      item: { id: item.id, sku: item.sku, name: item.name, uom: item.uom, isFinishedGood: item.isFinishedGood },
      lines: rows,
      materialCostPerUnit: Math.round(rows.reduce((s, r) => s + r.lineCost, 0) * 100) / 100,
      // True when at least one component has never been priced, so the total
      // above understates. Shown rather than hidden.
      incomplete: rows.some((r) => r.unitCost === 0),
    },
  });
});

// PUT /items/:id/bom — replace the whole bill of materials.
//
// Replace rather than add/edit/delete per line: a recipe is one thing, and
// editing it line by line invites a half-saved state where the components no
// longer make the product. The screen sends what the recipe now is.
//
// Nothing here is versioned. A production order explodes the BOM as it stands
// when the order is opened and then keeps its own component lines, so editing
// the recipe afterwards never reaches back into an order already running —
// the same snapshot rule the fixed asset register uses.
router.put("/:id/bom", canManageItems, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const item = await prisma.item.findFirst({
    where: { id: req.params.id, organizationId, deletedAt: null },
    select: { id: true, sku: true, name: true, itemKind: true },
  });
  if (!item) return res.status(404).json({ message: "Item not found." });
  if (item.itemKind !== "STOCK") {
    return res.status(400).json({ message: `${item.sku} is a service item — only a stock item can be manufactured.` });
  }

  const raw: unknown = req.body?.lines;
  if (!Array.isArray(raw)) {
    return res.status(400).json({ message: "lines is required — send an empty array to clear the bill of materials." });
  }

  const parsed: { componentItemId: string; qtyPerUnit: number }[] = [];
  const seen = new Set<string>();
  for (const entry of raw as { componentItemId?: unknown; qtyPerUnit?: unknown }[]) {
    const componentItemId = typeof entry?.componentItemId === "string" ? entry.componentItemId : "";
    const qtyPerUnit = Number(entry?.qtyPerUnit);
    if (!componentItemId) return res.status(400).json({ message: "Every line needs a component." });
    if (!Number.isFinite(qtyPerUnit) || qtyPerUnit <= 0) {
      return res.status(400).json({ message: "Quantity per unit must be more than zero." });
    }
    if (componentItemId === item.id) {
      return res.status(400).json({ message: `${item.sku} cannot be a component of itself.` });
    }
    // The database refuses this too. Catching it here turns a constraint
    // violation into a sentence.
    if (seen.has(componentItemId)) {
      return res.status(400).json({ message: "The same component is listed twice." });
    }
    seen.add(componentItemId);
    parsed.push({ componentItemId, qtyPerUnit });
  }

  if (parsed.length > 0) {
    const components = await prisma.item.findMany({
      where: { id: { in: parsed.map((l) => l.componentItemId) }, organizationId, deletedAt: null },
      select: { id: true, sku: true, itemKind: true, isActive: true },
    });
    // Typed explicitly rather than inferred: the inference collapses to `{}`
    // when the generated Prisma client is stale, which turns every field
    // access below into an error that has nothing to do with this code.
    type Comp = { id: string; sku: string; itemKind: string; isActive: boolean };
    const byId = new Map<string, Comp>((components as Comp[]).map((x) => [x.id, x]));
    for (const l of parsed) {
      const comp = byId.get(l.componentItemId);
      if (!comp) return res.status(400).json({ message: "A component is not an item in this organisation." });
      if (comp.itemKind !== "STOCK") {
        return res.status(400).json({ message: `${comp.sku} is a service item — it has no stock to consume. Labour and overhead go on the production order as cost, not here.` });
      }
      if (!comp.isActive) {
        return res.status(400).json({ message: `${comp.sku} is inactive and cannot be a component.` });
      }
    }

    // A cycle would make a production order explode for ever. Checked against
    // the graph as it stands, with this item''s own lines about to be replaced
    // — so a component that reaches back to this item is refused whether the
    // path is one hop or five.
    for (const l of parsed) {
      if (await bomReaches(organizationId, l.componentItemId, item.id)) {
        const comp = byId.get(l.componentItemId)!;
        return res.status(400).json({
          message: `${comp.sku} is made from ${item.sku}, directly or through another sub-assembly. Adding it here would make each the ingredient of the other.`,
        });
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.bomLine.deleteMany({ where: { organizationId, finishedItemId: item.id } });
    if (parsed.length > 0) {
      await tx.bomLine.createMany({
        data: parsed.map((l) => ({
          organizationId, finishedItemId: item.id,
          componentItemId: l.componentItemId, qtyPerUnit: l.qtyPerUnit,
        })),
      });
    }
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "bill_of_materials", entityId: item.id,
    summary: parsed.length === 0
      ? `Cleared the bill of materials for ${item.sku}`
      : `Bill of materials for ${item.sku} — ${parsed.length} component${parsed.length === 1 ? "" : "s"}`,
  });

  res.json({ data: { lines: parsed.length } });
});

// PATCH /items/:id/toggle — activate/deactivate. Deactivating keeps every
// stock movement and journal line intact; it only takes the item out of the
'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green