import {
  decodeJwt,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type ProtectedHeaderParameters,
  type CryptoKey,
  type JWK,
  type JWTPayload,
} from "jose";

import { errors } from "../errors.js";
import {
  createAuthenticatedPrincipal,
  isGuid,
  MICROSOFT_CONSUMER_TENANT_ID,
  type AuthenticatedPrincipal,
} from "./principal.js";

export const MICROSOFT_ORGANIZATIONS_METADATA_URL =
  "https://login.microsoftonline.com/organizations/v2.0/.well-known/openid-configuration";
export const MICROSOFT_ORGANIZATIONS_JWKS_URL =
  "https://login.microsoftonline.com/organizations/discovery/v2.0/keys";
const MICROSOFT_ISSUER_TEMPLATE =
  "https://login.microsoftonline.com/{tenantid}/v2.0";
const REQUIRED_API_SCOPE = "Assessment.Run";
const DEFAULT_MAX_TOKEN_BYTES = 32 * 1_024;
const DEFAULT_CACHE_TTL_MS = 60 * 60_000;
const DEFAULT_UNKNOWN_KID_COOLDOWN_MS = 30_000;
const DEFAULT_FETCH_TIMEOUT_MS = 5_000;
const MAX_METADATA_BYTES = 256 * 1_024;
const MAX_JWKS_BYTES = 1024 * 1_024;
const MAX_JWKS_KEYS = 100;

export interface ValidatedApiToken {
  readonly accessToken: string;
  readonly principal: AuthenticatedPrincipal;
}

export interface ApiTokenValidator {
  validate(accessToken: string): Promise<ValidatedApiToken>;
}

export interface SigningKeyProvider {
  resolveKey(
    protectedHeader: ProtectedHeaderParameters,
    unverifiedPayload: JWTPayload,
  ): Promise<CryptoKey | Uint8Array>;
}

interface CachedJwk {
  readonly jwk: JWK;
  importedKey?: Promise<CryptoKey | Uint8Array>;
}

export interface MicrosoftOrganizationsKeyProviderOptions {
  readonly fetchImplementation?: typeof fetch;
  readonly cacheTtlMs?: number;
  readonly unknownKidCooldownMs?: number;
  readonly fetchTimeoutMs?: number;
  readonly now?: () => number;
}

function expectedIssuer(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/v2.0`;
}

function validUnverifiedTenant(payload: JWTPayload): {
  tenantId: string;
  issuer: string;
} {
  if (!isGuid(payload.tid) || typeof payload.iss !== "string") {
    throw new Error("Invalid unverified tenant claims");
  }
  const tenantId = payload.tid.toLowerCase();
  const issuer = expectedIssuer(tenantId);
  if (payload.iss !== issuer) {
    throw new Error("Invalid unverified issuer");
  }
  return { tenantId, issuer };
}

function signingJwkMatches(
  jwk: JWK,
  tenantId: string,
  issuer: string,
): boolean {
  const record = jwk as JWK & { issuer?: unknown };
  if (
    jwk.kty !== "RSA" ||
    jwk.use !== "sig" ||
    (jwk.alg !== undefined && jwk.alg !== "RS256") ||
    typeof jwk.kid !== "string" ||
    typeof record.issuer !== "string"
  ) {
    return false;
  }

  const signingIssuer = record.issuer.replace("{tenantid}", tenantId);
  return signingIssuer === issuer;
}

async function fetchBoundedJson(
  fetchImplementation: typeof fetch,
  url: string,
  maximumBytes: number,
  timeoutMs: number,
): Promise<unknown> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  timeout.unref();

  try {
    const response = await fetchImplementation(url, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: abortController.signal,
    });
    if (!response.ok) {
      throw new Error("Microsoft identity metadata request failed");
    }

    const declaredLength = response.headers.get("content-length");
    if (
      declaredLength !== null &&
      Number.isFinite(Number(declaredLength)) &&
      Number(declaredLength) > maximumBytes
    ) {
      throw new Error("Microsoft identity metadata is too large");
    }

    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > maximumBytes) {
      throw new Error("Microsoft identity metadata is too large");
    }
    return JSON.parse(body) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

export class MicrosoftOrganizationsKeyProvider
  implements SigningKeyProvider
{
  readonly #fetchImplementation: typeof fetch;
  readonly #cacheTtlMs: number;
  readonly #unknownKidCooldownMs: number;
  readonly #fetchTimeoutMs: number;
  readonly #now: () => number;

  #keys = new Map<string, CachedJwk[]>();
  #expiresAt = 0;
  #lastRefreshAt = 0;
  #refreshPromise?: Promise<void>;

  public constructor(options: MicrosoftOrganizationsKeyProviderOptions = {}) {
    this.#fetchImplementation = options.fetchImplementation ?? fetch;
    this.#cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.#unknownKidCooldownMs =
      options.unknownKidCooldownMs ?? DEFAULT_UNKNOWN_KID_COOLDOWN_MS;
    this.#fetchTimeoutMs =
      options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    this.#now = options.now ?? Date.now;
  }

  public async resolveKey(
    protectedHeader: ProtectedHeaderParameters,
    unverifiedPayload: JWTPayload,
  ): Promise<CryptoKey | Uint8Array> {
    if (
      protectedHeader.alg !== "RS256" ||
      typeof protectedHeader.kid !== "string" ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(protectedHeader.kid)
    ) {
      throw new Error("Unsupported token signing header");
    }

    const { tenantId, issuer } = validUnverifiedTenant(unverifiedPayload);
    const now = this.#now();
    if (this.#keys.size === 0 || this.#expiresAt <= now) {
      await this.#refresh();
    }

    let candidates = this.#matchingCandidates(
      protectedHeader.kid,
      tenantId,
      issuer,
    );
    if (
      candidates.length === 0 &&
      now - this.#lastRefreshAt >= this.#unknownKidCooldownMs
    ) {
      await this.#refresh();
      candidates = this.#matchingCandidates(
        protectedHeader.kid,
        tenantId,
        issuer,
      );
    }

    const candidate = candidates[0];
    if (!candidate) {
      throw new Error("Token signing key was not found");
    }

    candidate.importedKey ??= importJWK(candidate.jwk, "RS256");
    return await candidate.importedKey;
  }

  #matchingCandidates(
    kid: string,
    tenantId: string,
    issuer: string,
  ): CachedJwk[] {
    return (this.#keys.get(kid) ?? []).filter(({ jwk }) =>
      signingJwkMatches(jwk, tenantId, issuer),
    );
  }

  async #refresh(): Promise<void> {
    if (this.#refreshPromise) {
      return await this.#refreshPromise;
    }

    this.#refreshPromise = this.#loadKeys();
    try {
      await this.#refreshPromise;
    } finally {
      this.#refreshPromise = undefined;
    }
  }

  async #loadKeys(): Promise<void> {
    const metadata = await fetchBoundedJson(
      this.#fetchImplementation,
      MICROSOFT_ORGANIZATIONS_METADATA_URL,
      MAX_METADATA_BYTES,
      this.#fetchTimeoutMs,
    );
    if (
      typeof metadata !== "object" ||
      metadata === null ||
      !("issuer" in metadata) ||
      metadata.issuer !== MICROSOFT_ISSUER_TEMPLATE ||
      !("jwks_uri" in metadata) ||
      metadata.jwks_uri !== MICROSOFT_ORGANIZATIONS_JWKS_URL
    ) {
      throw new Error("Unexpected Microsoft identity metadata");
    }

    const jwks = await fetchBoundedJson(
      this.#fetchImplementation,
      MICROSOFT_ORGANIZATIONS_JWKS_URL,
      MAX_JWKS_BYTES,
      this.#fetchTimeoutMs,
    );
    if (
      typeof jwks !== "object" ||
      jwks === null ||
      !("keys" in jwks) ||
      !Array.isArray(jwks.keys) ||
      jwks.keys.length === 0 ||
      jwks.keys.length > MAX_JWKS_KEYS
    ) {
      throw new Error("Unexpected Microsoft identity signing keys");
    }

    const nextKeys = new Map<string, CachedJwk[]>();
    for (const rawKey of jwks.keys) {
      if (
        typeof rawKey !== "object" ||
        rawKey === null ||
        !("kid" in rawKey) ||
        typeof rawKey.kid !== "string"
      ) {
        continue;
      }
      const entries = nextKeys.get(rawKey.kid) ?? [];
      entries.push({ jwk: rawKey as JWK });
      nextKeys.set(rawKey.kid, entries);
    }
    if (nextKeys.size === 0) {
      throw new Error("Microsoft identity signing key set is empty");
    }

    const refreshedAt = this.#now();
    this.#keys = nextKeys;
    this.#lastRefreshAt = refreshedAt;
    this.#expiresAt = refreshedAt + this.#cacheTtlMs;
  }
}

export interface EntraTokenValidatorOptions {
  readonly audience: string;
  readonly authorizedParty: string;
  readonly keyProvider: SigningKeyProvider;
  readonly maximumTokenBytes?: number;
  readonly clockToleranceSeconds?: number;
}

export class EntraTokenValidator implements ApiTokenValidator {
  readonly #audience: string;
  readonly #authorizedParty: string;
  readonly #keyProvider: SigningKeyProvider;
  readonly #maximumTokenBytes: number;
  readonly #clockToleranceSeconds: number;

  public constructor(options: EntraTokenValidatorOptions) {
    if (!isGuid(options.audience)) {
      throw new Error("CloudOps API audience must be a client ID GUID");
    }
    this.#audience = options.audience.toLowerCase();
    if (!isGuid(options.authorizedParty) || options.authorizedParty.toLowerCase() === this.#audience) {
      throw new Error("CloudOps Web authorized party must be a distinct client ID GUID");
    }
    this.#authorizedParty = options.authorizedParty.toLowerCase();
    this.#keyProvider = options.keyProvider;
    this.#maximumTokenBytes =
      options.maximumTokenBytes ?? DEFAULT_MAX_TOKEN_BYTES;
    this.#clockToleranceSeconds = options.clockToleranceSeconds ?? 5;
  }

  public async validate(accessToken: string): Promise<ValidatedApiToken> {
    if (
      accessToken.length === 0 ||
      Buffer.byteLength(accessToken, "utf8") > this.#maximumTokenBytes ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
        accessToken,
      )
    ) {
      throw errors.invalidApiToken();
    }

    let payload: JWTPayload;
    try {
      const unverifiedHeader = decodeProtectedHeader(accessToken);
      const unverifiedPayload = decodeJwt(accessToken);
      const key = await this.#keyProvider.resolveKey(
        unverifiedHeader,
        unverifiedPayload,
      );
      const verified = await jwtVerify(accessToken, key, {
        algorithms: ["RS256"],
        audience: this.#audience,
        requiredClaims: ["iss", "aud", "exp"],
        clockTolerance: this.#clockToleranceSeconds,
      });
      payload = verified.payload;
    } catch {
      throw errors.invalidApiToken();
    }

    if (
      payload.aud !== this.#audience ||
      payload.ver !== "2.0" ||
      !isGuid(payload.azp) ||
      payload.azp.toLowerCase() !== this.#authorizedParty ||
      !isGuid(payload.tid) ||
      !isGuid(payload.oid)
    ) {
      throw errors.invalidApiToken();
    }

    const tenantId = payload.tid.toLowerCase();
    const objectId = payload.oid.toLowerCase();
    if (
      tenantId === MICROSOFT_CONSUMER_TENANT_ID ||
      payload.iss !== expectedIssuer(tenantId)
    ) {
      throw errors.invalidApiToken();
    }

    if (
      payload.idtyp === "app" ||
      (payload.scp === undefined && Array.isArray(payload.roles))
    ) {
      throw errors.invalidApiToken();
    }
    if (typeof payload.scp !== "string") {
      throw errors.insufficientApiScope();
    }
    const scopes = new Set(payload.scp.split(/\s+/).filter(Boolean));
    if (!scopes.has(REQUIRED_API_SCOPE)) {
      throw errors.insufficientApiScope();
    }

    return Object.freeze({
      accessToken,
      principal: createAuthenticatedPrincipal(tenantId, objectId),
    });
  }
}
