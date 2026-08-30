// modF - wire the entitlement batch in. Run modE first.
//
// Four small edits.
//
// assertions.ts gains the one thing the batch needs: an sql assertion that
// is not a SELECT runs as a WRITE and yields the number of rows it changed,
// so `= 1` proves the statement hit exactly the row it meant to. A pack
// that writes behind the API's back is normally a bad idea; withdrawing a
// module is a platform-admin act and this pack holds two ordinary org
// logins by design, and what is under test is what the API does when the
// row says CANCELLED, not how the row got there.
//
// runCases.ts gets phase 19, 'module entitlement'. It runs AFTER the
// controls at 18, which everywhere else in this pack would be wrong - but
// these steps post nothing and put back the one column they write, so no
// accounting control could observe them. Any step that DID move stock
// would have to go before 18.
//
// Then: node tests/makeStkCases.mjs && npx tsc --noEmit -p tests/tsconfig.json
// Expect 122 steps across 32 cases, 121 runnable.
//
// Save this as backend/tests/modF.mjs and run it from backend/:
//   node tests/modF.mjs
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
function edit(file, from, to, done) {
  const t = read(file);
  if (t.includes(done)) { already++; save(file, t); return; }
  const n = t.split(from).length - 1;
  if (n === 0) throw new Error("anchor not found in " + file + ": " + from.slice(0, 70));
  if (n > 1) throw new Error("anchor is not unique in " + file + ": " + from.slice(0, 70));
  save(file, t.replace(from, to));
  applied++;
}

edit("tests/assertions.ts",
  L(
    "    const rows: any[] = await prisma.$queryRawUnsafe(sql);",
    "    const first = rows[0] ? Object.values(rows[0])[0] : null;",
    "    const value = typeof first === \"bigint\" ? Number(first) : first;",
    "    if (q[2]) { ctx.captures[q[2]] = value; return `captured ${q[2]} = ${value}`; }"),
  L(
    "    // A READ yields its first column; a WRITE yields the number of rows it",
    "    // changed. Almost every sql assertion in the pack is a read, and a pack",
    "    // that writes to the database behind the API's back would normally be a",
    "    // bad idea - it is how you end up asserting against state no user could",
    "    // have produced.",
    "    //",
    "    // The exception this exists for is ENTITLEMENT. Withdrawing a module is",
    "    // a platform-admin act, and the pack logs in as two ordinary org users",
    "    // by design; adding a third, more powerful login so that the suite can",
    "    // cancel subscriptions is a bigger and worse change than letting it set",
    "    // the one column the guard reads. What is under test is what the API",
    "    // does when the row says CANCELLED, not how the row got there.",
    "    //",
    "    // Returning the affected count rather than nothing is the point: `= 1`",
    "    // asserts the statement hit exactly the row it meant to, so a typo in",
    "    // the WHERE clause fails here instead of silently testing nothing.",
    "    const isRead = /^\\s*(select|with)\\b/i.test(sql);",
    "    let value: unknown;",
    "    if (isRead) {",
    "      const rows: any[] = await prisma.$queryRawUnsafe(sql);",
    "      const first = rows[0] ? Object.values(rows[0])[0] : null;",
    "      value = typeof first === \"bigint\" ? Number(first) : first;",
    "    } else {",
    "      value = await prisma.$executeRawUnsafe(sql);",
    "    }",
    "    if (q[2]) { ctx.captures[q[2]] = value as any; return `captured ${q[2]} = ${value}`; }"),
  "const isRead = /^\\s*(select|with)\\b/i.test(sql);"
);

edit("tests/runCases.ts",
  "        \"GST returns - GSTR-1 and GSTR-3B\", \"controls and reconciliation\"],",
  L(
    "        \"GST returns - GSTR-1 and GSTR-3B\", \"controls and reconciliation\",",
    "        \"module entitlement\"],"),
  "\"module entitlement\"],"
);

edit("tests/makeStkCases.mjs",
  "// stkCasesE.mjs is batch 4, the GST returns in ORG-B, phase 17.",
  L(
    "// stkCasesE.mjs is batch 4, the GST returns in ORG-B, phase 17.",
    "// stkCasesF.mjs is module entitlement, phase 19 - the only batch that runs",
    "// AFTER the controls, because it posts nothing and puts back the one",
    "// column it changes."),
  "// stkCasesF.mjs is module entitlement, phase 19"
);

edit("tests/makeStkCases.mjs",
  "import \"./stkCasesE.mjs\";",
  L(
    "import \"./stkCasesE.mjs\";",
    "import \"./stkCasesF.mjs\";"),
  "import \"./stkCasesF.mjs\";"
);

edit("tests/buildWorkbook.mjs",
  "           \"returns are batches 2 to 4.\" },",
  L(
    "           \"returns are batches 2 to 4. The last phase is module entitlement: \" +",
    "           \"what an organisation loses when Inventory is cancelled, and what \" +",
    "           \"it must keep.\" },"),
  "The last phase is module entitlement:"
);

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["tests/assertions.ts","tests/runCases.ts","tests/makeStkCases.mjs","tests/buildWorkbook.mjs"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}