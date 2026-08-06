export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function otpExpiry(minutes = 10): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

// MVP stub — no SMS/email provider wired up yet. Logs to the server console
// so the flow is testable end to end; swap for a real provider before
// handling real signups.
export function sendOtp(destination: string, otp: string) {
  console.log(`[otp] ${destination} -> ${otp}`);
}
