$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Test runner 1 of 4 - harness' -ForegroundColor Cyan

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
  [IO.File]::WriteAllText($p, (Decode $text).Replace([string][char]13, ''), (New-Object Text.UTF8Encoding $false))
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
// Test harness ~U+2014~ HTTP client, fixture resolution, and workbook reading.
//
// The suite is driven by SmartERP-Test-Scenarios.xlsx rather than by cases
// written in TypeScript. That is deliberate: the workbook is what a person
// reads when they run the pack by hand, and a second copy of the same
// expectations in code is a second copy that can disagree with the first.
//
// ACTIONS go over HTTP against a running backend, because that is what a user
// actually does. ASSERTIONS go straight to Postgres via Prisma, because a
// journal entry has no `referenceId` column and no endpoint returns "the
// ledger effect of this document" ~U+2014~ the database is the only place the real
// answer lives.

import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export const CONFIG = {
  baseUrl: process.env.TEST_BASE_URL ?? "http://localhost:4000",
  workbook: process.env.TEST_WORKBOOK ?? "tests/SmartERP-Test-Scenarios.xlsx",
  outWorkbook: process.env.TEST_WORKBOOK_OUT ?? "tests/SmartERP-Test-Results.xlsx",
  // Two logins because the pack spans two organisations, and organizationId
  // is taken from the token ~U+2014~ not from the request ~U+2014~ for anyone who is not a
  // platform admin. See middleware/auth.ts resolveOrgId.
  orgA: { email: process.env.TEST_ORG_A_EMAIL ?? "", password: process.env.TEST_ORG_A_PASSWORD ?? "" },
  orgB: { email: process.env.TEST_ORG_B_EMAIL ?? "", password: process.env.TEST_ORG_B_PASSWORD ?? "" },
  // A step whose assertions are all `manual:` is reported, not run.
  stopOnFail: process.env.TEST_STOP_ON_FAIL === "true",
};

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export interface Reply { status: number; body: any; }

const tokens: Record<string, string> = {};
// The login reply carries organizationId at the top level, so ORG_A / ORG_B
// need no extra call.
const loginBody: Record<string, any> = {};

export async function login(org: "A" | "B"): Promise<string> {
  if (tokens[org]) return tokens[org];
  const creds = org === "A" ? CONFIG.orgA : CONFIG.orgB;
  if (!creds.email) {
    throw new Error(
      `No credentials for ORG-${org}. Set TEST_ORG_${org}_EMAIL and TEST_ORG_${org}_PASSWORD.`,
    );
  }
  const res = await fetch(`${CONFIG.baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (res.status !== 200 || !body?.token) {
    throw new Error(`Login failed for ORG-${org}: ${res.status} ${JSON.stringify(body)}`);
  }
  if (!body.organizationId) {
    throw new Error(
      `ORG-${org} login succeeded but the user belongs to no organisation ~U+2014~ ` +
      `a platform-admin login cannot drive this pack.`);
  }
  tokens[org] = body.token;
  loginBody[org] = body;
  return body.token;
}

export async function request(
  org: "A" | "B", method: string, path: string, body?: unknown,
): Promise<Reply> {
  const token = await login(org);
  const res = await fetch(`${CONFIG.baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  return { status: res.status, body: parsed };
}

// ---------------------------------------------------------------------------
// FIXTURES
//
// Resolved by NATURAL KEY against the running system rather than copied out of
// the workbook by hand. Thirty ids transcribed into a spreadsheet is thirty
// chances to paste the wrong one, and the error it produces ("branch not in
// this organisation") tells you nothing about which row was wrong.
//
// Anything that cannot be resolved is reported as a SETUP failure naming what
// to create, which is far more useful than a step failing later for a reason
// that looks unrelated.
// ---------------------------------------------------------------------------

type FixtureSpec = { org: "A" | "B"; kind: string; match: string };

export const FIXTURE_SPECS: Record<string, FixtureSpec> = {
  BR_A_CHN: { org: "A", kind: "branch", match: "Chennai" },
  BR_A_D07: { org: "A", kind: "branch", match: "Test Branch D07" },
  BR_A_D08: { org: "A", kind: "branch", match: "Test Branch D08" },
  BR_A_D09: { org: "A", kind: "branch", match: "Test Branch D09" },
  BR_A_D10: { org: "A", kind: "branch", match: "Test Branch D10" },
  BR_A_D14: { org: "A", kind: "branch", match: "Test Branch D14" },
  BR_A_D15: { org: "A", kind: "branch", match: "Test Branch D15" },
  BR_A_D16: { org: "A", kind: "branch", match: "Test Branch D16" },
  BR_B_CHN: { org: "B", kind: "branch", match: "Chennai" },
  BR_B_TIR: { org: "B", kind: "branch", match: "Tiruppur" },
  BR_B_CBE: { org: "B", kind: "branch", match: "Coimbatore" },
  BR_B_BLR: { org: "B", kind: "branch", match: "Bengaluru" },
  BR_B_HYD: { org: "B", kind: "branch", match: "Hyderabad" },

  AC_1:  { org: "A", kind: "assetClass", match: "Office equipment" },
  AC_2:  { org: "A", kind: "assetClass", match: "Computers - desktops & laptops" },
  AC_3:  { org: "A", kind: "assetClass", match: "Motorcycles & scooters" },
  AC_4:  { org: "A", kind: "assetClass", match: "Vehicles - other" },
  AC_5:  { org: "A", kind: "assetClass", match: "Electrical installations" },
  AC_6:  { org: "A", kind: "assetClass", match: "Buildings - residential" },
  AC_1B: { org: "B", kind: "assetClass", match: "Office equipment" },

  ITM_LAP_A:      { org: "A", kind: "item", match: "LAP-14" },
  ITM_BRG_A:      { org: "A", kind: "item", match: "BRG-6205" },
  ITM_CAST_A:     { org: "A", kind: "item", match: "CAST-5HP" },
  ITM_PUMP_A:     { org: "A", kind: "item", match: "PUMP-5HP" },
  ITM_SVC_A:      { org: "A", kind: "item", match: "INST-SVC" },
  ITM_NONSTOCK_B: { org: "B", kind: "item", match: "LAP-14" },

  VENDOR_TN:  { org: "A", kind: "partner", match: "Sundar Systems" },
  VENDOR_USD: { org: "A", kind: "partner", match: "Overseas Supplies Inc" },
  CUST_TN:    { org: "A", kind: "partner", match: "Anand Traders" },

  ACC_4008: { org: "A", kind: "account", match: "4008" },
  ORG_A:    { org: "A", kind: "org", match: "" },
  ORG_B:    { org: "B", kind: "org", match: "" },
};

const LOOKUPS: Record<string, { path: string; field: string }> = {
  branch:     { path: "/branches",          field: "name" },
  item:       { path: "/items",             field: "sku" },
  assetClass: { path: "/asset-classes",     field: "name" },
  partner:    { path: "/business-partners", field: "name" },
  account:    { path: "/accounts",          field: "accountCode" },
};

function rows(body: any): any[] {
  const d = body?.data ?? body;
  if (Array.isArray(d)) return d;
  for (const k of ["items", "branches", "accounts", "classes", "partners"]) {
    if (Array.isArray(d?.[k])) return d[k];
  }
  return [];
}

export async function resolveFixtures(
  needed: Set<string>,
): Promise<{ values: Record<string, string>; missing: string[] }> {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  const cache: Record<string, any[]> = {};

  for (const key of Array.from(needed).sort()) {
    const spec = FIXTURE_SPECS[key];
    if (!spec) { missing.push(`${key} ~U+2014~ no fixture rule. Add one to FIXTURE_SPECS.`); continue; }

    if (spec.kind === "org") {
      await login(spec.org);
      values[key] = loginBody[spec.org].organizationId;
      continue;
    }

    const look = LOOKUPS[spec.kind];
    if (!look) { missing.push(`${key} ~U+2014~ unknown fixture kind '${spec.kind}'.`); continue; }

    const cacheKey = `${spec.org}:${look.path}`;
    if (!cache[cacheKey]) {
      const res = await request(spec.org, "GET", look.path);
      cache[cacheKey] = rows(res.body);
    }
    // Exact match first, then a contained match, so "Chennai" finds
    // "Chennai (Head Office)" without also matching a second branch.
    const list = cache[cacheKey];
    const exact = list.filter((r) => String(r?.[look.field] ?? "") === spec.match);
    const loose = list.filter((r) =>
      String(r?.[look.field] ?? "").toLowerCase().includes(spec.match.toLowerCase()));
    const hit = exact.length === 1 ? exact[0] : loose.length === 1 ? loose[0] : null;

    if (hit?.id) {
      values[key] = hit.id;
    } else if (loose.length > 1) {
      missing.push(
        `${key} ~U+2014~ '${spec.match}' matches ${loose.length} rows in ORG-${spec.org} ${look.path} ` +
        `(${loose.map((r) => r[look.field]).join(", ")}). Make the name unique.`);
    } else {
      missing.push(
        `${key} ~U+2014~ nothing in ORG-${spec.org} ${look.path} with ${look.field} '${spec.match}'. ` +
        `Create it first (see the Setup sheet).`);
    }
  }
  return { values, missing };
}

// ---------------------------------------------------------------------------
// WORKBOOK
// ---------------------------------------------------------------------------

export interface JeLine { code: string; name: string; debit: number; credit: number; }

export interface Step {
  key: string; caseId: string; caseTitle: string; stepNo: number;
  phase: number; login: "A" | "B";
  method: string | null; path: string | null; body: any; status: number | null;
  capture: Record<string, string>;
  asserts: string[];
  auto: string; note: string;
  posts: string[] | null;
  je: JeLine[];
  action: string;
  // where to write the result back
  sheet: string; row: number;
}

function cellText(v: any): string {
  if (v == null) return "";
  if (typeof v === "object") {
    if (Array.isArray(v?.richText)) return v.richText.map((t: any) => t.text).join("");
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
  }
  return String(v);
}

export async function readWorkbook(): Promise<{ wb: ExcelJS.Workbook; steps: Step[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(CONFIG.workbook);

  const auto = wb.getWorksheet("Automation");
  if (!auto) throw new Error("No 'Automation' sheet ~U+2014~ is this the reworked workbook?");

  // Expected journal lines live on the case sheets, keyed by step key. The key
  // is written only on a step's FIRST row, so it is forward-filled here.
  const je: Record<string, JeLine[]> = {};
  const meta: Record<string, { sheet: string; row: number; title: string; action: string }> = {};
  for (const name of ["Depreciation", "Stock Management"]) {
    const ws = wb.getWorksheet(name);
    if (!ws) continue;
    let key = "";
    ws.eachRow((row, n) => {
      if (n < 4) return;
      const k = cellText(row.getCell(13).value).trim();
      if (k) {
        key = k;
        meta[key] = {
          sheet: name, row: n,
          title: cellText(row.getCell(2).value),
          action: cellText(row.getCell(4).value),
        };
      }
      if (!key) return;
      const code = cellText(row.getCell(7).value).trim();
      if (!code) return;
      const dr = Number(row.getCell(9).value ?? 0) || 0;
      const cr = Number(row.getCell(10).value ?? 0) || 0;
      if (dr === 0 && cr === 0) return;
      (je[key] ??= []).push({ code, name: cellText(row.getCell(8).value), debit: dr, credit: cr });
    });
  }

  const steps: Step[] = [];
  auto.eachRow((row, n) => {
    if (n < 4) return;
    const key = cellText(row.getCell(1).value).trim();
    if (!/^[A-Z]{3}-\d+\.\d+$/.test(key)) return;   // skips the validation block
    const bodyText = cellText(row.getCell(7).value).trim();
    const capText = cellText(row.getCell(9).value).trim();
    const capture: Record<string, string> = {};
    for (const line of capText.split("\n").filter(Boolean)) {
      const i = line.indexOf("=");
      if (i > 0) capture[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    const m = meta[key];
    steps.push({
      key,
      caseId: cellText(row.getCell(2).value).trim(),
      caseTitle: m?.title ?? "",
      stepNo: Number(key.split(".")[1]),
      phase: Number(cellText(row.getCell(3).value)) || 99,
      login: cellText(row.getCell(4).value).includes("ORG-B") ? "B" : "A",
      method: cellText(row.getCell(5).value).trim() || null,
      path: cellText(row.getCell(6).value).trim() || null,
      body: bodyText ? JSON.parse(bodyText) : null,
      status: Number(cellText(row.getCell(8).value)) || null,
      capture,
      asserts: cellText(row.getCell(10).value).split("\n").map((x) => x.trim()).filter(Boolean),
      auto: cellText(row.getCell(11).value).trim(),
      note: cellText(row.getCell(12).value).trim(),
      posts: null,
      je: je[key] ?? [],
      action: m?.action ?? "",
      sheet: m?.sheet ?? "", row: m?.row ?? 0,
    });
  });
  return { wb, steps };
}
'@
Set-FileText 'backend/tests/harness.ts' $f0
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green