import ExcelJS from "exceljs";

// Shared styling for every bulk-upload template (Chart of Accounts, Items,
// Business Partners) — one look, one place to fix it. Ported from
// SmartAppt Gold's vendor-upload template generator (same header/hint-row/
// sample-row/dropdown structure), just parameterized instead of copy-pasted
// per entity.

export interface TemplateColumn {
  header: string; // e.g. "Code *" — the "*" convention marks required columns
  hint: string; // small italic row-2 hint, e.g. "← required" or "← pick from list"
  width: number;
  dropdown?: string[]; // short fixed list -> inline Excel data-validation dropdown
  numFmt?: string; // e.g. "#,##0.00" or "dd-mmm-yyyy"
  align?: "center";
}

const HEADER_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF1E3A5F" } };
const HINT_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF9FAFB" } };
const THIN_BORDER = { style: "thin" as const, color: { argb: "FF3B5998" } };
const HAIR_BORDER = { style: "hair" as const, color: { argb: "FFE5E7EB" } };

export async function buildTemplateWorkbook(
  sheetName: string,
  columns: TemplateColumn[],
  sampleRows = 200
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SmartERP";
  wb.created = new Date();

  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns.map((c) => ({ width: c.width }));

  const hdr = ws.getRow(1);
  hdr.height = 22;
  hdr.values = columns.map((c) => c.header);
  hdr.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11, name: "Calibri" };
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER };
  });

  const hint = ws.getRow(2);
  hint.height = 14;
  hint.values = columns.map((c) => c.hint);
  hint.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { italic: true, color: { argb: "FF6B7280" }, size: 9, name: "Calibri" };
    cell.fill = HINT_FILL;
  });

  for (let r = 3; r <= 2 + sampleRows; r++) {
    const row = ws.getRow(r);
    const bg = r % 2 === 0 ? "FFFAFAFA" : "FFFFFFFF";
    columns.forEach((c, idx) => {
      const cell = row.getCell(idx + 1);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
      cell.font = { color: { argb: "FF111827" }, size: 11, name: "Calibri" };
      cell.border = { top: HAIR_BORDER, bottom: HAIR_BORDER, left: HAIR_BORDER, right: HAIR_BORDER };
      if (c.dropdown) {
        cell.dataValidation = {
          type: "list",
          formulae: [`"${c.dropdown.join(",")}"`],
          showErrorMessage: true,
          errorTitle: "Invalid value",
          error: `Choose one of: ${c.dropdown.join(", ")}`,
          showInputMessage: true,
          promptTitle: c.header.replace(" *", ""),
          prompt: `One of: ${c.dropdown.join(", ")}`,
        };
      }
      if (c.numFmt) cell.numFmt = c.numFmt;
      if (c.align) cell.alignment = { horizontal: c.align };
    });
  }

  ws.views = [{ state: "frozen", ySplit: 2, xSplit: 0, topLeftCell: "A3" }];
  const lastCol = columns.length <= 26 ? String.fromCharCode(64 + columns.length) : "Z";
  ws.autoFilter = { from: "A1", to: `${lastCol}1` };

  const raw = await wb.xlsx.writeBuffer();
  return Buffer.from(raw);
}

// Loads the first (only) worksheet of an uploaded workbook. Callers iterate
// rows starting at 3 — rows 1-2 are the header and hint row laid down by
// buildTemplateWorkbook above.
export async function loadUploadedWorksheet(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  return wb.worksheets[0] ?? null;
}

// `row` is untyped (ExcelJS's own Row type varies across its bundled
// declarations) — every caller only ever does row.getCell(n).value, which
// is stable across versions, so `any` here is deliberate rather than lazy.
export function cellText(row: any, col: number): string | null {
  const v = row.getCell(col).value;
  if (v == null) return null;
  const s = typeof v === "object" && "text" in (v as any) ? (v as any).text : String(v);
  const trimmed = String(s).trim();
  return trimmed === "" ? null : trimmed;
}

export function cellDateIso(row: any, col: number): string | null {
  const v = row.getCell(col).value;
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
}
