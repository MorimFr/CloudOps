import { createDefaultAssessmentRegistry } from "../services/assessment-registry.js";
import { AssessmentManifestError } from "../services/assessment-manifest-error.js";

try {
  const command = process.argv[2];
  if (command !== "validate" && command !== "list") throw new Error("Unsupported command");
  // No auth/config/credentials are needed to inspect static plugin metadata.
  const catalog = createDefaultAssessmentRegistry(process.env.CLOUDOPS_ENGINE_ROOT).list();
  if (command === "validate") console.log(`${catalog.length} assessment manifests valid`);
  else for (const item of catalog) {
    console.log(`${item.id}\n  ${item.provider}/${item.domain}/${item.moduleId}\n  powershell\n  ${item.visibility}${item.enabled ? "" : " (disabled)"}`);
  }
} catch (error) {
  console.error(error instanceof AssessmentManifestError ? error.message : "Assessment manifest validation failed safely.");
  process.exitCode = 1;
}
