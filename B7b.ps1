$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Bill line: policy from the class, threshold...' -ForegroundColor Cyan

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

Edit-FileText 'backend/src/routes/purchaseBills.ts' '  // useful life below is the opposite: Schedule II is about the life of a
  // particular asset, so that one does belong on the line.
  //
  // Schedule II permits a different life where a company can justify one.
  // Omitted means the class''s default.
  usefulLifeMonths?: number;
  // Part A paragraph 3(i): where the life differs from the one PRESCRIBED —
  // longer or shorter, the 2014 amendment made the two symmetric — the
  // financial statements must disclose the difference and justify it "duly
  // supported by technical advice". Required whenever the effective life
  // differs from the class''s schedule_ii_life_months, and enforced by
  // fixed_assets_life_note_ck as well as here.
  usefulLifeNote?: string;
}

' '  // useful life below is the opposite: Schedule II is about the life of a
  // particular asset, so that one does belong on the line.
  //
  // NOTE: the useful life is not here either, as of migration_038. A
  // company adopting a life shorter than Schedule II is making one policy
  // decision, not one per purchase, so it is set per asset class under
  // Configuration > Depreciation — along with its Part A paragraph 3(i)
  // justification, which every asset copies at capitalisation.
}

'

Edit-FileText 'backend/src/routes/purchaseBills.ts' '    return res.status(400).json({ message: "exchangeRate must be greater than 0 for a non-INR bill." });
  }

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true, priceVarianceTolerancePct: true } });
  if (!org?.costingMethod) return res.status(422).json({ message: "Set the organization''s stock costing method first." });

  const vendor = await prisma.businessPartner.findFirst({ where: { id: effectiveBusinessPartnerId, organizationId, bpType: "VENDOR" } });' '    return res.status(400).json({ message: "exchangeRate must be greater than 0 for a non-INR bill." });
  }

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true, priceVarianceTolerancePct: true, capitalisationThreshold: true } });
  if (!org?.costingMethod) return res.status(422).json({ message: "Set the organization''s stock costing method first." });

  const vendor = await prisma.businessPartner.findFirst({ where: { id: effectiveBusinessPartnerId, organizationId, bpType: "VENDOR" } });'

Edit-FileText 'backend/src/routes/purchaseBills.ts' '    if (l.capitalise && !l.assetClassId) l.assetClassId = fromItem;
  }

  const capitalIdx: number[] = [];
  computed.forEach((l, i) => {
    if ((l as { capitalise?: boolean }).capitalise) capitalIdx.push(i);' '    if (l.capitalise && !l.assetClassId) l.assetClassId = fromItem;
  }

  // The capitalisation threshold, applied after the item default and before
  // anything is validated. A company that writes off everything under, say,
  // five thousand rupees does not want a fixed asset carrying a forty-rupee
  // monthly charge — so a line below the threshold is expensed instead,
  // whether it was ticked deliberately or defaulted from the item. Zero
  // means no threshold, which is where every organization starts.
  //
  // The line then behaves exactly as an ordinary one: it debits the item''s
  // own account. That is the whole reason a capital item still carries an
  // expense head.
  const threshold = Number(org.capitalisationThreshold ?? 0);
  const belowThreshold: string[] = [];
  if (threshold > 0) {
    for (const l of computed as ({ itemId: string; capitalise?: boolean; lineSubtotal: number })[]) {
      if (!l.capitalise) continue;
      if (l.lineSubtotal >= threshold) continue;
      l.capitalise = false;
      belowThreshold.push(itemById.get(l.itemId)!.sku);
    }
  }

  const capitalIdx: number[] = [];
  computed.forEach((l, i) => {
    if ((l as { capitalise?: boolean }).capitalise) capitalIdx.push(i);'

Edit-FileText 'backend/src/routes/purchaseBills.ts' '      const l = computed[i] as {
        itemId: string; quantity: number; lineSubtotal: number;
        capitalise?: boolean; prepaid?: boolean; assetClassId?: string;
        assetName?: string; inUseDate?: string; usefulLifeMonths?: number;
        usefulLifeNote?: string; capitaliseGst?: boolean; method?: string;
      };
      const item = itemById.get(l.itemId)!;
' '      const l = computed[i] as {
        itemId: string; quantity: number; lineSubtotal: number;
        capitalise?: boolean; prepaid?: boolean; assetClassId?: string;
        assetName?: string; inUseDate?: string;
        capitaliseGst?: boolean; method?: string;
      };
      const item = itemById.get(l.itemId)!;
'

Edit-FileText 'backend/src/routes/purchaseBills.ts' '      if (Number(cls.defaultResidualPct) >= 100) {
        return res.status(400).json({ message: `${cls.name}: the class''s residual percentage is ${Number(cls.defaultResidualPct)}% — fix the asset class before capitalising against it.` });
      }
      if (l.usefulLifeMonths !== undefined && l.usefulLifeMonths !== null) {
        const life = Number(l.usefulLifeMonths);
        if (!Number.isInteger(life) || life < 1 || life > 1200) {
          return res.status(400).json({ message: `${item.sku}: useful life must be a whole number of months between 1 and 1200.` });
        }
      }

      // The method is the company''s, not this line''s — and it is the method
      // in force in the month the asset is put to use, which is not
      // necessarily the method in force today: a change may already be dated' '      if (Number(cls.defaultResidualPct) >= 100) {
        return res.status(400).json({ message: `${cls.name}: the class''s residual percentage is ${Number(cls.defaultResidualPct)}% — fix the asset class before capitalising against it.` });
      }
      // The method is the company''s, not this line''s — and it is the method
      // in force in the month the asset is put to use, which is not
      // necessarily the method in force today: a change may already be dated'

Edit-FileText 'backend/src/routes/purchaseBills.ts' '        return res.status(400).json({ message: `${cls.name} has no residual percentage, and the company depreciates on written-down value from ${String(l.inUseDate).slice(0, 7)}. That rate is derived from the residual, and at zero the whole cost would be written off at once — give the class a residual, or change the policy.` });
      }

      // The deviation is measured against what Schedule II PRESCRIBES, not
      // against this org''s class default. Those are the same today, but a
      // class is editable and the statute is not — so if a class has been
      // moved off the prescribed life, an asset taking that class''s default
      // is still a deviation and still needs its justification.
      const effectiveLife = Number(l.usefulLifeMonths ?? cls.defaultUsefulLifeMonths);
      const note = String(l.usefulLifeNote ?? "").trim();
      if (note.length > 500) {
        return res.status(400).json({ message: `${item.sku}: the justification can be at most 500 characters.` });
      }
      if (effectiveLife !== cls.scheduleIiLifeMonths && !note) {
        const direction = effectiveLife > cls.scheduleIiLifeMonths ? "longer" : "shorter";
        return res.status(400).json({
          message: `${item.sku}: ${effectiveLife} months is ${direction} than the ${cls.scheduleIiLifeMonths} months Schedule II prescribes for ${cls.name}. Part A paragraph 3(i) requires the difference to be disclosed and justified, supported by technical advice — record that justification against the asset.`,
        });
      }
    }
  }
' '        return res.status(400).json({ message: `${cls.name} has no residual percentage, and the company depreciates on written-down value from ${String(l.inUseDate).slice(0, 7)}. That rate is derived from the residual, and at zero the whole cost would be written off at once — give the class a residual, or change the policy.` });
      }

      // The life, its justification and the residual all come from the
      // class now — one policy decision, copied onto each asset. A class
      // whose policy life differs from Schedule II without a justification
      // cannot exist (asset_classes_life_note_ck), so by the time a line
      // gets here there is nothing left to check.
    }
  }
'

Edit-FileText 'backend/src/routes/purchaseBills.ts' '        const l = computed[i] as {
          itemId: string; quantity: number; lineSubtotal: number;
          assetClassId?: string; assetName?: string; inUseDate?: string;
          usefulLifeMonths?: number; usefulLifeNote?: string;
        };
        const item = itemById.get(l.itemId)!;
        const cls = assetClassById.get(String(l.assetClassId))!;' '        const l = computed[i] as {
          itemId: string; quantity: number; lineSubtotal: number;
          assetClassId?: string; assetName?: string; inUseDate?: string;
        };
        const item = itemById.get(l.itemId)!;
        const cls = assetClassById.get(String(l.assetClassId))!;'

Edit-FileText 'backend/src/routes/purchaseBills.ts' '            // capitalised. The engine reads the policy per month rather than
            // this column, because a later change applies to this asset too.
            method: capitalMethod.get(i) ?? "SLM",
            usefulLifeMonths: Number(l.usefulLifeMonths ?? cls.defaultUsefulLifeMonths),
            // Snapshot, so "does this asset depart from Schedule II" stays
            // answerable after the class is edited.
            scheduleIiLifeMonths: cls.scheduleIiLifeMonths,
            usefulLifeNote: String(l.usefulLifeNote ?? "").trim() || null,
            // Pinned but unused: income tax depreciation is out of scope, and
            // these columns are NOT NULL. Nothing reads them today.
            itBlockCode: cls.defaultItBlockCode,' '            // capitalised. The engine reads the policy per month rather than
            // this column, because a later change applies to this asset too.
            method: capitalMethod.get(i) ?? "SLM",
            // Life, statutory reference and justification all copied off the
            // class, so "does this asset depart from Schedule II, and why"
            // stays answerable for the asset''s whole life even after someone
            // edits the class.
            usefulLifeMonths: cls.defaultUsefulLifeMonths,
            scheduleIiLifeMonths: cls.scheduleIiLifeMonths,
            usefulLifeNote: cls.lifePolicyNote,
            // Pinned but unused: income tax depreciation is out of scope, and
            // these columns are NOT NULL. Nothing reads them today.
            itBlockCode: cls.defaultItBlockCode,'

Edit-FileText 'backend/src/routes/purchaseBills.ts' '    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "CREATE", entityType: "purchase_bill", entityId: bill.id,
      summary: requiresApproval
        ? `Created purchase bill ${billNumber} — ${vendor.name} (${grandTotal.toFixed(2)}) — held Pending Approval: ${varianceNote}`
        : `Posted purchase bill ${billNumber} — ${vendor.name} (${grandTotal.toFixed(2)})`,
    });
    res.status(201).json({ data: bill });
  } catch (err: any) {' '    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "CREATE", entityType: "purchase_bill", entityId: bill.id,
      summary: (belowThreshold.length > 0 ? `Expensed below the ${threshold} capitalisation threshold: ${belowThreshold.join(", ")}. ` : "") + (requiresApproval
        ? `Created purchase bill ${billNumber} — ${vendor.name} (${grandTotal.toFixed(2)}) — held Pending Approval: ${varianceNote}`
        : `Posted purchase bill ${billNumber} — ${vendor.name} (${grandTotal.toFixed(2)})`),
    });
    res.status(201).json({ data: bill });
  } catch (err: any) {'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green