import type { OnboardingStep } from "@/lib/types";

export const PROVISION_LABELS: Record<OnboardingStep, string> = {
  SIGNUP: "Setting up your account…",
  VERIFIED: "Account verified…",
  DOMAIN_SELECTED: "Seeding your chart of accounts…",
  PROVISIONED: "Workspace ready.",
};

export default function ProvisioningStep({
  step,
  error,
}: {
  step: OnboardingStep;
  error: string | null;
}) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      {!error && (
        <div
          className="h-8 w-8 animate-spin rounded-full"
          style={{ border: "2px solid var(--theme-accent)", borderTopColor: "transparent" }}
        />
      )}
      {error && <p className="auth-err">{error}</p>}
    </div>
  );
}
