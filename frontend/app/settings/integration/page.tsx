"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import {
  ApiError, generateIntegrationConnection, getIntegrationConnection, revokeIntegrationConnection,
} from "@/lib/api";
import type { IntegrationConnectionStatus } from "@/lib/types";

// Owner/Admin screen for the API key an external system (currently: Project
// OS) presents to routes/integrationApi.ts to pull master data and push
// shadow POs/GRNs. Previously only reachable via curl (POST
// /integration/connections) — this is what makes it self-serve for a demo.
export default function IntegrationSettingsPage() {
  const [connection, setConnection] = useState<IntegrationConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("Project OS");
  const [generating, setGenerating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  // The raw key only ever exists in memory, right after generating it —
  // never persisted, never refetched. Same "shown once" convention as the
  // Team page's invite link.
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function load() {
    setLoading(true);
    getIntegrationConnection()
      .then(({ data }) => setConnection(data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the connection."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setGenerating(true);
    setCopied(false);
    try {
      const { data } = await generateIntegrationConnection(label || undefined);
      setFreshKey(data.apiKey);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not generate a key.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleRevoke() {
    if (!confirm("Revoke this API key? Whatever system is using it (e.g. Project OS) will stop being able to sync until a new key is generated and re-entered there.")) return;
    setError(null);
    setRevoking(true);
    try {
      await revokeIntegrationConnection();
      setFreshKey(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not revoke the key.");
    } finally {
      setRevoking(false);
    }
  }

  function handleCopy() {
    if (!freshKey) return;
    navigator.clipboard.writeText(freshKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const isLive = connection && !connection.revokedAt;

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Integration</h1>
        <p>The API key an external system (e.g. Project OS) uses to sync master data and push shadow POs/GRNs here.</p>
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="ent-section" style={{ marginBottom: 20 }}>
        <div className="ent-section-hdr"><span className="ent-section-title">Connection Status</span></div>
        <div style={{ padding: 14 }}>
          {loading ? (
            <p className="ent-empty">Loading…</p>
          ) : connection ? (
            <>
              <table style={{ fontSize: 13, marginBottom: 12 }}>
                <tbody>
                  <tr>
                    <td style={{ color: "var(--color-muted)", paddingRight: 16, paddingBottom: 6 }}>Status</td>
                    <td style={{ paddingBottom: 6 }}>
                      <span className={isLive ? "badge badge-green" : "badge badge-gray"}>
                        {isLive ? "Active" : "Revoked"}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ color: "var(--color-muted)", paddingRight: 16, paddingBottom: 6 }}>Label</td>
                    <td style={{ paddingBottom: 6 }}>{connection.label ?? "—"}</td>
                  </tr>
                  <tr>
                    <td style={{ color: "var(--color-muted)", paddingRight: 16, paddingBottom: 6 }}>Key</td>
                    <td style={{ paddingBottom: 6, fontFamily: "monospace" }}>••••••••••••{connection.apiKeyLast4}</td>
                  </tr>
                  <tr>
                    <td style={{ color: "var(--color-muted)", paddingRight: 16, paddingBottom: 6 }}>Generated</td>
                    <td style={{ paddingBottom: 6 }}>{new Date(connection.createdAt).toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td style={{ color: "var(--color-muted)", paddingRight: 16 }}>Last used</td>
                    <td>{connection.lastUsedAt ? new Date(connection.lastUsedAt).toLocaleString() : "Never"}</td>
                  </tr>
                </tbody>
              </table>
              {isLive && (
                <button className="ent-ia ent-ia-del" onClick={handleRevoke} disabled={revoking}>
                  {revoking ? "Revoking…" : "Revoke key"}
                </button>
              )}
            </>
          ) : (
            <p className="ent-empty">No integration connection configured yet.</p>
          )}
        </div>
      </div>

      <div className="ent-section">
        <div className="ent-section-hdr">
          <span className="ent-section-title">{connection ? "Generate a new key" : "Generate a key"}</span>
        </div>
        <div style={{ padding: 14 }}>
          <p style={{ fontSize: 13, color: "var(--color-muted)", marginBottom: 12 }}>
            {connection
              ? "Generating a new key immediately revokes the current one — only one key is live per organization at a time. Update the connection on the other system with the new key right after."
              : "This is what Project OS (or any other integration) authenticates with. Only one key can be live at a time."}
          </p>
          <form onSubmit={handleGenerate} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="ent-fg" style={{ minWidth: 220 }}>
              <label className="ent-fl">Label</label>
              <input className="ent-fc" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Project OS" />
            </div>
            <button type="submit" className="ent-btn-save" disabled={generating}>
              {generating ? "Generating…" : connection ? "Regenerate key" : "Generate key"}
            </button>
          </form>

          {freshKey && (
            <div style={{ marginTop: 16, padding: 12, border: "1px solid #059669", borderRadius: 8, background: "#f0fdf4" }}>
              <p style={{ fontSize: 13, color: "#065f46", marginBottom: 8, fontWeight: 500 }}>
                Copy this now — it won&apos;t be shown again.
              </p>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <code style={{ fontSize: 12, wordBreak: "break-all", flex: 1 }}>{freshKey}</code>
                <button type="button" className="ent-ia ent-ia-edit" onClick={handleCopy}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p style={{ fontSize: 12, color: "var(--color-muted)", marginTop: 8 }}>
                Paste this into Project OS's Settings &gt; Integration page along with this organization's API base URL.
              </p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
