import type { ApiErrorCode } from "@cloudops/contracts";

const MAX_AUTHENTICATE_HEADER_BYTES = 16 * 1_024;

function isSafeAuthenticateHeader(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x20 || codePoint > 0x7e) {
      return false;
    }
  }

  return (
    value.startsWith("Bearer ") &&
    Buffer.byteLength(value, "utf8") <= MAX_AUTHENTICATE_HEADER_BYTES
  );
}

export class CloudOpsError extends Error {
  public readonly code: ApiErrorCode;
  public readonly statusCode: number;
  public readonly authenticateHeader?: string;

  public constructor(
    code: ApiErrorCode,
    message: string,
    statusCode: number,
    authenticateHeader?: string,
  ) {
    super(message);
    this.name = "CloudOpsError";
    this.code = code;
    this.statusCode = statusCode;
    if (
      authenticateHeader !== undefined &&
      isSafeAuthenticateHeader(authenticateHeader)
    ) {
      Object.defineProperty(this, "authenticateHeader", {
        value: authenticateHeader,
        enumerable: false,
        configurable: false,
        writable: false,
      });
    }
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
  authenticationRequired: () =>
    new CloudOpsError(
      "AUTHENTICATION_REQUIRED",
      "A valid CloudOps API access token is required.",
      401,
      'Bearer error="invalid_token"',
    ),
  invalidApiToken: () =>
    new CloudOpsError(
      "INVALID_API_TOKEN",
      "The CloudOps API access token is invalid.",
      401,
      'Bearer error="invalid_token"',
    ),
  insufficientApiScope: () =>
    new CloudOpsError(
      "INSUFFICIENT_API_SCOPE",
      "The CloudOps API access token does not grant Assessment.Run.",
      403,
      'Bearer error="insufficient_scope", scope="Assessment.Run"',
    ),
  authInteractionRequired: (authenticateHeader: string) =>
    new CloudOpsError(
      "AUTH_INTERACTION_REQUIRED",
      "Additional Microsoft authentication is required.",
      401,
      authenticateHeader,
    ),
  graphConsentRequired: () =>
    new CloudOpsError(
      "GRAPH_CONSENT_REQUIRED",
      "The tenant has not granted a permission required by this assessment.",
      403,
    ),
  graphAuthenticationFailed: () =>
    new CloudOpsError(
      "GRAPH_AUTHENTICATION_FAILED",
      "Microsoft Graph authentication could not be completed.",
      401,
    ),
  graphUnavailable: () =>
    new CloudOpsError(
      "GRAPH_UNAVAILABLE",
      "Microsoft Graph authentication is temporarily unavailable.",
      503,
    ),
} as const;
