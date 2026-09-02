import { z } from "zod";

export const API_ERROR_CODES = [
  "ASSESSMENT_NOT_FOUND",
  "ASSESSMENT_DISABLED",
  "ASSESSMENT_EXECUTION_FAILED",
  "ASSESSMENT_TIMEOUT",
  "EXECUTION_NOT_FOUND",
  "EXECUTION_CAPACITY_REACHED",
  "ARTIFACT_NOT_READY",
  "ARTIFACT_UNAVAILABLE",
  "INVALID_REQUEST",
  "PAYLOAD_TOO_LARGE",
  "METHOD_NOT_ALLOWED",
  "NOT_FOUND",
  "INTERNAL_ERROR",
] as const;

export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorSchema = z
  .object({
    error: z
      .object({
        code: ApiErrorCodeSchema,
        message: z.string().min(1).max(300),
      })
      .strict(),
  })
  .strict();

export type ApiError = z.infer<typeof ApiErrorSchema>;
