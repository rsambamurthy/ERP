$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Fix the depreciation transaction timeout and the uuid 500' -ForegroundColor Cyan

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

# A here-string DROPS the newline immediately before its closing '@. For a
# replacement that is invisible - both sides lose it and the arithmetic still
# works - but for a DELETION the removed line's own newline survives and leaves
# a blank line behind. So every payload ends with a ~EOT~ sentinel that is
# stripped here, which makes the trailing newline explicit either way.
function Text($s) {
  $d = Decode $s
  $k = $d.LastIndexOf('~EOT~')
  if ($k -ge 0) { $d = $d.Substring(0, $k) }
  return $d.Replace([string][char]13, '')
}

function Set-FileText($rel, $text) {
  $p = Join-Path $repo $rel
  $dir = Split-Path $p -Parent
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::WriteAllText($p, (Text $text), (New-Object Text.UTF8Encoding $false))
  Write-Host "  wrote  $rel"
}

function Edit-FileText($rel, $old, $new) {
  $p = Join-Path $repo $rel
  if (-not (Test-Path -LiteralPath $p)) { throw "Missing file: $rel" }
  $old = Text $old
  $new = Text $new
  $t = [IO.File]::ReadAllText($p).Replace([string][char]13, '')
  $i = $t.IndexOf($old)
  if ($i -lt 0) {
    # Already applied? Only conclude that when the ANCHOR IS GONE. Testing
    # "does the file contain the replacement" on its own is wrong whenever the
    # replacement is short or blank - a bare newline is in every file, so the
    # edit silently skips and the file ends up one line different from the
    # source it was generated from.
    if ($t.Contains($new)) { Write-Host "  skip   $rel"; return }
    throw "Anchor not found in $rel."
  }
  if ($t.IndexOf($old, $i + 1) -ge 0) { throw "Anchor is not unique in $rel." }
  $t = $t.Substring(0, $i) + $new + $t.Substring($i + $old.Length)
  [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
  Write-Host "  edit   $rel"
}
$o0 = @'
export const prisma = global.prismaClient ?? new PrismaClient();
~EOT~
'@
$n0 = @'
// TRANSACTION BUDGET. Prisma's defaults for an interactive transaction are
// maxWait 2s and timeout 5s, and nothing in this codebase overrode them. Five
// seconds sounds generous until you count round trips: a depreciation run with
// seven branches issues about twenty-nine statements inside one transaction and
// blew straight through it (P2028, "Transaction already closed"), rolling back
// and returning a generic 500. It would pass every test with one or two
// branches and fail the day a real client had seven.
//
// Set here rather than per call site so every $transaction in the codebase
// inherits it ~U+2014~ purchase bills with many lines and branch transfers have the
// same shape and the same exposure.
export const prisma = global.prismaClient ?? new PrismaClient({
  transactionOptions: { maxWait: 10_000, timeout: 60_000 },
});
~EOT~
'@
Edit-FileText 'backend/src/db.ts' $o0 $n0
$o1 = @'

      for (const [branchId, lines] of byBranch) {
~EOT~
'@
$n1 = @'

      // Accumulated across every branch and written ONCE at the end. Doing
      // these per branch multiplied the statement count by the number of
      // branches for no benefit ~U+2014~ they carry the branch's journalEntryId in
      // the row, so nothing about them needs a per-branch round trip.
      const runRows: any[] = [];
      const finishedAssetIds: string[] = [];

      for (const [branchId, lines] of byBranch) {
~EOT~
'@
Edit-FileText 'backend/src/routes/depreciationRuns.ts' $o1 $n1
$o2 = @'
        await tx.fixedAssetDepreciationRun.createMany({
          // One row per period, not per posting: an asset caught up over four
          // months writes four rows, each at its own true period, all pointing
          // at this one entry.
          data: lines.flatMap((l) => l.charges.map((c) => ({
~EOT~
'@
$n2 = @'
        // One row per period, not per posting: an asset caught up over four
        // months writes four rows, each at its own true period, all pointing
        // at this one entry.
        runRows.push(...lines.flatMap((l) => l.charges.map((c) => ({
~EOT~
'@
Edit-FileText 'backend/src/routes/depreciationRuns.ts' $o2 $n2
$o3 = @'
          }))),
        });
~EOT~
'@
$n3 = @'
          }))));
~EOT~
'@
Edit-FileText 'backend/src/routes/depreciationRuns.ts' $o3 $n3
$o4 = @'
        const finished = lines.filter((l) => l.charges[l.charges.length - 1].final).map((l) => l.asset.id);
        if (finished.length > 0) {
          await tx.fixedAsset.updateMany({
            where: { id: { in: finished } },
            data: { status: "FULLY_DEPRECIATED" },
          });
        }
~EOT~
'@
$n4 = @'
        finishedAssetIds.push(
          ...lines.filter((l) => l.charges[l.charges.length - 1].final).map((l) => l.asset.id));
~EOT~
'@
Edit-FileText 'backend/src/routes/depreciationRuns.ts' $o4 $n4
$o5 = @'
        created.push(journalEntry.id);
      }
~EOT~
'@
$n5 = @'
        created.push(journalEntry.id);
      }

      if (runRows.length > 0) {
        await tx.fixedAssetDepreciationRun.createMany({ data: runRows });
      }
      if (finishedAssetIds.length > 0) {
        await tx.fixedAsset.updateMany({
          where: { id: { in: finishedAssetIds } },
          data: { status: "FULLY_DEPRECIATED" },
        });
      }
~EOT~
'@
Edit-FileText 'backend/src/routes/depreciationRuns.ts' $o5 $n5
$o6 = @'
// GET /fixed-assets/:id ~U+2014~ one asset, with every charge posted against it.
router.get("/:id", async (req, res) => {
~EOT~
'@
$n6 = @'
// GET /fixed-assets/:id ~U+2014~ one asset, with every charge posted against it.
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

router.get("/:id", async (req, res) => {
~EOT~
'@
Edit-FileText 'backend/src/routes/fixedAssets.ts' $o6 $n6
$o7 = @'
router.get("/:id", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const a = await prisma.fixedAsset.findFirst({
    where: { id: req.params.id, organizationId, deletedAt: null },
~EOT~
'@
$n7 = @'
router.get("/:id", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  // An id that is not a uuid reaches Prisma as one anyway and comes back as
  // P2023, which the error handler turns into a 500 with a stack trace. It is
  // a client sending a bad URL, not a server fault.
  if (!UUID.test(req.params.id)) return res.status(404).json({ message: "Fixed asset not found." });

  const a = await prisma.fixedAsset.findFirst({
    where: { id: req.params.id, organizationId, deletedAt: null },
~EOT~
'@
Edit-FileText 'backend/src/routes/fixedAssets.ts' $o7 $n7
$o8 = @'
router.get("/:id/schedule", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const a = await prisma.fixedAsset.findFirst({
    where: { id: req.params.id, organizationId, deletedAt: null },
~EOT~
'@
$n8 = @'
router.get("/:id/schedule", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  // An id that is not a uuid reaches Prisma as one anyway and comes back as
  // P2023, which the error handler turns into a 500 with a stack trace. It is
  // a client sending a bad URL, not a server fault.
  if (!UUID.test(req.params.id)) return res.status(404).json({ message: "Fixed asset not found." });

  const a = await prisma.fixedAsset.findFirst({
    where: { id: req.params.id, organizationId, deletedAt: null },
~EOT~
'@
Edit-FileText 'backend/src/routes/fixedAssets.ts' $o8 $n8
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green