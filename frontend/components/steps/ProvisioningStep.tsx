import type { OnboardingStep } from "@/lib/types";

const LABELS: Record<OnboardingStep, string> = {
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
    <div className="flex flex-col items-center gap-4 text-center">
      <h2 className="text-lg font-semibold text-navy-800">
        Auto-provisioning workspace
      </h2>
      {!error && (
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-terracotta-500 border-t-transparent" />
      )}
      <p className="text-sm text-terracotta-700">{LABELS[step]}</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
