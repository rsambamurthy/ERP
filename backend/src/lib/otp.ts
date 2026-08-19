import { sendEmail } from "./email";

export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function otpExpiry(minutes = 10): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

// destination is whatever identifier the caller registered/logged in with —
// same "@ means email" convention as routes/auth.ts's identifierWhere().
// An email destination sends for real via lib/email.ts (SMTP, configured
// with SMTP_USER/SMTP_PASS env vars — see backend/.env.example). A phone
// destination is still a console-log stub: no SMS gateway is wired up yet,
// that's a separate integration. Either way, devOtp in the API response
// (EXPOSE_DEV_OTP) remains the fallback until SMTP is actually configured.
export function sendOtp(destination: string, otp: string) {
  if (destination.includes("@")) {
    void sendEmail(
      destination,
      "Your SmartERP verification code",
      `Your one-time verification code is ${otp}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`
    );
    return;
  }
  console.log(`[otp] ${destination} -> ${otp}`);
}
