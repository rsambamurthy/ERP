"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { registerOrg, ApiError } from "../../lib/api";
import { setSession } from "../../lib/auth";

export default function RegisterPage() {
  const router = useRouter();
  const [organizationName, setOrganizationName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { data } = await registerOrg({ organizationName, name, email, password });
      // Registration always creates the first user as SUPER_ADMIN (see
      // project-os/backend/src/routes/auth.ts POST /register) — the
      // response itself doesn't repeat the role, so it's set explicitly
      // here rather than left blank.
      setSession(data.token, "SUPER_ADMIN", data.user.name, data.user.email);
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not register.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
        <div className="mb-6 text-center">
          <div className="text-lg font-semibold text-slate-900">Project OS</div>
          <div className="text-xs text-slate-400">Register a new organization</div>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="pos-field">
            <label className="pos-label" htmlFor="organizationName">Organization name</label>
            <input
              id="organizationName"
              required
              className="pos-input"
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="pos-field">
            <label className="pos-label" htmlFor="name">Your name</label>
            <input id="name" required className="pos-input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="pos-field">
            <label className="pos-label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              className="pos-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="pos-field">
            <label className="pos-label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              className="pos-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="pos-error">{error}</p>}
          <button type="submit" className="pos-btn-primary w-full" disabled={busy}>
            {busy ? "Creating…" : "Create organization"}
          </button>
        </form>
        <p className="text-sm text-slate-500 text-center mt-4">
          Already have an account?{" "}
          <Link href="/login" className="pos-link-btn">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
