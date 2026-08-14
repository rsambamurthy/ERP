"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import AuthCard from "@/components/ui/AuthCard";
import AccordionStep from "@/components/ui/AccordionStep";
import SignUpStep from "@/components/steps/SignUpStep";
import VerifyStep from "@/components/steps/VerifyStep";
import DomainSelectStep from "@/components/steps/DomainSelectStep";
import DomainDetailsStep from "@/components/steps/DomainDetailsStep";
import ProvisioningStep from "@/components/steps/ProvisioningStep";
import {
  ApiError,
  getOnboardingStatus,
  provisionWorkspace,
  registerUser,
  submitDomains,
  verifyOtp,
} from "@/lib/api";
import { setSession } from "@/lib/auth";
import type {
  DomainCode,
  DomainDetailsMap,
  OnboardingStep,
  RegisterPayload,
} from "@/lib/types";

type WizardStep = 1 | 2 | 3 | 4 | 5;

export default function RegisterPage() {
  const router = useRouter();

  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [contact, setContact] = useState<string>("");
  const [ownerName, setOwnerName] = useState<string>("");
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [domains, setDomains] = useState<DomainCode[]>([]);
  const [provisionStatus, setProvisionStatus] = useState<OnboardingStep>("SIGNUP");

  const handleSignUp = useCallback(async (payload: RegisterPayload) => {
    setLoading(true);
    setError(null);
    try {
      const res = await registerUser(payload);
      setOrganizationId(res.organizationId);
      setContact(payload.email || payload.phone);
      setOwnerName(payload.name);
      setDevOtp(res.devOtp ?? null);
      setWizardStep(2);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleVerify = useCallback(
    async (otp: string) => {
      if (!organizationId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await verifyOtp(organizationId, otp);
        if (res.token) setSession(res.token, organizationId, "OWNER", false, ownerName);
        setWizardStep(3);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Verification failed.");
      } finally {
        setLoading(false);
      }
    },
    [organizationId, ownerName]
  );

  function toggleDomain(code: DomainCode) {
    setDomains((d) => (d.includes(code) ? d.filter((c) => c !== code) : [...d, code]));
  }

  const handleDomainDetails = useCallback(
    async (details: DomainDetailsMap) => {
      if (!organizationId) return;
      setLoading(true);
      setError(null);
      try {
        await submitDomains(organizationId, details);
        setWizardStep(5);
        setProvisionStatus("DOMAIN_SELECTED");
        await provisionWorkspace(organizationId);

        // Poll /onboarding/status until PROVISIONED.
        const started = Date.now();
        const poll = async (): Promise<void> => {
          const status = await getOnboardingStatus(organizationId);
          setProvisionStatus(status.step);
          if (status.step === "PROVISIONED") {
            router.push(`/dashboard?org=${organizationId}&domains=${domains.join(",")}`);
            return;
          }
          if (Date.now() - started > 30000) {
            throw new ApiError("Provisioning is taking longer than expected.");
          }
          await new Promise((r) => setTimeout(r, 1500));
          return poll();
        };
        await poll();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Provisioning failed.");
      } finally {
        setLoading(false);
      }
    },
    [organizationId, domains, router]
  );

  function statusFor(step: WizardStep): "locked" | "active" | "complete" {
    if (step < wizardStep) return "complete";
    if (step === wizardStep) return "active";
    return "locked";
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-12">
      <AuthCard>
        <div className="flex flex-col">
          <AccordionStep index={1} title="Sign up" status={statusFor(1)}>
            <SignUpStep loading={loading} error={error} onSubmit={handleSignUp} />
          </AccordionStep>
          <AccordionStep index={2} title="Verify" status={statusFor(2)}>
            <VerifyStep
              destination={contact}
              devOtp={devOtp}
              loading={loading}
              error={error}
              onSubmit={handleVerify}
            />
          </AccordionStep>
          <AccordionStep index={3} title="Domain(s)" status={statusFor(3)}>
            <DomainSelectStep
              selected={domains}
              onToggle={toggleDomain}
              onNext={() => setWizardStep(4)}
              error={error}
            />
          </AccordionStep>
          <AccordionStep index={4} title="Details" status={statusFor(4)}>
            <DomainDetailsStep
              domains={domains}
              loading={loading}
              error={error}
              onSubmit={handleDomainDetails}
            />
          </AccordionStep>
          <AccordionStep index={5} title="Workspace" status={statusFor(5)}>
            <ProvisioningStep step={provisionStatus} error={error} />
          </AccordionStep>
        </div>
      </AuthCard>
    </main>
  );
}
