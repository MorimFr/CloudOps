import { exportJWK, generateKeyPair } from "jose";
import { describe, expect, it, vi } from "vitest";

import {
  EntraTokenValidator,
  MicrosoftOrganizationsKeyProvider,
  MICROSOFT_ORGANIZATIONS_JWKS_URL,
  MICROSOFT_ORGANIZATIONS_METADATA_URL,
} from "../src/auth/token-validator.js";
import {
  createLocalAuthHarness,
  TEST_API_CLIENT_ID,
  TEST_OBJECT_B,
  TEST_TENANT_A,
  TEST_TENANT_B,
} from "./auth-helpers.js";

describe("EntraTokenValidator", () => {
  it("accepts cryptographically signed delegated tokens from multiple tenants", async () => {
    const harness = await createLocalAuthHarness();
    const principalA = await harness.validate();
    const principalB = await harness.validate({
      tenantId: TEST_TENANT_B,
      objectId: TEST_OBJECT_B,
      scope: "openid Assessment.Run profile",
    });

    expect(principalA.principal.tenantId).toBe(TEST_TENANT_A);
    expect(principalB.principal.tenantId).toBe(TEST_TENANT_B);
    expect(principalA.principal.ownerKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(principalA.principal.ownerKey).not.toBe(
      principalB.principal.ownerKey,
    );
  });

  it.each([
    ["wrong audience", { audience: "00000003-0000-0000-c000-000000000000" }],
    ["expired", { expirationTime: Math.floor(Date.now() / 1_000) - 60 }],
    ["issuer mismatch", { issuer: "https://login.microsoftonline.com/common/v2.0" }],
    ["wrong version", { version: "1.0" }],
    ["future not-before", { notBefore: Math.floor(Date.now() / 1_000) + 300 }],
  ] as const)("rejects a token with %s", async (_name, options) => {
    const harness = await createLocalAuthHarness();
    const token = await harness.issueToken(options);

    await expect(harness.validator.validate(token)).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_API_TOKEN",
    });
  });

  it("rejects a token signed by a different RSA key", async () => {
    const harness = await createLocalAuthHarness();
    const otherKeyPair = await generateKeyPair("RS256");
    const token = await harness.issueToken({
      signingKey: otherKeyPair.privateKey,
    });

    await expect(harness.validator.validate(token)).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_API_TOKEN",
    });
  });

  it("returns 403 only for a valid delegated token missing Assessment.Run", async () => {
    const harness = await createLocalAuthHarness();
    const token = await harness.issueToken({ scope: "openid profile" });

    await expect(harness.validator.validate(token)).rejects.toMatchObject({
      statusCode: 403,
      code: "INSUFFICIENT_API_SCOPE",
    });
  });

  it("rejects app-only and Microsoft consumer tenant tokens", async () => {
    const harness = await createLocalAuthHarness();
    const appOnly = await harness.issueToken({
      scope: null,
      roles: ["Assessment.Run"],
      idtyp: "app",
    });
    const consumer = await harness.issueToken({
      tenantId: "9188040d-6c67-4c5b-b112-36a304b66dad",
    });

    await expect(harness.validator.validate(appOnly)).rejects.toMatchObject({
      code: "INVALID_API_TOKEN",
    });
    await expect(harness.validator.validate(consumer)).rejects.toMatchObject({
      code: "INVALID_API_TOKEN",
    });
  });
});

describe("MicrosoftOrganizationsKeyProvider", () => {
  it("uses only fixed metadata/JWKS URLs and validates the signing JWK issuer", async () => {
    const harness = await createLocalAuthHarness();
    const jwk = {
      ...(await exportJWK(harness.publicKey)),
      kid: "cloudops-test-key",
      use: "sig",
      alg: "RS256",
      issuer: "https://login.microsoftonline.com/{tenantid}/v2.0",
    };
    const requestedUrls: string[] = [];
    const fetchImplementation = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url === MICROSOFT_ORGANIZATIONS_METADATA_URL) {
        return Response.json({
          issuer: "https://login.microsoftonline.com/{tenantid}/v2.0",
          jwks_uri: MICROSOFT_ORGANIZATIONS_JWKS_URL,
        });
      }
      if (url === MICROSOFT_ORGANIZATIONS_JWKS_URL) {
        return Response.json({ keys: [jwk] });
      }
      throw new Error("Unexpected network destination");
    });
    const validator = new EntraTokenValidator({
      audience: TEST_API_CLIENT_ID,
      keyProvider: new MicrosoftOrganizationsKeyProvider({
        fetchImplementation: fetchImplementation as unknown as typeof fetch,
      }),
    });

    await expect(
      validator.validate(await harness.issueToken()),
    ).resolves.toMatchObject({ principal: { tenantId: TEST_TENANT_A } });
    expect(requestedUrls).toEqual([
      MICROSOFT_ORGANIZATIONS_METADATA_URL,
      MICROSOFT_ORGANIZATIONS_JWKS_URL,
    ]);

    const invalidIssuerFetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return url === MICROSOFT_ORGANIZATIONS_METADATA_URL
        ? Response.json({
            issuer: "https://login.microsoftonline.com/{tenantid}/v2.0",
            jwks_uri: MICROSOFT_ORGANIZATIONS_JWKS_URL,
          })
        : Response.json({
            keys: [{ ...jwk, issuer: "https://attacker.invalid/{tenantid}" }],
          });
    });
    const invalidIssuerValidator = new EntraTokenValidator({
      audience: TEST_API_CLIENT_ID,
      keyProvider: new MicrosoftOrganizationsKeyProvider({
        fetchImplementation:
          invalidIssuerFetch as unknown as typeof fetch,
      }),
    });
    await expect(
      invalidIssuerValidator.validate(await harness.issueToken()),
    ).rejects.toMatchObject({ code: "INVALID_API_TOKEN" });
  });

  it("rate-limits refresh attempts for an unknown signing key", async () => {
    const harness = await createLocalAuthHarness();
    const jwk = {
      ...(await exportJWK(harness.publicKey)),
      kid: "known-key",
      use: "sig",
      alg: "RS256",
      issuer: "https://login.microsoftonline.com/{tenantid}/v2.0",
    };
    let now = 1_000;
    let fetches = 0;
    const provider = new MicrosoftOrganizationsKeyProvider({
      now: () => now,
      cacheTtlMs: 60_000,
      unknownKidCooldownMs: 30_000,
      fetchImplementation: (async (input: string | URL | Request) => {
        fetches += 1;
        return String(input) === MICROSOFT_ORGANIZATIONS_METADATA_URL
          ? Response.json({
              issuer: "https://login.microsoftonline.com/{tenantid}/v2.0",
              jwks_uri: MICROSOFT_ORGANIZATIONS_JWKS_URL,
            })
          : Response.json({ keys: [jwk] });
      }) as unknown as typeof fetch,
    });
    const payload = {
      tid: TEST_TENANT_A,
      iss: `https://login.microsoftonline.com/${TEST_TENANT_A}/v2.0`,
    };

    await expect(
      provider.resolveKey({ alg: "RS256", kid: "unknown" }, payload),
    ).rejects.toThrow(/not found/);
    await expect(
      provider.resolveKey({ alg: "RS256", kid: "unknown" }, payload),
    ).rejects.toThrow(/not found/);
    expect(fetches).toBe(2);

    now += 30_000;
    await expect(
      provider.resolveKey({ alg: "RS256", kid: "unknown" }, payload),
    ).rejects.toThrow(/not found/);
    expect(fetches).toBe(4);
  });
});
