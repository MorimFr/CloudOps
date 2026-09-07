import { z } from "zod";

export const API_ERROR_CODES = [
  "ASSESSMENT_NOT_FOUND",
  "ASSESSMENT_DISABLED",
  "ASSESSMENT_EXECUTION_FAILED",
  "ASSESSMENT_TIMEOUT",
  "ARTIFACT_TOO_LARGE",
  "EXECUTION_NOT_FOUND",
  "EXECUTION_CAPACITY_REACHED",
  "ARTIFACT_NOT_READY",
  "ARTIFACT_UNAVAILABLE",
  "INVALID_REQUEST",
  "PAYLOAD_TOO_LARGE",
  "AUTHENTICATION_REQUIRED",
  "INVALID_API_TOKEN",
  "INSUFFICIENT_API_SCOPE",
  "AUTH_INTERACTION_REQUIRED",
  "GRAPH_CONSENT_REQUIRED",
  "GRAPH_INSUFFICIENT_PRIVILEGES",
  "GRAPH_AUTHENTICATION_FAILED",
  "GRAPH_THROTTLED",
  "GRAPH_UNAVAILABLE",
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
