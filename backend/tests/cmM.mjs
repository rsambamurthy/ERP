// SmartERP - Charge Master, one fix.
//
// STK-40.1 sent a charge object with no chargeTypeId at all. The empty
// string went into the findMany as a uuid, Prisma answered P2023, and the
// error handler turned that into a 500 with a stack trace. A malformed
// request is a 400. Same guard routes/fixedAssets.ts already carries.
//
// Save this as backend/tests/cmM.mjs and run it from backend/:
//   node tests/cmM.mjs
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

edit("src/routes/salesInvoices.ts",
  L(
    "  }",
    "  const chargeTypeIds = [...new Set(chargeInputs.map((c) => String(c.chargeTypeId ?? \"\")))];",
    "  const chargeTypes = chargeTypeIds.length"),
  L(
    "  }",
    "  // Only well-formed ids reach the query. An id that is not a uuid - \"\", or",
    "  // a charge object with no chargeTypeId at all - goes to Prisma as one",
    "  // anyway and comes back as P2023, which the error handler turns into a 500",
    "  // with a stack trace. A malformed request is a 400, and dropping the bad",
    "  // ids here means the \"no such active charge type\" refusal below is what",
    "  // answers, which is both correct and the message the user needs.",
    "  const CHARGE_TYPE_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;",
    "  const chargeTypeIds = [...new Set(",
    "    chargeInputs.map((c) => String(c.chargeTypeId ?? \"\")).filter((id) => CHARGE_TYPE_UUID.test(id))",
    "  )];",
    "  const chargeTypes = chargeTypeIds.length"),
  "const CHARGE_TYPE_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;");

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["src/routes/salesInvoices.ts"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}