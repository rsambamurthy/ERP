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
// `pre` means evaluate BEFORE the step's own call — which is how "the screen
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
    // count(...) = 0 can be asserted — which several cases rely on.
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
  // "the field is deliberately empty" is a thing a pack needs to be able to
  // say - a cost per unit before any unit exists, a disposal date on an asset
  // still in use. It has to be an EXPLICIT null, never undefined: a path that
  // resolved to nothing is a typo in the assertion, and matching it here would
  // turn every misspelt field name into a passing test.
  if (want === "null") return actual === null;
  if (want === "true" || want === "false") return String(actual) === want;
  if (/^-?\d+(\.\d+)?$/.test(want)) {
    // NOTHING IS NOT ZERO. Number(null) is 0 and finite, so `= 0` used to pass
    // against a null - which is what a `sql` assertion returns when the query
    // matched NO ROWS AT ALL. That is the worst kind of green: a query looking
    // at the wrong table or a mistyped column name reads exactly like a
    // balance that is correctly nil, and the case goes on passing after the
    // thing it was watching has broken. undefined was already rejected by the
    // isFinite check below; null has to be rejected explicitly.
    if (actual === null || actual === undefined) return false;
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

// Which table holds the link to a document's journal entry, and under which
// column. Most documents post ONE entry and call the column journalEntryId,
// so `doc()` covers them in a word.
//
// A stock transfer does not. It is two events - goods leave on Monday, arrive
// on Thursday - and a TAXABLE one posts three entries, because two GST
// registrations keep two trial balances and neither may post to the other's
// accounts. All three ids live on the same row under different columns, so
// the refType picks the column and the selector is the transfer id.
interface DocRef { table: string; field: string }
const doc = (table: string): DocRef => ({ table, field: "journalEntryId" });

const DOC_TABLE: Record<string, DocRef> = {
  purchase_bill: doc("purchaseBill"),
  purchase_return: doc("purchaseReturn"),
  stock_adjustment: doc("stockAdjustment"),
  sales_invoice: doc("salesInvoice"),
  // All three production postings are rows in the SAME table. A production
  // order is a container; what carries a journal entry is the ISSUE, COST or
  // RECEIPT posted against it, and productionEntry.journalEntryId is the link.
  // So the selector for each is the entryId the posting returned, not the
  // order id - which is why every production case captures data.entryId.
  production_issue: doc("productionEntry"),
  production_cost: doc("productionEntry"),
  production_receipt: doc("productionEntry"),

  stock_transfer_dispatch: { table: "stockTransfer", field: "dispatchJournalEntryId" },
  stock_transfer_receipt:  { table: "stockTransfer", field: "receiptJournalEntryId" },
  stock_transfer_transit:  { table: "stockTransfer", field: "transitClearingJournalEntryId" },
  // A cancellation reuses receiptJournalEntryId to hold the return entry -
  // see the comment on the column in schema.prisma. Named separately here so
  // a case can say which of the two it means and be read by a person.
  stock_transfer_cancel:   { table: "stockTransfer", field: "receiptJournalEntryId" },
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
  // ids come from the response rather than from a date lookup — no month-end
  // arithmetic, and it stays correct for a quarterly frequency.
  if (refType === "depreciation_run") {
    const period = /period=(\S+)/.exec(selector)?.[1];
    const branchRaw = /branch=(\S+)/.exec(selector)?.[1];
    // Same key the runner writes: the posting belongs to one organisation.
    const reply = period ? ctx.postedPeriods.get(`${ctx.step.login}:${period}`) : ctx.reply;
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

  const ref = DOC_TABLE[refType];
  if (!ref) throw new AssertionError(`journal: unknown document type '${refType}'`);
  const id = substitute(selector.trim(), ctx);
  const row: any = await (prisma as any)[ref.table].findUnique({
    where: { id }, select: { [ref.field]: true },
  });
  if (!row) throw new AssertionError(`no ${refType} with id ${id}`);
  if (!row[ref.field]) {
    throw new AssertionError(`${refType} ${id} has posted no journal entry (${ref.field} is null)`);
  }
  return [row[ref.field]];
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
    // WHITESPACE around the operator is required, and that is the whole point:
    // a bracket filter writes id={{x}} with no spaces, so a non-greedy split on
    // a bare "=" tore the expression apart at the filter instead of at the
    // comparison. Every assertion in the pack writes " = ", so demanding the
    // spaces disambiguates the two completely.
    const m = /^(.*?)\s+(>=|=)\s+(.+)$/s.exec(body);
    if (!m) throw new AssertionError(`cannot parse (an assertion needs spaces around = or >=): ${text}`);
    const [, exprRaw, op, wantRaw] = m;
    const want = substitute(wantRaw.trim(), ctx);
    // The LEFT side needs substituting too. Captures did it; this did not, so
    // {{DEP-01.assetId}} inside a filter stayed literal and matched nothing.
    const expr = substitute(exprRaw.trim(), ctx);
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
    // The operator is matched HERE rather than sniffed off the front of the
    // expected value, which is what made `sql "..." >= 2` unparseable.
    const q = /^sql\s+"([\s\S]*?)"\s*(?:capture\s+(\w+)|(>=|=)\s*(.+))?$/.exec(text);
    if (!q) throw new AssertionError(`cannot parse: ${text}`);
    const sql = substitute(q[1], ctx, true);
    // A READ yields its first column; a WRITE yields the number of rows it
    // changed. Almost every sql assertion in the pack is a read, and a pack
    // that writes to the database behind the API's back would normally be a
    // bad idea - it is how you end up asserting against state no user could
    // have produced.
    //
    // The exception this exists for is ENTITLEMENT. Withdrawing a module is
    // a platform-admin act, and the pack logs in as two ordinary org users
    // by design; adding a third, more powerful login so that the suite can
    // cancel subscriptions is a bigger and worse change than letting it set
    // the one column the guard reads. What is under test is what the API
    // does when the row says CANCELLED, not how the row got there.
    //
    // Returning the affected count rather than nothing is the point: `= 1`
    // asserts the statement hit exactly the row it meant to, so a typo in
    // the WHERE clause fails here instead of silently testing nothing.
    const isRead = /^\s*(select|with)\b/i.test(sql);
    let value: unknown;
    if (isRead) {
      const rows: any[] = await prisma.$queryRawUnsafe(sql);
      const first = rows[0] ? Object.values(rows[0])[0] : null;
      value = typeof first === "bigint" ? Number(first) : first;
    } else {
      value = await prisma.$executeRawUnsafe(sql);
    }
    if (q[2]) { ctx.captures[q[2]] = value as any; return `captured ${q[2]} = ${value}`; }
    const opGe = q[3] === ">=";
    const want = substitute(String(q[4] ?? "").trim(), ctx);
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
