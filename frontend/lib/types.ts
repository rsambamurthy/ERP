export type DomainCode = "TRADING" | "MANUFACTURING";

export interface DomainType {
  code: DomainCode;
  name: string;
  description?: string;
}

export interface TradingDetails {
  gstin: string;
  businessType: "RETAILER" | "WHOLESALER" | "DISTRIBUTOR";
  primaryCategories?: string;
}

export interface ManufacturingDetails {
  gstin: string;
  industryType: string;
  hasBom: boolean;
}

export type DomainDetailsMap = {
  TRADING?: TradingDetails;
  MANUFACTURING?: ManufacturingDetails;
};

export interface RegisterPayload {
  businessName: string;
  email: string;
  phone: string;
  password: string;
}

export interface RegisterResponse {
  organizationId: string;
  userId: string;
  // Dev convenience only — present until a real email/SMS provider is wired
  // up. Will disappear once EXPOSE_DEV_OTP is turned off in the backend.
  devOtp?: string;
}

export type OnboardingStep =
  | "SIGNUP"
  | "VERIFIED"
  | "DOMAIN_SELECTED"
  | "PROVISIONED";

export interface OnboardingStatus {
  step: OnboardingStep;
  organizationId: string;
}
