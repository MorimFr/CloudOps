import {
  ConfidentialClientApplication,
  LogLevel,
  type Configuration,
  type OnBehalfOfRequest,
} from "@azure/msal-node";
import { classifyIdentityFailure, type GraphPermission } from "@cloudops/contracts";

import { CloudOpsError, errors } from "../errors.js";
import { isGuid, MICROSOFT_CONSUMER_TENANT_ID } from "./principal.js";
import { createIdentityNetwork } from "./identity-network.js";

const GRAPH_SCOPES: Readonly<Record<GraphPermission, string>> = Object.freeze({
  "User.Read": "https://graph.microsoft.com/User.Read",
  "User.Read.All": "https://graph.microsoft.com/User.Read.All",
  "AuditLog.Read.All": "https://graph.microsoft.com/AuditLog.Read.All",
  "LicenseAssignment.Read.All": "https://graph.microsoft.com/LicenseAssignment.Read.All",
});
const MAX_GRAPH_TOKEN_BYTES = 64 * 1_024;
const MAX_CLAIMS_CHALLENGE_BYTES = 8 * 1_024;

export interface OboClient {
  acquireTokenOnBehalfOf(
    request: OnBehalfOfRequest,
  ): Promise<{ readonly accessToken: string } | null>;
  clearCache(): void;
}

export type OboClientFactory = (configuration: Configuration) => OboClient;

export interface OboServiceOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly clientFactory?: OboClientFactory;
}

export interface OboTokenRequest {
  readonly incomingApiAccessToken: string;
  readonly tenantId: string;
  readonly requiredPermissions: readonly GraphPermission[];
  readonly signal?: AbortSignal;
}

export interface OboTokenResult {
  readonly accessToken: string;
}

export interface GraphTokenBroker {
  acquireToken(request: OboTokenRequest): Promise<OboTokenResult>;
}

function defaultClientFactory(configuration: Configuration): OboClient {
  return new ConfidentialClientApplication(configuration);
}

function authorityForTenant(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}`;
}

function stringField(error: unknown, field: string): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

function hasConsentError(error: unknown): boolean {
  return classifyIdentityFailure(error) === "consent";
}

function interactionRequired(error: unknown): boolean {
  const errorCode = stringField(error, "errorCode")?.toLowerCase();
  const subError = stringField(error, "subError")?.toLowerCase();
  return (
    errorCode === "interaction_required" ||
    errorCode === "claims_challenge_required" ||
    subError === "basic_action" ||
    subError === "additional_action" ||
    subError === "message_only" ||
    stringField(error, "claims") !== undefined
  );
}

function temporaryIdentityFailure(error: unknown): boolean {
  const code = stringField(error, "errorCode")?.toLowerCase();
  return (
    code === "temporarily_unavailable" ||
    code === "server_error" ||
    code === "request_timeout" ||
    code === "network_error"
  );
}

function isSafeJsonClaimsChallenge(claims: string): boolean {
  if (
    claims.length === 0 ||
    Buffer.byteLength(claims, "utf8") > MAX_CLAIMS_CHALLENGE_BYTES
  ) {
    return false;
  }
  try {
    const parsed = JSON.parse(claims) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function safeAuthenticateHeader(error: unknown, tenantId: string): string {
  const authorizationUri = `${authorityForTenant(tenantId)}/oauth2/v2.0/authorize`;
  const claims = stringField(error, "claims");
  if (claims !== undefined && isSafeJsonClaimsChallenge(claims)) {
    const encodedClaims = Buffer.from(claims, "utf8").toString("base64");
    return `Bearer authorization_uri="${authorizationUri}", error="insufficient_claims", claims="${encodedClaims}"`;
  }

  return `Bearer authorization_uri="${authorizationUri}", error="interaction_required"`;
}

function normalizeOboError(error: unknown, tenantId: string): Error {
  if (classifyIdentityFailure(error) === "admin") {
    return errors.adminApprovalRequired();
  }
  if (hasConsentError(error)) {
    return errors.graphConsentRequired();
  }
  if (interactionRequired(error)) {
    return errors.authInteractionRequired(
      safeAuthenticateHeader(error, tenantId),
    );
  }
  if (temporaryIdentityFailure(error)) {
    return errors.graphUnavailable();
  }
  return errors.graphAuthenticationFailed();
}

export class MsalOboService implements GraphTokenBroker {
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #clientFactory: OboClientFactory;

  public constructor(options: OboServiceOptions) {
    if (!isGuid(options.clientId) || options.clientSecret.trim() === "") {
      throw new Error("Microsoft OBO client configuration is invalid");
    }
    this.#clientId = options.clientId.toLowerCase();
    this.#clientSecret = options.clientSecret;
    this.#clientFactory = options.clientFactory ?? defaultClientFactory;
  }

  public async acquireToken(request: OboTokenRequest): Promise<OboTokenResult> {
    if (
      !isGuid(request.tenantId) ||
      request.tenantId.toLowerCase() === MICROSOFT_CONSUMER_TENANT_ID ||
      request.incomingApiAccessToken.length === 0 ||
      request.requiredPermissions.length === 0
    ) {
      throw errors.graphAuthenticationFailed();
    }

    const tenantId = request.tenantId.toLowerCase();
    const scopes = request.requiredPermissions.map(
      (permission) => GRAPH_SCOPES[permission],
    );
    if (scopes.some((scope) => scope === undefined)) {
      throw errors.graphAuthenticationFailed();
    }

    let client: OboClient | undefined;
    const signal = request.signal ?? AbortSignal.timeout(15_000);
    try {
      if (signal.aborted) throw errors.graphUnavailable();
      client = this.#clientFactory({
        auth: {
          clientId: this.#clientId,
          clientSecret: this.#clientSecret,
          authority: authorityForTenant(tenantId),
        },
        cache: {},
        system: {
          networkClient: createIdentityNetwork(signal),
          loggerOptions: {
            loggerCallback: () => undefined,
            piiLoggingEnabled: false,
            logLevel: LogLevel.Error,
          },
        },
      });
      const result = await client.acquireTokenOnBehalfOf({
        oboAssertion: request.incomingApiAccessToken,
        scopes,
        skipCache: true,
      });
      if (
        !result ||
        result.accessToken.length === 0 ||
        /\s/.test(result.accessToken) ||
        Buffer.byteLength(result.accessToken, "utf8") > MAX_GRAPH_TOKEN_BYTES
      ) {
        throw errors.graphAuthenticationFailed();
      }
      return { accessToken: result.accessToken };
    } catch (error) {
      if (signal.aborted) throw errors.graphUnavailable();
      if (error instanceof CloudOpsError) {
        throw error;
      }
      throw normalizeOboError(error, tenantId);
    } finally {
      try {
        client?.clearCache();
      } catch {
        // The client is ephemeral; failure to clear cannot expose data to a
        // subsequent request and must not replace the normalized outcome.
      }
    }
  }
}
