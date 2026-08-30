// modG - restores tests/packRender.mjs, which I told you to delete by
// mistake.
//
// It was on the cleanup list as a one-shot patch script. It is not one - it
// is a helper MODULE that buildWorkbook.mjs imports at run time, and with it
// gone the workbook build dies at ERR_MODULE_NOT_FOUND before it reads a
// single result.
//
// What it does: renders the pack's assertion language as English. The
// assertions are written for a parser - `field data.period.periodStart =
// 2026-04-01` - which is right for the runner and no use to somebody reading
// a test pack. plain() turns that into a sentence. Nothing is paraphrased
// from a second source: it renders THE assertion, which is why the readable
// column and the executed check cannot drift apart.
//
// Byte-for-byte what was there before. Nothing else is touched.
//
// Save this as backend/tests/modG.mjs and run it from backend/:
//   node tests/modG.mjs
// Safe to run twice - a second run says 'already there' and changes nothing.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const at = (f) => path.join(here, "..", f);
const read = (f) => fs.readFileSync(at(f), "utf8").replace(/\r\n/g, "\n");
const L = (...ls) => ls.join("\n");
const save = (f, t) => fs.writeFileSync(at(f), t.replace(/\n*$/, "\n"));

let applied = 0, already = 0;
function create(file, text, done) {
  if (fs.existsSync(at(file)) && read(file).includes(done)) { already++; return; }
  save(file, text);
  applied++;
}

create("tests/packRender.mjs", L(
    "// Turning the assertion language into English.",
    "//",
    "// The pack's assertions are written for a parser - `field data.period.periodStart",
    "// = 2026-04-01`. That is exactly right for the runner and no use at all to",
    "// somebody reading a test pack, so this renders the same meaning as a sentence.",
    "// Nothing is restated or paraphrased from a second source: this IS the",
    "// assertion, spelled out, which is why the two cannot drift apart.",
    "",
    "const money = (n) => Number(n).toLocaleString(\"en-IN\",",
    "  { minimumFractionDigits: 2, maximumFractionDigits: 2 });",
    "",
    "// ---------------------------------------------------------------------------",
    "// The assertion language, rendered as something a person reads rather than",
    "// something a parser eats. Same meaning, no DSL.",
    "// ---------------------------------------------------------------------------",
    "export function plain(a) {",
    "  let t = a.trim(), prefix = \"\";",
    "  if (/^pre\\s+/i.test(t)) { t = t.replace(/^pre\\s+/i, \"\"); prefix = \"Before the call, \"; }",
    "  const m = /^(GET|POST|PUT|PATCH|DELETE)\\s+(\\S+)\\s*::\\s*([\\s\\S]+)$/.exec(t);",
    "  if (m) { prefix += `reading ${m[1]} ${m[2]} \\u2014 `; t = m[3].trim(); }",
    "",
    "  let r = t;",
    "  const f = /^field\\s+(\\S+)\\s*(>=|=)\\s*([\\s\\S]+)$/.exec(t);",
    "  if (f) {",
    "    const [, path, op, want] = f;",
    "    const human = path",
    "      .replace(/^data\\./, \"\")",
    "      .replace(/\\[(\\w+)=([^\\]]+)\\]/g, \" where $1 is $2\")",
    "      .replace(/\\[(\\d+)\\]/g, \" #$1\")",
    "      .replace(/\\[\\]/g, \" (each)\")",
    "      .replace(/count\\(([^)]+)\\)/g, \"the number of $1\")",
    "      .replace(/sum\\(([^)]+)\\)/g, \"the total of $1\")",
    "      .replace(/distinct\\(([^)]+)\\)/g, \"the distinct count of $1\")",
    "      .replace(/\\./g, \" \");",
    "    const val = /^-?\\d+(\\.\\d+)?$/.test(want) ? money(want) : want;",
    "    r = `${human} ${op === \">=\" ? \"is at least\" : \"is\"} ${val}`;",
    "  } else if (/^journal\\s+/i.test(t)) {",
    "    const [, ref, sel] = /^journal\\s+(\\S+)\\s+([\\s\\S]+)$/.exec(t);",
    "    r = `the ledger entry this ${ref.replace(/_/g, \" \")} posted matches the \" +",
    "        \"Debit/Credit rows above, exactly (${sel})`;",
    "  } else if (/^error contains/i.test(t)) {",
    "    r = `it is refused, and the message says ${t.replace(/^error contains\\s*/i, \"\")}`;",
    "  } else if (/^manual:/i.test(t)) {",
    "    r = t.replace(/^manual:\\s*/i, \"\");",
    "  } else if (/^sql\\s+/i.test(t)) {",
    "    const cap = /capture\\s+(\\w+)\\s*$/.exec(t);",
    "    const eq = /\"\\s*(>=|=)\\s*([\\s\\S]+)$/.exec(t);",
    "    if (cap) r = `read a figure straight from the database and remember it as ${cap[1]}`;",
    "    else if (eq) r = `straight from the database, the figure ${eq[1] === \">=\" ? \"is at least\" : \"is\"} ` +",
    "                     `${/^-?\\d+(\\.\\d+)?$/.test(eq[2].trim()) ? money(eq[2]) : eq[2].trim()}`;",
    "    else r = \"a direct database check\";",
    "  } else if (/^stock\\s+/i.test(t)) {",
    "    r = t.replace(/^stock\\s+/i, \"the stock record shows \");",
    "  }",
    "  return prefix + r;",
    "}",
    "",
    "export function requestText(s) {",
    "  if (!s.method) return \"\";",
    "  const b = s.body ? `\\n\\n${JSON.stringify(s.body, null, 1)}` : \"\";",
    "  return `${s.method} ${s.path}${b}`;",
    "}",
    "",
    "export function jeText(je) {",
    "  if (!je || !je.length) return \"\";",
    "  return je.map((l) => `${l.accountCode} ${l.accountName}`.trim() +",
    "    `  Dr ${money(l.debit ?? 0)}  Cr ${money(l.credit ?? 0)}`).join(\"\\n\");",
    "}"
),
  "export function plain(a) {");

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["tests/packRender.mjs"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}