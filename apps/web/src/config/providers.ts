export const OPERATIONAL_DOMAINS = [
  { id: "dashboard", label: "Dashboard", description: "Visão geral do provider e da conexão." },
  { id: "govops", label: "GovOps", description: "Governança, identidade, compliance e postura organizacional." },
  { id: "secops", label: "SecOps", description: "Security posture, identity security, threats e hardening." },
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
  },
  {
    id: "aws",
    name: "Amazon Web Services",
    shortName: "AWS",
    services: "AWS",
    monogram: "AWS",
    integration: "unavailable",
    available: false,
  },
  {
    id: "gcp",
    name: "Google Cloud Platform",
    shortName: "GCP",
    services: "Google Cloud",
    monogram: "GCP",
    integration: "unavailable",
    available: false,
  },
] as const;

export type CloudProviderId = (typeof CLOUD_PROVIDERS)[number]["id"];
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];

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
