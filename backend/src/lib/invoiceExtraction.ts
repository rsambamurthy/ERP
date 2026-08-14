// Reads a vendor invoice (PDF or image, uploaded via multer memoryStorage —
// see lib/upload.ts) using Claude's vision/document understanding and
// returns structured data. Used by POST /purchase-bills/extract-invoice.
// Never posts anything itself — the caller decides what to do with the
// result (auto-fill on a manual bill, or a read-only comparison against
// GRN-derived lines on a PO-linked bill).

export interface ExtractedInvoiceLine {
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}

export interface ExtractedInvoice {
  vendorName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null; // YYYY-MM-DD
  currency: string;
  grandTotal: number | null;
  lines: ExtractedInvoiceLine[];
}

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5";

const EXTRACTION_PROMPT = `Extract this vendor invoice into strict JSON with exactly this shape — no prose, no markdown code fences, just the JSON object:
{
  "vendorName": string or null,
  "invoiceNumber": string or null,
  "invoiceDate": "YYYY-MM-DD" or null,
  "currency": ISO 4217 currency code, default "INR" if not shown,
  "grandTotal": number or null (the final total payable, including tax),
  "lines": [ { "description": string, "quantity": number, "rate": number, "amount": number } ]
}
Use null for any field you can't read confidently. Include every line item you can find. Return only the JSON object, nothing else.`;

export async function extractInvoiceData(buffer: Buffer, mimeType: string): Promise<ExtractedInvoice> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Invoice extraction isn't configured — ANTHROPIC_API_KEY is missing on the server.");
  }

  const isPdf = mimeType === "application/pdf";
  const fileBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") } }
    : { type: "image", source: { type: "base64", media_type: mimeType, data: buffer.toString("base64") } };

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: [fileBlock, { type: "text", text: EXTRACTION_PROMPT }] }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Invoice extraction failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const body = (await res.json()) as { content?: { type: string; text?: string }[] };
  const raw = body.content?.find((c) => c.type === "text")?.text ?? "";
  const jsonText = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed: Partial<ExtractedInvoice> & { lines?: Partial<ExtractedInvoiceLine>[] };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Could not parse the extracted invoice — the file may be unreadable or not an invoice.");
  }

  return {
    vendorName: parsed.vendorName ?? null,
    invoiceNumber: parsed.invoiceNumber ?? null,
    invoiceDate: parsed.invoiceDate ?? null,
    currency: parsed.currency ?? "INR",
    grandTotal: typeof parsed.grandTotal === "number" ? parsed.grandTotal : null,
    lines: Array.isArray(parsed.lines)
      ? parsed.lines.map((l) => ({
          description: String(l?.description ?? "").slice(0, 200),
          quantity: Number(l?.quantity ?? 0),
          rate: Number(l?.rate ?? 0),
          amount: Number(l?.amount ?? 0),
        }))
      : [],
  };
}
