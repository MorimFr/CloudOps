import { z } from "zod";

import { PublicMetricsSchema } from "./execution.js";

export const ProgressControlEventSchema = z
  .object({
    type: z.literal("progress"),
    stage: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Z][A-Z0-9_]*$/),
    progress: z.number().int().min(0).max(100),
  })
  .strict();

export const PublicMetricsControlEventSchema = z
  .object({
    type: z.literal("publicMetrics"),
    publicMetrics: PublicMetricsSchema,
  })
  .strict();

export const ASSESSMENT_FAILURE_CODES = [
  "ASSESSMENT_FAILED",
  "GRAPH_CONSENT_REQUIRED",
  "GRAPH_INSUFFICIENT_PRIVILEGES",
  "GRAPH_AUTHENTICATION_FAILED",
  "GRAPH_THROTTLED",
  "GRAPH_UNAVAILABLE",
] as const;

export const AssessmentFailureCodeSchema = z.enum(ASSESSMENT_FAILURE_CODES);
export type AssessmentFailureCode = z.infer<
  typeof AssessmentFailureCodeSchema
>;

export const ErrorControlEventSchema = z
  .object({
    type: z.literal("error"),
    code: AssessmentFailureCodeSchema,
    message: z.string().min(1).max(300),
  })
  .strict();

export const PowerShellControlEventSchema = z.discriminatedUnion("type", [
  ProgressControlEventSchema,
  PublicMetricsControlEventSchema,
  ErrorControlEventSchema,
]);

export type PowerShellControlEvent = z.infer<
  typeof PowerShellControlEventSchema
>;
