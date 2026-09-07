import {
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWTPayload,
} from "jose";

import {
  EntraTokenValidator,
  type ApiTokenValidator,
  type SigningKeyProvider,
  type ValidatedApiToken,
} from "../src/auth/token-validator.js";

export const TEST_API_CLIENT_ID =
  "11111111-1111-4111-8111-111111111111";
export const TEST_TENANT_A =
  "22222222-2222-4222-8222-222222222222";
export const TEST_TENANT_B =
  "33333333-3333-4333-8333-333333333333";
export const TEST_OBJECT_A =
  "44444444-4444-4444-8444-444444444444";
export const TEST_OBJECT_B =
  "55555555-5555-4555-8555-555555555555";

const TEST_KEY_ID = "cloudops-test-key";

export interface TestTokenOptions {
  readonly tenantId?: string;
  readonly objectId?: string;
  readonly audience?: string;
  readonly issuer?: string;
  readonly version?: string;
  readonly scope?: string | null;
  readonly roles?: readonly string[];
  readonly idtyp?: string;
  readonly expirationTime?: number;
  readonly notBefore?: number;
  readonly signingKey?: CryptoKey;
  readonly keyId?: string;
  readonly additionalClaims?: JWTPayload;
}

export interface LocalAuthHarness {
  readonly validator: ApiTokenValidator;
  readonly publicKey: CryptoKey;
  readonly privateKey: CryptoKey;
  issueToken(options?: TestTokenOptions): Promise<string>;
  validate(options?: TestTokenOptions): Promise<ValidatedApiToken>;
}

export async function createLocalAuthHarness(): Promise<LocalAuthHarness> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const keyProvider: SigningKeyProvider = {
    async resolveKey(header) {
      if (header.alg !== "RS256" || header.kid !== TEST_KEY_ID) {
        throw new Error("Unknown local signing key");
      }
      return publicKey;
    },
  };
  const validator = new EntraTokenValidator({
    audience: TEST_API_CLIENT_ID,
    keyProvider,
    clockToleranceSeconds: 0,
  });

  async function issueToken(options: TestTokenOptions = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1_000);
    const tenantId = options.tenantId ?? TEST_TENANT_A;
    const objectId = options.objectId ?? TEST_OBJECT_A;
    const scope = options.scope === undefined
      ? "Assessment.Run"
      : options.scope;
    const claims: JWTPayload = {
      ver: options.version ?? "2.0",
      tid: tenantId,
      oid: objectId,
      ...(scope === null ? {} : { scp: scope }),
      ...(options.roles ? { roles: [...options.roles] } : {}),
      ...(options.idtyp ? { idtyp: options.idtyp } : {}),
      ...options.additionalClaims,
    };
    let token = new SignJWT(claims)
      .setProtectedHeader({
        alg: "RS256",
        kid: options.keyId ?? TEST_KEY_ID,
        typ: "JWT",
      })
      .setIssuer(
        options.issuer ??
          `https://login.microsoftonline.com/${tenantId.toLowerCase()}/v2.0`,
      )
      .setAudience(options.audience ?? TEST_API_CLIENT_ID)
      .setIssuedAt(now)
      .setExpirationTime(options.expirationTime ?? now + 3_600);
    if (options.notBefore !== undefined) {
      token = token.setNotBefore(options.notBefore);
    }
    return await token.sign(options.signingKey ?? privateKey);
  }

  return {
    validator,
    publicKey,
    privateKey,
    issueToken,
    async validate(options = {}) {
      return await validator.validate(await issueToken(options));
    },
  };
}
