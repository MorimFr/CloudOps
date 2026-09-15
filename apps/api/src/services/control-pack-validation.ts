import {
  AssessmentPlanSchema, GraphPermissionSchema, type AssessmentDefinition,
  type AssessmentManifest, type AssessmentPlan, type ControlPack,
} from "@cloudops/contracts";

export class ControlPackValidationError extends Error {
  constructor(readonly field: string, reason: string) {
    // Callers supply only fixed developer-owned fields/reasons, never input values.
    super(`Assessment SDK invalid; field: ${field}; reason: ${reason}`);
    this.name = "ControlPackValidationError";
  }
}

const ordinal = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
function fail(field: string, reason: string): never { throw new ControlPackValidationError(field, reason); }

/** Build-time/preflight validation over data only. The PowerShell SDK owns execution. */
export function validateControlPackPlan(
  pack: ControlPack,
  definition: AssessmentDefinition,
  manifest: Pick<AssessmentManifest, "id" | "provider" | "auth">,
  selectedControlIds?: readonly string[],
): AssessmentPlan {
  if (definition.assessmentId !== manifest.id) fail("assessmentId", "definition does not match manifest");
  const collectors = new Map(definition.collectors.map((collector) => [collector.id, collector]));
  const evaluators = new Map(definition.evaluators.map((evaluator) => [evaluator.id, evaluator]));
  const recommendations = new Set(definition.recommendations.map((recommendation) => recommendation.recommendationId));

  // The adapter is provider-specific; the shared SDK permission contract is not.
  if (manifest.provider === "azure" && definition.collectors.some((collector) =>
    collector.requiredPermissions.some((permission) => !GraphPermissionSchema.safeParse(permission).success))) {
    fail("collectors.requiredPermissions", "unsupported permission in Azure collector registry");
  }
  const allRequiredPermissions = new Set<string>();
  let authenticationRequired = false;
  for (const control of pack.controls) {
    if (!recommendations.has(control.recommendationId)) fail("controls.recommendationId", "unknown recommendation");
    for (const id of control.collectorRequirements) {
      if (!collectors.has(id)) fail("controls.collectorRequirements", "unknown collector");
    }
    if (control.evaluator !== null) {
      const evaluator = evaluators.get(control.evaluator);
      if (!evaluator) fail("controls.evaluator", "unknown evaluator");
      if (evaluator.collectorRequirements.some((id) => !control.collectorRequirements.includes(id))) {
        fail("controls.collectorRequirements", "control omits evaluator dependency");
      }
    }
    // MANUAL/HYBRID metadata is validated but does not schedule collectors in v1.
    if (control.evaluationType !== "AUTOMATED") continue;
    for (const id of control.collectorRequirements) {
      const collector = collectors.get(id)!;
      for (const permission of collector.requiredPermissions) allRequiredPermissions.add(permission);
      authenticationRequired ||= collector.requiresAuthentication;
    }
  }
  if (authenticationRequired && manifest.auth.provider === "none") fail("auth.provider", "planned collectors require authentication");
  const declared = new Set<string>(manifest.auth.permissions);
  if ([...allRequiredPermissions].some((permission) => !declared.has(permission))) {
    fail("auth.permissions", "manifest must declare a superset of pack permissions");
  }

  const requested = selectedControlIds === undefined ? undefined : new Set(selectedControlIds);
  const knownControls = new Set(pack.controls.map((control) => control.id));
  if (requested && (requested.size === 0 || requested.size !== selectedControlIds!.length
    || [...requested].some((id) => !knownControls.has(id)))) fail("selectedControlIds", "unknown, duplicate or empty selection");
  const selected = pack.controls.filter((control) => !requested || requested.has(control.id))
    .sort((left, right) => left.order - right.order || ordinal(left.id, right.id));
  const collectorIds = new Set<string>();
  const permissions = new Set<string>();
  for (const control of selected) {
    if (control.evaluationType !== "AUTOMATED") continue;
    for (const id of control.collectorRequirements) {
      collectorIds.add(id);
      for (const permission of collectors.get(id)!.requiredPermissions) permissions.add(permission);
    }
  }
  return AssessmentPlanSchema.parse({
    schemaVersion: "cloudops.assessment-plan.v1", packId: pack.id, controlPackVersion: pack.controlPackVersion,
    controlIds: selected.map((control) => control.id), collectorIds: [...collectorIds].sort(ordinal),
    requiredPermissions: [...permissions].sort(ordinal),
  });
}
