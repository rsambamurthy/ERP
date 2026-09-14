"use client";

import { useCallback, useState } from "react";
import AuthCard from "@/components/ui/AuthCard";
import AccordionStep from "@/components/ui/AccordionStep";
import SignUpStep from "@/components/steps/SignUpStep";
import DomainSelectStep from "@/components/steps/DomainSelectStep";
import DomainDetailsStep from "@/components/steps/DomainDetailsStep";
import ProvisioningStep from "@/components/steps/ProvisioningStep";
import { SignUpIcon, DomainIcon, DetailsIcon, WorkspaceIcon } from "@/components/steps/stepIcons";
import { ApiError, registerUser, submitDomains } from "@/lib/api";
import type { DomainCode, DomainDetailsMap, RegisterPayload } from "@/lib/types";

type WizardStep = 1 | 2 | 3 | 4;

export default function RegisterPage() {
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pendingRegistrationId, setPendingRegistrationId] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState<string>("");
  const [contact, setContact] = useState<string>("");
  const [domains, setDomains] = useState<DomainCode[]>([]);

  const handleSignUp = useCallback(async (payload: RegisterPayload) => {
    setLoading(true);
    setError(null);
    try {
      const res = await registerUser(payload);
      setPendingRegistrationId(res.pendingRegistrationId);
      setBusinessName(payload.businessName);
      setContact(payload.email);
      setWizardStep(2);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, []);

  function toggleDomain(code: DomainCode) {
    setDomains((d) => (d.includes(code) ? d.filter((c) => c !== code) : [...d, code]));
  }

  const handleDomainDetails = useCallback(
    async (details: DomainDetailsMap) => {
      if (!pendingRegistrationId) return;
      setLoading(true);
      setError(null);
      try {
        await submitDomains(pendingRegistrationId, details);
        setWizardStep(4);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Something went wrong.");
      } finally {
        setLoading(false);
      }
    },
    [pendingRegistrationId]
  );

  function statusFor(step: WizardStep): "locked" | "active" | "complete" {
    if (step < wizardStep) return "complete";
    if (step === wizardStep) return "active";
    return "locked";
  }

  function subtitleFor(step: WizardStep): string {
    switch (step) {
      case 1:
        return wizardStep > 1 ? `${businessName} — ${contact}` : "Business name, contact, and password";
      case 2:
        return wizardStep > 2
          ? domains.join(", ")
          : "Pick one or both — Trading and Manufacturing";
      case 3:
        return wizardStep > 3 ? "Domain setup submitted" : "GSTIN and domain-specific info";
      case 4:
        return "Verify your email to finish creating your workspace";
    }
  }

  return (
    <main className="auth-page">
      <AuthCard width={720}>
        <p className="auth-intro">Create your workspace in a few steps.</p>
        <div>
          <AccordionStep icon={<SignUpIcon />} title="Sign up" subtitle={subtitleFor(1)} status={statusFor(1)}>
            <SignUpStep loading={loading} error={error} onSubmit={handleSignUp} />
          </AccordionStep>
          <AccordionStep icon={<DomainIcon />} title="Select business domain(s)" subtitle={subtitleFor(2)} status={statusFor(2)}>
            <DomainSelectStep
              selected={domains}
              onToggle={toggleDomain}
              onNext={() => setWizardStep(3)}
              error={error}
            />
          </AccordionStep>
          <AccordionStep icon={<DetailsIcon />} title="Details" subtitle={subtitleFor(3)} status={statusFor(3)}>
            <DomainDetailsStep
              domains={domains}
              loading={loading}
              error={error}
              onSubmit={handleDomainDetails}
            />
          </AccordionStep>
          <AccordionStep icon={<WorkspaceIcon />} title="Check your email" subtitle={subtitleFor(4)} status={statusFor(4)}>
            <ProvisioningStep email={contact} />
          </AccordionStep>
        </div>
      </AuthCard>
    </main>
  );
}
