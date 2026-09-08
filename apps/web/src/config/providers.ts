import type { CSSProperties } from "react";

export const OPERATIONAL_DOMAINS = [
  { id: "dashboard", label: "Dashboard", description: "Visão geral do provider e da conexão." },
  { id: "govops", label: "GovOps", description: "Governança, identidade, compliance e postura organizacional." },
  { id: "secops", label: "SecOps", description: "Assessments, consultas e ferramentas para reduzir riscos de identidade, dados, rede e endpoints." },
  { id: "finops", label: "FinOps", description: "Custos, otimização, desperdício e governança financeira." },
  { id: "devops", label: "DevOps", description: "CI/CD, DevSecOps, automação e práticas de desenvolvimento." },
] as const;

export type OperationalDomainId = (typeof OPERATIONAL_DOMAINS)[number]["id"];

export const CLOUD_PROVIDERS = [
  {
    id: "azure",
    name: "Microsoft Azure",
    shortName: "Azure",
    services: "Entra · M365 · Azure",
    monogram: "Az",
    integration: "microsoft-entra",
    available: true,
    theme: { primary: "#75c8ff", secondary: "#65e5ef", tertiary: "#75c8ff", quaternary: "#65e5ef", soft: "rgba(40, 153, 232, 0.09)", border: "rgba(91, 190, 250, 0.28)", glow: "rgba(40, 153, 232, 0.12)" },
  },
  {
    id: "aws",
    name: "Amazon Web Services",
    shortName: "AWS",
    services: "AWS",
    monogram: "AWS",
    integration: "unavailable",
    available: false,
    theme: { primary: "#ffc46b", secondary: "#ffe49c", tertiary: "#ffc46b", quaternary: "#ffe49c", soft: "rgba(255, 153, 0, 0.08)", border: "rgba(255, 183, 77, 0.28)", glow: "rgba(255, 153, 0, 0.10)" },
  },
  {
    id: "gcp",
    name: "Google Cloud Platform",
    shortName: "GCP",
    services: "Google Cloud",
    monogram: "GCP",
    integration: "unavailable",
    available: false,
    theme: { primary: "#8cb8ff", secondary: "#82dba2", tertiary: "#f5cc65", quaternary: "#f18b85", soft: "rgba(66, 133, 244, 0.08)", border: "rgba(112, 163, 246, 0.28)", glow: "rgba(66, 133, 244, 0.10)" },
  },
] as const;

export type CloudProviderId = (typeof CLOUD_PROVIDERS)[number]["id"];
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];

export function providerThemeStyle(provider: CloudProvider): CSSProperties {
  return Object.fromEntries(Object.entries(provider.theme).map(([key, value]) => [`--provider-${key}`, value])) as CSSProperties;
}

export function isCloudProviderId(value: string): value is CloudProviderId {
  return CLOUD_PROVIDERS.some((provider) => provider.id === value);
}

export function isOperationalDomainId(
  value: string,
): value is OperationalDomainId {
  return OPERATIONAL_DOMAINS.some((domain) => domain.id === value);
}

export function cloudProviderById(id: CloudProviderId): CloudProvider {
  const provider = CLOUD_PROVIDERS.find((candidate) => candidate.id === id);
  if (!provider) {
    throw new Error("Cloud provider metadata is unavailable.");
  }
  return provider;
}

export function operationalDomainById(id: OperationalDomainId) {
  const domain = OPERATIONAL_DOMAINS.find((candidate) => candidate.id === id);
  if (!domain) {
    throw new Error("Operational domain metadata is unavailable.");
  }
  return domain;
}
