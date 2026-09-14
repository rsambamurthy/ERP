// Final step of the registration wizard. Provisioning is no longer polled
// from here — POST /auth/verify-email (triggered by the user clicking the
// emailed link, not by anything in this browser tab) creates the
// organization and runs provisionOrganization() synchronously in one shot.
// This step is just the "we sent you a link" confirmation the flow's step 5
// calls for.
export default function ProvisioningStep({ email }: { email: string }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <p>
        We&apos;ve sent a verification link to <strong>{email || "your email"}</strong>.
      </p>
      <p style={{ color: "var(--color-muted)" }}>
        Click the link in that email to verify your address and create your workspace. The link
        expires in 24 hours.
      </p>
    </div>
  );
}
