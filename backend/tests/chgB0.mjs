// Diagnostic only. Prints three regions of prisma/schema.prisma so the
// anchors in chgB can be cut against YOUR copy rather than mine.
//   node tests/chgB0.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const t = fs.readFileSync(path.join(here, "..", "prisma/schema.prisma"), "utf8")
  .replace(/\r\n/g, "\n").split("\n");

function show(startsWith, endsWith) {
  const a = t.findIndex((l) => l.trim().startsWith(startsWith));
  if (a < 0) { console.log("NOT FOUND: " + startsWith); return; }
  let b = a;
  while (b < t.length && !t[b].includes(endsWith)) b++;
  console.log("===== " + startsWith + "  (lines " + (a + 1) + "-" + (b + 1) + ")");
  for (let i = a; i <= Math.min(b, t.length - 1); i++) {
    console.log(String(i + 1).padStart(5) + "|" + t[i]);
  }
  console.log("");
}

show("model Account {", '@@map("accounts")');
show("model SalesInvoice {", '@@map("sales_invoices")');
show("model SalesInvoiceLine {", '@@map("sales_invoice_lines")');
console.log("total lines: " + t.length);