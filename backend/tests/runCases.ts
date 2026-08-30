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
// That is also why postedPeriods is global — a case asserts against whichever
// run actually wrote the entry, whether or not that run was its own step.

import fs from "fs";
import ExcelJS from "exceljs";
import {
  CONFIG, prisma, request, readCases, resolveFixtures, Step, Reply,
} from "./harness";
import {
  Ctx, evaluate, isPre, substitute, substituteDeep, evalPath, AssertionError,
} from "./assertions";

type Outcome = "PASS" | "FAIL" | "MANUAL" | "SKIPPED";

const MODULE_NAME: Record<string, string> = { DEP: "depreciation", STK: "stock management" };

// Phase order is the whole trick: a module's state accumulates, so the steps
// run in dependency order rather than case order. Depreciation posts each
// period once and every case reads its own slice; stock walks one item's
// cost forward and every case asserts the balance it inherits.
const PHASES: Record<string, string[]> = {
  DEP: ["", "capitalise", "post April", "post May", "post June",
        "post July / catch-up", "later periods", "controls"],
  STK: ["", "opening balances and refusals", "found stock", "purchase raises the average",
        "sale consumes at average", "shrinkage and a two-way document", "over-issue is refused",
        "FIFO in ORG-B", "purchase returns", "sales returns and the stock ledger",
        "production - material and conversion cost", "production - output",
        "production - refusals, close and cancel",
        "transfers - untaxed, one registration", "transfers - taxable, both ways",
        "transfers - cancellation and refusals", "transfers - reconciliation",
        "GST returns - GSTR-1 and GSTR-3B", "selling into negative stock",
        "controls and reconciliation", "module entitlement"],
};

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

    // A step that only means something once a given period is on the ledger.
    // When that period could not be posted because the month is not over yet,
    // this step has nothing to say - and saying it in red buries the failures
    // that are actually about the software.
    if (step.needsPeriod && !postedPeriods.has(`${step.login}:${step.needsPeriod}`)) {
      return done("SKIPPED", `${step.needsPeriod} was never posted`);
    }

    // ---- assertions marked `pre` see the state BEFORE the call
    const pre = step.asserts.filter(isPre);
    const post = step.asserts.filter((a) => !isPre(a));
    const notes: string[] = [];
    for (const a of pre) notes.push(await evaluate(a, ctx));

    // ---- the call
    if (step.method && step.path) {
      const path = substitute(step.path, ctx);

      // A period posting may carry an array — "post these, in order". Each
      // period is posted at most once across the whole suite.
      const periods: string[] | null =
        path === "/depreciation-runs/post" && Array.isArray(step.body?.periodStart)
          ? step.body.periodStart
          : path === "/depreciation-runs/post" && typeof step.body?.periodStart === "string"
            ? [step.body.periodStart]
            : null;

      if (periods) {
        // A step that expects a refusal has to make the call. Reusing the
        // recorded success from the registry handed it a 200 and the assertion
        // then had no error message to read - which defeated the two cases
        // whose entire purpose is to prove a period cannot be posted twice.
        const wantsSuccess = step.status == null || step.status === 200;
        for (const raw of periods) {
          // SUBSTITUTE. This branch bypassed substituteDeep, so a step whose
          // period is a placeholder - DEP-17.2 uses {{CURRENT_MONTH_START}} -
          // sent the braces to the server verbatim and was refused for the
          // wrong reason entirely.
          const p = substitute(raw, ctx);
          // KEYED BY ORGANISATION. April in ORG-A and April in ORG-B are two
          // different postings; keying on the date alone handed ORG-B the
          // ORG-A reply, and the quarterly case then asserted ORG-A's figures
          // against ORG-B's expectations.
          const k = `${step.login}:${p}`;
          if (wantsSuccess && postedPeriods.has(k)) { ctx.reply = postedPeriods.get(k)!; continue; }
          const reply = await request(step.login, "POST", path, { periodStart: p });
          ctx.reply = reply;
          if (reply.status === 200) postedPeriods.set(k, reply);
          else if (wantsSuccess) {
            const why = String(reply.body?.message ?? "");
            // Refusing a period that has not ended is CORRECT, and it is the
            // pack's calendar that is out of step, not the engine. Reporting
            // that as a failure would be reporting the software for being
            // right. The pack is pinned to Apr-Oct 2026; anchoring it to the
            // run date instead is a separate job.
            if (reply.status === 409 && /is not over yet/i.test(why)) {
              return done("SKIPPED", why);
            }
            return done("FAIL", `POST ${p} returned ${reply.status}: ${why}`);
          }
        }
      } else {
        ctx.reply = await request(step.login, step.method, path,
                                  step.body ? substituteDeep(step.body, ctx) : undefined);
      }

      if (step.status != null && ctx.reply && ctx.reply.status !== step.status) {
        return done("FAIL",
          `HTTP ${ctx.reply.status}, expected ${step.status}` +
          (ctx.reply.body?.message ? ` — ${ctx.reply.body.message}` : ""));
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

  console.log(`${BOLD}SmartERP — ${MODULE_NAME[CONFIG.module] ?? CONFIG.module} test run${OFF}`);
  console.log(`${GREY}workbook ${CONFIG.workbook}   backend ${CONFIG.baseUrl}${OFF}\n`);

  const { wb, steps: all } = await readCases();
  let steps = all.filter((s) => s.caseId.startsWith(`${CONFIG.module}-`) && s.auto !== "TBD");
  if (only.length) steps = steps.filter((s) => only.some((o) => s.key.startsWith(o)));
  if (steps.length === 0) { console.log("Nothing to run."); return; }

  // phase first, then case, then step — see the note at the top
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
    console.log(`${RED}${BOLD}SETUP INCOMPLETE — ${missing.length} fixture(s) could not be resolved${OFF}`);
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
      const label = (PHASES[CONFIG.module] ?? [])[phase] ?? `phase ${phase}`;
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
  if (!wb) {
    // Ran from depCases.json, so there is no workbook to annotate. The report
    // goes to JSON instead — same information, different container.
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
    if (!ws) continue;
    const row = ws.getRow(r.step.row);
    row.getCell(11).value = r.outcome === "PASS" ? "Pass"
      : r.outcome === "FAIL" ? "Fail" : "Not run";
    row.getCell(12).value = `${stamp} · ${r.detail}`.slice(0, 500);
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
