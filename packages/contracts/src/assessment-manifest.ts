import { z } from "zod";
import {
  AssessmentIdSchema, AssessmentVisibilitySchema, CatalogOrderSchema,
  CloudProviderSchema, GraphPermissionSchema, OperationalDomainSchema,
} from "./assessment.js";
import { AssessmentDisplaySchema } from "./assessment-display.js";

export const ASSESSMENT_MANIFEST_VERSION = "cloudops.assessment.v1";
export const MAX_ASSESSMENT_MANIFEST_BYTES = 64 * 1024;

export const AssessmentEntrypointSchema = z.string().min(1).max(240)
  // Portable path segments only: no shell arguments, drive/UNC paths, ADS,
  // backslashes, dot segments, percent encoding or absolute paths.
  .regex(/^(?:[a-z0-9][a-z0-9_-]*\/)*[a-z0-9][a-z0-9._-]*\.ps1$/i);

const AuthSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("none"),
    permissions: z.array(GraphPermissionSchema).length(0).readonly(),
    adminConsentRequired: z.literal(false),
  }).strict(),
  z.object({
    provider: z.literal("microsoft-graph"),
    permissions: z.array(GraphPermissionSchema).min(1).max(16)
      .refine((items) => new Set(items).size === items.length, "Duplicate permissions")
      .readonly(),
    adminConsentRequired: z.boolean(),
  }).strict(),
]);

export const AssessmentManifestSchema = z.object({
  schemaVersion: z.literal(ASSESSMENT_MANIFEST_VERSION),
  id: AssessmentIdSchema,
  name: z.string().min(1).max(100).refine((text) => text.trim().length > 0),
  description: z.string().min(1).max(500).refine((text) => text.trim().length > 0),
  provider: CloudProviderSchema,
  domain: OperationalDomainSchema,
  moduleId: AssessmentIdSchema,
  assessmentOrder: CatalogOrderSchema,
  enabled: z.boolean(),
  visibility: AssessmentVisibilitySchema,
  engine: z.object({
    runtime: z.literal("powershell"),
    entrypoint: AssessmentEntrypointSchema,
    timeoutSeconds: z.number().int().min(1).max(3300),
    maxConcurrentExecutions: z.number().int().min(1).max(100).optional(),
  }).strict().readonly(),
  auth: AuthSchema.readonly(),
  display: AssessmentDisplaySchema.optional(),
}).strict().superRefine((manifest, context) => {
  if (manifest.auth.provider === "microsoft-graph" && manifest.provider !== "azure") {
    context.addIssue({ code: "custom", path: ["auth", "provider"], message: "Graph requires Azure" });
  }
}).readonly();

export type AssessmentManifest = z.infer<typeof AssessmentManifestSchema>;
