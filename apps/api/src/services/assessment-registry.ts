import {
  AssessmentSummarySchema, type AssessmentId, type AssessmentSummary,
} from "@cloudops/contracts";
import { errors } from "../errors.js";
import { discoverAssessmentManifests, type DiscoveredAssessment } from "./assessment-discovery.js";
import { AssessmentManifestError } from "./assessment-manifest-error.js";
import { ModuleRegistry } from "./module-registry.js";
import { discoverControlPacks } from "./control-pack-discovery.js";

export interface RegisteredAssessment extends AssessmentSummary {
  readonly scriptPath: string;
  readonly timeoutMs: number;
  readonly maxConcurrentExecutions?: number;
}

/** Joins validated plugins with central modules; no per-assessment defaults. */
export class AssessmentRegistry {
  readonly #assessments = new Map<AssessmentId, RegisteredAssessment>();

  constructor(plugins: readonly DiscoveredAssessment[], modules: ModuleRegistry = new ModuleRegistry()) {
    for (const { manifest, scriptPath } of plugins) {
      if (this.#assessments.has(manifest.id)) throw new AssessmentManifestError(manifest.id, "id", "duplicate assessment ID");
      let module;
      try { module = modules.resolve(manifest.moduleId); }
      catch { throw new AssessmentManifestError(manifest.id, "moduleId", "module is not registered"); }
      if (module.provider !== manifest.provider || module.domain !== manifest.domain) {
        throw new AssessmentManifestError(manifest.id, "moduleId", "module provider/domain mismatch");
      }
      const summary = AssessmentSummarySchema.parse({
        id: manifest.id, name: manifest.name, description: manifest.description,
        provider: manifest.provider, domain: manifest.domain,
        moduleId: module.id, moduleName: module.name, moduleDescription: module.description, moduleOrder: module.order,
        assessmentOrder: manifest.assessmentOrder, enabled: manifest.enabled, visibility: manifest.visibility,
        requiredAuthProvider: manifest.auth.provider, requiredPermissions: [...manifest.auth.permissions],
        adminConsentRequired: manifest.auth.adminConsentRequired,
        ...(manifest.display ? { display: manifest.display } : {}),
      });
      this.#assessments.set(manifest.id, Object.freeze({
        ...summary, scriptPath, timeoutMs: manifest.engine.timeoutSeconds * 1000,
        ...(manifest.engine.maxConcurrentExecutions !== undefined ? { maxConcurrentExecutions: manifest.engine.maxConcurrentExecutions } : {}),
      }));
    }
  }

  list(): AssessmentSummary[] {
    return [...this.#assessments.values()].map((assessment) => ({
      id: assessment.id, name: assessment.name,
      ...(assessment.description ? { description: assessment.description } : {}),
      provider: assessment.provider, domain: assessment.domain,
      moduleId: assessment.moduleId, moduleName: assessment.moduleName,
      moduleDescription: assessment.moduleDescription, moduleOrder: assessment.moduleOrder,
      assessmentOrder: assessment.assessmentOrder, enabled: assessment.enabled, visibility: assessment.visibility,
      requiredAuthProvider: assessment.requiredAuthProvider, requiredPermissions: assessment.requiredPermissions,
      adminConsentRequired: assessment.adminConsentRequired,
      ...(assessment.display ? { display: assessment.display } : {}),
    }));
  }

  resolve(assessmentId: AssessmentId): RegisteredAssessment {
    const assessment = this.#assessments.get(assessmentId);
    if (!assessment) throw errors.assessmentNotFound();
    if (!assessment.enabled) throw errors.assessmentDisabled();
    return assessment;
  }
}

export function createDefaultAssessmentRegistry(engineRoot?: string): AssessmentRegistry {
  const plugins = discoverAssessmentManifests(engineRoot);
  const registry = new AssessmentRegistry(plugins);
  discoverControlPacks(plugins, engineRoot);
  return registry;
}
