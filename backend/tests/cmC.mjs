// SmartERP - Charge Master.
//
// Script 3 of 12: backend/src/routes/chargeTypes.ts, part 1 of 2.
//
// The file will not compile until cmD lands. That is expected.
//
// Save this as backend/tests/cmC.mjs and run it from backend/:
//   node tests/cmC.mjs
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
  fs.mkdirSync(path.dirname(at(file)), { recursive: true });
  save(file, text);
  applied++;
}

create("src/routes/chargeTypes.ts", L(
    "import { Router } from \"express\";",
    "import { prisma } from \"../db\";",
    "import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from \"../middleware/auth\";",
    "import { logAudit } from \"../lib/audit\";",
    "import { SALES_REVENUE_CODE } from \"./salesInvoices\";",
    "",
    "// Charge Master - the labels an invoice may put on freight, packing,",
    "// insurance and the like, each bound to the income account it credits.",
    "//",
    "// WHY THIS TABLE EXISTS. migration_054 shipped charges with a free-text",
    "// label. That drifts: \"Delivery charges\", \"Delivery Charges\", \"Delivery\",",
    "// \"Frieght\", all on account 5002, and any report grouping by label breaks",
    "// into four rows that are one thing. The account was always the stable key",
    "// and the label never was, so the label stops being typed and starts being",
    "// chosen. A unique index on lower(label) per organisation is what actually",
    "// enforces it - see migration_055.",
    "//",
    "// There is deliberately NO tax rate here, for the same reason there is none",
    "// on a charge row: a charge is prorated into the goods lines and taxed at",
    "// THEIR rate (section 8(a), composite supply), so it never has a rate of its",
    "// own to get wrong. See lib/discountGst.ts.",
    "//",
    "// Gated on coa.manage rather than a permission of its own. The only decision",
    "// a charge type encodes is which income head a recovery lands in, which is a",
    "// chart-of-accounts decision wearing a friendlier name - and adding a",
    "// permission to the catalogue changes every custom role's grid for one",
    "// screen that nobody would grant separately.",
    "const router = Router();",
    "router.use(authenticate, requireActiveSubscription);",
    "const canManage = requirePermission(\"coa.manage\");",
    "",
    "function orgIdOr400(req: import(\"express\").Request, res: import(\"express\").Response): string | null {",
    "  const organizationId = resolveOrgId(req);",
    "  if (!organizationId) {",
    "    res.status(400).json({ message: \"organizationId is required.\" });",
    "    return null;",
    "  }",
    "  return organizationId;",
    "}",
    "",
    "const withAccount = {",
    "  account: { select: { id: true, accountCode: true, accountName: true, accountType: true } },",
    "} as const;",
    "",
    "// The account a charge type may point at, and the one refusal that matters.",
    "// Returns an error message, or null when the account is fine.",
    "//",
    "// Both halves are the same rule the invoice already enforces (see the charge",
    "// validation in routes/salesInvoices.ts), applied one step earlier. Checking",
    "// it here as well is not duplication for its own sake: a master row that",
    "// cannot be used is worse than a refusal at the point of creation, because",
    "// the user finds out about it mid-invoice with a customer waiting.",
    "async function accountProblem(organizationId: string, accountId: unknown): Promise<string | null> {",
    "  if (!accountId || typeof accountId !== \"string\") return \"Choose the income account this charge credits.\";",
    "  const account = await prisma.account.findFirst({",
    "    where: { id: accountId, organizationId, deletedAt: null },",
    "    select: { accountType: true, accountCode: true, isGroup: true },",
    "  });",
    "  if (!account) return \"That account does not belong to this organization.\";",
    "  if (account.accountType !== \"INCOME\" || account.isGroup) {",
    "    return \"A charge recovers money from a customer, so it must credit an income account that is not a group.\";",
    "  }",
    "  if (account.accountCode === SALES_REVENUE_CODE) {",
    "    return \"A charge cannot credit Sales Revenue \u2014 use a separate head such as Freight & Delivery \" +",
    "      \"Recovered, so what you recover on delivery can be read against what delivery costs you.\";",
    "  }",
    "  return null;",
    "}",
    "",
    "// GET /charge-types - active only by default, because that is what a picker",
    "// wants; ?includeInactive=true for the master screen, which has to show the",
    "// retired ones in order to bring one back.",
    "router.get(\"/\", async (req, res) => {",
    "  const organizationId = orgIdOr400(req, res);",
    "  if (!organizationId) return;",
    "  const includeInactive = String(req.query.includeInactive ?? \"\") === \"true\";",
    "  const chargeTypes = await prisma.chargeType.findMany({",
    "    where: { organizationId, ...(includeInactive ? {} : { isActive: true }) },",
    "    include: withAccount,",
    "    orderBy: [{ sortOrder: \"asc\" }, { label: \"asc\" }],",
    "  });",
    "  res.json({ data: chargeTypes });",
    "});",
    "",
    "router.post(\"/\", canManage, async (req, res) => {",
    "  const organizationId = orgIdOr400(req, res);",
    "  if (!organizationId) return;",
    "  const { label, accountId, sortOrder } = req.body ?? {};",
    "",
    "  const trimmed = String(label ?? \"\").trim();",
    "  if (!trimmed) return res.status(400).json({ message: \"Give the charge a label.\" });",
    "  if (trimmed.length > 60) return res.status(400).json({ message: \"A charge label is at most 60 characters.\" });",
    "",
    "  const problem = await accountProblem(organizationId, accountId);",
    "  if (problem) return res.status(400).json({ message: problem });",
    "",
    "  // Case-insensitively, because that is the whole point. The unique index in",
    "  // migration_055 is the real guard; this exists so the user gets a sentence",
    "  // instead of a constraint violation.",
    "  const clash = await prisma.chargeType.findFirst({"
),
  "Charge Master - the labels an invoice may put");

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["src/routes/chargeTypes.ts"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}