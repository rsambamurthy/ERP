"use client";

import { useState } from "react";
import Input from "../ui/Input";
import Button from "../ui/Button";

interface Props {
  destination: string;
  loading: boolean;
  error: string | null;
  onSubmit: (otp: string) => void;
}

export default function VerifyStep({ destination, loading, error, onSubmit }: Props) {
  const [otp, setOtp] = useState("");

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(otp);
      }}
    >
      <h2 className="text-lg font-semibold text-gray-900">Verify identity</h2>
      <p className="text-sm text-gray-500">
        Enter the OTP sent to {destination || "your phone or email"}.
      </p>
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
