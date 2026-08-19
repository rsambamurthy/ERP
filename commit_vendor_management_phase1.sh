#!/usr/bin/env bash
# Vendor Management — Phase 1 (profile depth + minimal approval workflow).
# Review the diff, then run this yourself: bash commit_vendor_management_phase1.sh
set -euo pipefail

cd "$(dirname "$0")"

git add \
  db/migration_028_vendor_management.sql \
  backend/prisma/schema.prisma \
  backend/src/routes/businessPartners.ts \
  backend/src/routes/purchaseOrders.ts \
  backend/src/routes/purchaseBills.ts \
  backend/README.md \
  frontend/lib/types.ts \
  frontend/lib/api.ts \
  frontend/lib/auth.ts \
  "frontend/app/accounting/business-partners/page.tsx" \
  "frontend/app/accounting/business-partners/[id]/page.tsx"

git commit -m "Vendor Management Phase 1: profile depth + approval workflow

- Extend BusinessPartner (bpType=VENDOR) with vendorCategory,
  approvalStatus (+ approve/reject audit fields), taxIdType/taxId
  (generic, separate from GSTIN/India GST engine).
- New vendor_contacts, vendor_addresses (with country), and
  vendor_bank_accounts (ifscCode/swiftCode/routingNumber) tables.
- Minimal single-step approval workflow (submit-for-approval/approve/
  reject routes) reusing businessPartners.manage — a placeholder for a
  future generic Workflow Management System.
- purchaseOrders.ts/purchaseBills.ts block create/edit against a vendor
  that isn't APPROVED.
- Frontend: vendor detail page (Basic Details, approval banner,
  Contacts/Addresses/Bank Accounts CRUD), extended create form, list
  page links to detail.

Run db/migration_028_vendor_management.sql against your database, then
npx prisma generate in backend/ before deploying."

echo "Committed. Push when ready: git push"
