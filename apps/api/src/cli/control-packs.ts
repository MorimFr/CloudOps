import { discoverAssessmentManifests } from "../services/assessment-discovery.js";
import { AssessmentRegistry } from "../services/assessment-registry.js";
import { AssessmentManifestError } from "../services/assessment-manifest-error.js";
import { discoverControlPacks } from "../services/control-pack-discovery.js";
import { ControlPackValidationError } from "../services/control-pack-validation.js";

try {
  const command = process.argv[2];
  if (command !== "validate" && command !== "list") throw new Error("Unsupported developer command");
  const plugins = discoverAssessmentManifests(process.env.CLOUDOPS_ENGINE_ROOT);
  new AssessmentRegistry(plugins); // Module relationships remain centralized.
  const packs = discoverControlPacks(plugins, process.env.CLOUDOPS_ENGINE_ROOT);
  if (command === "validate") console.log(`${packs.length} control packs valid`);
  else for (const { assessmentId, pack, plan } of packs) {
    console.log(`${pack.id}\n  name: ${pack.name}\n  assessment: ${assessmentId}\n  version: ${pack.controlPackVersion}\n  source: ${pack.source.kind}\n  controls: ${pack.controls.length}\n  automated: ${pack.controls.filter((control) => control.evaluationType === "AUTOMATED").length}\n  manual: ${pack.controls.filter((control) => control.evaluationType === "MANUAL").length}\n  hybrid: ${pack.controls.filter((control) => control.evaluationType === "HYBRID").length}\n  collectors: ${plan.collectorIds.length}`);
  }
} catch (error) {
  console.error(error instanceof AssessmentManifestError || error instanceof ControlPackValidationError
    ? error.message : "Control pack validation failed safely.");
  process.exitCode = 1;
}
