import type { Configuration, OnBehalfOfRequest } from "@azure/msal-node";
import { describe, expect, it, vi } from "vitest";

import {
  MsalOboService,
  type OboClient,
} from "../src/auth/obo-service.js";
import {
  TEST_API_CLIENT_ID,
  TEST_TENANT_A,
} from "./auth-helpers.js";

const CLIENT_SECRET = "unit-test-client-secret-never-log";

describe("MsalOboService", () => {
  it("uses a tenant-bound ephemeral client and registry-mapped scopes", async () => {
    const configurations: Configuration[] = [];
    const requests: OnBehalfOfRequest[] = [];
    const clearCache = vi.fn();
    const service = new MsalOboService({
      clientId: TEST_API_CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      clientFactory(configuration) {
        configurations.push(configuration);
        return {
          async acquireTokenOnBehalfOf(request) {
            requests.push(request);
            return { accessToken: "delegated-graph-token" };
          },
          clearCache,
        };
      },
    });

    await expect(
      service.acquireToken({
        incomingApiAccessToken: "validated-incoming-api-token",
        tenantId: TEST_TENANT_A,
        requiredPermissions: ["User.Read"],
      }),
    ).resolves.toEqual({ accessToken: "delegated-graph-token" });

    expect(configurations).toHaveLength(1);
    expect(configurations[0]?.auth).toMatchObject({
      clientId: TEST_API_CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      authority: `https://login.microsoftonline.com/${TEST_TENANT_A}`,
    });
    expect(configurations[0]?.cache).not.toHaveProperty("cachePlugin");
    expect(configurations[0]?.system?.loggerOptions).toMatchObject({
      piiLoggingEnabled: false,
    });
    expect(requests).toEqual([
      {
        oboAssertion: "validated-incoming-api-token",
        scopes: ["https://graph.microsoft.com/User.Read"],
        skipCache: true,
      },
    ]);
    expect(clearCache).toHaveBeenCalledOnce();

    await service.acquireToken({
      incomingApiAccessToken: "second-incoming-token",
      tenantId: TEST_TENANT_A,
      requiredPermissions: ["User.Read"],
    });
    expect(configurations).toHaveLength(2);
  });

  it("returns a safe tenant-bound claims challenge", async () => {
    const claims = '{"access_token":{"xms_cc":{"values":["cp1"]}}}';
    const clearCache = vi.fn();
    const client: OboClient = {
      async acquireTokenOnBehalfOf() {
        throw {
          errorCode: "interaction_required",
          claims,
          errorMessage: "raw identity details must not escape",
        };
      },
      clearCache,
    };
    const service = new MsalOboService({
      clientId: TEST_API_CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      clientFactory: () => client,
    });

    const error = await service.acquireToken({
      incomingApiAccessToken: "incoming-secret-token",
      tenantId: TEST_TENANT_A,
      requiredPermissions: ["User.Read"],
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      statusCode: 401,
      code: "AUTH_INTERACTION_REQUIRED",
      message: "Additional Microsoft authentication is required.",
    });
    const header = (error as { authenticateHeader?: string }).authenticateHeader;
    expect(header).toContain(
      `authorization_uri="https://login.microsoftonline.com/${TEST_TENANT_A}/oauth2/v2.0/authorize"`,
    );
    const encodedClaims = header?.match(/claims="([^"]+)"/)?.[1];
    expect(Buffer.from(encodedClaims ?? "", "base64").toString("utf8")).toBe(
      claims,
    );
    expect(JSON.stringify(error)).not.toContain("incoming-secret-token");
    expect(JSON.stringify(error)).not.toContain("raw identity details");
    expect(clearCache).toHaveBeenCalledOnce();
  });

  it.each([
    [
      { errorCode: "invalid_grant", errorMessage: "AADSTS65001: consent" },
      403,
      "GRAPH_CONSENT_REQUIRED",
    ],
    [
      { errorCode: "temporarily_unavailable", message: "raw outage" },
      503,
      "GRAPH_UNAVAILABLE",
    ],
    [
      { errorCode: "invalid_grant", message: "raw tenant details" },
      401,
      "GRAPH_AUTHENTICATION_FAILED",
    ],
  ] as const)(
    "normalizes Microsoft identity failures without raw details",
    async (identityError, statusCode, code) => {
      const service = new MsalOboService({
        clientId: TEST_API_CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        clientFactory: () => ({
          async acquireTokenOnBehalfOf() {
            throw identityError;
          },
          clearCache: vi.fn(),
        }),
      });

      const error = await service.acquireToken({
        incomingApiAccessToken: "incoming-secret-token",
        tenantId: TEST_TENANT_A,
        requiredPermissions: ["User.Read"],
      }).catch((caught: unknown) => caught);

      expect(error).toMatchObject({ statusCode, code });
      expect((error as Error).message).not.toContain("raw");
      expect(JSON.stringify(error)).not.toContain("incoming-secret-token");
    },
  );

  it("normalizes client construction failures and never reflects their details", async () => {
    const service = new MsalOboService({
      clientId: TEST_API_CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      clientFactory: () => {
        throw new Error("constructor leaked client-secret-value");
      },
    });

    const error = await service.acquireToken({
      incomingApiAccessToken: "incoming-secret-token",
      tenantId: TEST_TENANT_A,
      requiredPermissions: ["User.Read"],
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "GRAPH_AUTHENTICATION_FAILED" });
    expect((error as Error).message).not.toContain("client-secret-value");
    expect(JSON.stringify(error)).not.toContain("incoming-secret-token");
  });

  it("does not propagate a malformed claims value", async () => {
    const service = new MsalOboService({
      clientId: TEST_API_CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      clientFactory: () => ({
        async acquireTokenOnBehalfOf() {
          throw {
            errorCode: "interaction_required",
            claims: "not-json\r\nunsafe-header",
          };
        },
        clearCache: vi.fn(),
      }),
    });

    const error = await service.acquireToken({
      incomingApiAccessToken: "incoming",
      tenantId: TEST_TENANT_A,
      requiredPermissions: ["User.Read"],
    }).catch((caught: unknown) => caught);
    const header = (error as { authenticateHeader?: string }).authenticateHeader;

    expect(error).toMatchObject({ code: "AUTH_INTERACTION_REQUIRED" });
    expect(header).toBe(
      `Bearer authorization_uri="https://login.microsoftonline.com/${TEST_TENANT_A}/oauth2/v2.0/authorize", error="interaction_required"`,
    );
    expect(header).not.toContain("not-json");
  });

  it("rejects unregistered permissions and unvalidated tenants before MSAL", async () => {
    const clientFactory = vi.fn();
    const service = new MsalOboService({
      clientId: TEST_API_CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      clientFactory,
    });

    await expect(
      service.acquireToken({
        incomingApiAccessToken: "incoming",
        tenantId: "organizations",
        requiredPermissions: ["User.Read"],
      }),
    ).rejects.toMatchObject({ code: "GRAPH_AUTHENTICATION_FAILED" });
    await expect(
      service.acquireToken({
        incomingApiAccessToken: "incoming",
        tenantId: TEST_TENANT_A,
        requiredPermissions: ["Directory.ReadWrite.All"],
      } as never),
    ).rejects.toMatchObject({ code: "GRAPH_AUTHENTICATION_FAILED" });
    expect(clientFactory).not.toHaveBeenCalled();
  });
});
