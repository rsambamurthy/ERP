"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { login, ApiError } from "../../lib/api";
import { setSession } from "../../lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { data } = await login({ email, password });
      setSession(data.token, data.role, data.user.name, data.user.email);
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not log in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
        <div className="mb-6 text-center">
          <div className="text-lg font-semibold text-slate-900">Project OS</div>
          <div className="text-xs text-slate-400">R1 Pilot</div>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="pos-field">
            <label className="pos-label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              className="pos-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </div>
          <div className="pos-field">
            <label className="pos-label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              className="pos-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="pos-error">{error}</p>}
          <button type="submit" className="pos-btn-primary w-full" disabled={busy}>
            {busy ? "Logging in…" : "Log in"}
          </button>
        </form>
        <p className="text-sm text-slate-500 text-center mt-4">
          No account yet?{" "}
          <Link href="/register" className="pos-link-btn">
            Register an organization
          </Link>
        </p>
      </div>
    </div>
  );
}
