import type { ApiErrorCode } from "@cloudops/contracts";

export class CloudOpsError extends Error {
  public readonly code: ApiErrorCode;
  public readonly statusCode: number;

  public constructor(
    code: ApiErrorCode,
    message: string,
    statusCode: number,
  ) {
    super(message);
    this.name = "CloudOpsError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export const errors = {
  assessmentNotFound: () =>
    new CloudOpsError(
      "ASSESSMENT_NOT_FOUND",
      "The requested assessment does not exist.",
      404,
    ),
  assessmentDisabled: () =>
    new CloudOpsError(
      "ASSESSMENT_DISABLED",
      "The requested assessment is not available.",
      409,
    ),
  executionNotFound: () =>
    new CloudOpsError(
      "EXECUTION_NOT_FOUND",
      "The requested execution does not exist or has expired.",
      404,
    ),
  capacityReached: () =>
    new CloudOpsError(
      "EXECUTION_CAPACITY_REACHED",
      "Execution capacity has been reached. Try again later.",
      429,
    ),
  artifactNotReady: () =>
    new CloudOpsError(
      "ARTIFACT_NOT_READY",
      "The assessment artifact is not ready.",
      409,
    ),
  artifactUnavailable: () =>
    new CloudOpsError(
      "ARTIFACT_UNAVAILABLE",
      "The assessment artifact is no longer available.",
      410,
    ),
  invalidRequest: () =>
    new CloudOpsError(
      "INVALID_REQUEST",
      "The request is invalid.",
      400,
    ),
} as const;
