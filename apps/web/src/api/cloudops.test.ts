import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CloudOpsApiError,
  createExecution,
  downloadExecutionArtifact,
  listAssessments,
  parseClaimsChallenge,
} from "./cloudops";
import type { ApiAccessTokenProvider } from "../auth/types";

const fetchMock = vi.fn<typeof fetch>();
const capturedAuthorizationHeaders: Array<string | null> = [];
const PRIMARY_TOKEN = `primary-${"a".repeat(48)}`;
const CHALLENGED_TOKEN = `challenged-${"b".repeat(48)}`;
const TENANT_ID = "11111111-1111-4111-8111-111111111111";

const assessment = {
  id: "microsoft-graph-connectivity",
  name: "Microsoft Graph Connectivity",
  description: "Validates delegated Microsoft Graph access.",
  enabled: true,
  provider: "azure",
  domain: "secops",
  moduleId: "connectivity-diagnostics",
  moduleName: "Conectividade e diagnóstico",
  moduleDescription: "Validação técnica.",
  moduleOrder: 4,
  assessmentOrder: 1,
  visibility: "public",
  requiredAuthProvider: "microsoft-graph",
  requiredPermissions: ["User.Read"],
  adminConsentRequired: false,
} as const;

function tokenProvider(token = PRIMARY_TOKEN): ApiAccessTokenProvider {
  return vi.fn(async () => token);
}

function authorizationHeader(callIndex = 0): string | null {
  return capturedAuthorizationHeaders[callIndex] ?? null;
}

describe("CloudOps API client", () => {
  beforeEach(() => {
    capturedAuthorizationHeaders.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        capturedAuthorizationHeaders.push(
          new Headers(init?.headers).get("Authorization"),
        );
        return fetchMock(input, init);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("injects an API bearer token and disables browser credential/cache reuse", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([assessment]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const getToken = tokenProvider();

    await expect(listAssessments(getToken)).resolves.toHaveLength(1);

    expect(getToken).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/api/v1/assessments",
      expect.objectContaining({
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      }),
    );
    expect(authorizationHeader()).toBe(`Bearer ${PRIMARY_TOKEN}`);
  });

  it("keeps the assessment id in the approved route and sends options only", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          executionId: "EXE-550e8400-e29b-41d4-a716-446655440000",
          status: "STARTING",
        }),
        { status: 202, headers: { "Content-Type": "application/json" } },
      ),
    );

    await createExecution(
      {
        assessmentId: "hello world/validated",
        options: { mode: "foundation" },
      },
      tokenProvider(),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/api/v1/assessments/hello%20world%2Fvalidated/executions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ options: { mode: "foundation" } }),
      }),
    );
    expect(authorizationHeader()).toBe(`Bearer ${PRIMARY_TOKEN}`);
  });

  it("returns only the sanitized API error contract", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "EXECUTION_CAPACITY_REACHED",
            message: "Capacidade temporariamente atingida.",
          },
          internalDetails: "must not be surfaced",
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      ),
    );

    const error = await listAssessments(tokenProvider()).catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(CloudOpsApiError);
    expect(error).toMatchObject({
      code: "EXECUTION_CAPACITY_REACHED",
      status: 429,
      message: "Capacidade temporariamente atingida.",
    });
    expect(String(error)).not.toContain("internalDetails");
  });

  it("performs one claims-challenge retry with an interactive fresh token", async () => {
    const claims = JSON.stringify({
      access_token: { essential: true, acrs: { values: ["c1"] } },
    });
    const encodedClaims = window.btoa(claims);
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 401,
          headers: {
            "WWW-Authenticate":
              `Bearer authorization_uri="https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize", ` +
              `error="insufficient_claims", claims="${encodedClaims}"`,
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([assessment]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    const getToken = vi
      .fn<ApiAccessTokenProvider>()
      .mockResolvedValueOnce(PRIMARY_TOKEN)
      .mockResolvedValueOnce(CHALLENGED_TOKEN);

    await expect(listAssessments(getToken)).resolves.toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenNthCalledWith(1);
    expect(getToken).toHaveBeenNthCalledWith(2, {
      claims,
      forceRefresh: true,
      interactive: true,
    });
    expect(authorizationHeader(1)).toBe(`Bearer ${CHALLENGED_TOKEN}`);
  });

  it("never loops when the challenged retry also returns 401", async () => {
    const claims = window.btoa(JSON.stringify({ access_token: {} }));
    const challenge =
      `Bearer authorization_uri="https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize", ` +
      `error="insufficient_claims", claims="${claims}"`;
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 401,
          headers: { "WWW-Authenticate": challenge },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "AUTH_INTERACTION_REQUIRED",
              message: "Additional interaction is required.",
            },
          }),
          {
            status: 401,
            headers: {
              "Content-Type": "application/json",
              "WWW-Authenticate": challenge,
            },
          },
        ),
      );
    const getToken = vi
      .fn<ApiAccessTokenProvider>()
      .mockResolvedValueOnce(PRIMARY_TOKEN)
      .mockResolvedValueOnce(CHALLENGED_TOKEN);

    await expect(listAssessments(getToken)).rejects.toMatchObject({
      code: "AUTH_INTERACTION_REQUIRED",
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it("does not add a claims retry after consent already consumed the shared budget", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "AUTH_INTERACTION_REQUIRED", message: "Safe challenge" } }), {
      status: 401,
      headers: { "WWW-Authenticate": `Bearer authorization_uri="https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize", error="interaction_required"` },
    }));
    const getToken = tokenProvider();
    await expect(createExecution({ assessmentId: "test", options: {} }, getToken, { remaining: 0 })).rejects.toMatchObject({ code: "AUTH_INTERACTION_REQUIRED" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(getToken).toHaveBeenCalledOnce();
  });

  it("performs one interactive retry for a validated interaction challenge without claims", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 401,
          headers: {
            "WWW-Authenticate":
              `Bearer authorization_uri="https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize", ` +
              'error="interaction_required"',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([assessment]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    const getToken = vi
      .fn<ApiAccessTokenProvider>()
      .mockResolvedValueOnce(PRIMARY_TOKEN)
      .mockResolvedValueOnce(CHALLENGED_TOKEN);

    await expect(listAssessments(getToken)).resolves.toHaveLength(1);
    expect(getToken).toHaveBeenNthCalledWith(2, {
      forceRefresh: true,
      interactive: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects challenges that point outside a validated tenant authority", () => {
    const claims = window.btoa(JSON.stringify({ access_token: {} }));
    expect(
      parseClaimsChallenge(
        `Bearer authorization_uri="https://evil.example/${TENANT_ID}/oauth2/v2.0/authorize", error="insufficient_claims", claims="${claims}"`,
      ),
    ).toBeNull();
    expect(
      parseClaimsChallenge(
        `Bearer authorization_uri="https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize", error="insufficient_claims", claims="${claims}"`,
      ),
    ).toBeNull();
  });

  it("downloads through a transient Blob URL and revokes it", async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:cloudops-ephemeral");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    fetchMock.mockResolvedValueOnce(
      new Response(new Blob(["zip-bytes"], { type: "application/zip" }), {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": 'attachment; filename="cloudops-report.zip"',
        },
      }),
    );

    await downloadExecutionArtifact("EXE-123", tokenProvider());

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download="cloudops-report.zip"]')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(authorizationHeader()).toBe(`Bearer ${PRIMARY_TOKEN}`);

    vi.runOnlyPendingTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:cloudops-ephemeral");
  });
});
