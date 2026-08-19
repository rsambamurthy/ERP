import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { upload } from "../lib/upload";
import { buildTemplateWorkbook, loadUploadedWorksheet, cellText, cellDateIso } from "../lib/xlsxTemplate";

const router = Router();
router.use(authenticate, requireActiveSubscription);
const canManageBp = requirePermission("businessPartners.manage");

// stateCode (the 2-digit GST state code) is auto-filled from a GSTIN's
// first 2 characters when one is set, but stays independently editable —
// a B2C customer or an unregistered vendor still has a state without
// having a GSTIN. See migration_014 / branches.ts's identical helper.
function resolveStateCode(stateCode: unknown, gstin: unknown): string | null | undefined {
  if (stateCode !== undefined) return stateCode ? String(stateCode).trim() : null;
  if (gstin) return String(gstin).trim().toUpperCase().slice(0, 2);
  return undefined;
}

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

// GET /business-partners?bpType=CUSTOMER|VENDOR
router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const bpType = req.query.bpType ? String(req.query.bpType) : undefined;
  const partners = await prisma.businessPartner.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ...(bpType ? { bpType } : {}),
    },
    orderBy: { name: "asc" },
  });
  res.json({ data: partners });
});

// GET /business-partners/:id — full detail including Vendor Management
// (Phase 1) child records. Contacts/addresses/bank accounts are returned
// regardless of bpType (harmless if empty for a CUSTOMER) rather than
// gating the route itself on bpType — same "present but unused" convention
// as openingBalance/address already follow.
router.get("/:id", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const partner = await prisma.businessPartner.findFirst({
    where: { id: req.params.id, organizationId },
    include: {
      vendorContacts: { orderBy: { isPrimary: "desc" } },
      vendorAddresses: { orderBy: { isPrimary: "desc" } },
      vendorBankAccounts: { orderBy: { isPrimary: "desc" } },
    },
  });
  if (!partner) return res.status(404).json({ message: "Business partner not found." });
  res.json({ data: partner });
});

// POST /business-partners — creates a customer or vendor master record.
router.post("/", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const { bpType, name, gstin, stateCode, phone, email, address, openingBalance, openingBalanceType, vendorCategory, taxIdType, taxId, submitForApproval } = req.body ?? {};
  if (!bpType || !["CUSTOMER", "VENDOR"].includes(bpType) || !name) {
    return res.status(400).json({ message: "bpType (CUSTOMER or VENDOR) and name are required." });
  }

  const partner = await prisma.businessPartner.create({
    data: {
      organizationId,
      bpType, name,
      gstin: gstin ?? null,
      stateCode: resolveStateCode(stateCode, gstin) ?? null,
      phone: phone ?? null,
      email: email ?? null,
      address: address ?? null,
      openingBalance: openingBalance ?? 0,
      openingBalanceType: openingBalanceType ?? null,
      // Only meaningful for bpType VENDOR — harmless/unused on CUSTOMER.
      vendorCategory: vendorCategory ?? null,
      // International tax registration (EIN/GST-HST/VAT/...) — separate
      // from gstin, see the schema comment on BusinessPartner.taxIdType.
      taxIdType: taxIdType ?? null,
      taxId: taxId ?? null,
      // Optional — Prisma's schema default (APPROVED) applies unless the
      // caller deliberately routes a new vendor through the approval
      // placeholder at creation time (see the Vendor Management routes
      // below for submit-for-approval/approve/reject).
      ...(submitForApproval ? { approvalStatus: "PENDING_APPROVAL" } : {}),
    },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "CREATE", entityType: "business_partner", entityId: partner.id,
    summary: `Created ${bpType.toLowerCase()} ${partner.name}`,
  });
  res.status(201).json({ data: partner });
});

router.patch("/:id", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const partner = await prisma.businessPartner.findFirst({
    where: { id: req.params.id, organizationId },
  });
  if (!partner) return res.status(404).json({ message: "Business partner not found." });

  const body = { ...(req.body ?? {}) };
  if (body.stateCode === undefined && body.gstin !== undefined) {
    const derived = resolveStateCode(undefined, body.gstin);
    if (derived !== undefined) body.stateCode = derived;
  }
  // Approval-workflow fields only ever move through submit-for-approval/
  // approve/reject below — never a raw PATCH, so the PENDING_APPROVAL-only
  // gate and audit trail on those routes can't be bypassed.
  delete body.approvalStatus;
  delete body.approvedBy;
  delete body.approvedAt;
  delete body.rejectedBy;
  delete body.rejectedAt;
  delete body.rejectionReason;

  const updated = await prisma.businessPartner.update({
    where: { id: partner.id },
    data: body,
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "business_partner", entityId: partner.id,
    summary: `Updated ${partner.name}`,
  });
  res.json({ data: updated });
});

router.patch("/:id/toggle", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const partner = await prisma.businessPartner.findFirst({
    where: { id: req.params.id, organizationId },
  });
  if (!partner) return res.status(404).json({ message: "Business partner not found." });

  const updated = await prisma.businessPartner.update({
    where: { id: partner.id },
    data: { isActive: !partner.isActive },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "TOGGLE", entityType: "business_partner", entityId: partner.id,
    summary: `${updated.isActive ? "Activated" : "Deactivated"} ${partner.name}`,
  });
  res.json({ data: updated });
});

router.delete("/:id", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const partner = await prisma.businessPartner.findFirst({
    where: { id: req.params.id, organizationId },
  });
  if (!partner) return res.status(404).json({ message: "Business partner not found." });

  const used = await prisma.journalLine.findFirst({ where: { businessPartnerId: partner.id } });
  if (used) {
    return res.status(409).json({ message: "This business partner has journal entries and cannot be deleted." });
  }

  await prisma.businessPartner.update({ where: { id: partner.id }, data: { deletedAt: new Date() } });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "DELETE", entityType: "business_partner", entityId: partner.id,
    summary: `Deleted ${partner.name}`,
  });
  res.json({ data: { deleted: true } });
});

// ── Vendor Management (Phase 1) ─────────────────────────────────────────
// Multiple contacts / labeled addresses / bank accounts, plus a minimal
// single-step approval workflow on the partner itself. Everything here
// rides on the existing businessPartners.manage permission — no new
// permission, no vendor-specific access control. See migration_028's
// header comment for why the approval workflow is deliberately this thin.

async function findPartnerOr404(organizationId: string, id: string, res: import("express").Response) {
  const partner = await prisma.businessPartner.findFirst({ where: { id, organizationId } });
  if (!partner) res.status(404).json({ message: "Business partner not found." });
  return partner;
}

// Contacts
router.post("/:id/contacts", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const partner = await findPartnerOr404(organizationId, req.params.id, res);
  if (!partner) return;
  const { name, designation, phone, email, isPrimary } = req.body ?? {};
  if (!name) return res.status(400).json({ message: "name is required." });
  const contact = await prisma.vendorContact.create({
    data: { businessPartnerId: partner.id, name, designation: designation ?? null, phone: phone ?? null, email: email ?? null, isPrimary: !!isPrimary },
  });
  res.status(201).json({ data: contact });
});

router.patch("/:id/contacts/:contactId", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const partner = await findPartnerOr404(organizationId, req.params.id, res);
  if (!partner) return;
  const contact = await prisma.vendorContact.findFirst({ where: { id: req.params.contactId, businessPartnerId: partner.id } });
  if (!contact) return res.status(404).json({ message: "Contact not found." });
  const updated = await prisma.vendorContact.update({ where: { id: contact.id }, data: req.body ?? {} });
  res.json({ data: updated });
});

router.delete("/:id/contacts/:contactId", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const partner = await findPartnerOr404(organizationId, req.params.id, res);
  if (!partner) return;
  const contact = await prisma.vendorContact.findFirst({ where: { id: req.params.contactId, businessPartnerId: partner.id } });
  if (!contact) return res.status(404).json({ message: "Contact not found." });
  await prisma.vendorContact.delete({ where: { id: contact.id } });
  res.json({ data: { deleted: true } });
});

// Addresses
router.post("/:id/addresses", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const partner = await findPartnerOr404(organizationId, req.params.id, res);
  if (!partner) return;
  const { label, line1, line2, city, state, stateCode, pincode, country, isPrimary } = req.body ?? {};
  const address = await prisma.vendorAddress.create({
    data: {
      businessPartnerId: partner.id,
      label: label || "Registered",
      line1: line1 ?? null, line2: line2 ?? null, city: city ?? null, state: state ?? null,
      stateCode: stateCode ?? null, pincode: pincode ?? null, country: country || "India",
      isPrimary: !!isPrimary,
    },
  });
  res.status(201).json({ data: address });
});

router.patch("/:id/addresses/:addressId", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const partner = await findPartnerOr404(organizationId, req.params.id, res);
  if (!partner) return;
  const address = await prisma.vendorAddress.findFirst({ where: { id: req.params.addressId, businessPartnerId: partner.id } });
  if (!address) return res.status(404).json({ message: "Address not found." });
  const updated = await prisma.vendorAddress.update({ where: { id: address.id }, data: req.body ?? {} });
  res.json({ data: updated });
});

router.delete("/:id/addresses/:addressId", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const partner = await findPartnerOr404(organizationId, req.params.id, res);
  if (!partner) return;
  const address = await prisma.vendorAddress.findFirst({ where: { id: req.params.addressId, businessPartnerId: partner.id } });
  if (!address) return res.status(404).json({ message: "Address not found." });
  await prisma.vendorAddress.delete({ where: { id: address.id } });
  res.json({ data: { deleted: true } });
});

// Bank accounts
router.post("/:id/bank-accounts", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const partner = await findPartnerOr404(organizationId, req.params.id, res);
  if (!partner) return;
  const { accountHolderName, bankName, accountNumber, ifscCode, swiftCode, routingNumber, branchName, isPrimary } = req.body ?? {};
  const bankAccount = await prisma.vendorBankAccount.create({
    data: {
      businessPartnerId: partner.id,
      accountHolderName: accountHolderName ?? null, bankName: bankName ?? null,
      accountNumber: accountNumber ?? null, ifscCode: ifscCode ?? null,
      swiftCode: swiftCode ?? null, routingNumber: routingNumber ?? null,
      branchName: branchName ?? null,
      isPrimary: !!isPrimary,
    },
  });
  res.status(201).json({ data: bankAccount });
});

router.patch("/:id/bank-accounts/:bankAccountId", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const partner = await findPartnerOr404(organizationId, req.params.id, res);
  if (!partner) return;
  const bankAccount = await prisma.vendorBankAccount.findFirst({ where: { id: req.params.bankAccountId, businessPartnerId: partner.id } });
  if (!bankAccount) return res.status(404).json({ message: "Bank account not found." });
  const updated = await prisma.vendorBankAccount.update({ where: { id: bankAccount.id }, data: req.body ?? {} });
  res.json({ data: updated });
});

router.delete("/:id/bank-accounts/:bankAccountId", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const partner = await findPartnerOr404(organizationId, req.params.id, res);
  if (!partner) return;
  const bankAccount = await prisma.vendorBankAccount.findFirst({ where: { id: req.params.bankAccountId, businessPartnerId: partner.id } });
  if (!bankAccount) return res.status(404).json({ message: "Bank account not found." });
  await prisma.vendorBankAccount.delete({ where: { id: bankAccount.id } });
  res.json({ data: { deleted: true } });
});

// Approval workflow — single-step placeholder (see migration_028's header
// comment). Any status -> PENDING_APPROVAL is allowed (an org may want to
// re-review an already-APPROVED vendor); APPROVED/REJECTED only reachable
// from PENDING_APPROVAL, same gating shape as Purchase Order/Bill approval.
router.post("/:id/submit-for-approval", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const partner = await findPartnerOr404(organizationId, req.params.id, res);
  if (!partner) return;
  const updated = await prisma.businessPartner.update({
    where: { id: partner.id },
    data: { approvalStatus: "PENDING_APPROVAL", approvedBy: null, approvedAt: null, rejectedBy: null, rejectedAt: null, rejectionReason: null },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "SUBMIT_FOR_APPROVAL", entityType: "business_partner", entityId: partner.id,
    summary: `Submitted ${partner.name} for approval`,
  });
  res.json({ data: updated });
});

router.post("/:id/approve", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const partner = await findPartnerOr404(organizationId, req.params.id, res);
  if (!partner) return;
  if (partner.approvalStatus !== "PENDING_APPROVAL") {
    return res.status(400).json({ message: `Cannot approve a partner in ${partner.approvalStatus} status — only Pending Approval can be approved.` });
  }
  const updated = await prisma.businessPartner.update({
    where: { id: partner.id },
    data: { approvalStatus: "APPROVED", approvedBy: req.user!.userId, approvedAt: new Date(), rejectedBy: null, rejectedAt: null, rejectionReason: null },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "APPROVE", entityType: "business_partner", entityId: partner.id,
    summary: `Approved ${partner.name}`,
  });
  res.json({ data: updated });
});

router.post("/:id/reject", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const partner = await findPartnerOr404(organizationId, req.params.id, res);
  if (!partner) return;
  if (partner.approvalStatus !== "PENDING_APPROVAL") {
    return res.status(400).json({ message: `Cannot reject a partner in ${partner.approvalStatus} status — only Pending Approval can be rejected.` });
  }
  const { reason } = req.body ?? {};
  if (!reason) return res.status(400).json({ message: "reason is required." });
  const updated = await prisma.businessPartner.update({
    where: { id: partner.id },
    data: { approvalStatus: "REJECTED", rejectedBy: req.user!.userId, rejectedAt: new Date(), rejectionReason: reason },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "REJECT", entityType: "business_partner", entityId: partner.id,
    summary: `Rejected ${partner.name}: ${reason}`,
  });
  res.json({ data: updated });
});

// ── Bulk upload (Template Download + Bulk Upload) ─────────────────────────
// Business Partners have no natural key until one is given here — a row
// with a Code matches an existing partner by (org, code) for update;
// a row with a blank Code always creates a new partner (never matched
// against anything, since name alone isn't reliable — see ROADMAP-adjacent
// decision made when this was designed).

const BP_COLUMNS = [
  { header: "Type *", hint: "← pick from list", width: 12, dropdown: ["CUSTOMER", "VENDOR"] },
  { header: "Code", hint: "optional — set to update later via re-upload", width: 14 },
  { header: "Name *", hint: "← required", width: 30 },
  { header: "GSTIN", hint: "optional", width: 18 },
  { header: "Phone", hint: "optional", width: 15 },
  { header: "Email", hint: "optional", width: 26 },
  { header: "Address", hint: "optional", width: 30 },
  { header: "Opening Balance", hint: "optional, number", width: 16, numFmt: "#,##0.00" },
  { header: "DR / CR", hint: "required if balance given", width: 9, dropdown: ["DR", "CR"], align: "center" as const },
  { header: "As On Date", hint: "optional", width: 14, numFmt: "dd-mmm-yyyy" },
];

interface BpPreviewRow {
  rowNum: number;
  bpType: "CUSTOMER" | "VENDOR" | null;
  code: string | null;
  name: string;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  openingBalance: number | null;
  openingBalanceType: "DEBIT" | "CREDIT" | null;
  openingBalanceDate: string | null;
  status: "create" | "update" | "error";
  error?: string;
}

router.get("/bulk-upload/template", canManageBp, async (req, res) => {
  const buffer = await buildTemplateWorkbook("Business Partners", BP_COLUMNS);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="SmartERP_BusinessPartners_Template.xlsx"');
  res.send(buffer);
});

router.post("/bulk-upload/preview", canManageBp, upload.single("file"), async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  if (!req.file) return res.status(400).json({ message: "No file uploaded." });

  const ws = await loadUploadedWorksheet(req.file.buffer);
  if (!ws) return res.json({ data: [] });

  const existing = await prisma.businessPartner.findMany({
    where: { organizationId, deletedAt: null, code: { not: null } },
    select: { code: true },
  });
  const byCode = new Set(existing.map((p) => p.code!.trim()));

  const preview: BpPreviewRow[] = [];

  ws.eachRow((row, rowNum) => {
    if (rowNum <= 2) return;
    const typeRaw = (cellText(row, 1) ?? "").toUpperCase();
    const name = cellText(row, 3);
    if (!typeRaw && !name) return;

    const push = (status: BpPreviewRow["status"], error?: string) =>
      preview.push({
        rowNum,
        bpType: typeRaw === "CUSTOMER" || typeRaw === "VENDOR" ? typeRaw : null,
        code: cellText(row, 2), name: name ?? "",
        gstin: cellText(row, 4), phone: cellText(row, 5), email: cellText(row, 6), address: cellText(row, 7),
        openingBalance: null, openingBalanceType: null, openingBalanceDate: cellDateIso(row, 10),
        status, error,
      });

    if (typeRaw !== "CUSTOMER" && typeRaw !== "VENDOR") return push("error", 'Type must be "CUSTOMER" or "VENDOR"');
    if (!name) return push("error", "Name is required");

    const code = cellText(row, 2);
    const status: "create" | "update" = code && byCode.has(code) ? "update" : "create";

    const balRaw = row.getCell(8).value;
    const balance = balRaw != null && balRaw !== "" ? Number(balRaw) : null;
    if (balance !== null && isNaN(balance)) return push("error", "Opening balance is not a valid number");

    const sideRaw = (cellText(row, 9) ?? "").toUpperCase();
    let side: "DEBIT" | "CREDIT" | null = null;
    if (sideRaw === "DR") side = "DEBIT";
    else if (sideRaw === "CR") side = "CREDIT";
    else if (sideRaw) return push("error", `Invalid DR/CR value: "${sideRaw}"`);
    if (balance && balance > 0 && !side) return push("error", "DR/CR is required when Opening Balance is given");

    preview.push({
      rowNum, bpType: typeRaw as "CUSTOMER" | "VENDOR", code, name,
      gstin: cellText(row, 4), phone: cellText(row, 5), email: cellText(row, 6), address: cellText(row, 7),
      openingBalance: balance, openingBalanceType: side, openingBalanceDate: cellDateIso(row, 10),
      status,
    });
  });

  res.json({ data: preview });
});

router.post("/bulk-upload/apply", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const rows: BpPreviewRow[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const workRows = rows.filter((r) => r.status === "create" || r.status === "update");
  if (workRows.length === 0) return res.json({ data: { created: 0, updated: 0 } });

  const existing = await prisma.businessPartner.findMany({
    where: { organizationId, deletedAt: null, code: { not: null } },
    select: { id: true, code: true },
  });
  const byCode = new Map<string, string>(existing.map((p) => [p.code!.trim(), p.id]));

  // Resolve every row to either an update against an existing id, or a new
  // create — *before* touching the database. This replaces what used to be one
  // awaited prisma call per row: a 9,625-row import meant 9,625 sequential
  // round trips, which took minutes and, with no transaction around it, left
  // half the file imported if anything failed partway.
  //
  // The pass below preserves the old sequential semantics exactly, including
  // the subtle one: if the same Code appears twice in a single file, the first
  // occurrence used to create and the second used to update what the first had
  // just made. There is a partial unique index on (organization_id, code)
  // where code is not null (migration_007), so a naive createMany over both
  // rows would blow up with a unique violation instead. Here the second
  // occurrence overwrites the pending create's data — last write wins, same
  // net row, same created/updated tallies as before.
  const rowData = (row: BpPreviewRow) => ({
    bpType: row.bpType!,
    name: row.name,
    gstin: row.gstin,
    phone: row.phone,
    email: row.email,
    address: row.address ? { full: row.address } : undefined,
    openingBalance: row.openingBalance ?? 0,
    openingBalanceType: row.openingBalanceType,
  });

  type CreateInput = ReturnType<typeof rowData> & { organizationId: string; code: string | null };
  const creates: CreateInput[] = [];
  const updates: { id: string; data: ReturnType<typeof rowData> }[] = [];
  const pendingCreateIdx = new Map<string, number>();

  let created = 0, updated = 0;
  for (const row of workRows) {
    const code = row.code ? row.code.trim() : null;
    const existingId = code ? byCode.get(code) : undefined;

    if (existingId) {
      updates.push({ id: existingId, data: rowData(row) });
      updated++;
      continue;
    }

    const pending = code != null ? pendingCreateIdx.get(code) : undefined;
    if (pending !== undefined) {
      creates[pending] = { ...creates[pending], ...rowData(row) };
      updated++;
      continue;
    }

    if (code != null) pendingCreateIdx.set(code, creates.length);
    creates.push({ organizationId, code: row.code, ...rowData(row) });
    created++;
  }

  // One transaction so a failure anywhere leaves the org's data untouched
  // rather than partially imported. createMany batches the inserts into a
  // handful of multi-row INSERTs instead of one statement per row; updates
  // still cost a statement each, but in practice a re-import updates far
  // fewer rows than it creates. The timeout is generous because this is an
  // explicitly bulk operation, not a user-facing read path.
  const CHUNK = 1000;
  await prisma.$transaction(
    async (tx) => {
      for (let i = 0; i < creates.length; i += CHUNK) {
        await tx.businessPartner.createMany({ data: creates.slice(i, i + CHUNK) });
      }
      for (const u of updates) {
        await tx.businessPartner.update({ where: { id: u.id }, data: u.data });
      }
    },
    { timeout: 120_000, maxWait: 15_000 }
  );
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "BULK_UPLOAD", entityType: "business_partner", entityId: organizationId,
    summary: `Bulk upload: ${created} business partner(s) created, ${updated} updated`,
  });
  res.json({ data: { created, updated } });
});

export default router;
