import { z } from "zod";

export const AssessmentIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);

export type AssessmentId = z.infer<typeof AssessmentIdSchema>;

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
  })
  .strict();

export type AssessmentSummary = z.infer<typeof AssessmentSummarySchema>;
