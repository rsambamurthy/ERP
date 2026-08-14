"use client";

import { useState } from "react";
import Input from "../ui/Input";
import Button from "../ui/Button";

interface Props {
  destination: string;
  devOtp?: string | null;
  loading: boolean;
  error: string | null;
  onSubmit: (otp: string) => void;
}

export default function VerifyStep({ destination, devOtp, loading, error, onSubmit }: Props) {
  const [otp, setOtp] = useState("");

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(otp);
      }}
    >
      {devOtp && (
        <div className="auth-hint">
          Dev mode — no email/SMS provider yet. Your OTP is{" "}
          <span className="font-mono font-semibold tracking-wider">{devOtp}</span>.
        </div>
      )}
      <Input
        label="OTP"
        inputMode="numeric"
        maxLength={6}
        required
        value={otp}
        onChange={(e) => setOtp(e.target.value)}
      />
      {error && <p className="auth-err">{error}</p>}
      <Button type="submit" loading={loading}>
        Verify
      </Button>
    </form>
  );
}
