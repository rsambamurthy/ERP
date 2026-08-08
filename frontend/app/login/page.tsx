"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthCard from "@/components/ui/AuthCard";
import { ApiError, getMpinStatus, requestMpinOtp, setMpin, verifyMpin, type MpinLoginResponse } from "@/lib/api";
import { setSession } from "@/lib/auth";

// SmartAppt Gold-style login: identifier -> (M-PIN, if already set) or
// (OTP -> set a new M-PIN) -> in. Same theme (cream/terracotta, AuthCard)
// SmartERP's public pages already use; this page just brings over the
// multi-step flow itself. Email/phone + password (POST /auth/login) still
// works on the backend for anyone who hasn't set an M-PIN yet — this screen
// just doesn't surface that path anymore, matching the reference screen.
type Step = "identifier" | "mpin" | "otp" | "set_mpin";

const T = { primary: "#C4572B", muted: "#A08070", label: "#8A6050", pinBg: "#FDF8F5", border: "#DDD0C8" };

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "0.65rem 0.9rem", border: `1px solid ${T.border}`, borderRadius: 8,
  fontSize: "1rem", outline: "none", boxSizing: "border-box", background: "#fff",
};

const pinStyle: React.CSSProperties = {
  ...inputStyle, letterSpacing: "0.5em", textAlign: "center", background: T.pinBg,
};

const labelStyle: React.CSSProperties = {
  display: "block", fontWeight: 600, marginBottom: 6, fontSize: "0.8rem",
  textTransform: "uppercase", letterSpacing: "0.05em", color: T.label,
};

const btn = (primary = true): React.CSSProperties => ({
  width: "100%", padding: "0.75rem", borderRadius: 10, border: "none",
  background: primary ? T.primary : "#f3f4f6", color: primary ? "white" : "#374151",
  fontWeight: 600, fontSize: "0.95rem", cursor: "pointer", marginTop: "0.5rem",
});

const errBox: React.CSSProperties = {
  background: "#fee2e2", color: "#991b1b", padding: "0.75rem", borderRadius: 8,
  marginBottom: "1rem", fontSize: "0.875rem",
};

const otpHint: React.CSSProperties = {
  background: "#fefce8", border: "1px solid #fde047", color: "#854d0e", borderRadius: 6,
  padding: "0.5rem 0.9rem", marginBottom: "0.75rem", fontSize: "0.8rem",
};

function PinInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <input
      type="password"
      inputMode="numeric"
      maxLength={4}
      placeholder="● ● ● ●"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
      style={pinStyle}
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
    setSession(res.token, res.organizationId, res.role, res.isPlatformAdmin, res.name, res.permissions, res.customRoleId);
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
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-12">
      <AuthCard>
        {error && <div style={errBox}>{error}</div>}

        {step === "identifier" && (
          <form onSubmit={handleIdentifierSubmit}>
            <div style={{ marginBottom: "1rem" }}>
              <label style={labelStyle}>Email or mobile number</label>
              <input
                type="text"
                placeholder="you@company.com or +91 98765 43210"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                style={inputStyle}
                autoFocus
              />
            </div>
            <button type="submit" style={btn()} disabled={loading}>
              {loading ? "Checking…" : "Continue"}
            </button>
            <div style={{ textAlign: "center", marginTop: "1rem" }}>
              <Link href="/register" style={{ fontSize: "0.875rem", color: T.primary, fontWeight: 600 }}>
                Register Company
              </Link>
            </div>
          </form>
        )}

        {step === "mpin" && (
          <form onSubmit={handleMpinSubmit}>
            <p style={{ color: T.muted, fontSize: "0.875rem", marginBottom: "1rem" }}>
              Enter your 4-digit M-PIN for {identifier}
            </p>
            <div style={{ marginBottom: "1rem" }}>
              <label style={labelStyle}>M-PIN</label>
              <PinInput value={mpin} onChange={setMpinValue} autoFocus />
            </div>
            <button type="submit" style={btn()} disabled={loading || mpin.length < 4}>
              {loading ? "Verifying…" : "Log in"}
            </button>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
              <span style={{ fontSize: 13, color: T.primary, cursor: "pointer", fontWeight: 600 }} onClick={handleForgotMpin}>
                Forgot M-PIN?
              </span>
              <span
                style={{ fontSize: 13, color: T.primary, cursor: "pointer", fontWeight: 600 }}
                onClick={() => { setMpinValue(""); setStep("identifier"); }}
              >
                Change
              </span>
            </div>
          </form>
        )}

        {step === "otp" && (
          <form onSubmit={handleOtpSubmit}>
            <p style={{ color: T.muted, fontSize: "0.875rem", marginBottom: "0.75rem" }}>
              Enter the OTP sent to {identifier}
            </p>
            {devOtp && (
              <div style={otpHint}>
                OTP: <strong>{devOtp}</strong> (shown here until a real SMS/email provider is wired up)
              </div>
            )}
            <div style={{ marginBottom: "1rem" }}>
              <label style={labelStyle}>OTP</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={8}
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                required
                style={inputStyle}
                autoFocus
              />
            </div>
            <button type="submit" style={btn()}>Continue</button>
            <button
              type="button"
              style={btn(false)}
              onClick={() => { setOtp(""); setDevOtp(null); setStep("identifier"); }}
            >
              Change number
            </button>
          </form>
        )}

        {step === "set_mpin" && (
          <form onSubmit={handleSetMpin}>
            <p style={{ color: T.muted, fontSize: "0.875rem", marginBottom: "1rem" }}>
              Set a 4-digit M-PIN for faster logins next time.
            </p>
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={labelStyle}>New M-PIN</label>
              <PinInput value={newMpin} onChange={setNewMpin} autoFocus />
            </div>
            <div style={{ marginBottom: "1rem" }}>
              <label style={labelStyle}>Confirm M-PIN</label>
              <PinInput value={confirmMpin} onChange={setConfirmMpin} />
            </div>
            <button type="submit" style={btn()} disabled={loading || newMpin.length < 4 || confirmMpin.length < 4}>
              {loading ? "Setting M-PIN…" : "Set M-PIN & Log in"}
            </button>
          </form>
        )}
      </AuthCard>
    </main>
  );
}
