$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Test runner 3 of 4 - driver' -ForegroundColor Cyan

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
// The driver. Reads the workbook, runs the steps, writes the results back.
//
//   npm run test:dep              every DEP- case
//   npm run test:dep -- DEP-07    one case
//   npm run test:dep -- --dry     resolve fixtures and print the plan, call nothing
//
// PHASE ORDER, not case order. A depreciation run posts the whole ORGANISATION
// for one period, so the six cases that each say "post April" are one posting
// seen six ways. Running them in case order would post April once and get 409
// five times. So: every asset is capitalised (phase 1), then each period is
// posted ONCE and every case asserts its own branch's slice.
//
// That is also why postedPeriods is global ~U+2014~ a case asserts against whichever
// run actually wrote the entry, whether or not that run was its own step.

import ExcelJS from "exceljs";
import {
  CONFIG, prisma, request, readWorkbook, resolveFixtures, Step, Reply,
} from "./harness";
import {
  Ctx, evaluate, isPre, substitute, substituteDeep, evalPath, AssertionError,
} from "./assertions";

type Outcome = "PASS" | "FAIL" | "MANUAL" | "SKIPPED";

interface Result {
  step: Step; outcome: Outcome; detail: string; ms: number;
}

const GREEN = "\x1b[32m", RED = "\x1b[31m", GREY = "\x1b[90m",
      YELLOW = "\x1b[33m", BOLD = "\x1b[1m", OFF = "\x1b[0m";

function placeholdersIn(steps: Step[]): Set<string> {
  const found = new Set<string>();
  const scan = (t: string) => {
    for (const m of t.matchAll(/\{\{([^}]+)\}\}/g)) {
      const name = m[1].trim();
      // A capture is bound at run time; only UPPER_SNAKE names are fixtures.
      if (/^[A-Z][A-Z0-9_]*$/.test(name)) found.add(name);
    }
  };
  for (const s of steps) {
    scan(JSON.stringify(s.body ?? {}));
    scan(s.path ?? "");
    s.asserts.forEach(scan);
    Object.values(s.capture).forEach(scan);
  }
  return found;
}

async function runStep(step: Step, ctx: Ctx, postedPeriods: Map<string, Reply>): Promise<Result> {
  const t0 = Date.now();
  const done = (outcome: Outcome, detail: string): Result =>
    ({ step, outcome, detail, ms: Date.now() - t0 });

  try {
    ctx.step = step;
    ctx.reply = null;

    // ---- assertions marked `pre` see the state BEFORE the call
    const pre = step.asserts.filter(isPre);
    const post = step.asserts.filter((a) => !isPre(a));
    const notes: string[] = [];
    for (const a of pre) notes.push(await evaluate(a, ctx));

    // ---- the call
    if (step.method && step.path) {
      const path = substitute(step.path, ctx);

      // A period posting may carry an array ~U+2014~ "post these, in order". Each
      // period is posted at most once across the whole suite.
      const periods: string[] | null =
        path === "/depreciation-runs/post" && Array.isArray(step.body?.periodStart)
          ? step.body.periodStart
          : path === "/depreciation-runs/post" && typeof step.body?.periodStart === "string"
            ? [step.body.periodStart]
            : null;

      if (periods) {
        for (const p of periods) {
          if (postedPeriods.has(p)) { ctx.reply = postedPeriods.get(p)!; continue; }
          const reply = await request(step.login, "POST", path, { periodStart: p });
          ctx.reply = reply;
          // A 409 is a legitimate expectation (DEP-17) ~U+2014~ only record a success.
          if (reply.status === 200) postedPeriods.set(p, reply);
          else if (step.status === 200) {
            return done("FAIL", `POST ${p} returned ${reply.status}: ${reply.body?.message ?? ""}`);
          }
        }
      } else {
        ctx.reply = await request(step.login, step.method, path,
                                  step.body ? substituteDeep(step.body, ctx) : undefined);
      }

      if (step.status != null && ctx.reply && ctx.reply.status !== step.status && !periods) {
        return done("FAIL",
          `HTTP ${ctx.reply.status}, expected ${step.status}` +
          (ctx.reply.body?.message ? ` ~U+2014~ ${ctx.reply.body.message}` : ""));
      }
    }

    // ---- captures
    for (const [name, expr] of Object.entries(step.capture)) {
      let root = ctx.reply?.body;
      let path = expr;
      const pm = /^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)\s*::\s*(.+)$/s.exec(expr);
      if (pm) {
        // POST /purchase-bills returns the bill, not the asset it created, so
        // the asset is looked up rather than read off the response.
        root = (await request(step.login, pm[1], substitute(pm[2], ctx))).body;
        path = pm[3].trim();
      }
      const value = evalPath(root, substitute(path, ctx));
      if (value === undefined || value === null) {
        return done("FAIL", `capture ${name}: ${path} resolved to nothing`);
      }
      ctx.captures[name] = value;
      ctx.captures[`${step.caseId}.${name}`] = value;   // reachable from other cases
    }

    // ---- assertions
    let manual = 0;
    for (const a of post) {
      const r = await evaluate(a, ctx);
      if (r === "MANUAL") manual++; else notes.push(r);
    }
    if (manual > 0 && notes.length === 0) return done("MANUAL", "needs a human or Playwright");
    return done("PASS", notes.join("; ") || "called, nothing asserted");
  } catch (err: any) {
    const msg = err instanceof AssertionError ? err.message : (err?.message ?? String(err));
    return done("FAIL", msg);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const only = args.filter((a) => !a.startsWith("--"));

  console.log(`${BOLD}SmartERP ~U+2014~ depreciation test run${OFF}`);
  console.log(`${GREY}workbook ${CONFIG.workbook}   backend ${CONFIG.baseUrl}${OFF}\n`);

  const { wb, steps: all } = await readWorkbook();
  let steps = all.filter((s) => s.caseId.startsWith("DEP-") && s.auto !== "TBD");
  if (only.length) steps = steps.filter((s) => only.some((o) => s.key.startsWith(o)));
  if (steps.length === 0) { console.log("Nothing to run."); return; }

  // phase first, then case, then step ~U+2014~ see the note at the top
  steps.sort((a, b) =>
    a.phase - b.phase ||
    a.caseId.localeCompare(b.caseId) ||
    a.stepNo - b.stepNo);

  // Built-ins are bound here rather than looked up, and must not be reported
  // as missing setup.
  const now = new Date();
  const builtIns: Record<string, string> = {
    CURRENT_MONTH_START:
      `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`,
  };
  const wanted = placeholdersIn(steps);
  for (const k of Object.keys(builtIns)) wanted.delete(k);

  const { values: resolved, missing } = await resolveFixtures(wanted);
  const fixtures = { ...resolved, ...builtIns };
  if (missing.length) {
    console.log(`${RED}${BOLD}SETUP INCOMPLETE ~U+2014~ ${missing.length} fixture(s) could not be resolved${OFF}`);
    for (const m of missing) console.log(`  ${RED}x${OFF} ${m}`);
    console.log(`\n${GREY}Create these from the Setup sheet, then run again. Nothing was called.${OFF}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${GREEN}v${OFF} ${Object.keys(fixtures).length} fixtures resolved\n`);

  if (dry) {
    let phase = 0;
    for (const s of steps) {
      if (s.phase !== phase) { phase = s.phase; console.log(`${BOLD}-- phase ${phase}${OFF}`); }
      console.log(`  ${s.key.padEnd(11)} ${(s.method ?? "").padEnd(6)} ${s.path ?? "(no call)"}`);
    }
    return;
  }

  const postedPeriods = new Map<string, Reply>();
  const ctx: Ctx = { step: steps[0], reply: null, captures: {}, fixtures, postedPeriods };
  const results: Result[] = [];

  let phase = 0;
  for (const step of steps) {
    if (step.phase !== phase) {
      phase = step.phase;
      const label = ["", "capitalise", "post April", "post May", "post June",
                     "post July / catch-up", "later periods", "controls"][phase] ?? `phase ${phase}`;
      console.log(`\n${BOLD}-- phase ${phase}: ${label}${OFF}`);
    }
    const r = await runStep(step, ctx, postedPeriods);
    results.push(r);
    const mark = r.outcome === "PASS" ? `${GREEN}v${OFF}`
      : r.outcome === "FAIL" ? `${RED}x${OFF}`
      : r.outcome === "MANUAL" ? `${YELLOW}~${OFF}` : `${GREY}-${OFF}`;
    console.log(`  ${mark} ${step.key.padEnd(11)} ${GREY}${step.action.split("\n")[0].slice(0, 58)}${OFF}`);
    if (r.outcome === "FAIL") console.log(`      ${RED}${r.detail}${OFF}`);
    else if (r.detail && r.outcome === "PASS") console.log(`      ${GREY}${r.detail.slice(0, 110)}${OFF}`);
    if (r.outcome === "FAIL" && CONFIG.stopOnFail) break;
  }

  // ---- report
  const by = (o: Outcome) => results.filter((r) => r.outcome === o).length;
  console.log(`\n${BOLD}${"=".repeat(64)}${OFF}`);
  console.log(`  ${GREEN}pass ${by("PASS")}${OFF}   ${RED}fail ${by("FAIL")}${OFF}   ` +
              `${YELLOW}manual ${by("MANUAL")}${OFF}   ${GREY}skipped ${by("SKIPPED")}${OFF}` +
              `   of ${results.length}`);
  const failed = results.filter((r) => r.outcome === "FAIL");
  if (failed.length) {
    console.log(`\n${BOLD}Failures${OFF}`);
    for (const f of failed) {
      console.log(`  ${RED}${f.step.key}${OFF}  ${f.step.caseTitle}`);
      console.log(`    ${f.detail}`);
      if (f.step.note) console.log(`    ${GREY}note: ${f.step.note}${OFF}`);
    }
  }

  // ---- write the outcome back into the workbook, so the pack a person reads
  //      and the suite a machine runs report in the same place
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  for (const r of results) {
    if (!r.step.sheet || !r.step.row) continue;
    const ws = wb.getWorksheet(r.step.sheet);
    if (!ws) continue;
    const row = ws.getRow(r.step.row);
    row.getCell(11).value = r.outcome === "PASS" ? "Pass"
      : r.outcome === "FAIL" ? "Fail" : "Not run";
    row.getCell(12).value = `${stamp} ~U+00B7~ ${r.detail}`.slice(0, 500);
    row.commit();
  }
  await wb.xlsx.writeFile(CONFIG.outWorkbook);
  console.log(`\n${GREY}Results written to ${CONFIG.outWorkbook}${OFF}`);

  await prisma.$disconnect();
  if (failed.length) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
'@
Set-FileText 'backend/tests/runCases.ts' $f0
$f1 = @'
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    // The parent pins rootDir to src and lib to ES2020, both of which are
    // right for the server and wrong here: these files live outside src, and
    // the runner uses global fetch (Node 18+) plus a few ES2021 conveniences.
    // Nothing here is ever compiled into dist ~U+2014~ the parent's include list is
    // src/**/*.ts, so `npm run build` and the Railway deploy never see it.
    "rootDir": "..",
    "lib": ["ES2022"],
    "target": "ES2022",
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["**/*.ts"]
}
'@
Set-FileText 'backend/tests/tsconfig.json' $f1
$o0 = @'
    "create-admin": "ts-node scripts/create-admin.ts"
  },
'@
$n0 = @'
    "create-admin": "ts-node scripts/create-admin.ts",
    "test:dep": "ts-node tests/runCases.ts",
    "test:dep:dry": "ts-node tests/runCases.ts --dry",
    "test:seed": "ts-node tests/seed.ts"
  },
'@
Edit-FileText 'backend/package.json' $o0 $n0
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green