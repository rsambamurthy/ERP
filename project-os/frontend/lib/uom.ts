// Common units of measure for BOQ lines. There's no UOM master in
// project-os/backend (unlike Cost Category) — this is a frontend-only
// convenience list for the manual Add Line form so demo data looks
// consistent, not a validated/enforced set. The backend still accepts
// any non-empty string, and Excel import (boq.ts's BOQ_IMPORT_COLUMNS)
// is untouched by this — free text there, same as before.
export const COMMON_UOMS: string[] = [
  "NOS",
  "KG",
  "TON",
  "M",
  "SQM",
  "CUM",
  "LTR",
  "RMT",
  "LOT",
  "DAYS",
  "HRS",
  "BAG",
  "ROLL",
  "SET",
  "PCS",
  "BOX",
];
