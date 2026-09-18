import { z } from "zod";
import { AssessmentDisplaySchema } from "./assessment-display.js";

export const AssessmentIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export type AssessmentId = z.infer<typeof AssessmentIdSchema>;

export const CLOUD_PROVIDERS = ["azure", "aws", "gcp"] as const;
export const CloudProviderSchema = z.enum(CLOUD_PROVIDERS);
export type CloudProvider = z.infer<typeof CloudProviderSchema>;

export const OPERATIONAL_DOMAINS = [
  "dashboard",
  "govops",
  "secops",
  "finops",
  "devops",
] as const;
export const OperationalDomainSchema = z.enum(OPERATIONAL_DOMAINS);
export type OperationalDomain = z.infer<typeof OperationalDomainSchema>;

export const ASSESSMENT_VISIBILITIES = ["public", "development"] as const;
export const AssessmentVisibilitySchema = z.enum(ASSESSMENT_VISIBILITIES);
export type AssessmentVisibility = z.infer<
  typeof AssessmentVisibilitySchema
>;

export const ASSESSMENT_AUTH_PROVIDERS = [
  "none",
  "microsoft-graph",
] as const;
export const AssessmentAuthProviderSchema = z.enum(
  ASSESSMENT_AUTH_PROVIDERS,
);
export type AssessmentAuthProvider = z.infer<
  typeof AssessmentAuthProviderSchema
>;

export const GRAPH_PERMISSIONS = ["User.Read", "User.Read.All", "AuditLog.Read.All", "LicenseAssignment.Read.All", "GroupSettings.Read.All", "Policy.Read.All"] as const;
export const GraphPermissionSchema = z.enum(GRAPH_PERMISSIONS);
export type GraphPermission = z.infer<typeof GraphPermissionSchema>;

export const CatalogOrderSchema = z.number().int().min(1).max(999);
export const AssessmentModuleSchema = z.object({
  id: AssessmentIdSchema,
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(300),
  order: CatalogOrderSchema,
  provider: CloudProviderSchema,
  domain: OperationalDomainSchema,
}).strict();
export type AssessmentModule = z.infer<typeof AssessmentModuleSchema>;

export const AssessmentOptionsSchema = z.record(z.string(), z.unknown());

export const AssessmentExecutionRequestSchema = z
  .object({
    assessmentId: AssessmentIdSchema,
    options: AssessmentOptionsSchema,
  })
  .strict();

export type AssessmentExecutionRequest = z.infer<
  typeof AssessmentExecutionRequestSchema
>;

export const CreateExecutionBodySchema = z
  .object({
    options: AssessmentOptionsSchema.default({}),
  })
  .strict();

export type CreateExecutionBody = z.infer<typeof CreateExecutionBodySchema>;

export const AssessmentSummarySchema = z
  .object({
    id: AssessmentIdSchema,
    name: z.string().min(1).max(120),
    description: z.string().min(1).max(500).optional(),
    enabled: z.boolean(),
    provider: CloudProviderSchema,
    domain: OperationalDomainSchema,
    moduleId: AssessmentIdSchema,
    moduleName: z.string().min(1).max(120),
    moduleDescription: z.string().min(1).max(300),
    moduleOrder: CatalogOrderSchema,
    assessmentOrder: CatalogOrderSchema,
    visibility: AssessmentVisibilitySchema,
    requiredAuthProvider: AssessmentAuthProviderSchema,
    requiredPermissions: z.array(GraphPermissionSchema).max(16).readonly(),
    adminConsentRequired: z.boolean(),
    display: AssessmentDisplaySchema.optional(),
  })
  .strict();

export type AssessmentSummary = z.infer<typeof AssessmentSummarySchema>;

export const AssessmentCatalogSchema = AssessmentSummarySchema.array().superRefine((items, context) => {
  const ids = new Set<string>();
  const modules = new Map<string, string>();
  for (const item of items) {
    const metadata = JSON.stringify([
      item.provider, item.domain, item.moduleName, item.moduleDescription, item.moduleOrder,
    ]);
    if (ids.has(item.id) || (modules.has(item.moduleId) && modules.get(item.moduleId) !== metadata)) {
      context.addIssue({ code: "custom", message: "Inconsistent catalog metadata" });
    }
    ids.add(item.id);
    modules.set(item.moduleId, metadata);
  }
});
