import { AssessmentIdSchema } from "@cloudops/contracts";
import type { ZodError } from "zod";

/** Only safe relative locations and developer-owned reasons reach startup logs. */
export class AssessmentManifestError extends Error {
  constructor(directory: string, field: string, reason: string) {
    const location = AssessmentIdSchema.safeParse(directory).success
      ? `${directory}/assessment.json` : "engine/[invalid-directory]";
    super(`Assessment manifest invalid: ${location}; field: ${field}; reason: ${reason}`);
    this.name = "AssessmentManifestError";
  }
}

const FIELDS = new Set([
  "schemaVersion", "id", "name", "description", "provider", "domain", "moduleId",
  "assessmentOrder", "enabled", "visibility", "engine", "runtime", "entrypoint",
  "timeoutSeconds", "maxConcurrentExecutions", "auth", "permissions",
  "adminConsentRequired", "display", "icon", "tags", "source",
]);

export function manifestSchemaError(directory: string, error: ZodError): AssessmentManifestError {
  const issue = error.issues[0];
  const field = issue?.path.length && issue.path.every((part) =>
    typeof part === "string" ? FIELDS.has(part) : typeof part === "number" && part >= 0 && part < 16)
    ? issue.path.join(".") : "manifest";
  const reason = field === "engine.timeoutSeconds" ? "expected integer from 1 to 3300"
    : field === "engine.maxConcurrentExecutions" ? "expected integer from 1 to 100"
    : issue?.code === "unrecognized_keys" ? "unknown fields are not allowed"
    : issue?.code === "too_big" ? "value exceeds the schema limit"
    : issue?.code === "too_small" ? "required value is empty or below the schema limit"
    : issue?.code === "invalid_value" ? "unsupported value or schema version"
    : issue?.code === "invalid_format" ? "invalid format"
    : issue?.code === "custom" ? "inconsistent or unsafe metadata"
    : "missing field or invalid type";
  // Never print Zod messages/unknown keys: these can include submitted values.
  return new AssessmentManifestError(directory, field, reason);
}
