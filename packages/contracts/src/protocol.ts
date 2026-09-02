import { z } from "zod";

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

export const SummaryControlEventSchema = z
  .object({
    type: z.literal("summary"),
    summary: z.record(z.string(), z.unknown()),
  })
  .strict();

export const ErrorControlEventSchema = z
  .object({
    type: z.literal("error"),
    code: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Z][A-Z0-9_]*$/),
    message: z.string().min(1).max(300),
  })
  .strict();

export const PowerShellControlEventSchema = z.discriminatedUnion("type", [
  ProgressControlEventSchema,
  SummaryControlEventSchema,
  ErrorControlEventSchema,
]);

export type PowerShellControlEvent = z.infer<
  typeof PowerShellControlEventSchema
>;
