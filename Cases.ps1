$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Depreciation cases (no workbook needed)' -ForegroundColor Cyan

# Pure ASCII. Every non-ASCII character travels as ~U+XXXX~ and is decoded
# below, so this behaves identically whether PowerShell reads it as UTF-8 or
# as Windows-1252. No byte-order mark needed.
$decoder = [Text.RegularExpressions.MatchEvaluator] {
  param($m)
  [char]::ConvertFromUtf32([Convert]::ToInt32($m.Groups[1].Value, 16))
}
function Decode($s) {
  return [Text.RegularExpressions.Regex]::Replace($s, '~U\+([0-9A-Fa-f]{4,6})~', $decoder)
}

function Set-FileText($rel, $text) {
  $p = Join-Path $repo $rel
  $dir = Split-Path $p -Parent
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  # A PowerShell here-string DROPS the newline immediately before its closing
  # '@, so the text arrives here one byte short of the source file. Every file
  # this delivers ends with exactly one newline (git shows the alternative as
  # "\ No newline at end of file"), so put it back rather than publish hashes
  # that can never match.
  $body = (Decode $text).Replace([string][char]13, '')
  if (-not $body.EndsWith("`n")) { $body += "`n" }
  [IO.File]::WriteAllText($p, $body, (New-Object Text.UTF8Encoding $false))
  Write-Host "  wrote  $rel"
}

function Edit-FileText($rel, $old, $new) {
  $p = Join-Path $repo $rel
  if (-not (Test-Path -LiteralPath $p)) { throw "Missing file: $rel" }
  $old = (Decode $old).Replace([string][char]13, '')
  $new = (Decode $new).Replace([string][char]13, '')
  $t = [IO.File]::ReadAllText($p).Replace([string][char]13, '')
  if ($t.Contains($new)) { Write-Host "  skip   $rel"; return }
  $i = $t.IndexOf($old)
  if ($i -lt 0) { throw "Anchor not found in $rel." }
  if ($t.IndexOf($old, $i + 1) -ge 0) { throw "Anchor is not unique in $rel." }
  $t = $t.Substring(0, $i) + $new + $t.Substring($i + $old.Length)
  [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
  Write-Host "  edit   $rel"
}
$f0 = @'
[{"key":"DEP-01.1","caseId":"DEP-01","caseTitle":"Capitalise a laptop from a purchase bill","action":"Create a Purchase Bill (not linked to a Purchase Order).","je":[{"code":"1405","name":"Computers & Equipment (asset card)",
"debit":120000.0,"credit":0},{"code":"1102","name":"CGST Input Credit","debit":10800.0,"credit":0},{"code":"1103","name":"SGST Input Credit","debit":10800.0,"credit":0},{"code":"2001","name":"Accounts Payable (Sundar Systems)",
"debit":0,"credit":141600.0}],"phase":1,"login":"A","method":"POST","path":"/purchase-bills","body":{"businessPartnerId":"{{VENDOR_TN}}","billDate":"2026-04-01","branchId":"{{BR_A_D07}}","lines":[{"itemId":"{{ITM_LAP_A}}",
"quantity":1,"rate":120000,"taxRate":18,"capitalise":true,"assetClassId":"{{AC_1}}","assetName":"Laptop 14in - Finance","inUseDate":"2026-04-01"}]},"status":201,"capture":{"billId":"data.id"},
"asserts":["journal purchase_bill {{billId}}"],"auto":"YES"},{"key":"DEP-01.2","caseId":"DEP-01","caseTitle":"Capitalise a laptop from a purchase bill","action":"Open Fixed Assets and find the new asset.",
"phase":1,"login":"A","method":"GET","path":"/fixed-assets","status":200,"capture":{"assetId":"data[purchaseBill.id={{billId}}].id","assetCode":"data[purchaseBill.id={{billId}}].assetCode"},
"asserts":["field data[id={{assetId}}].grossCost = 120000.00","field data[id={{assetId}}].residualValue = 6000.00","field data[id={{assetId}}].usefulLifeMonths = 60","field data[id={{assetId}}].method = SLM",
"field data[id={{assetId}}].inUseDate = 2026-04-01"],"auto":"YES"},{"key":"DEP-01.3","caseId":"DEP-01","caseTitle":"Capitalise a laptop from a purchase bill","action":"Check the asset's own sub-ledger card.",
"phase":1,"login":"A","method":"GET","path":"/journal","status":200,"asserts":["manual: drill into the 1405 sub-ledger card in the UI. The API assertion in step 1 already proves the line carries the asset's businessPartnerId."],
"auto":"PARTIAL"},{"key":"DEP-02.1","caseId":"DEP-02","caseTitle":"Line under the capitalisation threshold is expensed","action":"Create a Purchase Bill with a small capital-by-nature line.",
"je":[{"code":"4008","name":"Administrative (the item's expense head)","debit":4500.0,"credit":0},{"code":"1102","name":"CGST Input Credit","debit":405.0,"credit":0},{"code":"1103","name":"SGST Input Credit",
"debit":405.0,"credit":0},{"code":"2001","name":"Accounts Payable","debit":0,"credit":5310.0}],"phase":1,"login":"A","method":"POST","path":"/purchase-bills","body":{"businessPartnerId":"{{VENDOR_TN}}",
"billDate":"2026-04-02","branchId":"{{BR_A_CHN}}","lines":[{"itemId":"{{ITM_LAP_A}}","quantity":1,"rate":4500,"taxRate":18,"capitalise":true,"assetClassId":"{{AC_1}}","assetName":"Laptop - below threshold",
"inUseDate":"2026-04-02"}]},"status":201,"capture":{"billId":"data.id"},"asserts":["journal purchase_bill {{billId}}"],"auto":"YES"},{"key":"DEP-02.2","caseId":"DEP-02","caseTitle":"Line under the capitalisation threshold is expensed",
"action":"Search Fixed Assets for anything dated 02-Apr-2026.","phase":1,"login":"A","method":"GET","path":"/fixed-assets","status":200,"asserts":["field count(data[purchaseBill.id={{billId}}]) = 0"],
"auto":"YES"},{"key":"DEP-03.1","caseId":"DEP-03","caseTitle":"A stock item cannot be capitalised","action":"Create a Purchase Bill and tick capitalise on a stock line.","phase":1,"login":"A",
"method":"POST","path":"/purchase-bills","body":{"businessPartnerId":"{{VENDOR_TN}}","billDate":"2026-04-03","branchId":"{{BR_A_CHN}}","lines":[{"itemId":"{{ITM_BRG_A}}","quantity":1,"rate":50000,
"taxRate":18,"capitalise":true,"assetClassId":"{{AC_1}}","assetName":"Bearing","inUseDate":"2026-04-03"}]},"status":400,"asserts":["error contains \"Only a non-stock item can be capitalised\""],
"auto":"YES"},{"key":"DEP-04.1","caseId":"DEP-04","caseTitle":"A line is either prepaid or capitalised, not both","action":"Create a Purchase Bill with both flags set on one line.","phase":1,
"login":"A","method":"POST","path":"/purchase-bills","body":{"businessPartnerId":"{{VENDOR_TN}}","billDate":"2026-04-04","branchId":"{{BR_A_CHN}}","lines":[{"itemId":"{{ITM_LAP_A}}","quantity":1,
"rate":60000,"taxRate":18,"capitalise":true,"assetClassId":"{{AC_1}}","assetName":"Laptop","inUseDate":"2026-04-04","prepaid":true,"prepaidStartMonth":"2026-04","prepaidMonths":12}]},"status":400,
"asserts":["error contains \"either prepaid or capitalised\""],"auto":"YES"},{"key":"DEP-05.1","caseId":"DEP-05","caseTitle":"Capitalising GST is refused (not yet supported)","action":"Create a Purchase Bill and ask for the GST to go into the asset's cost.",
"phase":1,"login":"A","method":"POST","path":"/purchase-bills","body":{"businessPartnerId":"{{VENDOR_TN}}","billDate":"2026-04-05","branchId":"{{BR_A_CHN}}","lines":[{"itemId":"{{ITM_LAP_A}}",
"quantity":1,"rate":60000,"taxRate":18,"capitalise":true,"assetClassId":"{{AC_1}}","assetName":"Laptop","inUseDate":"2026-04-05","capitaliseGst":true}]},"status":400,"asserts":["error contains \"Capitalising GST\""],
"auto":"YES"},{"key":"DEP-06.1","caseId":"DEP-06","caseTitle":"Capitalising on a foreign-currency bill is refused","action":"Create a USD Purchase Bill with a capital line.","phase":1,"login":"A",
"method":"POST","path":"/purchase-bills","body":{"businessPartnerId":"{{VENDOR_USD}}","billDate":"2026-04-06","branchId":"{{BR_A_CHN}}","lines":[{"itemId":"{{ITM_LAP_A}}","quantity":1,"rate":1500,
"taxRate":18,"capitalise":true,"assetClassId":"{{AC_1}}","assetName":"Laptop","inUseDate":"2026-04-06"}],"currency":"USD","exchangeRate":84},"status":400,"asserts":["error contains \"foreign-currency bill\""],
"auto":"YES"},{"key":"DEP-07.1","caseId":"DEP-07","caseTitle":"SLM monthly \u2014 three periods","action":"Open Depreciation > Due, on or after 01-May-2026.","phase":2,"login":"A","method":"GET",
"path":"/depreciation-runs/due","status":200,"asserts":["field data.period.periodStart = 2026-04-01","field data.frequency = MONTHLY","field data.assets[id={{DEP-01.assetId}}].amount = 1900.00"],
"auto":"YES"},{"key":"DEP-07.2","caseId":"DEP-07","caseTitle":"SLM monthly \u2014 three periods","action":"Post April 2026.","je":[{"code":"4020","name":"Depreciation & Amortisation","debit":1900.0,
"credit":0},{"code":"1455","name":"Accumulated Depreciation - Computers (asset card)","debit":0,"credit":1900.0}],"phase":2,"login":"A","method":"POST","path":"/depreciation-runs/post","body":{"periodStart":"2026-04-01"},
"status":200,"asserts":["journal depreciation_run period=2026-04-01 branch={{BR_A_D07}}"],"auto":"YES"},{"key":"DEP-07.3","caseId":"DEP-07","caseTitle":"SLM monthly \u2014 three periods","action":"Post May 2026.",
"je":[{"code":"4020","name":"Depreciation & Amortisation","debit":1900.0,"credit":0},{"code":"1455","name":"Accumulated Depreciation - Computers (asset card)","debit":0,"credit":1900.0}],"phase":3,
"login":"A","method":"POST","path":"/depreciation-runs/post","body":{"periodStart":"2026-05-01"},"status":200,"asserts":["journal depreciation_run period=2026-05-01 branch={{BR_A_D07}}"],"auto":"YES"},
{"key":"DEP-07.4","caseId":"DEP-07","caseTitle":"SLM monthly \u2014 three periods","action":"Post June 2026.","je":[{"code":"4020","name":"Depreciation & Amortisation","debit":1900.0,"credit":0},
{"code":"1455","name":"Accumulated Depreciation - Computers (asset card)","debit":0,"credit":1900.0}],"phase":4,"login":"A","method":"POST","path":"/depreciation-runs/post","body":{"periodStart":"2026-06-01"},
"status":200,"asserts":["journal depreciation_run period=2026-06-01 branch={{BR_A_D07}}"],"auto":"YES"},{"key":"DEP-07.5","caseId":"DEP-07","caseTitle":"SLM monthly \u2014 three periods","action":"Open the asset's depreciation schedule.",
"phase":4,"login":"A","method":"GET","path":"/fixed-assets/{{DEP-01.assetId}}/schedule","status":200,"asserts":["field count(data.runs) = 3","field data.runs[2].closingWdv = 114300.00","field data.runs[0].amount = 1900.00"],
"auto":"YES"},{"key":"DEP-08.1","caseId":"DEP-08","caseTitle":"SLM part month \u2014 pro-rata on days","action":"Capitalise via a Purchase Bill.","je":[{"code":"1405","name":"Computers & Equipment (asset card)",
"debit":120000.0,"credit":0},{"code":"1102","name":"CGST Input Credit","debit":10800.0,"credit":0},{"code":"1103","name":"SGST Input Credit","debit":10800.0,"credit":0},{"code":"2001","name":"Accounts Payable",
"debit":0,"credit":141600.0}],"phase":1,"login":"A","method":"POST","path":"/purchase-bills","body":{"businessPartnerId":"{{VENDOR_TN}}","billDate":"2026-04-16","branchId":"{{BR_A_D08}}","lines":[{"itemId":"{{ITM_LAP_A}}",
"quantity":1,"rate":120000,"taxRate":18,"capitalise":true,"assetClassId":"{{AC_1}}","assetName":"Laptop 14in - part month","inUseDate":"2026-04-16"}]},"status":201,"capture":{"billId":"data.id"},
"asserts":["journal purchase_bill {{billId}}"],"auto":"YES"},{"key":"DEP-08.2","caseId":"DEP-08","caseTitle":"SLM part month \u2014 pro-rata on days","action":"Post April 2026 and read this asset's line.",
"je":[{"code":"4020","name":"Depreciation & Amortisation","debit":950.0,"credit":0},{"code":"1455","name":"Accumulated Depreciation - Computers (asset card)","debit":0,"credit":950.0}],"phase":2,
"login":"A","method":"POST","path":"/depreciation-runs/post","body":{"periodStart":"2026-04-01"},"status":200,"asserts":["pre GET /depreciation-runs/due :: field data.assets[branchId={{BR_A_D08}}].charges[0].daysCharged = 15",
"pre GET /depreciation-runs/due :: field data.assets[branchId={{BR_A_D08}}].charges[0].daysInPeriod = 30","pre GET /depreciation-runs/due :: field data.assets[branchId={{BR_A_D08}}].amount = 950.00",
"journal depreciation_run period=2026-04-01 branch={{BR_A_D08}}"],"auto":"YES","note":"Run this INSTEAD of DEP-07.2 - one post covers every branch. Assert both branches' figures from the one call."},
{"key":"DEP-08.3","caseId":"DEP-08","caseTitle":"SLM part month \u2014 pro-rata on days","action":"Post May 2026.","je":[{"code":"4020","name":"Depreciation & Amortisation","debit":1900.0,"credit":0},
{"code":"1455","name":"Accumulated Depreciation - Computers (asset card)","debit":0,"credit":1900.0}],"phase":3,"login":"A","method":"POST","path":"/depreciation-runs/post","body":{"periodStart":"2026-05-01"},
"status":200,"asserts":["journal depreciation_run period=2026-05-01 branch={{BR_A_D08}}"],"auto":"YES","note":"Same posting as DEP-07.3."},{"key":"DEP-09.1","caseId":"DEP-09","caseTitle":"WDV monthly \u2014 three periods",
"action":"Capitalise via a Purchase Bill.","je":[{"code":"1405","name":"Computers & Equipment (asset card)","debit":100000.0,"credit":0},{"code":"1102","name":"CGST Input Credit","debit":9000.0,
"credit":0},{"code":"1103","name":"SGST Input Credit","debit":9000.0,"credit":0},{"code":"2001","name":"Accounts Payable","debit":0,"credit":118000.0}],"phase":1,"login":"A","method":"POST",
"path":"/purchase-bills","body":{"businessPartnerId":"{{VENDOR_TN}}","billDate":"2026-04-01","branchId":"{{BR_A_D09}}","lines":[{"itemId":"{{ITM_LAP_A}}","quantity":1,"rate":100000,"taxRate":18,
"capitalise":true,"assetClassId":"{{AC_2}}","assetName":"Laptop - WDV test","inUseDate":"2026-04-01"}]},"status":201,"capture":{"billId":"data.id"},"asserts":["journal purchase_bill {{billId}}"],
"auto":"YES","note":"AC-2 must already be on WDV - see Setup 5b."},{"key":"DEP-09.2","caseId":"DEP-09","caseTitle":"WDV monthly \u2014 three periods","action":"Post April 2026.","je":[{"code":"4020",
"name":"Depreciation & Amortisation","debit":7984.65,"credit":0},{"code":"1455","name":"Accumulated Depreciation - Computers (asset card)","debit":0,"credit":7984.65}],"phase":2,"login":"A",
"method":"POST","path":"/depreciation-runs/post","body":{"periodStart":"2026-04-01"},"status":200,"asserts":["journal depreciation_run period=2026-04-01 branch={{BR_A_D09}}"],"auto":"YES","note":"Same posting as DEP-07.2."},
{"key":"DEP-09.3","caseId":"DEP-09","caseTitle":"WDV monthly \u2014 three periods","action":"Post May 2026.","je":[{"code":"4020","name":"Depreciation & Amortisation","debit":7347.1,"credit":0},
{"code":"1455","name":"Accumulated Depreciation - Computers (asset card)","debit":0,"credit":7347.1}],"phase":3,"login":"A","method":"POST","path":"/depreciation-runs/post","body":{"periodStart":"2026-05-01"},
"status":200,"asserts":["journal depreciation_run period=2026-05-01 branch={{BR_A_D09}}"],"auto":"YES","note":"Same posting as DEP-07.3."},{"key":"DEP-09.4","caseId":"DEP-09","caseTitle":"WDV monthly \u2014 three periods",
"action":"Post June 2026.","je":[{"code":"4020","name":"Depreciation & Amortisation","debit":6760.46,"credit":0},{"code":"1455","name":"Accumulated Depreciation - Computers (asset card)","debit":0,
"credit":6760.46}],"phase":4,"login":"A","method":"POST","path":"/depreciation-runs/post","body":{"periodStart":"2026-06-01"},"status":200,"asserts":["journal depreciation_run period=2026-06-01 branch={{BR_A_D09}}"],
"auto":"YES","note":"Same posting as DEP-07.4."},{"key":"DEP-10.1","caseId":"DEP-10","caseTitle":"Catch-up \u2014 an asset added late picks up every period it missed","action":"Capitalise an asset BACKDATED into an already-posted period.",
"je":[{"code":"1405","name":"Computers & Equipment (asset card)","debit":120000.0,"credit":0},{"code":"1102","name":"CGST Input Credit","debit":10800.0,"credit":0},{"code":"1103","name":"SGST Input Credit",
"debit":10800.0,"credit":0},{"code":"2001","name":"Accounts Payable","debit":0,"credit":141600.0}],"phase":5,"login":"A","method":"POST","path":"/purchase-bills","body":{"businessPartnerId":"{{VENDOR_TN}}",
"billDate":"2026-04-01","branchId":"{{BR_A_D10}}","lines":[{"itemId":"{{ITM_LAP_A}}","quantity":1,"rate":120000,"taxRate":18,"capitalise":true,"assetClassId":"{{AC_1}}","assetName":"Laptop - backdated",
"inUseDate":"2026-04-01"}]},"status":201,"capture":{"billId":"data.id","assetId":"GET /fixed-assets :: data[purchaseBill.id={{billId}}].id"},"asserts":["journal purchase_bill {{billId}}"],"auto":"YES",
"note":"MUST run only after DEP-07.4 has posted June."},{"key":"DEP-10.2","caseId":"DEP-10","caseTitle":"Catch-up \u2014 an asset added late picks up every period it missed","action":"Open Depreciation > Due on or after 01-Aug-2026.",
"phase":5,"login":"A","method":"GET","path":"/depreciation-runs/due","status":200,"asserts":["field data.period.periodStart = 2026-07-01","field data.assets[branchId={{BR_A_D10}}].amount = 7600.00",
"field count(data.assets[branchId={{BR_A_D10}}].charges) = 4"],"auto":"YES"},{"key":"DEP-10.3","caseId":"DEP-10","caseTitle":"Catch-up \u2014 an asset added late picks up every period it missed",
"action":"Post July 2026.","je":[{"code":"4020","name":"Depreciation & Amortisation","debit":7600.0,"credit":0},{"code":"1455","name":"Accumulated Depreciation - Computers (asset card)","debit":0,
"credit":7600.0}],"phase":5,"login":"A","method":"POST","path":"/depreciation-runs/post","body":{"periodStart":"2026-07-01"},"status":200,"asserts":["journal depreciation_run period=2026-07-01 branch={{BR_A_D10}}"],
"auto":"YES"},{"key":"DEP-10.4","caseId":"DEP-10","caseTitle":"Catch-up \u2014 an asset added late picks up every period it missed","action":"Check the asset's schedule.","phase":5,"login":"A",
"method":"GET","path":"/fixed-assets/{{DEP-10.assetId}}/schedule","status":200,"asserts":["field count(data.runs) = 4","field data.runs[0].periodStart = 2026-04-01","field data.runs[3].closingWdv = 112400.00",
"field distinct(data.runs[].journalEntryId) = 1"],"auto":"YES"},{"key":"DEP-11.1","caseId":"DEP-11","caseTitle":"Quarterly frequency","action":"Capitalise via a Purchase Bill in ORG-B.","phase":1,
"login":"B","method":"POST","path":"/purchase-bills","body":{"businessPartnerId":"{{VENDOR_TN}}","billDate":"2026-04-01","branchId":"{{BR_B_CHN}}","lines":[{"itemId":"{{ITM_NONSTOCK_B}}","quantity":1,
"rate":120000,"taxRate":18,"capitalise":true,"assetClassId":"{{AC_1B}}","assetName":"Office equipment - quarterly","inUseDate":"2026-04-01"}]},"status":201,"capture":{"billId":"data.id"},"asserts":["journal purchase_bill {{billId}}"],
"auto":"YES"},{"key":"DEP-11.2","caseId":"DEP-11","caseTitle":"Quarterly frequency","action":"Open Depreciation > Due on or after 01-Jul-2026.","phase":2,"login":"B","method":"GET","path":"/depreciation-runs/due",
"status":200,"asserts":["field data.frequency = QUARTERLY","field data.period.periodStart = 2026-04-01","field data.period.periodEnd = 2026-06-30","field data.period.months = 3","field data.totalAmount = 5700.00"],
"auto":"YES"},{"key":"DEP-11.3","caseId":"DEP-11","caseTitle":"Quarterly frequency","action":"Post the quarter.","je":[{"code":"4020","name":"Depreciation & Amortisation","debit":5700.0,"credit":0},
{"code":"1455","name":"Accumulated Depreciation - Computers (asset card)","debit":0,"credit":5700.0}],"phase":2,"login":"B","method":"POST","path":"/depreciation-runs/post","body":{"periodStart":"2026-04-01"},
"status":200,"asserts":["journal depreciation_run period=2026-04-01"],"auto":"YES"},{"key":"DEP-11.4","caseId":"DEP-11","caseTitle":"Quarterly frequency","action":"Post the next quarter on or after 01-Oct-2026.",
"je":[{"code":"4020","name":"Depreciation & Amortisation","debit":5700.0,"credit":0},{"code":"1455","name":"Accumulated Depreciation - Computers (asset card)","debit":0,"credit":5700.0}],"phase":5,
"login":"B","method":"POST","path":"/depreciation-runs/post","body":{"periodStart":"2026-07-01"},"status":200,"asserts":["journal depreciation_run period=2026-07-01"],"auto":"YES"},{"key":"DEP-12.1",
"caseId":"DEP-12","caseTitle":"Blocked \u2014 asset not yet in use","action":"Capitalise with in-use date after the period being posted.","phase":1,"login":"A","method":"POST","path":"/purchase-bills",
"body":{"businessPartnerId":"{{VENDOR_TN}}","billDate":"2026-04-01","branchId":"{{BR_A_CHN}}","lines":[{"itemId":"{{ITM_LAP_A}}","quantity":1,"rate":60000,"taxRate":18,"capitalise":true,"assetClassId":"{{AC_1}}",
"assetName":"Laptop - future use","inUseDate":"2026-09-01"}]},"status":201,"capture":{"billId":"data.id","assetId":"GET /fixed-assets :: data[purchaseBill.id={{billId}}].id"},"auto":"YES"},{"key":"DEP-12.2",
"caseId":"DEP-12","caseTitle":"Blocked \u2014 asset not yet in use","action":"Open Depreciation > Due for a period before September.","phase":2,"login":"A","method":"GET","path":"/depreciation-runs/due",
"status":200,"asserts":["field count(data.assets[id={{DEP-12.assetId}}]) = 0","field count(data.blocked[id={{DEP-12.assetId}}]) = 0"],"auto":"YES","note":"Absent from BOTH lists. NOT_YET_IN_USE is deliberately silent."},
{"key":"DEP-12.3","caseId":"DEP-12","caseTitle":"Blocked \u2014 asset not yet in use","action":"Post September 2026 (after the earlier months are posted).","je":[{"code":"4020","name":"Depreciation & Amortisation",
"debit":950.0,"credit":0},{"code":"1455","name":"Accumulated Depreciation - Computers (asset card)","debit":0,"credit":950.0}],"phase":6,"login":"A","method":"POST","path":"/depreciation-runs/post",
"body":{"periodStart":["2026-09-01"]},"status":200,"asserts":["journal depreciation_run period=2026-09-01 branch={{BR_A_CHN}}"],"auto":"YES"},{"key":"DEP-13.1","caseId":"DEP-13","caseTitle":"Blocked \u2014 WDV with no residual value",
"action":"Capitalise against AC-6.","phase":1,"login":"A","method":"POST","path":"/purchase-bills","body":{"businessPartnerId":"{{VENDOR_TN}}","billDate":"2026-04-01","branchId":"{{BR_A_CHN}}",
"lines":[{"itemId":"{{ITM_LAP_A}}","quantity":1,"rate":60000,"taxRate":18,"capitalise":true,"assetClassId":"{{AC_6}}","assetName":"WDV no-residual test","inUseDate":"2026-04-01"}]},"status":201,
"capture":{"assetId":"GET /fixed-assets :: data[purchaseBill.id={{billId}}].id"},"auto":"YES"},{"key":"DEP-13.2","caseId":"DEP-13","caseTitle":"Blocked \u2014 WDV with no residual value","action":"Open Depreciation > Due for April 2026.",
"phase":2,"login":"A","method":"GET","path":"/depreciation-runs/due","status":200,"asserts":["field data.blocked[id={{DEP-13.assetId}}].reason = WDV_NEEDS_RESIDUAL","field count(data.assets[id={{DEP-13.assetId}}]) = 0"],
"auto":"YES"},{"key":"DEP-13.3","caseId":"DEP-13","caseTitle":"Blocked \u2014 WDV with no residual value","action":"Post April 2026 and check the asset.","phase":4,"login":"A","method":"GET",
"path":"/fixed-assets/{{DEP-13.assetId}}/schedule","status":200,"asserts":["field count(data.runs) = 0"],"auto":"YES"},{"key":"DEP-14.1","caseId":"DEP-14","caseTitle":"End of life \u2014 the last period is a balancing figure",
"action":"Capitalise a short-life asset.","je":[{"code":"1404","name":"Vehicles (asset card)","debit":12000.0,"credit":0},{"code":"1102","name":"CGST Input Credit","debit":1080.0,"credit":0},
{"code":"1103","name":"SGST Input Credit","debit":1080.0,"credit":0},{"code":"2001","name":"Accounts Payable","debit":0,"credit":14160.0}],"phase":1,"login":"A","method":"POST","path":"/purchase-bills",
"body":{"businessPartnerId":"{{VENDOR_TN}}","billDate":"2026-04-01","branchId":"{{BR_A_D14}}","lines":[{"itemId":"{{ITM_LAP_A}}","quantity":1,"rate":12000,"taxRate":18,"capitalise":true,"assetClassId":"{{AC_3}}",
"assetName":"Short-life test","inUseDate":"2026-04-01"}]},"status":201,"capture":{"billId":"data.id","assetId":"GET /fixed-assets :: data[purchaseBill.id={{billId}}].id"},"asserts":["journal purchase_bill {{billId}}"],
"auto":"YES"},{"key":"DEP-14.2","caseId":"DEP-14","caseTitle":"End of life \u2014 the last period is a balancing figure","action":"Post April 2026.","je":[{"code":"4020","name":"Depreciation & Amortisation",
"debit":3600.0,"credit":0},{"code":"1454","name":"Accumulated Depreciation - Vehicles (asset card)","debit":0,"credit":3600.0}],"phase":2,"login":"A","method":"POST","path":"/depreciation-runs/post",
"body":{"periodStart":"2026-04-01"},"status":200,"asserts":["journal depreciation_run period=2026-04-01 branch={{BR_A_D14}}"],"auto":"YES","note":"Same posting as DEP-07.2."},{"key":"DEP-14.3",
"caseId":"DEP-14","caseTitle":"End of life \u2014 the last period is a balancing figure","action":"Post May 2026.","je":[{"code":"4020","name":"Depreciation & Amortisation","debit":3600.0,"credit":0},
{"code":"1454","name":"Accumulated Depreciation - Vehicles (asset card)","debit":0,"credit":3600.0}],"phase":3,"login":"A","method":"POST","path":"/depreciation-runs/post","body":{"periodStart":"2026-05-01"},
"status":200,"asserts":["journal depreciation_run period=2026-05-01 branch={{BR_A_D14}}"],"auto":"YES","note":"Same posting as DEP-07.3."},{"key":"DEP-14.4","caseId":"DEP-14","caseTitle":"End of life \u2014 the last period is a balancing figure",
"action":"Post June 2026 \u2014 the last period.","je":[{"code":"4020","name":"Depreciation & Amortisation","debit":3600.0,"credit":0},{"code":"1454","name":"Accumulated Depreciation - Vehicles (asset card)",
"debit":0,"credit":3600.0}],"phase":4,"login":"A","method":"POST","path":"/depreciation-runs/post","body":{"periodStart":"2026-06-01"},"status":200,"asserts":["pre GET /depreciation-runs/due :: field data.assets[id={{DEP-14.assetId}}].charges[0].final = true",
"pre GET /depreciation-runs/due :: field data.assets[id={{DEP-14.assetId}}].charges[0].closingWdv = 1200.00","journal depreciation_run period=2026-06-01 branch={{BR_A_D14}}"],"auto":"YES","note":"Same posting as DEP-07.4."},
{"key":"DEP-14.5","caseId":"DEP-14","caseTitle":"End of life \u2014 the last period is a balancing figure","action":"Post July 2026 and look for this asset.","phase":5,"login":"A","method":"GET",
"path":"/depreciation-runs/due","status":200,"asserts":["field data.blocked[id={{DEP-14.assetId}}].reason = FULLY_DEPRECIATED"],"auto":"YES","note":"Call this before posting July."},{"key":"DEP-15.1",
"caseId":"DEP-15","caseTitle":"Awkward division \u2014 seven months, and it still lands exactly on residual","action":"Capitalise.","phase":1,"login":"A","method":"POST","path":"/purchase-bills",
"body":{"businessPartnerId":"{{VENDOR_TN}}","billDate":"2026-04-01","branchId":"{{BR_A_D15}}","lines":[{"itemId":"{{ITM_LAP_A}}","quantity":1,"rate":10000,"taxRate":18,"capitalise":true,"assetClassId":"{{AC_4}}",
"assetName":"Seven-month test","inUseDate":"2026-04-01"}]},"status":201,"capture":{"billId":"data.id","assetId":"GET /fixed-assets :: data[purchaseBill.id={{billId}}].id"},"asserts":["journal purchase_bill {{billId}}"],
"auto":"YES"},{"key":"DEP-15.2","caseId":"DEP-15","caseTitle":"Awkward division \u2014 seven months, and it still lands exactly on residual","action":"Post April through October 2026, one period at a time, and record each charge.",
"je":[{"code":"4020","name":"Depreciation & Amortisation (7 entries, one per month)","debit":9000.0,"credit":0},{"code":"1454","name":"Accumulated Depreciation - Vehicles (asset card)","debit":0,
"credit":9000.0}],"phase":6,"login":"A","method":"POST","path":"/depreciation-runs/post","body":{"periodStart":["2026-08-01","2026-09-01","2026-10-01"]},"status":200,"asserts":["GET /fixed-assets/{{DEP-15.assetId}}/schedule :: field sum(data.runs[].amount) = 9000.00"],
"auto":"YES","note":"Posts the tail of the calendar (Apr-Jul are posted by other cases). Expected per-month: 1285.71, 1285.72, 1285.71, 1285.71, 1285.72, 1285.71, 1285.72."},{"key":"DEP-15.3",
"caseId":"DEP-15","caseTitle":"Awkward division \u2014 seven months, and it still lands exactly on residual","action":"Confirm the closing carrying amount.","phase":7,"login":"A","method":"GET",
"path":"/fixed-assets/{{DEP-15.assetId}}/schedule","status":200,"asserts":["field data.runs[6].closingWdv = 1000.00","field data.runs[6].final = true","field sum(data.runs[].amount) = 9000.00"],
"auto":"YES"},{"key":"DEP-16.1","caseId":"DEP-16","caseTitle":"Method changed mid-life by policy","action":"Capitalise against AC-5.","phase":1,"login":"A","method":"POST","path":"/purchase-bills",
"body":{"businessPartnerId":"{{VENDOR_TN}}","billDate":"2026-04-01","branchId":"{{BR_A_D16}}","lines":[{"itemId":"{{ITM_LAP_A}}","quantity":1,"rate":100000,"taxRate":18,"capitalise":true,"assetClassId":"{{AC_5}}",
"assetName":"Method-change test","inUseDate":"2026-04-01"}]},"status":201,"capture":{"billId":"data.id","assetId":"GET /fixed-assets :: data[purchaseBill.id={{billId}}].id"},"asserts":["journal purchase_bill {{billId}}",
"GET /fixed-assets/{{assetId}} :: field data.method = SLM"],"auto":"YES"},{"key":"DEP-16.2","caseId":"DEP-16","caseTitle":"Method changed mid-life by policy","action":"Post April 2026.","je":[{"code":"4020",
"name":"Depreciation & Amortisation","debit":2638.89,"credit":0},{"code":"1452","name":"Accumulated Depreciation - Plant & Machinery (asset card)","debit":0,"credit":2638.89}],"phase":2,"login":"A",
"method":"POST","path":"/depreciation-runs/post","body":{"periodStart":"2026-04-01"},"status":200,"asserts":["journal depreciation_run period=2026-04-01 branch={{BR_A_D16}}"],"auto":"YES","note":"Same posting as DEP-07.2."},
{"key":"DEP-16.3","caseId":"DEP-16","caseTitle":"Method changed mid-life by policy","action":"Post May 2026.","je":[{"code":"4020","name":"Depreciation & Amortisation","debit":2638.89,"credit":0},
{"code":"1452","name":"Accumulated Depreciation - Plant & Machinery (asset card)","debit":0,"credit":2638.89}],"phase":3,"login":"A","method":"POST","path":"/depreciation-runs/post","body":{"periodStart":"2026-05-01"},
"status":200,"asserts":["journal depreciation_run period=2026-05-01 branch={{BR_A_D16}}"],"auto":"YES","note":"Same posting as DEP-07.3."},{"key":"DEP-16.4","caseId":"DEP-16","caseTitle":"Method changed mid-life by policy",
"action":"Post June 2026 \u2014 the first period under the new policy.","je":[{"code":"4020","name":"Depreciation & Amortisation","debit":7850.41,"credit":0},{"code":"1452","name":"Accumulated Depreciation - Plant & Machinery (asset card)",
"debit":0,"credit":7850.41}],"phase":4,"login":"A","method":"POST","path":"/depreciation-runs/post","body":{"periodStart":"2026-06-01"},"status":200,"asserts":["pre GET /depreciation-runs/due :: field data.assets[id={{DEP-16.assetId}}].charges[0].method = WDV",
"pre GET /depreciation-runs/due :: field data.assets[id={{DEP-16.assetId}}].charges[0].amount = 7850.41","journal depreciation_run period=2026-06-01 branch={{BR_A_D16}}"],"auto":"YES","note":"The AC-5 policy change effective 2026-06 must be posted first - see Setup 5b."},
{"key":"DEP-17.1","caseId":"DEP-17","caseTitle":"A period cannot be posted twice","action":"Try to post April 2026 again.","phase":7,"login":"A","method":"POST","path":"/depreciation-runs/post",
"body":{"periodStart":"2026-04-01"},"status":409,"asserts":["error contains \"not the one on screen\""],"auto":"YES","note":"Run after April is already posted."},{"key":"DEP-17.2","caseId":"DEP-17",
"caseTitle":"A period cannot be posted twice","action":"Try to post a period that is not over yet.","phase":7,"login":"A","method":"POST","path":"/depreciation-runs/post","body":{"periodStart":"{{CURRENT_MONTH_START}}"},
"status":409,"asserts":["error contains \"is not over yet\""],"auto":"YES","note":"{{CURRENT_MONTH_START}} is a built-in the runner binds to the first day of the current month."},{"key":"DEP-17.3",
"caseId":"DEP-17","caseTitle":"A period cannot be posted twice","action":"Try to skip a period.","phase":7,"login":"A","method":"POST","path":"/depreciation-runs/post","body":{"periodStart":"2026-06-01"},
"status":409,"asserts":["error contains \"period due\""],"auto":"YES","note":"Run while May is unposted."},{"key":"DEP-17.4","caseId":"DEP-17","caseTitle":"A period cannot be posted twice","action":"Count the journal entries and depreciation_periods rows for April.",
"phase":7,"login":"A","asserts":["sql \"SELECT count(*) FROM depreciation_periods WHERE period_start='2026-04-01'\" = 1"],"auto":"YES","note":"Direct database check - no endpoint exposes this."},
{"key":"DEP-18.1","caseId":"DEP-18","caseTitle":"One P&L line per expense head, one balance-sheet line per asset","action":"Post April 2026 and open the BR-A-CHN journal entry.","phase":7,"login":"A",
"asserts":["sql \"SELECT count(*) FROM journal_lines l JOIN journal_entries e ON e.id=l.journal_entry_id JOIN accounts a ON a.id=l.account_id WHERE e.reference_type='depreciation_run' AND e.entry_date='2026-04-30' AND e.branch_id={{BR_A_CHN}} AND a.account_code='4020'\" = 1",
"sql \"SELECT count(DISTINCT l.business_partner_id) FROM journal_lines l JOIN journal_entries e ON e.id=l.journal_entry_id WHERE e.reference_type='depreciation_run' AND e.entry_date='2026-04-30' AND e.branch_id={{BR_A_CHN}} AND l.credit>0\" >= 3"],
"auto":"YES"},{"key":"DEP-18.2","caseId":"DEP-18","caseTitle":"One P&L line per expense head, one balance-sheet line per asset","action":"Confirm the entry is per branch, not per organisation.",
"phase":7,"login":"A","asserts":["sql \"SELECT count(DISTINCT branch_id) FROM journal_entries WHERE reference_type='depreciation_run' AND entry_date='2026-04-30'\" >= 2"],"auto":"YES"},{"key":"DEP-18.3",
"caseId":"DEP-18","caseTitle":"One P&L line per expense head, one balance-sheet line per asset","action":"Add the debits and credits across every entry from that run.","phase":7,"login":"A",
"asserts":["sql \"SELECT sum(debit)-sum(credit) FROM journal_lines l JOIN journal_entries e ON e.id=l.journal_entry_id WHERE e.reference_type='depreciation_run'\" = 0"],"auto":"YES"},{"key":"DEP-19.1",
"caseId":"DEP-19","caseTitle":"The register reconciles to the ledger","action":"Total the register.","phase":7,"login":"A","asserts":["sql \"SELECT coalesce(sum(r.amount),0) FROM fixed_asset_depreciation_runs r JOIN fixed_assets a ON a.id=r.fixed_asset_id WHERE a.organization_id={{ORG_A}} AND r.period_end<='2026-06-30'\" capture regTotal"],
"auto":"YES"},{"key":"DEP-19.2","caseId":"DEP-19","caseTitle":"The register reconciles to the ledger","action":"Total the ledger.","phase":7,"login":"A","asserts":["sql \"SELECT coalesce(sum(l.credit-l.debit),0) FROM journal_lines l JOIN journal_entries e ON e.id=l.journal_entry_id JOIN accounts a ON a.id=l.account_id WHERE e.organization_id={{ORG_A}} AND e.entry_date<='2026-06-30' AND a.account_code IN ('1451','1452','1454','1455')\" = {{regTotal}}"],
"auto":"YES"},{"key":"DEP-19.3","caseId":"DEP-19","caseTitle":"The register reconciles to the ledger","action":"Total the expense.","phase":7,"login":"A","asserts":["sql \"SELECT coalesce(sum(l.debit-l.credit),0) FROM journal_lines l JOIN journal_entries e ON e.id=l.journal_entry_id JOIN accounts a ON a.id=l.account_id WHERE e.organization_id={{ORG_A}} AND e.entry_date<='2026-06-30' AND a.account_code='4020'\" = {{regTotal}}"],
"auto":"YES"},{"key":"DEP-19.4","caseId":"DEP-19","caseTitle":"The register reconciles to the ledger","action":"Check each asset card individually.","phase":7,"login":"A","asserts":["manual: per-card drill-down is a UI check. The DEP-18.1 assertion on distinct business_partner_id is the automated proxy."],
"auto":"PARTIAL"},{"key":"DEP-20.1","caseId":"DEP-20","caseTitle":"Editing an asset class does not restate assets already capitalised","action":"Edit asset class AC-1.","phase":7,"login":"A",
"method":"PATCH","path":"/depreciation-policy/classes/{{AC_1}}","body":{"usefulLifeMonths":84,"lifePolicyNote":"Test - life extended after capitalisation."},"status":200,"auto":"YES"},{"key":"DEP-20.2",
"caseId":"DEP-20","caseTitle":"Editing an asset class does not restate assets already capitalised","action":"Re-open the DEP-07 asset.","phase":7,"login":"A","method":"GET","path":"/fixed-assets/{{DEP-01.assetId}}",
"status":200,"asserts":["field data.usefulLifeMonths = 60"],"auto":"YES"},{"key":"DEP-20.3","caseId":"DEP-20","caseTitle":"Editing an asset class does not restate assets already capitalised",
"action":"Post May 2026.","je":[{"code":"4020","name":"Depreciation & Amortisation","debit":1900.0,"credit":0},{"code":"1455","name":"Accumulated Depreciation - Computers (asset card)","debit":0,
"credit":1900.0}],"phase":7,"login":"A","method":"POST","path":"/depreciation-runs/post","body":{"periodStart":"2026-05-01"},"status":200,"asserts":["pre GET /depreciation-runs/due :: field data.assets[id={{DEP-01.assetId}}].amount = 1900.00"],
"auto":"YES","note":"Only valid if run BEFORE DEP-07.3. Otherwise assert from the schedule instead."},{"key":"DEP-20.4","caseId":"DEP-20","caseTitle":"Editing an asset class does not restate assets already capitalised",
"action":"Capitalise a NEW asset against AC-1 and check it.","phase":7,"login":"A","method":"POST","path":"/purchase-bills","body":{"businessPartnerId":"{{VENDOR_TN}}","billDate":"2026-05-02",
"branchId":"{{BR_A_CHN}}","lines":[{"itemId":"{{ITM_LAP_A}}","quantity":1,"rate":120000,"taxRate":18,"capitalise":true,"assetClassId":"{{AC_1}}","assetName":"Laptop - after class edit","inUseDate":"2026-05-02"}]},
"status":201,"capture":{"assetId":"GET /fixed-assets :: data[purchaseBill.id={{billId}}].id"},"asserts":["GET /fixed-assets/{{assetId}} :: field data.usefulLifeMonths = 84"],"auto":"YES"},{"key":"DEP-21.1",
"caseId":"DEP-21","caseTitle":"Purchase return of a capitalised line \u2014 KNOWN DEFECT","action":"Raise a Purchase Return against the DEP-01 bill for the capitalised laptop.","phase":7,"login":"A",
"method":"POST","path":"/purchase-returns","body":{"purchaseBillId":"{{DEP-01.billId}}","returnDate":"2026-04-20","branchId":"{{BR_A_D07}}","lines":[{"itemId":"{{ITM_LAP_A}}","quantity":1,"rate":120000,
"taxRate":18}]},"status":201,"capture":{"returnId":"data.id"},"auto":"YES","note":"EXPECTED TO FAIL until the defect is fixed."},{"key":"DEP-21.2","caseId":"DEP-21","caseTitle":"Purchase return of a capitalised line \u2014 KNOWN DEFECT",
"action":"Read the journal entry that was actually written.","je":[{"code":"2001","name":"Accounts Payable","debit":141600.0,"credit":0},{"code":"4008","name":"Administrative  <-- WRONG, should be 1405",
"debit":0,"credit":120000.0},{"code":"1102","name":"CGST Input Credit reversed","debit":0,"credit":10800.0},{"code":"1103","name":"SGST Input Credit reversed","debit":0,"credit":10800.0}],"phase":7,
"login":"A","asserts":["sql \"SELECT a.account_code FROM journal_lines l JOIN journal_entries e ON e.id=l.journal_entry_id JOIN accounts a ON a.id=l.account_id WHERE e.reference_type='purchase_return' AND l.credit>0 AND a.account_type='ASSET'\" = 1405"],
"auto":"YES","note":"ASSERTS THE CORRECT BEHAVIOUR, so it FAILS today - it will return 4008. Flip nothing; fix the code."},{"key":"DEP-21.3","caseId":"DEP-21","caseTitle":"Purchase return of a capitalised line \u2014 KNOWN DEFECT",
"action":"Post May depreciation and look at the returned asset.","phase":7,"login":"A","method":"POST","path":"/depreciation-runs/post","body":{"periodStart":"2026-05-01"},"status":200,"asserts":["pre GET /depreciation-runs/due :: field count(data.assets[id={{DEP-01.assetId}}]) = 0"],
"auto":"YES","note":"ASSERTS THE CORRECT BEHAVIOUR - a returned asset should not charge. Fails today."}]
'@
Set-FileText 'backend/tests/depCases.json' $f0
$o0 = @'
import ExcelJS from "exceljs";
'@
$n0 = @'
import fs from "fs";
import ExcelJS from "exceljs";
'@
Edit-FileText 'backend/tests/harness.ts' $o0 $n0
$o1 = @'
  outWorkbook: process.env.TEST_WORKBOOK_OUT ?? "tests/SmartERP-Test-Results.xlsx",
'@
$n1 = @'
  outWorkbook: process.env.TEST_WORKBOOK_OUT ?? "tests/SmartERP-Test-Results.xlsx",
  // Used when the workbook is absent ~U+2014~ same steps, no formatting.
  casesJson: process.env.TEST_CASES_JSON ?? "tests/depCases.json",
  outJson: process.env.TEST_RESULTS_JSON ?? "tests/SmartERP-Test-Results.json",
'@
Edit-FileText 'backend/tests/harness.ts' $o1 $n1
$o2 = @'
export async function readWorkbook(): Promise<{ wb: ExcelJS.Workbook; steps: Step[] }> {
'@
$n2 = @'
// The workbook is the source of truth when it is present. When it is not, the
// same steps are read from tests/depCases.json, which is generated from it ~U+2014~
// so a machine can run the pack on a box that has no copy of the spreadsheet.
// The two carry identical data; only the human-readable pack is missing.
export async function readCases(): Promise<{ wb: ExcelJS.Workbook | null; steps: Step[] }> {
  if (fs.existsSync(CONFIG.workbook)) return readWorkbook();

  const jsonPath = CONFIG.casesJson;
  if (!fs.existsSync(jsonPath)) {
    throw new Error(
      `Neither ${CONFIG.workbook} nor ${jsonPath} exists. One of them has to be there.`);
  }
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as any[];
  const steps: Step[] = raw.map((r) => ({
    key: r.key, caseId: r.caseId, caseTitle: r.caseTitle ?? "",
    stepNo: Number(String(r.key).split(".")[1]),
    phase: r.phase ?? 99, login: r.login === "B" ? "B" : "A",
    method: r.method ?? null, path: r.path ?? null, body: r.body ?? null,
    status: r.status ?? null, capture: r.capture ?? {}, asserts: r.asserts ?? [],
    auto: r.auto ?? "YES", note: r.note ?? "", posts: null,
    je: r.je ?? [], action: r.action ?? "",
    // No workbook means nowhere to write results back to; runCases.ts writes a
    // JSON report instead.
    sheet: "", row: 0,
  }));
  return { wb: null, steps };
}

export async function readWorkbook(): Promise<{ wb: ExcelJS.Workbook; steps: Step[] }> {
'@
Edit-FileText 'backend/tests/harness.ts' $o2 $n2
$o3 = @'
import ExcelJS from "exceljs";
'@
$n3 = @'
import fs from "fs";
import ExcelJS from "exceljs";
'@
Edit-FileText 'backend/tests/runCases.ts' $o3 $n3
$o4 = @'
  CONFIG, prisma, request, readWorkbook, resolveFixtures, Step, Reply,
'@
$n4 = @'
  CONFIG, prisma, request, readCases, resolveFixtures, Step, Reply,
'@
Edit-FileText 'backend/tests/runCases.ts' $o4 $n4
$o5 = @'
  const { wb, steps: all } = await readWorkbook();
'@
$n5 = @'
  const { wb, steps: all } = await readCases();
'@
Edit-FileText 'backend/tests/runCases.ts' $o5 $n5
$o6 = @'
  for (const r of results) {
    if (!r.step.sheet || !r.step.row) continue;
    const ws = wb.getWorksheet(r.step.sheet);
'@
$n6 = @'
  if (!wb) {
    // Ran from depCases.json, so there is no workbook to annotate. The report
    // goes to JSON instead ~U+2014~ same information, different container.
    fs.writeFileSync(CONFIG.outJson, JSON.stringify(results.map((r) => ({
      key: r.step.key, case: r.step.caseId, title: r.step.caseTitle,
      outcome: r.outcome, detail: r.detail, ms: r.ms, at: stamp,
    })), null, 1));
    console.log(`\n${GREY}Results written to ${CONFIG.outJson}${OFF}`);
    await prisma.$disconnect();
    if (failed.length) process.exitCode = 1;
    return;
  }
  for (const r of results) {
    if (!r.step.sheet || !r.step.row) continue;
    const ws = wb.getWorksheet(r.step.sheet);
'@
Edit-FileText 'backend/tests/runCases.ts' $o6 $n6
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green