import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  AssessmentIdSchema,
  AssessmentSummarySchema,
  type AssessmentId,
  type AssessmentSummary,
  type AssessmentAuthProvider,
  type AssessmentVisibility,
  type CloudProvider,
  type GraphPermission,
  type OperationalDomain,
} from "@cloudops/contracts";

import { errors } from "../errors.js";
import { ModuleRegistry } from "./module-registry.js";

export interface AssessmentRegistration {
  readonly id: AssessmentId;
  readonly name: string;
  readonly description?: string;
  readonly scriptRelativePath: string;
  readonly enabled: boolean;
  readonly timeoutMs: number;
  readonly maxConcurrentExecutions?: number;
  readonly provider: CloudProvider;
  readonly domain: OperationalDomain;
  readonly moduleId: string;
  readonly assessmentOrder: number;
  readonly visibility: AssessmentVisibility;
  readonly requiredAuthProvider: AssessmentAuthProvider;
  readonly requiredPermissions: readonly GraphPermission[];
  readonly adminConsentRequired: boolean;
}

export interface RegisteredAssessment extends AssessmentSummary {
  readonly scriptPath: string;
  readonly timeoutMs: number;
  readonly maxConcurrentExecutions?: number;
}

const DEFAULT_REGISTRATIONS: readonly AssessmentRegistration[] = [
  {
    id: "inactive-users",
    name: "Mapear Usuários Inativos",
    description: "Identifica contas sem login bem-sucedido há pelo menos 90 dias. Gera relatório executivo HTML e CSV de inativos; contas novas sem login aguardam 90 dias desde a criação.",
    scriptRelativePath: path.join("inactive-users", "Invoke-Assessment.ps1"),
    enabled: true,
    // signInActivity is limited to 500 users/page and 10 requests/minute.
    // Bound long scans below one hour; authentication can still expire earlier.
    timeoutMs: 55 * 60_000,
    maxConcurrentExecutions: 1,
    provider: "azure",
    domain: "secops",
    moduleId: "identity-visibility",
    assessmentOrder: 1,
    visibility: "public",
    requiredAuthProvider: "microsoft-graph",
    requiredPermissions: ["User.Read", "User.Read.All", "AuditLog.Read.All", "LicenseAssignment.Read.All"],
    adminConsentRequired: true,
  },
  {
    id: "hello-world",
    name: "Hello World Assessment",
    description:
      "Validates the in-memory CloudOps execution and report pipeline.",
    scriptRelativePath: path.join(
      "hello-world",
      "Invoke-Assessment.ps1",
    ),
    enabled: true,
    timeoutMs: 30_000,
    provider: "azure",
    domain: "devops",
    moduleId: "runtime-validation",
    assessmentOrder: 1,
    visibility: "development",
    requiredAuthProvider: "none",
    requiredPermissions: [],
    adminConsentRequired: false,
  },
  {
    id: "microsoft-graph-connectivity",
    name: "Microsoft Graph Connectivity",
    description:
      "Validates delegated Microsoft Graph access for the connected tenant.",
    scriptRelativePath: path.join(
      "microsoft-graph-connectivity",
      "Invoke-Assessment.ps1",
    ),
    enabled: true,
    timeoutMs: 60_000,
    provider: "azure",
    domain: "secops",
    moduleId: "connectivity-diagnostics",
    assessmentOrder: 1,
    visibility: "public",
    requiredAuthProvider: "microsoft-graph",
    requiredPermissions: ["User.Read"],
    adminConsentRequired: false,
  },
];

function defaultEngineRoot(): string {
  return fileURLToPath(new URL("../../../../engine/", import.meta.url));
}

function resolveRegisteredScript(
  engineRoot: string,
  relativeScriptPath: string,
): string {
  if (
    relativeScriptPath.trim() === "" ||
    path.isAbsolute(relativeScriptPath)
  ) {
    throw new Error("Assessment script paths must be relative registry values");
  }

  const resolvedRoot = path.resolve(engineRoot);
  const resolvedScript = path.resolve(resolvedRoot, relativeScriptPath);
  const relativeToRoot = path.relative(resolvedRoot, resolvedScript);

  if (
    relativeToRoot === "" ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    relativeToRoot === ".." ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new Error("Assessment script path escapes the configured engine root");
  }

  if (path.extname(resolvedScript).toLowerCase() !== ".ps1") {
    throw new Error("Assessment registry entries must point to PowerShell scripts");
  }

  return resolvedScript;
}

export class AssessmentRegistry {
  readonly #assessments = new Map<AssessmentId, RegisteredAssessment>();

  public constructor(
    engineRoot: string,
    registrations: readonly AssessmentRegistration[] = DEFAULT_REGISTRATIONS,
    modules: ModuleRegistry = new ModuleRegistry(),
  ) {
    if (registrations.length === 0) {
      throw new Error("At least one assessment must be registered");
    }

    for (const registration of registrations) {
      const id = AssessmentIdSchema.parse(registration.id);
      if (this.#assessments.has(id)) {
        throw new Error("Duplicate assessment registry entry");
      }

      if (
        !Number.isSafeInteger(registration.timeoutMs) ||
        registration.timeoutMs < 100 ||
        registration.timeoutMs > 55 * 60_000
      ) {
        throw new Error("Assessment timeout is outside the allowed range");
      }
      if (registration.maxConcurrentExecutions !== undefined &&
        (!Number.isSafeInteger(registration.maxConcurrentExecutions) || registration.maxConcurrentExecutions < 1 || registration.maxConcurrentExecutions > 100)) {
        throw new Error("Assessment concurrency is outside the allowed range");
      }

      const module = modules.resolve(registration.moduleId);
      if (module.provider !== registration.provider || module.domain !== registration.domain) {
        throw new Error("Assessment module does not belong to its provider/domain");
      }
      const publicAssessment = AssessmentSummarySchema.parse({
        id,
        name: registration.name,
        ...(registration.description
          ? { description: registration.description }
          : {}),
        enabled: registration.enabled,
        provider: registration.provider,
        domain: registration.domain,
        moduleId: module.id,
        moduleName: module.name,
        moduleDescription: module.description,
        moduleOrder: module.order,
        assessmentOrder: registration.assessmentOrder,
        visibility: registration.visibility,
        requiredAuthProvider: registration.requiredAuthProvider,
        requiredPermissions: [...registration.requiredPermissions],
        adminConsentRequired: registration.adminConsentRequired,
      });

      if (
        (publicAssessment.requiredAuthProvider === "none" &&
          publicAssessment.requiredPermissions.length !== 0) ||
        (publicAssessment.requiredAuthProvider === "microsoft-graph" &&
          (publicAssessment.provider !== "azure" ||
            publicAssessment.requiredPermissions.length === 0))
      ) {
        throw new Error("Assessment authentication metadata is inconsistent");
      }

      this.#assessments.set(id, Object.freeze({
        ...publicAssessment,
        scriptPath: resolveRegisteredScript(
          engineRoot,
          registration.scriptRelativePath,
        ),
        timeoutMs: registration.timeoutMs,
        ...(registration.maxConcurrentExecutions !== undefined ? { maxConcurrentExecutions: registration.maxConcurrentExecutions } : {}),
      }));
    }
  }

  public list(): AssessmentSummary[] {
    return [...this.#assessments.values()].map((assessment) => ({
      id: assessment.id,
      name: assessment.name,
      ...(assessment.description
        ? { description: assessment.description }
        : {}),
      enabled: assessment.enabled,
      provider: assessment.provider,
      domain: assessment.domain,
      moduleId: assessment.moduleId,
      moduleName: assessment.moduleName,
      moduleDescription: assessment.moduleDescription,
      moduleOrder: assessment.moduleOrder,
      assessmentOrder: assessment.assessmentOrder,
      visibility: assessment.visibility,
      requiredAuthProvider: assessment.requiredAuthProvider,
      requiredPermissions: Object.freeze([
        ...assessment.requiredPermissions,
      ]),
      adminConsentRequired: assessment.adminConsentRequired,
    }));
  }

  public resolve(assessmentId: AssessmentId): RegisteredAssessment {
    const assessment = this.#assessments.get(assessmentId);
    if (!assessment) {
      throw errors.assessmentNotFound();
    }

    if (!assessment.enabled) {
      throw errors.assessmentDisabled();
    }

    return assessment;
  }
}

export function createDefaultAssessmentRegistry(
  configuredEngineRoot?: string,
): AssessmentRegistry {
  return new AssessmentRegistry(
    configuredEngineRoot
      ? path.resolve(configuredEngineRoot)
      : defaultEngineRoot(),
  );
}
