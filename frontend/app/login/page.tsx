"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthCard from "@/components/ui/AuthCard";
import { ApiError, getMpinStatus, requestMpinOtp, setMpin, verifyMpin, type MpinLoginResponse } from "@/lib/api";
import { setSession } from "@/lib/auth";

// SmartAppt Gold-style login: identifier -> (M-PIN, if already set) or
// (OTP -> set a new M-PIN) -> in. Same navy/blue enterprise theme as the
// rest of the app (see .auth-* classes in globals.css). Email/phone +
// password (POST /auth/login) still works on the backend for anyone who
// hasn't set an M-PIN yet — this screen just doesn't surface that path
// anymore, matching the reference screen.
type Step = "identifier" | "mpin" | "otp" | "set_mpin";

function PinInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <input
      type="password"
      inputMode="numeric"
      maxLength={4}
      placeholder="● ● ● ●"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
      className="auth-fc auth-pin"
      autoFocus={autoFocus}
    />
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("identifier");
  const [identifier, setIdentifier] = useState("");
  const [mpin, setMpinValue] = useState("");
  const [otp, setOtp] = useState("");
  const [newMpin, setNewMpin] = useState("");
  const [confirmMpin, setConfirmMpin] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loginSuccess(res: MpinLoginResponse) {
    setSession(res.token, res.organizationId, res.role, res.isPlatformAdmin, res.name, res.permissions, res.customRoleId, res.deniedModules);
    router.push(res.isPlatformAdmin ? "/admin" : "/dashboard");
  }

  async function handleIdentifierSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await getMpinStatus(identifier);
      if (res.data.hasMpin) {
        setStep("mpin");
      } else {
        const otpRes = await requestMpinOtp(identifier);
        setDevOtp(otpRes.data.devOtp ?? null);
        setStep("otp");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  async function handleMpinSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      loginSuccess(await verifyMpin(identifier, mpin));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Incorrect M-PIN.");
      setMpinValue("");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotMpin() {
    setError(null);
    setDevOtp(null);
    setLoading(true);
    try {
      const otpRes = await requestMpinOtp(identifier);
      setDevOtp(otpRes.data.devOtp ?? null);
      setStep("otp");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send a code.");
    } finally {
      setLoading(false);
    }
  }

  function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!otp) return;
    setError(null);
    setStep("set_mpin");
  }

  async function handleSetMpin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newMpin.length < 4 || confirmMpin.length < 4) {
      setError("Enter a 4-digit M-PIN twice.");
      return;
    }
    if (newMpin !== confirmMpin) {
      setError("PINs do not match.");
      return;
    }
    setLoading(true);
    try {
      loginSuccess(await setMpin(identifier, otp, newMpin));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not set M-PIN.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <AuthCard>
        {error && <div className="auth-err" style={{ marginBottom: "1rem" }}>{error}</div>}

        {step === "identifier" && (
          <form onSubmit={handleIdentifierSubmit}>
            <div className="auth-fg" style={{ marginBottom: "1rem" }}>
              <label className="auth-fl">Email or mobile number</label>
              <input
                type="text"
                placeholder="you@company.com or +91 98765 43210"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                className="auth-fc"
                autoFocus
              />
            </div>
            <button type="submit" className="auth-btn" disabled={loading}>
              {loading ? "Checking…" : "Continue"}
            </button>
            <div style={{ textAlign: "center", marginTop: "1rem" }}>
              <Link href="/register" className="auth-link">
                Register Company
              </Link>
            </div>
          </form>
        )}

        {step === "mpin" && (
          <form onSubmit={handleMpinSubmit}>
            <p className="auth-p" style={{ marginBottom: "1rem" }}>
              Enter your 4-digit M-PIN for {identifier}
            </p>
            <div className="auth-fg" style={{ marginBottom: "1rem" }}>
              <label className="auth-fl">M-PIN</label>
              <PinInput value={mpin} onChange={setMpinValue} autoFocus />
            </div>
            <button type="submit" className="auth-btn" disabled={loading || mpin.length < 4}>
              {loading ? "Verifying…" : "Log in"}
            </button>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
              <button type="button" className="auth-link" onClick={handleForgotMpin}>
                Forgot M-PIN?
              </button>
              <button
                type="button"
                className="auth-link"
                onClick={() => { setMpinValue(""); setStep("identifier"); }}
              >
                Change
              </button>
            </div>
          </form>
        )}

        {step === "otp" && (
          <form onSubmit={handleOtpSubmit}>
            <p className="auth-p" style={{ marginBottom: "0.75rem" }}>
              Enter the OTP sent to {identifier}
            </p>
            {devOtp && (
              <div className="auth-hint" style={{ marginBottom: "0.75rem" }}>
                OTP: <strong>{devOtp}</strong> (shown here until a real SMS/email provider is wired up)
              </div>
            )}
            <div className="auth-fg" style={{ marginBottom: "1rem" }}>
              <label className="auth-fl">OTP</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={8}
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                required
                className="auth-fc"
                autoFocus
              />
            </div>
            <button type="submit" className="auth-btn">Continue</button>
            <button
              type="button"
              className="auth-btn auth-btn-secondary"
              onClick={() => { setOtp(""); setDevOtp(null); setStep("identifier"); }}
            >
              Change number
            </button>
          </form>
        )}

        {step === "set_mpin" && (
          <form onSubmit={handleSetMpin}>
            <p className="auth-p" style={{ marginBottom: "1rem" }}>
              Set a 4-digit M-PIN for faster logins next time.
            </p>
            <div className="auth-fg" style={{ marginBottom: "0.75rem" }}>
              <label className="auth-fl">New M-PIN</label>
              <PinInput value={newMpin} onChange={setNewMpin} autoFocus />
            </div>
            <div className="auth-fg" style={{ marginBottom: "1rem" }}>
              <label className="auth-fl">Confirm M-PIN</label>
              <PinInput value={confirmMpin} onChange={setConfirmMpin} />
            </div>
            <button type="submit" className="auth-btn" disabled={loading || newMpin.length < 4 || confirmMpin.length < 4}>
              {loading ? "Setting M-PIN…" : "Set M-PIN & Log in"}
            </button>
          </form>
        )}
      </AuthCard>
    </main>
  );
}
