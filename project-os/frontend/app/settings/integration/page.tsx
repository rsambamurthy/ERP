"use client";

import { useEffect, useState } from "react";
import AppShell from "../../../components/layout/AppShell";
import { canManageIntegration } from "../../../lib/auth";
import { getSmartErpConnection, saveSmartErpConnection, syncSmartErp, ApiError } from "../../../lib/api";
import { SmartErpConnectionStatus, SyncResult } from "../../../lib/types";

// The connection + sync job itself (task #118) already existed on the
// backend — POST /integration/connection, POST /integration/sync — but
// had no UI until now, so setting it up meant driving it with curl. This
// page is what actually populates the Item and Customer pickers used
// elsewhere (BOQ Add Line, New Project) with real SmartERP data.
export default function IntegrationSettingsPage() {
  return (
    <AppShell>
      <IntegrationInner />
    </AppShell>
  );
}

function IntegrationInner() {
  const [connection, setConnection] = useState<SmartErpConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  function load() {
    setLoading(true);
    getSmartErpConnection()
      .then(({ data }) => {
        setConnection(data);
        if (data) setApiBaseUrl(data.apiBaseUrl);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load connection."))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      await saveSmartErpConnection({ apiBaseUrl, apiKey });
      setApiKey("");
      setNotice("Connection saved.");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save connection.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSync() {
    setError(null);
    setSyncing(true);
    setSyncResult(null);
    try {
      const { data } = await syncSmartErp();
      setSyncResult(data);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  if (!canManageIntegration()) {
    return <p className="pos-error">Only a Super Admin can manage the SmartERP connection.</p>;
  }

  return (
    <>
      <div className="pos-page-hdr">
        <div>
          <h1 className="pos-page-title">SmartERP Integration</h1>
          <p className="pos-page-sub">
            Section 9.1 — connect this org to a SmartERP organization and pull its Business Partners, Items and
            Branches in read-only. This is what populates the Customer and Item pickers used elsewhere in Project OS.
          </p>
        </div>
      </div>

      {error && <p className="pos-error mb-4">{error}</p>}
      {notice && <p className="text-sm text-green-700 mb-4">{notice}</p>}

      <div className="pos-section">
        <div className="pos-section-title">Connection</div>
        {loading ? (
          <p className="pos-empty">Loading…</p>
        ) : (
          <>
            {connection ? (
              <p className="text-sm text-slate-600 mb-4">
                Connected to <span className="font-medium text-slate-900">{connection.apiBaseUrl}</span>.{" "}
                {connection.lastSyncedAt ? (
                  <>
                    Last synced {new Date(connection.lastSyncedAt).toLocaleString()} —{" "}
                    <span className={connection.lastSyncStatus === "SUCCESS" ? "text-green-700" : "text-red-700"}>
                      {connection.lastSyncStatus}
                    </span>
                    .
                  </>
                ) : (
                  "Never synced yet."
                )}
              </p>
            ) : (
              <p className="pos-empty mb-4">No SmartERP connection configured yet.</p>
            )}

            <form onSubmit={handleSave} className="flex flex-col gap-4 max-w-md">
              <div className="pos-field">
                <label className="pos-label">SmartERP API base URL *</label>
                <input
                  className="pos-input"
                  required
                  value={apiBaseUrl}
                  onChange={(e) => setApiBaseUrl(e.target.value)}
                  placeholder="https://your-smarterp-backend.up.railway.app"
                />
              </div>
              <div className="pos-field">
                <label className="pos-label">API key *</label>
                <input
                  type="password"
                  className="pos-input"
                  required
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Generated on SmartERP: Settings > Integration Connections"
                />
                <p className="text-xs text-slate-400 mt-1">
                  {connection
                    ? "Never echoed back for security — re-enter it here even if you're just updating the URL."
                    : "Generate this from SmartERP's own Integration Connections screen (Owner/Admin only there)."}
                </p>
              </div>
              <div>
                <button type="submit" className="pos-btn-primary" disabled={saving}>
                  {saving ? "Saving…" : connection ? "Update connection" : "Save connection"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>

      {connection && (
        <div className="pos-section">
          <div className="pos-section-title">Sync</div>
          <p className="text-sm text-slate-600 mb-3">
            Pulls every Business Partner, Item and Branch from SmartERP and upserts them here by external ID — a full
            pull each time, not incremental, so it's safe to re-run any time master data changes on the SmartERP side.
          </p>
          <button className="pos-btn-primary" onClick={handleSync} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          {syncResult && (
            <p className="text-sm text-green-700 mt-3">
              Synced {syncResult.partnersSynced} business partner(s), {syncResult.itemsSynced} item(s), and{" "}
              {syncResult.branchesSynced} branch(es).
            </p>
          )}
        </div>
      )}
    </>
  );
}
