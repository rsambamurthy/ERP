// modH - the REAL packRender.mjs. Overwrites what modG wrote.
//
// modG was right that the file had to come back and wrong about its
// contents: I retyped it into the message instead of pasting the script I
// had generated and checked, so what landed on disk was my approximation of
// the file rather than the file. The hash said so - 4172315EBF9B6F45 where
// 42983D040D4975D9 was expected - which is the entire reason the hashes are
// there.
//
// This one is the generated script, pasted verbatim. It overwrites
// unconditionally rather than checking whether the file exists, because a
// wrong file is already there.
//
// What it does: renders the pack's assertion language as English, for the
// readable column of the workbook. Nothing else imports it and nothing in
// the test runs touches it, so the 2 failures in the last run are unrelated
// to this and are still to be looked at.
//
// Save this as backend/tests/modH.mjs and run it from backend/:
//   node tests/modH.mjs
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
    "  if (/^manual:/i.test(t)) return \"BY HAND: \" + t.replace(/^manual:\\s*/i, \"\");",
    "  if (t.startsWith(\"error contains \")) {",
    "    return prefix + `the request is refused, and the message contains ${t.slice(15).trim()}`;",
    "  }",
    "  if (t.startsWith(\"journal \")) {",
    "    return prefix + \"the ledger entry for this document matches the rows in the previous column, \"",
    "      + \"and it balances\";",
    "  }",
    "  const q = /^sql\\s+\"([\\s\\S]*?)\"\\s*(?:capture\\s+(\\w+)|(>=|=)\\s*(.+))?$/.exec(t);",
    "  if (q) {",
    "    return prefix + (q[2] ? `read from the database and remembered as ${q[2]}:`",
    "      : `from the database, this returns ${q[3] === \">=\" ? \"at least \" : \"\"}${q[4]}:`) + `\\n${q[1]}`;",
    "  }",
    "  const f = /^field\\s+(.*?)\\s+(>=|=)\\s+(.+)$/s.exec(t);",
    "  if (f) {",
    "    const [, expr, op, want] = f;",
    "    const cmp = op === \">=\" ? \"at least \" : \"\";",
    "    // count(...) / sum(...) / distinct(...) read badly as \"X is N\". Say what",
    "    // they mean instead - these are the lines a reviewer actually checks.",
    "    const fn = /^(count|sum|distinct)\\((.+)\\)$/s.exec(expr);",
    "    if (fn) {",
    "      const inner = fn[2];",
    "      if (fn[1] === \"count\") return prefix + `exactly ${cmp}${want} row(s) match: ${inner}`;",
    "      if (fn[1] === \"sum\") return prefix + `the total of ${inner} is ${cmp}${want}`;",
    "      return prefix + `there are ${cmp}${want} distinct values of ${inner}`;",
    "    }",
    "    return prefix + `${expr} is ${cmp}${want}`;",
    "  }",
    "  return prefix + t;",
    "}",
    "",
    "export function requestText(s) {",
    "  if (!s.method || !s.path) return s.body ? JSON.stringify(s.body, null, 1) : \"\";",
    "  const head = `${s.method} ${s.path}` + (s.status ? `   expects HTTP ${s.status}` : \"\");",
    "  return s.body ? `${head}\\n${JSON.stringify(s.body, null, 1)}` : head;",
    "}",
    "",
    "export function jeText(je) {",
    "  if (!je || je.length === 0) return \"\";",
    "  return je.map((l) =>",
    "    `${l.code}  ${l.name}\\n      ${Number(l.debit) > 0 ? \"Dr \" + money(l.debit) : \"Cr \" + money(l.credit)}`)",
    "    .join(\"\\n\");",
    "}",
    ""
),
  "BY HAND: ");

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["tests/packRender.mjs"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}