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
// wrong — a failure that is annoying to diagnose.
//
// SMTP is not needed. POST /auth/register returns the OTP in the response as
// `devOtp` whenever EXPOSE_DEV_OTP is anything other than the string "false",
// which is the default. See the warning printed at the end — that default is
// fine locally and is not fine on a public deployment.
//
// LOCAL ONLY by intent. It refuses to run against a host that is not
// localhost unless TEST_SEED_ALLOW_REMOTE=true, because it registers
// organisations and posts accounting policy.

import { PrismaClient } from "@prisma/client";
import { freshOrgs, orgCreds, readTestOrgs, writeTestOrgs, ORGS_FILE } from "./testOrgs";

const prisma = new PrismaClient();

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:4000";
const PRINT_ONLY = process.argv.includes("--print");
const REUSE = process.argv.includes("--reuse");
const PASSWORD = process.env.TEST_SEED_PASSWORD ?? "TestPass!2026";

// A FRESH PAIR EVERY TIME, unless told otherwise. See testOrgs.ts for why:
// the pack asserts exact figures, and those hold only where nothing else has
// ever happened. Nothing is deleted - the previous test organisations are
// simply left behind, which is what makes this safe against a real database.
function chooseOrgs(): { A: string; B: string } {
  const existing = readTestOrgs();
  // A leftover TEST_ORG_A_EMAIL must not quietly win. It did once, and the run
  // it produced looked fine and meant nothing. Say so and carry on.
  if (process.env.TEST_ORG_A_EMAIL || process.env.TEST_ORG_B_EMAIL) {
    console.log(`${YELLOW}!${OFF} TEST_ORG_A_EMAIL / TEST_ORG_B_EMAIL are set and are being ` +
                `IGNORED. Pass --env to use them.`);
  }
  if (process.argv.includes("--env")) {
    const A = process.env.TEST_ORG_A_EMAIL, B = process.env.TEST_ORG_B_EMAIL;
    if (!A || !B) throw new Error("--env needs both TEST_ORG_A_EMAIL and TEST_ORG_B_EMAIL.");
    console.log(`${YELLOW}--env:${OFF} ${A} / ${B}`);
    return { A, B };
  }
  if (REUSE && existing) {
    console.log(`${YELLOW}--reuse:${OFF} keeping ${existing.A} / ${existing.B}`);
    console.log(`${YELLOW}!${OFF} figures already posted in these organisations still ` +
                `count. Drop --reuse for a run whose numbers can be trusted.`);
    return existing;
  }
  const made = freshOrgs(PASSWORD);
  writeTestOrgs(made);
  console.log(`${GREEN}+${OFF} new organisations for this run: ${made.A} / ${made.B}`);
  return made;
}

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
  // email is filled in by chooseOrgs() at the top of main().
  { key: "A", businessName: "Vaigai Pumps Pvt Ltd",   email: "", costingMethod: "WEIGHTED_AVG", frequency: "MONTHLY" },
  { key: "B", businessName: "Vaigai Exports Pvt Ltd", email: "", costingMethod: "FIFO",         frequency: "QUARTERLY" },
];

// name, code, state, gstin, itcEligibility. Head office first — the ERP falls
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
    // Separate registration in the SAME state, under s.25(2) — taxable, and
    // CGST + SGST rather than IGST.
    ["Coimbatore", "BCBE", "33", "33AAACW5678B2Z8", "FULL", false],
    ["Bengaluru", "BBLR", "29", "29AAACW5678B1Z5", "FULL", false],
    // RESTRICTED so a taxable transfer to it is refused (STK-23). There is no
    // API for this field — see the note where it is applied.
    ["Hyderabad", "BHYD", "36", "36AAACW5678B1Z2", "RESTRICTED", false],
  ],
};

// sku, name, itemKind, account code, hsn, taxRate, defaultAssetClass name|null
const ITEMS: Record<"A" | "B", Array<[string, string, string, string, string, number, string | null]>> = {
  A: [
    // A capitalisable item must be SERVICE — that is the system's only
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
    // No HSN at all — the STK-22 blocker depends on it.
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
  ["Motorcycles & scooters", 3, 10, "Test class — short life, used to verify the end-of-life balancing figure."],
  ["Vehicles - other", 7, 10, "Test class — awkward division, used to verify the residual lands exactly."],
  ["Electrical installations", 36, 5, "Test class — mid-life method change."],
  ["Buildings - residential", 36, 0, "Test class — WDV with no residual, to verify the refusal."],
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

  // BOTH overlays. Manufacturing brings 1301/1302/1303 and the production
  // documents; TRADING brings 1201 Inventory, which the trading items need and
  // which is NOT part of the core chart — a manufacturing-only org has no 1201
  // at all, and every stock item pointed at it fails to save.
  must(await call("POST", "/onboarding/domain",
    { organizationId, domains: { TRADING: {}, MANUFACTURING: {} } }), "onboarding/domain");
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
    // justification — Part A paragraph 3(i), in both directions.
    const r = await call("PATCH", `/depreciation-policy/classes/${cls.id}`, {
      usefulLifeMonths: life, residualPct: residual,
      ...(note ? { lifePolicyNote: note } : {}),
    }, token);
    if (r.status >= 400) { console.log(`  ${RED}x${OFF} class ${name}: ${r.body?.message}`); continue; }
    ok(`asset class ${name} — ${life}m, ${residual}% residual`);
  }
}

// Re-runs domain selection and provisioning. Both are idempotent, and both
// have to happen again for an organisation created before a missing template
// was inserted: provisioning COPIES coa_templates at the moment it runs, so an
// org provisioned against an incomplete chart stays incomplete for ever unless
// it is re-provisioned. This is what repairs the missing 1401-1455 / 4020 block.
async function reprovision(organizationId: string) {
  const d = await call("POST", "/onboarding/domain",
    { organizationId, domains: { TRADING: {}, MANUFACTURING: {} } });
  if (d.status >= 400) {
    // Refused once a journal entry has been posted (domain_locked_at). Nothing
    // to repair at that point anyway.
    console.log(`  ${GREY}. domains: ${d.body?.message}${OFF}`);
  }
  const p = await call("POST", "/onboarding/provision", { organizationId });
  if (p.status >= 400) {
    console.log(`  ${RED}x${OFF} re-provision: ${p.body?.message}`);
    return;
  }
  ok("re-provisioned (fills in any accounts and asset classes that were missing)");
}

// Frequency, threshold and costing method. Runs BEFORE items are created:
// POST /items refuses outright until the organisation has a costing method,
// and the failure message does not say which setting is missing.
async function setBasics(plan: OrgPlan, token: string) {
  must(await call("PATCH", "/depreciation-policy",
    { frequency: plan.frequency, capitalisationThreshold: 5000 }, token), "policy");
  ok(`frequency ${plan.frequency}, capitalisation threshold 5,000.00`);

  // Set ONCE, permanently: every ItemStock and StockLot row that follows is
  // computed under it, so the route refuses to change it and there is no
  // defined way to migrate an org's stock history from one method to the
  // other. Read before writing, or a second run dies on a 409.
  const cur = must(await call("GET", "/items/costing-method", undefined, token), "read costing method");
  const already: string | null = cur?.data?.costingMethod ?? null;
  if (already === plan.costingMethod) {
    had(`costing method ${plan.costingMethod}`);
  } else if (already) {
    throw new Error(
      `ORG-${plan.key} is on ${already} but this plan needs ${plan.costingMethod}, and the ` +
      `costing method cannot be changed once set. Register a fresh organisation under a ` +
      `different TEST_ORG_${plan.key}_EMAIL, or delete this one from the database.`);
  } else {
    must(await call("POST", "/items/costing-method",
      { costingMethod: plan.costingMethod }, token), "costing method");
    ok(`costing method ${plan.costingMethod}`);
  }
}

// Method is organisation policy with a per-class override history, not a field
// on the class.
//
// The history is rebuilt from scratch each run. Withdrawing a change is only
// possible before anything has posted under it, which is exactly the state a
// freshly seeded org is in, and rebuilding is far easier to reason about than
// reconciling whatever rows a half-finished earlier run left behind.
async function setDepPolicy(plan: OrgPlan, token: string) {
  if (plan.key !== "A") return;

  const current = must(await call("GET", "/depreciation-policy", undefined, token), "read policy");
  const existing: any[] = current?.data?.changes ?? [];
  for (const c of existing) {
    const r = await call("DELETE", `/depreciation-policy/change/${c.id}`, undefined, token);
    if (r.status >= 400) {
      console.log(`  ${GREY}. could not withdraw the ${c.toMethod} change dated ${c.effectiveMonth}: ${r.body?.message}${OFF}`);
    } else {
      console.log(`  ${GREY}. withdrew ${c.toMethod} from ${String(c.effectiveMonth).slice(0, 7)}${OFF}`);
    }
  }

  const classes = rowsOf(must(await call("GET", "/asset-classes", undefined, token), "list asset classes"));
  const idOf = (n: string) => classes.find((c: any) => c.name === n)?.id;

  // [method, effectiveMonth, class name or null for the whole organisation, reason]
  const changes: Array<[string, string, string | null, string]> = [
    ["SLM", "2026-04", null, "Test baseline - straight line across the organisation."],
    ["WDV", "2026-04", "Computers - desktops & laptops", "Test class - WDV verification."],
    ["WDV", "2026-04", "Buildings - residential", "Test class - WDV with no residual."],
    ["WDV", "2026-06", "Electrical installations", "Test class - mid-life method change from June."],
  ];

  for (const [toMethod, effectiveMonth, className, reason] of changes) {
    let assetClassId: string | undefined;
    if (className) {
      assetClassId = idOf(className);
      // THE BUG THIS GUARD EXISTS FOR: when the class could not be resolved,
      // the earlier version simply omitted assetClassId — and a change with no
      // assetClassId applies to the WHOLE ORGANISATION. A missing asset class
      // silently became an organisation-wide method switch. Refuse instead.
      if (!assetClassId) {
        console.log(`  ${RED}x${OFF} policy ${toMethod} from ${effectiveMonth}: asset class ` +
          `'${className}' not found, so this change is SKIPPED. It must never be posted ` +
          `without a class - that would switch the whole organisation.`);
        continue;
      }
    }
    const r = await call("POST", "/depreciation-policy/change",
      { toMethod, effectiveMonth, reason, ...(assetClassId ? { assetClassId } : {}) }, token);
    if (r.status >= 400) {

      console.log(`  ${GREY}. policy ${toMethod} from ${effectiveMonth}: ${r.body?.message}${OFF}`);
      continue;
    }
    ok(`policy ${toMethod} from ${effectiveMonth}${className ? ` (${className})` : " (organisation)"}`);
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
  console.log(`${BOLD}SmartERP — test fixture seed${OFF}`);
  console.log(`${GREY}backend ${BASE}${OFF}`);

  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(BASE);
  if (!local && process.env.TEST_SEED_ALLOW_REMOTE !== "true") {
    console.log(`\n${RED}${BOLD}Refusing to seed ${BASE}${OFF}`);
    console.log(`This registers organisations and posts accounting policy, so it is meant for a`);
    console.log(`local backend. Set TEST_SEED_ALLOW_REMOTE=true if you really mean to.`);
    process.exitCode = 1;
    return;
  }

  if (PRINT_ONLY) {
    for (const plan of ORGS) plan.email = orgCreds(plan.key).email;
    await printOnly();
    await prisma.$disconnect();
    return;
  }

  const chosen = chooseOrgs();
  for (const plan of ORGS) plan.email = chosen[plan.key];

  for (const plan of ORGS) {
    const { organizationId, token } = await ensureOrg(plan);
    // Order matters. Re-provision first so the chart is complete, then the
    // costing method (items are refused without it), then everything else.
    await reprovision(organizationId);
    await setBasics(plan, token);
    await ensureBranches(plan, token);
    await ensurePartners(token);
    await configureClasses(token);
    await ensureItems(plan, token);
    await setDepPolicy(plan, token);
  }

  console.log(`\n${BOLD}${"=".repeat(64)}${OFF}`);
  console.log(`  ${GREEN}created ${created}${OFF}   ${GREY}already there ${existed}${OFF}`);
  // Nothing to copy into an environment: the pack reads the same file. Shown
  // so a failure two minutes from now can be traced to the right rows.
  console.log(`\n${BOLD}This run drives:${OFF}`);
  for (const plan of ORGS) console.log(`  ORG-${plan.key}  ${plan.email}`);
  console.log(`${GREY}recorded in ${ORGS_FILE}${OFF}`);

  console.log(`\n${YELLOW}${BOLD}Two things worth acting on${OFF}`);
  console.log(`${YELLOW}1.${OFF} EXPOSE_DEV_OTP defaults to ON. That is what made this seed possible without`);
  console.log(`   SMTP, and it also means POST /auth/forgot-password returns the reset code to`);
  console.log(`   an unauthenticated caller. On any public deployment, set EXPOSE_DEV_OTP=false.`);
  console.log(`${YELLOW}2.${OFF} branches.itc_eligibility has no API. This script wrote it directly. Until a`);
  console.log(`   route accepts it, no user can mark a branch as restricted — so the refusal in`);
  console.log(`   stockTransfers.ts can never fire in production.`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(`\n${RED}${e?.message ?? e}${OFF}`);
  await prisma.$disconnect();
  process.exit(1);
});
