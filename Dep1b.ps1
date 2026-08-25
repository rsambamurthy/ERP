$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Test runner 2 of 4 - assertions' -ForegroundColor Cyan

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
// The assertion language the Automation sheet is written in.
//
// Grammar, in full:
//
//   [pre] [<METHOD> <path> ::] <assertion>
//
//   field <path> <op> <value>      op is = or >=
//   journal <refType> <selector>   the ledger effect of a document must equal
//                                  the Debit/Credit rows on that step
//   error contains "<text>"
//   sql "<query>" = <value>
//   sql "<query>" capture <name>
//   manual: <why>
//
// `pre` means evaluate BEFORE the step's own call ~U+2014~ which is how "the screen
// showed 950.00, then I clicked Post and the ledger moved" is expressed. The
// distinction matters: POST /depreciation-runs/post returns totals only, so
// every per-asset figure has to be read from /due first.
//
// PATHS support enough shape to address a real response and no more:
//   data.period.periodStart          plain
//   data.runs[2].closingWdv          index
//   data.assets[id={{x}}].amount     find-in-array by a (possibly nested) key
//   data.runs[].amount               pluck across an array
//   count(...) sum(...) distinct(...)  applied to the result

import { prisma, request, Step, JeLine, Reply } from "./harness";

export interface Ctx {
  step: Step;
  reply: Reply | null;
  captures: Record<string, any>;
  fixtures: Record<string, string>;
  postedPeriods: Map<string, Reply>;
}

export class AssertionError extends Error {}

// ---------------------------------------------------------------------------
// placeholders
// ---------------------------------------------------------------------------

export function substitute(text: string, ctx: Ctx, forSql = false): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_m, raw) => {
    const name = String(raw).trim();
    let v: any;
    if (name in ctx.fixtures) v = ctx.fixtures[name];
    else if (name in ctx.captures) v = ctx.captures[name];
    else if (name.includes(".")) v = ctx.captures[name];   // cross-case: DEP-01.assetId
    if (v === undefined) throw new AssertionError(`{{${name}}} is not resolved`);
    // In SQL a uuid has to be quoted and a number must not be.
    if (forSql && !(typeof v === "number") && !/^-?\d+(\.\d+)?$/.test(String(v))) {
      return `'${String(v).replace(/'/g, "''")}'`;
    }
    return String(v);
  });
}

export function substituteDeep(value: any, ctx: Ctx): any {
  if (typeof value === "string") return substitute(value, ctx);
  if (Array.isArray(value)) return value.map((v) => substituteDeep(v, ctx));
  if (value && typeof value === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) out[k] = substituteDeep(v, ctx);
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// paths
// ---------------------------------------------------------------------------

function deep(obj: any, dotted: string): any {
  return dotted.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}

export function resolvePath(root: any, path: string): any {
  // split on '.' but never inside [...]
  const parts: string[] = [];
  let buf = "", depth = 0;
  for (const ch of path) {
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    if (ch === "." && depth === 0) { parts.push(buf); buf = ""; continue; }
    buf += ch;
  }
  if (buf) parts.push(buf);

  let cur: any = root;
  for (const part of parts) {
    if (cur == null) return undefined;
    const m = /^([A-Za-z0-9_]*)(\[(.*)\])?$/.exec(part);
    if (!m) return undefined;
    const [, name, , sel] = m;
    if (name) {
      cur = Array.isArray(cur) ? cur.map((x) => x?.[name]) : cur?.[name];
    }
    if (sel === undefined) continue;
    if (sel === "") continue;                                  // pluck: already mapped
    if (/^\d+$/.test(sel)) { cur = Array.isArray(cur) ? cur[Number(sel)] : undefined; continue; }
    const eq = sel.indexOf("=");
    if (eq < 0) return undefined;
    const key = sel.slice(0, eq).trim(), want = sel.slice(eq + 1).trim();
    if (!Array.isArray(cur)) return undefined;
    const hits = cur.filter((x) => String(deep(x, key) ?? "") === want);
    // A filter that matches nothing yields [] rather than undefined, so
    // count(...) = 0 can be asserted ~U+2014~ which several cases rely on.
    cur = hits.length === 1 ? hits[0] : hits;
  }
  return cur;
}

function applyFn(fn: string, v: any): any {
  const arr = Array.isArray(v) ? v : v === undefined ? [] : [v];
  if (fn === "count") return arr.length;
  if (fn === "sum") return Math.round(arr.reduce((s, x) => s + Number(x ?? 0), 0) * 100) / 100;
  if (fn === "distinct") return new Set(arr.map((x) => String(x))).size;
  throw new AssertionError(`unknown function ${fn}(...)`);
}

export function evalPath(root: any, expr: string): any {
  const m = /^(count|sum|distinct)\((.+)\)$/.exec(expr.trim());
  if (m) return applyFn(m[1], resolvePath(root, m[2]));
  return resolvePath(root, expr.trim());
}

function same(actual: any, want: string): boolean {
  if (want === "true" || want === "false") return String(actual) === want;
  if (/^-?\d+(\.\d+)?$/.test(want)) {
    const a = Number(actual), b = Number(want);
    if (!Number.isFinite(a)) return false;
    return Math.round(a * 100) === Math.round(b * 100);      // money, to the paisa
  }
  // A date comes back as an ISO timestamp; the sheet writes the day.
  const s = String(actual ?? "");
  return s === want || s.slice(0, want.length) === want;
}

// ---------------------------------------------------------------------------
// journal comparison
// ---------------------------------------------------------------------------

const DOC_TABLE: Record<string, string> = {
  purchase_bill: "purchaseBill",
  purchase_return: "purchaseReturn",
  stock_adjustment: "stockAdjustment",
  sales_invoice: "salesInvoice",
};

function fold(lines: JeLine[]): Map<string, { d: number; c: number }> {
  const m = new Map<string, { d: number; c: number }>();
  for (const l of lines) {
    const e = m.get(l.code) ?? { d: 0, c: 0 };
    e.d += l.debit; e.c += l.credit;
    m.set(l.code, e);
  }
  for (const [, e] of m) { e.d = Math.round(e.d * 100) / 100; e.c = Math.round(e.c * 100) / 100; }
  return m;
}

async function linesOfEntries(entryIds: string[]): Promise<JeLine[]> {
  if (entryIds.length === 0) return [];
  const rows = (await prisma.journalLine.findMany({
    where: { journalEntryId: { in: entryIds } },
    include: { account: { select: { accountCode: true, accountName: true } } },
  })) as Array<{ debit: unknown; credit: unknown; account: { accountCode: string; accountName: string } }>;
  return rows.map((r) => ({
    code: r.account.accountCode,
    name: r.account.accountName,
    debit: Number(r.debit), credit: Number(r.credit),
  }));
}

async function entriesFor(refType: string, selector: string, ctx: Ctx): Promise<string[]> {
  // A period posting writes one entry per branch and returns their ids, so the
  // ids come from the response rather than from a date lookup ~U+2014~ no month-end
  // arithmetic, and it stays correct for a quarterly frequency.
  if (refType === "depreciation_run") {
    const period = /period=(\S+)/.exec(selector)?.[1];
    const branchRaw = /branch=(\S+)/.exec(selector)?.[1];
    const reply = period ? ctx.postedPeriods.get(period) : ctx.reply;
    const ids: string[] = reply?.body?.data?.journalEntryIds ?? [];
    if (ids.length === 0) throw new AssertionError(`no posting recorded for period ${period}`);
    if (!branchRaw) return ids;
    const branchId = substitute(branchRaw, ctx);
    const entries = (await prisma.journalEntry.findMany({
      where: { id: { in: ids }, branchId }, select: { id: true },
    })) as Array<{ id: string }>;
    if (entries.length === 0) {
      throw new AssertionError(`the ${period} run wrote no entry for that branch`);
    }
    return entries.map((e) => e.id);
  }

  const table = DOC_TABLE[refType];
  if (!table) throw new AssertionError(`journal: unknown document type '${refType}'`);
  const id = substitute(selector.trim(), ctx);
  const doc: any = await (prisma as any)[table].findUnique({
    where: { id }, select: { journalEntryId: true },
  });
  if (!doc) throw new AssertionError(`no ${refType} with id ${id}`);
  if (!doc.journalEntryId) throw new AssertionError(`${refType} ${id} has posted no journal entry`);
  return [doc.journalEntryId];
}

async function assertJournal(rest: string, ctx: Ctx): Promise<string> {
  const sp = rest.indexOf(" ");
  const refType = sp < 0 ? rest : rest.slice(0, sp);
  const selector = sp < 0 ? "" : rest.slice(sp + 1).trim();

  const expected = fold(ctx.step.je);
  if (expected.size === 0) throw new AssertionError("journal: the step has no expected lines");

  const actual = fold(await linesOfEntries(await entriesFor(refType, selector, ctx)));

  const problems: string[] = [];
  for (const code of new Set([...expected.keys(), ...actual.keys()])) {
    const e = expected.get(code) ?? { d: 0, c: 0 };
    const a = actual.get(code) ?? { d: 0, c: 0 };
    if (Math.round(e.d * 100) !== Math.round(a.d * 100) ||
        Math.round(e.c * 100) !== Math.round(a.c * 100)) {
      problems.push(
        `${code}: expected Dr ${e.d.toFixed(2)} Cr ${e.c.toFixed(2)}, ` +
        `got Dr ${a.d.toFixed(2)} Cr ${a.c.toFixed(2)}`);
    }
  }
  if (problems.length) throw new AssertionError(problems.join("; "));

  const tot = [...actual.values()].reduce((s, x) => s + x.d - x.c, 0);
  if (Math.round(tot * 100) !== 0) throw new AssertionError(`entry does not balance by ${tot.toFixed(2)}`);
  return `${actual.size} accounts matched, entry balances`;
}

// ---------------------------------------------------------------------------
// one assertion
// ---------------------------------------------------------------------------

const PREFIX = /^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)\s*::\s*(.+)$/s;

export function isPre(text: string): boolean { return /^pre\s+/i.test(text); }

export async function evaluate(raw: string, ctx: Ctx): Promise<string> {
  let text = raw.trim().replace(/^pre\s+/i, "");

  // An embedded lookup: fetch, then assert against THAT response.
  let root: any = ctx.reply?.body;
  const pm = PREFIX.exec(text);
  if (pm) {
    const reply = await request(ctx.step.login, pm[1], substitute(pm[2], ctx));
    root = reply.body;
    text = pm[3].trim();
  }

  if (/^manual:/i.test(text)) return "MANUAL";

  if (text.startsWith("journal ")) return assertJournal(text.slice(8).trim(), ctx);

  if (text.startsWith("error contains ")) {
    const want = text.slice(15).trim().replace(/^"|"$/g, "");
    const msg = String(ctx.reply?.body?.message ?? JSON.stringify(ctx.reply?.body ?? ""));
    if (!msg.toLowerCase().includes(want.toLowerCase())) {
      throw new AssertionError(`message was "${msg}", expected it to contain "${want}"`);
    }
    return `message contained "${want}"`;
  }

  if (text.startsWith("field ")) {
    const body = text.slice(6).trim();
    const m = /^(.*?)\s*(>=|=)\s*(.+)$/s.exec(body);
    if (!m) throw new AssertionError(`cannot parse: ${text}`);
    const [, expr, op, wantRaw] = m;
    const want = substitute(wantRaw.trim(), ctx);
    const actual = evalPath(root, expr);
    if (op === ">=") {
      if (!(Number(actual) >= Number(want))) {
        throw new AssertionError(`${expr} = ${JSON.stringify(actual)}, expected >= ${want}`);
      }
    } else if (!same(actual, want)) {
      throw new AssertionError(`${expr} = ${JSON.stringify(actual)}, expected ${want}`);
    }
    return `${expr} = ${want}`;
  }

  if (text.startsWith("sql ")) {
    const q = /^sql\s+"([\s\S]*?)"\s*(capture\s+(\w+)|=\s*(.+))?$/.exec(text);
    if (!q) throw new AssertionError(`cannot parse: ${text}`);
    const sql = substitute(q[1], ctx, true);
    const rows: any[] = await prisma.$queryRawUnsafe(sql);
    const first = rows[0] ? Object.values(rows[0])[0] : null;
    const value = typeof first === "bigint" ? Number(first) : first;
    if (q[3]) { ctx.captures[q[3]] = value; return `captured ${q[3]} = ${value}`; }
    const wantText = substitute(String(q[4] ?? "").trim(), ctx);
    const opGe = wantText.startsWith(">=");
    const want = opGe ? wantText.slice(2).trim() : wantText;
    if (opGe) {
      if (!(Number(value) >= Number(want))) {
        throw new AssertionError(`sql returned ${value}, expected >= ${want}`);
      }
    } else if (!same(value, want)) {
      throw new AssertionError(`sql returned ${JSON.stringify(value)}, expected ${want}`);
    }
    return `sql = ${want}`;
  }

  if (text.startsWith("stock ")) {
    throw new AssertionError("the `stock` assertion is not implemented yet (Stock Management pass)");
  }

  throw new AssertionError(`unrecognised assertion: ${text}`);
}
'@
Set-FileText 'backend/tests/assertions.ts' $f0
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green