"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { ApiError, changePassword, getMe, updateMe } from "@/lib/api";
import type { MyProfile } from "@/lib/types";

export default function ProfilePage() {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [pwForm, setPwForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaved, setPwSaved] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await getMe();
      setProfile(res.data);
      setForm({ name: res.data.name ?? "", email: res.data.email ?? "", phone: res.data.phone ?? "" });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load profile.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await updateMe({ name: form.name, email: form.email || undefined, phone: form.phone || undefined });
      setProfile(res.data);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save profile.");
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwSaved(false);
    if (pwForm.newPassword !== pwForm.confirm) {
      setPwError("New passwords don't match.");
      return;
    }
    setPwSaving(true);
    try {
      await changePassword({ currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword });
      setPwForm({ currentPassword: "", newPassword: "", confirm: "" });
      setPwSaved(true);
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : "Could not change password.");
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>My Profile</h1>
        <p>Your own name, contact details, and password.</p>
      </div>

      {loading ? (
        <p className="ent-empty">Loading…</p>
      ) : (
        <>
          <form onSubmit={handleSaveProfile} className="ent-section" style={{ marginBottom: 20 }}>
            <div className="ent-section-hdr"><span className="ent-section-title">Profile</span></div>
            <div className="ent-form-grid">
              <div className="ent-fg">
                <label className="ent-fl">Name</label>
                <input className="ent-fc" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              </div>
              <div className="ent-fg">
                <label className="ent-fl">Email</label>
                <input className="ent-fc" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="ent-fg">
                <label className="ent-fl">Phone</label>
                <input className="ent-fc" type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>
            </div>
            {error && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 10px" }}>{error}</p>}
            {saved && <p style={{ color: "#15803d", fontSize: 13, padding: "0 14px 10px" }}>Saved.</p>}
            <div style={{ padding: "0 14px 14px" }}>
              <button type="submit" className="ent-btn-save" disabled={saving}>{saving ? "Saving…" : "Save Profile"}</button>
            </div>
          </form>

          <form onSubmit={handleChangePassword} className="ent-section">
            <div className="ent-section-hdr"><span className="ent-section-title">Change Password</span></div>
            <div className="ent-form-grid">
              <div className="ent-fg">
                <label className="ent-fl">Current Password</label>
                <input
                  className="ent-fc" type="password" required
                  value={pwForm.currentPassword}
                  onChange={(e) => setPwForm((f) => ({ ...f, currentPassword: e.target.value }))}
                />
              </div>
              <div className="ent-fg">
                <label className="ent-fl">New Password</label>
                <input
                  className="ent-fc" type="password" minLength={8} required
                  value={pwForm.newPassword}
                  onChange={(e) => setPwForm((f) => ({ ...f, newPassword: e.target.value }))}
                />
              </div>
              <div className="ent-fg">
                <label className="ent-fl">Confirm New Password</label>
                <input
                  className="ent-fc" type="password" minLength={8} required
                  value={pwForm.confirm}
                  onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))}
                />
              </div>
            </div>
            {pwError && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 10px" }}>{pwError}</p>}
            {pwSaved && <p style={{ color: "#15803d", fontSize: 13, padding: "0 14px 10px" }}>Password changed.</p>}
            <div style={{ padding: "0 14px 14px" }}>
              <button type="submit" className="ent-btn-save" disabled={pwSaving}>{pwSaving ? "Saving…" : "Change Password"}</button>
            </div>
          </form>
        </>
      )}
    </AppShell>
  );
}
