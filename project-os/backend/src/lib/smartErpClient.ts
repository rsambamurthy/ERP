import { prisma } from "../db";

export interface SmartErpClient {
  apiBaseUrl: string;
  apiKey: string;
}

// Looks up this org's SmartERP connection — set via POST
// /integration/connection, using an API key generated on the SmartERP
// side (POST /integration/connections there, OWNER/ADMIN). Returns null
// if never configured, meaning the org is running Project OS standalone
// — the manual synced-*/POST endpoints in routes/integration.ts are the
// fallback for exactly that case.
export async function getSmartErpClient(organizationId: string): Promise<SmartErpClient | null> {
  const connection = await prisma.smartErpConnection.findUnique({ where: { organizationId } });
  if (!connection || !connection.apiKeyCiphertext) return null;
  return { apiBaseUrl: connection.apiBaseUrl.replace(/\/$/, ""), apiKey: connection.apiKeyCiphertext };
}

// Thin wrapper over the global fetch (Node 18+, no extra dependency) —
// attaches the X-Api-Key header SmartERP's middleware/serviceAuth.ts
// expects, and turns a non-2xx response into a thrown Error carrying
// SmartERP's own { message } body when present, so callers can surface
// it directly rather than a generic "request failed".
export async function smartErpFetch(client: SmartErpClient, path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${client.apiBaseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Api-Key": client.apiKey, ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body && typeof body === "object" && "message" in body ? String((body as any).message) : `SmartERP request failed (HTTP ${res.status}).`;
    throw Object.assign(new Error(message), { status: res.status });
  }
  return body;
}
