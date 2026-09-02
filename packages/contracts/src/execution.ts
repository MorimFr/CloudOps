import { z } from "zod";

import { AssessmentIdSchema } from "./assessment.js";

export const EXECUTION_STATUSES = [
  "CREATED",
  "STARTING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "EXPIRED",
] as const;

export const ExecutionStatusSchema = z.enum(EXECUTION_STATUSES);
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;

export const ExecutionIdSchema = z
  .string()
  .regex(/^EXE-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

export const ExecutionSummarySchema = z.record(z.string(), z.unknown());

export const ExecutionSchema = z
  .object({
    executionId: ExecutionIdSchema,
    assessmentId: AssessmentIdSchema,
    status: ExecutionStatusSchema,
    stage: z.string().max(100).nullable(),
    progress: z.number().int().min(0).max(100),
    createdAt: z.string().datetime({ offset: true }),
    startedAt: z.string().datetime({ offset: true }).nullable(),
    completedAt: z.string().datetime({ offset: true }).nullable(),
    summary: ExecutionSummarySchema.optional(),
    artifactAvailable: z.boolean(),
    expiresAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export type Execution = z.infer<typeof ExecutionSchema>;

export const CreateExecutionResponseSchema = z
  .object({
    executionId: ExecutionIdSchema,
    status: z.literal("STARTING"),
  })
  .strict();

export type CreateExecutionResponse = z.infer<
  typeof CreateExecutionResponseSchema
>;
