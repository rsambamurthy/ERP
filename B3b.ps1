$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Method, life override and justification...' -ForegroundColor Cyan

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

Edit-FileText 'backend/src/routes/purchaseBills.ts' '  // "YYYY-MM-DD". When the asset was put to use, which is what Schedule II
  // charges from — not the purchase date. Cannot precede the bill date.
  inUseDate?: string;
  // Schedule II permits a different life where a company can justify one.
  // Omitted means the class''s default.
  usefulLifeMonths?: number;
}

' '  // "YYYY-MM-DD". When the asset was put to use, which is what Schedule II
  // charges from — not the purchase date. Cannot precede the bill date.
  inUseDate?: string;
  // Schedule II prescribes lives, not methods: Part A never names one and
  // Part C''s Notes ask only that the method used be disclosed. Omitted means
  // the class''s default. WDV requires a residual value — its rate is
  // 1 - (residual/cost)^(1/n), which at zero residual is 1.
  method?: string;
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

'

Edit-FileText 'backend/src/routes/purchaseBills.ts' '        itemId: string; quantity: number; lineSubtotal: number;
        capitalise?: boolean; prepaid?: boolean; assetClassId?: string;
        assetName?: string; inUseDate?: string; usefulLifeMonths?: number;
        capitaliseGst?: boolean;
      };
      const item = itemById.get(l.itemId)!;
' '        itemId: string; quantity: number; lineSubtotal: number;
        capitalise?: boolean; prepaid?: boolean; assetClassId?: string;
        assetName?: string; inUseDate?: string; usefulLifeMonths?: number;
        method?: string; usefulLifeNote?: string; capitaliseGst?: boolean;
      };
      const item = itemById.get(l.itemId)!;
'

Edit-FileText 'backend/src/routes/purchaseBills.ts' '        if (!Number.isInteger(life) || life < 1 || life > 1200) {
          return res.status(400).json({ message: `${item.sku}: useful life must be a whole number of months between 1 and 1200.` });
        }
      }
    }
  }' '        if (!Number.isInteger(life) || life < 1 || life > 1200) {
          return res.status(400).json({ message: `${item.sku}: useful life must be a whole number of months between 1 and 1200.` });
        }
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
  }'

Edit-FileText 'backend/src/routes/purchaseBills.ts' '        const l = computed[i] as {
          itemId: string; quantity: number; lineSubtotal: number;
          assetClassId?: string; assetName?: string; inUseDate?: string;
          usefulLifeMonths?: number;
        };
        const item = itemById.get(l.itemId)!;
        const cls = assetClassById.get(String(l.assetClassId))!;' '        const l = computed[i] as {
          itemId: string; quantity: number; lineSubtotal: number;
          assetClassId?: string; assetName?: string; inUseDate?: string;
          usefulLifeMonths?: number; method?: string; usefulLifeNote?: string;
        };
        const item = itemById.get(l.itemId)!;
        const cls = assetClassById.get(String(l.assetClassId))!;'

Edit-FileText 'backend/src/routes/purchaseBills.ts' '            gstCapitalised: false,
            purchaseDate: new Date(billDate),
            inUseDate: new Date(`${l.inUseDate}T00:00:00.000Z`),
            method: cls.defaultMethod,
            usefulLifeMonths: Number(l.usefulLifeMonths ?? cls.defaultUsefulLifeMonths),
            // Pinned but unused: income tax depreciation is out of scope, and
            // these columns are NOT NULL. Nothing reads them today.
            itBlockCode: cls.defaultItBlockCode,' '            gstCapitalised: false,
            purchaseDate: new Date(billDate),
            inUseDate: new Date(`${l.inUseDate}T00:00:00.000Z`),
            method: String(l.method ?? cls.defaultMethod).toUpperCase(),
            usefulLifeMonths: Number(l.usefulLifeMonths ?? cls.defaultUsefulLifeMonths),
            // Snapshot, so "does this asset depart from Schedule II" stays
            // answerable after the class is edited.
            scheduleIiLifeMonths: cls.scheduleIiLifeMonths,
            usefulLifeNote: String(l.usefulLifeNote ?? "").trim() || null,
            // Pinned but unused: income tax depreciation is out of scope, and
            // these columns are NOT NULL. Nothing reads them today.
            itBlockCode: cls.defaultItBlockCode,'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green