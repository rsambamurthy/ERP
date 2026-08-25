$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Test runner 4 of 4 - seed' -ForegroundColor Cyan

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
// Builds the Setup sheet: two organisations and everything the test pack
// needs inside them.
//
//   npm run test:seed              create or top up
//   npm run test:seed -- --print   show what exists, change nothing
//
// IDEMPOTENT. Every step looks before it creates, so re-running after a
// half-finished attempt continues rather than duplicating. That matters more
// than it sounds: the fixture resolver matches branches and items BY NAME, and
// two branches called "Test Branch D07" would make it ambiguous rather than
// wrong ~U+2014~ a failure that is annoying to diagnose.
//
// SMTP is not needed. POST /auth/register returns the OTP in the response as
// `devOtp` whenever EXPOSE_DEV_OTP is anything other than the string "false",
// which is the default. See the warning printed at the end ~U+2014~ that default is
// fine locally and is not fine on a public deployment.
//
// LOCAL ONLY by intent. It refuses to run against a host that is not
// localhost unless TEST_SEED_ALLOW_REMOTE=true, because it registers
// organisations and posts accounting policy.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:4000";
const PRINT_ONLY = process.argv.includes("--print");
const PASSWORD = process.env.TEST_SEED_PASSWORD ?? "TestPass!2026";

const GREEN = "\x1b[32m", RED = "\x1b[31m", GREY = "\x1b[90m",
      YELLOW = "\x1b[33m", BOLD = "\x1b[1m", OFF = "\x1b[0m";

let created = 0, existed = 0;
const ok = (what: string) => { created++; console.log(`  ${GREEN}+${OFF} ${what}`); };
const had = (what: string) => { existed++; console.log(`  ${GREY}. ${what} (already there)${OFF}`); };

// ---------------------------------------------------------------------------

interface Reply { status: number; body: any; }

async function call(method: string, path: string, body?: unknown, token?: string): Promise<Reply> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  return { status: res.status, body: parsed };
}

function must(r: Reply, what: string): any {
  if (r.status >= 400) {
    throw new Error(`${what} failed: HTTP ${r.status} ${r.body?.message ?? JSON.stringify(r.body)}`);
  }
  return r.body;
}

function rowsOf(body: any): any[] {
  const d = body?.data ?? body;
  return Array.isArray(d) ? d : [];
}

// ---------------------------------------------------------------------------
// the two organisations
// ---------------------------------------------------------------------------

interface OrgPlan {
  key: "A" | "B";
  businessName: string;
  email: string;
  costingMethod: "WEIGHTED_AVG" | "FIFO";
  frequency: "MONTHLY" | "QUARTERLY";
}

const ORGS: OrgPlan[] = [
  { key: "A", businessName: "Vaigai Pumps Pvt Ltd",   email: process.env.TEST_ORG_A_EMAIL ?? "test-org-a@smarterp.local", costingMethod: "WEIGHTED_AVG", frequency: "MONTHLY" },
  { key: "B", businessName: "Vaigai Exports Pvt Ltd", email: process.env.TEST_ORG_B_EMAIL ?? "test-org-b@smarterp.local", costingMethod: "FIFO",         frequency: "QUARTERLY" },
];

// name, code, state, gstin, itcEligibility. Head office first ~U+2014~ the ERP falls
// back to it whenever a branch is not named on a document.
const BRANCHES: Record<"A" | "B", Array<[string, string, string, string, string, boolean]>> = {
  A: [
    ["Chennai (Head Office)", "CHN", "33", "33AAACV1234A1Z5", "FULL", true],
    ["Test Branch D07", "TD07", "33", "33AAACV1234A1Z5", "FULL", false],
    ["Test Branch D08", "TD08", "33", "33AAACV1234A1Z5", "FULL", false],
    ["Test Branch D09", "TD09", "33", "33AAACV1234A1Z5", "FULL", false],
    ["Test Branch D10", "TD10", "33", "33AAACV1234A1Z5", "FULL", false],
    ["Test Branch D14", "TD14", "33", "33AAACV1234A1Z5", "FULL", false],
    ["Test Branch D15", "TD15", "33", "33AAACV1234A1Z5", "FULL", false],
    ["Test Branch D16", "TD16", "33", "33AAACV1234A1Z5", "FULL", false],
  ],
  B: [
    ["Chennai", "BCHN", "33", "33AAACW5678B1Z9", "FULL", true],
    // Same GSTIN as Chennai on purpose: a second place of business under one
    // registration, so transfers to it are not a supply.
    ["Tiruppur", "BTIR", "33", "33AAACW5678B1Z9", "FULL", false],
    // Separate registration in the SAME state, under s.25(2) ~U+2014~ taxable, and
    // CGST + SGST rather than IGST.
    ["Coimbatore", "BCBE", "33", "33AAACW5678B2Z8", "FULL", false],
    ["Bengaluru", "BBLR", "29", "29AAACW5678B1Z5", "FULL", false],
    // RESTRICTED so a taxable transfer to it is refused (STK-23). There is no
    // API for this field ~U+2014~ see the note where it is applied.
    ["Hyderabad", "BHYD", "36", "36AAACW5678B1Z2", "RESTRICTED", false],
  ],
};

// sku, name, itemKind, account code, hsn, taxRate, defaultAssetClass name|null
const ITEMS: Record<"A" | "B", Array<[string, string, string, string, string, number, string | null]>> = {
  A: [
    // A capitalisable item must be SERVICE ~U+2014~ that is the system's only
    // "non-stock" flag, and a STOCK line is refused for capitalisation because
    // it would put the same purchase in the register and the stock ledger.
    ["LAP-14", "Laptop 14 inch", "SERVICE", "4008", "84713010", 18, "Office equipment"],
    ["BRG-6205", "Bearing 6205", "STOCK", "1201", "84821010", 18, null],
    ["CAST-5HP", "Casting, 5HP pump body", "STOCK", "1301", "73251000", 18, null],
    ["PUMP-5HP", "Pump 5HP", "STOCK", "1303", "84137010", 18, null],
    ["INST-SVC", "Installation service", "SERVICE", "4008", "998719", 18, null],
  ],
  B: [
    ["LAP-14", "Laptop 14 inch", "SERVICE", "4008", "84713010", 18, "Office equipment"],
    ["BRG-6205", "Bearing 6205", "STOCK", "1201", "84821010", 18, null],
    ["PUMP-P1", "Pump P1 (untaxed transfer)", "STOCK", "1303", "84137010", 18, null],
    ["PUMP-P2", "Pump P2 (inter-state transfer)", "STOCK", "1303", "84137010", 18, null],
    ["PUMP-P3", "Pump P3 (intra-state transfer)", "STOCK", "1303", "84137010", 18, null],
    // No HSN at all ~U+2014~ the STK-22 blocker depends on it.
    ["GASKET-NH", "Gasket kit (no HSN)", "STOCK", "1303", "", 18, null],
  ],
};

// bpType, name, gstin, state
const PARTNERS: Array<["CUSTOMER" | "VENDOR", string, string | null, string | null]> = [
  ["VENDOR", "Sundar Systems", "33AABCS9999A1Z1", "33"],
  ["VENDOR", "Overseas Supplies Inc", null, null],
  ["CUSTOMER", "Anand Traders", "33AACCA8888B1Z2", "33"],
];

// class name, useful life, residual %, life policy note (blank = leave the life alone)
const CLASSES: Array<[string, number, number, string]> = [
  ["Office equipment", 60, 5, ""],
  ["Computers - desktops & laptops", 36, 5, ""],
  ["Motorcycles & scooters", 3, 10, "Test class ~U+2014~ short life, used to verify the end-of-life balancing figure."],
  ["Vehicles - other", 7, 10, "Test class ~U+2014~ awkward division, used to verify the residual lands exactly."],
  ["Electrical installations", 36, 5, "Test class ~U+2014~ mid-life method change."],
  ["Buildings - residential", 36, 0, "Test class ~U+2014~ WDV with no residual, to verify the refusal."],
];

// ---------------------------------------------------------------------------

async function ensureOrg(plan: OrgPlan): Promise<{ organizationId: string; token: string }> {
  console.log(`\n${BOLD}ORG-${plan.key}  ${plan.businessName}${OFF}`);

  // Already registered? Then just log in. This is what makes a re-run safe.
  const existing = await call("POST", "/auth/login", { email: plan.email, password: PASSWORD });
  if (existing.status === 200 && existing.body?.token) {
    had(`organisation (${plan.email})`);
    return { organizationId: existing.body.organizationId, token: existing.body.token };
  }

  const reg = await call("POST", "/auth/register", {
    businessName: plan.businessName, name: `Test Owner ${plan.key}`,
    email: plan.email, password: PASSWORD,
  });
  if (reg.status === 409) {
    throw new Error(
      `${plan.email} is already registered but the password did not work. ` +
      `Either set TEST_SEED_PASSWORD to the right one, or use a different email.`);
  }
  must(reg, "register");
  const organizationId: string = reg.body.organizationId;

  // No SMTP needed: the OTP comes back in the response.
  const otp: string | undefined = reg.body.devOtp;
  if (!otp) {
    // The only way this happens is EXPOSE_DEV_OTP=false. The code is still in
    // the database, so say exactly how to read it rather than just failing.
    const state = await prisma.onboardingState.findUnique({
      where: { organizationId }, select: { otpCode: true },
    });
    if (!state?.otpCode) {
      throw new Error(
        `No devOtp in the register response and no otp_code in onboarding_states. ` +
        `Set EXPOSE_DEV_OTP=true on the backend and try again.`);
    }
    console.log(`  ${YELLOW}!${OFF} devOtp suppressed; read from the database instead`);
    must(await call("POST", "/auth/verify-otp", { organizationId, otp: state.otpCode }), "verify-otp");
  } else {
    must(await call("POST", "/auth/verify-otp", { organizationId, otp }), "verify-otp");
  }

  // Manufacturing overlay, because 1301/1302/1303 and the production documents
  // only exist for organisations that pick it.
  must(await call("POST", "/onboarding/domain",
    { organizationId, domains: { MANUFACTURING: {} } }), "onboarding/domain");
  must(await call("POST", "/onboarding/provision", { organizationId }), "provision");

  const login = must(await call("POST", "/auth/login",
    { email: plan.email, password: PASSWORD }), "login after provisioning");
  ok(`organisation, verified and provisioned (${plan.email})`);
  return { organizationId, token: login.token };
}

async function ensureBranches(plan: OrgPlan, token: string) {
  const have = rowsOf(must(await call("GET", "/branches", undefined, token), "list branches"));
  for (const [name, code, stateCode, gstin, itc, isHeadOffice] of BRANCHES[plan.key]) {
    let row = have.find((b) => b.name === name);
    if (row) { had(`branch ${name}`); }
    else {
      const r = await call("POST", "/branches",
        { code, name, gstin, stateCode, isHeadOffice }, token);
      if (r.status >= 400) { console.log(`  ${RED}x${OFF} branch ${name}: ${r.body?.message}`); continue; }
      row = r.body?.data ?? r.body;
      ok(`branch ${name}`);
    }
    // itcEligibility is READ by stockTransfers.ts but neither POST /branches
    // nor PATCH /branches/:id accepts it, so there is no way to set it through
    // the API at all. Written directly here, and reported as a gap at the end.
    if (row?.id && itc !== "FULL") {
      await prisma.$executeRawUnsafe(
        `UPDATE branches SET itc_eligibility = $1 WHERE id = $2::uuid`, itc, row.id);
      console.log(`  ${YELLOW}~${OFF} ${name}: itc_eligibility set to ${itc} directly (no API for it)`);
    }
  }
}

async function ensurePartners(token: string) {
  const have = rowsOf(must(await call("GET", "/business-partners", undefined, token), "list partners"));
  for (const [bpType, name, gstin, stateCode] of PARTNERS) {
    if (have.some((p) => p.name === name)) { had(`partner ${name}`); continue; }
    const r = await call("POST", "/business-partners", { bpType, name, gstin, stateCode }, token);
    if (r.status >= 400) { console.log(`  ${RED}x${OFF} partner ${name}: ${r.body?.message}`); continue; }
    ok(`partner ${name}`);
  }
}

async function ensureItems(plan: OrgPlan, token: string) {
  const accounts = rowsOf(must(await call("GET", "/accounts", undefined, token), "list accounts"));
  const byCode = new Map(accounts.map((a: any) => [a.accountCode, a.id]));
  const classes = rowsOf(must(await call("GET", "/asset-classes", undefined, token), "list asset classes"));
  const classByName = new Map(classes.map((c: any) => [c.name, c.id]));
  const have = rowsOf(must(await call("GET", "/items", undefined, token), "list items"));

  for (const [sku, name, itemKind, acct, hsnCode, taxRate, className] of ITEMS[plan.key]) {
    if (have.some((i) => i.sku === sku)) { had(`item ${sku}`); continue; }
    const stockAccountId = byCode.get(acct);
    if (!stockAccountId) {
      console.log(`  ${RED}x${OFF} item ${sku}: no account ${acct} in this organisation`);
      continue;
    }
    const r = await call("POST", "/items", {
      sku, name, uom: "NOS", itemKind, stockAccountId,
      hsnCode: hsnCode || null, taxRate,
      ...(className ? { defaultAssetClassId: classByName.get(className) } : {}),
    }, token);
    if (r.status >= 400) { console.log(`  ${RED}x${OFF} item ${sku}: ${r.body?.message}`); continue; }
    ok(`item ${sku}`);
  }
}

async function configureClasses(token: string) {
  const classes = rowsOf(must(await call("GET", "/asset-classes", undefined, token), "list asset classes"));
  for (const [name, life, residual, note] of CLASSES) {
    const cls = classes.find((c: any) => c.name === name);
    if (!cls) { console.log(`  ${RED}x${OFF} asset class '${name}' not found`); continue; }
    const sameLife = Number(cls.defaultUsefulLifeMonths) === life;
    const sameResidual = Math.abs(Number(cls.defaultResidualPct) - residual) < 0.001;
    if (sameLife && sameResidual) { had(`asset class ${name}`); continue; }
    // A life that departs from the Schedule II life is refused without a
    // justification ~U+2014~ Part A paragraph 3(i), in both directions.
    const r = await call("PATCH", `/depreciation-policy/classes/${cls.id}`, {
      usefulLifeMonths: life, residualPct: residual,
      ...(note ? { lifePolicyNote: note } : {}),
    }, token);
    if (r.status >= 400) { console.log(`  ${RED}x${OFF} class ${name}: ${r.body?.message}`); continue; }
    ok(`asset class ${name} ~U+2014~ ${life}m, ${residual}% residual`);
  }
}

async function setPolicy(plan: OrgPlan, token: string) {
  must(await call("PATCH", "/depreciation-policy",
    { frequency: plan.frequency, capitalisationThreshold: 5000 }, token), "policy");
  ok(`frequency ${plan.frequency}, capitalisation threshold 5,000.00`);

  must(await call("POST", "/items/costing-method",
    { costingMethod: plan.costingMethod }, token), "costing method");
  ok(`costing method ${plan.costingMethod}`);

  if (plan.key !== "A") return;

  // Method is organisation policy with a per-class override history, not a
  // field on the class. Each of these is one row in that history.
  const classes = rowsOf(must(await call("GET", "/asset-classes", undefined, token), "list asset classes"));
  const idOf = (n: string) => classes.find((c: any) => c.name === n)?.id;
  const changes: Array<[string, string, string | undefined, string]> = [
    ["SLM", "2026-04", undefined, "Test baseline ~U+2014~ straight line across the organisation."],
    ["WDV", "2026-04", idOf("Computers - desktops & laptops"), "Test class ~U+2014~ WDV verification."],
    ["WDV", "2026-04", idOf("Buildings - residential"), "Test class ~U+2014~ WDV with no residual."],
    ["WDV", "2026-06", idOf("Electrical installations"), "Test class ~U+2014~ mid-life method change from June."],
  ];
  for (const [toMethod, effectiveMonth, assetClassId, reason] of changes) {
    const r = await call("POST", "/depreciation-policy/change",
      { toMethod, effectiveMonth, reason, ...(assetClassId ? { assetClassId } : {}) }, token);
    if (r.status >= 400) {
      // A repeat of the same change is not an error worth stopping for.
      console.log(`  ${GREY}. policy ${toMethod} from ${effectiveMonth}: ${r.body?.message}${OFF}`);
      continue;
    }
    ok(`policy ${toMethod} from ${effectiveMonth}${assetClassId ? " (one class)" : " (organisation)"}`);
  }
}

// ---------------------------------------------------------------------------

async function printOnly() {
  for (const plan of ORGS) {
    const login = await call("POST", "/auth/login", { email: plan.email, password: PASSWORD });
    if (login.status !== 200) {
      console.log(`\n${BOLD}ORG-${plan.key}${OFF}  ${RED}not registered${OFF} (${plan.email})`);
      continue;
    }
    const token = login.body.token;
    console.log(`\n${BOLD}ORG-${plan.key}  ${plan.businessName}${OFF}  ${GREY}${login.body.organizationId}${OFF}`);
    for (const [label, path, field] of [
      ["branches", "/branches", "name"],
      ["items", "/items", "sku"],
      ["partners", "/business-partners", "name"],
    ] as const) {
      const list = rowsOf((await call("GET", path, undefined, token)).body);
      console.log(`  ${label}: ${list.map((x: any) => x[field]).join(", ") || GREY + "none" + OFF}`);
    }
  }
}

async function main() {
  console.log(`${BOLD}SmartERP ~U+2014~ test fixture seed${OFF}`);
  console.log(`${GREY}backend ${BASE}${OFF}`);

  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(BASE);
  if (!local && process.env.TEST_SEED_ALLOW_REMOTE !== "true") {
    console.log(`\n${RED}${BOLD}Refusing to seed ${BASE}${OFF}`);
    console.log(`This registers organisations and posts accounting policy, so it is meant for a`);
    console.log(`local backend. Set TEST_SEED_ALLOW_REMOTE=true if you really mean to.`);
    process.exitCode = 1;
    return;
  }

  if (PRINT_ONLY) { await printOnly(); await prisma.$disconnect(); return; }

  for (const plan of ORGS) {
    const { token } = await ensureOrg(plan);
    await ensureBranches(plan, token);
    await ensurePartners(token);
    await configureClasses(token);
    await ensureItems(plan, token);
    await setPolicy(plan, token);
  }

  console.log(`\n${BOLD}${"=".repeat(64)}${OFF}`);
  console.log(`  ${GREEN}created ${created}${OFF}   ${GREY}already there ${existed}${OFF}`);
  console.log(`\n${BOLD}Put these in your environment before running the pack:${OFF}`);
  for (const plan of ORGS) {
    console.log(`  TEST_ORG_${plan.key}_EMAIL=${plan.email}`);
    console.log(`  TEST_ORG_${plan.key}_PASSWORD=${PASSWORD}`);
  }

  console.log(`\n${YELLOW}${BOLD}Two things worth acting on${OFF}`);
  console.log(`${YELLOW}1.${OFF} EXPOSE_DEV_OTP defaults to ON. That is what made this seed possible without`);
  console.log(`   SMTP, and it also means POST /auth/forgot-password returns the reset code to`);
  console.log(`   an unauthenticated caller. On any public deployment, set EXPOSE_DEV_OTP=false.`);
  console.log(`${YELLOW}2.${OFF} branches.itc_eligibility has no API. This script wrote it directly. Until a`);
  console.log(`   route accepts it, no user can mark a branch as restricted ~U+2014~ so the refusal in`);
  console.log(`   stockTransfers.ts can never fire in production.`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(`\n${RED}${e?.message ?? e}${OFF}`);
  await prisma.$disconnect();
  process.exit(1);
});
'@
Set-FileText 'backend/tests/seed.ts' $f0
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green