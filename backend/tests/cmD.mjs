// SmartERP - Charge Master.
//
// Script 4 of 12: backend/src/routes/chargeTypes.ts, part 2 of 2.
//
// Save this as backend/tests/cmD.mjs and run it from backend/:
//   node tests/cmD.mjs
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

edit("src/routes/chargeTypes.ts",
  L(
    "  // instead of a constraint violation.",
    "  const clash = await prisma.chargeType.findFirst({"),
  L(
    "  // instead of a constraint violation.",
    "  const clash = await prisma.chargeType.findFirst({",
    "    where: { organizationId, label: { equals: trimmed, mode: \"insensitive\" } },",
    "    select: { label: true, isActive: true },",
    "  });",
    "  if (clash) {",
    "    return res.status(409).json({",
    "      message: clash.isActive",
    "        ? `\"${clash.label}\" already exists.`",
    "        : `\"${clash.label}\" already exists but is inactive \u2014 reactivate it rather than adding a second one.`,",
    "    });",
    "  }",
    "",
    "  const chargeType = await prisma.chargeType.create({",
    "    data: {",
    "      organizationId, label: trimmed, accountId: String(accountId),",
    "      sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,",
    "    },",
    "    include: withAccount,",
    "  });",
    "  logAudit({",
    "    organizationId, actorUserId: req.user!.userId,",
    "    action: \"CREATE\", entityType: \"charge_type\", entityId: chargeType.id,",
    "    summary: `Created charge type ${chargeType.label} \u2014 credits ${chargeType.account.accountCode}`,",
    "  });",
    "  res.status(201).json({ data: chargeType });",
    "});",
    "",
    "// PATCH /charge-types/:id - label, account and order.",
    "//",
    "// THE ACCOUNT IS EDITABLE, AND THAT IS SAFE, which is worth stating because",
    "// it looks like it should not be. Every charge already posted holds its own",
    "// account_id, snapshotted at the time (migration_054), so repointing a type",
    "// changes where the NEXT charge lands and rewrites nothing that has been",
    "// issued. Same reasoning as a customer's GSTIN on an old invoice.",
    "router.patch(\"/:id\", canManage, async (req, res) => {",
    "  const organizationId = orgIdOr400(req, res);",
    "  if (!organizationId) return;",
    "  const existing = await prisma.chargeType.findFirst({",
    "    where: { id: req.params.id, organizationId },",
    "  });",
    "  if (!existing) return res.status(404).json({ message: \"Charge type not found.\" });",
    "",
    "  const { label, accountId, sortOrder } = req.body ?? {};",
    "  const data: { label?: string; accountId?: string; sortOrder?: number } = {};",
    "",
    "  if (label !== undefined) {",
    "    const trimmed = String(label).trim();",
    "    if (!trimmed) return res.status(400).json({ message: \"Give the charge a label.\" });",
    "    if (trimmed.length > 60) return res.status(400).json({ message: \"A charge label is at most 60 characters.\" });",
    "    const clash = await prisma.chargeType.findFirst({",
    "      where: { organizationId, label: { equals: trimmed, mode: \"insensitive\" }, id: { not: existing.id } },",
    "      select: { label: true },",
    "    });",
    "    if (clash) return res.status(409).json({ message: `\"${clash.label}\" already exists.` });",
    "    data.label = trimmed;",
    "  }",
    "  if (accountId !== undefined) {",
    "    const problem = await accountProblem(organizationId, accountId);",
    "    if (problem) return res.status(400).json({ message: problem });",
    "    data.accountId = String(accountId);",
    "  }",
    "  if (sortOrder !== undefined && Number.isFinite(Number(sortOrder))) data.sortOrder = Number(sortOrder);",
    "",
    "  const chargeType = await prisma.chargeType.update({",
    "    where: { id: existing.id }, data, include: withAccount,",
    "  });",
    "  logAudit({",
    "    organizationId, actorUserId: req.user!.userId,",
    "    action: \"UPDATE\", entityType: \"charge_type\", entityId: chargeType.id,",
    "    summary: `Updated charge type ${chargeType.label}`,",
    "  });",
    "  res.json({ data: chargeType });",
    "});",
    "",
    "// PATCH /charge-types/:id/toggle - retire it, or bring it back.",
    "//",
    "// There is no DELETE, and there should not be. A charge type that has been",
    "// used is pointed at by documents; deleting it would either fail on the",
    "// foreign key or, worse, take the link with it and leave a report unable to",
    "// say what a recovery was for. Deactivating takes it out of the picker and",
    "// leaves every invoice it ever appeared on exactly as it was.",
    "router.patch(\"/:id/toggle\", canManage, async (req, res) => {",
    "  const organizationId = orgIdOr400(req, res);",
    "  if (!organizationId) return;",
    "  const existing = await prisma.chargeType.findFirst({",
    "    where: { id: req.params.id, organizationId },",
    "  });",
    "  if (!existing) return res.status(404).json({ message: \"Charge type not found.\" });",
    "",
    "  const chargeType = await prisma.chargeType.update({",
    "    where: { id: existing.id },",
    "    data: { isActive: !existing.isActive },",
    "    include: withAccount,",
    "  });",
    "  logAudit({",
    "    organizationId, actorUserId: req.user!.userId,",
    "    action: \"UPDATE\", entityType: \"charge_type\", entityId: chargeType.id,",
    "    summary: `${chargeType.isActive ? \"Reactivated\" : \"Deactivated\"} charge type ${chargeType.label}`,",
    "  });",
    "  res.json({ data: chargeType });",
    "});",
    "",
    "export default router;"),
  "router.patch(\"/:id/toggle\"");

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["src/routes/chargeTypes.ts"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}