"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AuthCard from "@/components/ui/AuthCard";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { ApiError, forgotPassword, resetPassword } from "@/lib/api";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [identifier, setIdentifier] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const isEmail = identifier.includes("@");

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await forgotPassword(isEmail ? { email: identifier } : { phone: identifier });
      setDevOtp(res.devOtp ?? null);
      setStep(2);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await resetPassword({ ...(isEmail ? { email: identifier } : { phone: identifier }), otp, newPassword });
      setDone(true);
      setTimeout(() => router.push("/login"), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <AuthCard>
        {done ? (
          <div className="flex flex-col gap-2">
            <h2 className="auth-h2">Password reset</h2>
            <p className="auth-p">Taking you to log in…</p>
          </div>
        ) : step === 1 ? (
          <form className="flex flex-col gap-4" onSubmit={handleRequest}>
            <h2 className="auth-h2">Forgot password</h2>
            <p className="auth-p">Enter the email or phone on your account and we'll send a reset code.</p>
            <Input label="Email or phone" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
            {error && <p className="auth-err">{error}</p>}
            <Button type="submit" loading={loading}>Send reset code</Button>
          </form>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={handleReset}>
            <h2 className="auth-h2">Reset password</h2>
            <p className="auth-p">Enter the code sent to {identifier} and choose a new password.</p>
            {devOtp && (
              <div className="auth-hint">
                Dev mode — no email/SMS provider yet. Your code is{" "}
                <span className="font-mono font-semibold tracking-wider">{devOtp}</span>.
              </div>
            )}
            <Input label="Reset code" inputMode="numeric" maxLength={6} required value={otp} onChange={(e) => setOtp(e.target.value)} />
            <Input
              label="New password"
              type="password"
              minLength={8}
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            {error && <p className="auth-err">{error}</p>}
            <Button type="submit" loading={loading}>Reset password</Button>
          </form>
        )}
      </AuthCard>
    </main>
  );
}
