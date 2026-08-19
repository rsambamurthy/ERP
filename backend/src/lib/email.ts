// SMTP delivery for transactional mail (registration OTP, M-PIN OTP, password
// reset). Kept deliberately small: one exported function, no templating layer,
// no queue — every caller today is a short one-off message.
//
// Configuration is entirely env-driven and entirely optional. With no
// SMTP_USER/SMTP_PASS set, sendEmail() logs and returns false rather than
// throwing, and lib/otp.ts falls back to the console-log + devOtp stub it used
// before any provider existed. That fallback is what keeps a Railway deploy
// with no mail config working exactly as it does today.
//
// Defaults target GoDaddy Workspace Email; any other provider just needs
// SMTP_HOST / SMTP_PORT / SMTP_SECURE set explicitly.

import nodemailer, { type Transporter } from "nodemailer";

const SMTP_HOST = process.env.SMTP_HOST || "smtpout.secureserver.net";
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
// Implicit TLS on 465, STARTTLS on everything else — the usual convention,
// overridable for providers that don't follow it.
const SMTP_SECURE = process.env.SMTP_SECURE
  ? process.env.SMTP_SECURE === "true"
  : SMTP_PORT === 465;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
// Most providers reject a From that isn't the authenticated mailbox, so
// default to it rather than inventing a no-reply address that would bounce.
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

export function isEmailConfigured(): boolean {
  return Boolean(SMTP_USER && SMTP_PASS);
}

// Built once on first use, not at import time: constructing a transporter for
// an unconfigured deploy is pointless, and doing it at module load would make
// a bad SMTP config fail the whole process at boot instead of one send.
let transporter: Transporter | null = null;
function getTransporter(): Transporter | null {
  if (!isEmailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER!, pass: SMTP_PASS! },
    });
  }
  return transporter;
}

/**
 * Send a plain-text message. Never throws and never rejects — callers treat
 * mail as best-effort (`void sendEmail(...)` in lib/otp.ts), so a provider
 * outage must not surface as an unhandled rejection or a failed registration.
 * Returns whether the message was actually handed to the provider.
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const tx = getTransporter();
  if (!tx) {
    console.log(`[email] SMTP not configured — would have sent to ${to}: ${subject}`);
    return false;
  }
  try {
    await tx.sendMail({ from: SMTP_FROM, to, subject, text });
    return true;
  } catch (err) {
    // Logged, not rethrown: the OTP is still valid, and the caller's devOtp
    // fallback (EXPOSE_DEV_OTP) is what the user actually needs right now.
    console.error(`[email] failed to send to ${to}:`, err);
    return false;
  }
}