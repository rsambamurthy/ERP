# Project OS — AI Project Operating System (R1 Pilot)

A separate application from SmartERP. Per `prd-r1-pilot.docx` (one level
up, in the ERP workspace root) this is the project-centric operating
layer for contractors — Project/Contract, BOQ & Estimation, Procurement,
basic Inventory, basic Site Execution — that integrates with SmartERP as
its accounting backend rather than owning the general ledger itself.

This folder is a sibling of `backend/` and `frontend/` (SmartERP's own
folders) purely for convenience of having one connected workspace. It is
not part of the SmartERP codebase: separate `package.json`, separate
Prisma schema, separate database, no shared imports.

## Status

**R1 — Pilot**, per the PRD. Proves the transaction loop on one real
project for one pilot customer. Not a market/GA release — see the PRD's
Section 16 (Pilot Exit Criteria) for what has to be true before that.

## Structure

- `backend/` — Node/Express/Prisma/PostgreSQL API, mirroring SmartERP
  backend's own conventions (see `backend/README.md`) so anyone familiar
  with one codebase can navigate the other.
- `frontend/` — not yet scaffolded.

## Reference

- `../prd-r1-pilot.docx` — the governing PRD for this release.
- `../AI_Project_Operating_System_Product_Blueprint_v1.docx` (if present)
  — the full product blueprint this R1 scope was cut down from.
- `../mep-gap-analysis.docx` — background research on what SmartERP
  already covers; its architectural recommendation (gate Contracting
  inside SmartERP) was superseded by the decision to build this as a
  separate product.
