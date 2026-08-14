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
      <h2 className="text-lg font-semibold text-navy-800">Verify identity</h2>
      <p className="text-sm text-terracotta-700">
        Enter the OTP sent to {destination || "your phone or email"}.
      </p>
      {devOtp && (
        <div className="rounded-lg border border-terracotta-100 bg-terracotta-50 px-3 py-2 text-sm text-terracotta-700">
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
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" loading={loading}>
        Verify
      </Button>
    </form>
  );
}
