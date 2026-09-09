import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { GraphTokenBroker } from "../src/auth/obo-service.js";
import type { ValidatedApiToken } from "../src/auth/token-validator.js";
import type { ApiConfig } from "../src/config.js";
import { errors } from "../src/errors.js";
import { AssessmentRegistry, createDefaultAssessmentRegistry } from "../src/services/assessment-registry.js";
import { discoverAssessmentManifests } from "../src/services/assessment-discovery.js";
import { ExecutionManager } from "../src/services/execution-manager.js";
import {
  createLocalAuthHarness,
  type LocalAuthHarness,
  TEST_OBJECT_B,
  TEST_TENANT_B,
} from "./auth-helpers.js";
import { ImmediateRuntime, waitForCondition } from "./helpers.js";

const openApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
let authHarness: LocalAuthHarness;
let tokenA: string;
let tokenB: string;
let authenticatedA: ValidatedApiToken;

function registry(): AssessmentRegistry {
  return new AssessmentRegistry(discoverAssessmentManifests().filter((item) => item.manifest.id === "hello-world"));
}

function graphRegistry(): AssessmentRegistry {
  return new AssessmentRegistry(discoverAssessmentManifests().filter((item) => item.manifest.id === "microsoft-graph-connectivity"));
}

function authorization(token = tokenA): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

interface TestAppOptions {
  readonly nodeEnv?: "test" | "development" | "production";
  readonly config?: Partial<ApiConfig>;
  readonly assessmentRegistry?: AssessmentRegistry;
  readonly graphTokenBroker?: GraphTokenBroker;
}

async function testApp(options: TestAppOptions = {}) {
  const runtime = new ImmediateRuntime();
  const assessmentRegistry = options.assessmentRegistry ?? registry();
  const manager = new ExecutionManager({
    registry: assessmentRegistry,
    runtime,
    artifactTtlMs: 60_000,
    ...(options.graphTokenBroker
      ? { graphTokenBroker: options.graphTokenBroker }
      : {}),
  });
  const app = await buildApp({
    logger: false,
    config: {
      nodeEnv: options.nodeEnv ?? "test",
      ...options.config,
    },
    registry: assessmentRegistry,
    runtime,
    executionManager: manager,
    tokenValidator: authHarness.validator,
  });
  openApps.push(app);
  return { app, runtime, manager };
}

beforeAll(async () => {
  authHarness = await createLocalAuthHarness();
  tokenA = await authHarness.issueToken();
  tokenB = await authHarness.issueToken({
    tenantId: TEST_TENANT_B,
    objectId: TEST_OBJECT_B,
  });
  authenticatedA = await authHarness.validator.validate(tokenA);
});

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => await app.close()));
});

describe("CloudOps API", () => {
  it("launches the registered inactive-user tool with tenant-bound scopes and one-time download", async () => {
    const assessmentRegistry = createDefaultAssessmentRegistry();
    const { app, manager, runtime } = await testApp({ assessmentRegistry, graphTokenBroker: {
      async acquireToken(request) {
        expect(request.tenantId).toBe(authenticatedA.principal.tenantId);
        expect(request.requiredPermissions).toEqual(["User.Read", "User.Read.All", "AuditLog.Read.All", "LicenseAssignment.Read.All"]);
        return { accessToken: "synthetic-graph-inventory-token" };
      },
    } });
    const catalog = await app.inject({ method: "GET", url: "/api/v1/assessments", headers: authorization() });
    expect(catalog.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: "inactive-users", moduleId: "identity-visibility", adminConsentRequired: true })]));
    const response = await app.inject({ method: "POST", url: "/api/v1/assessments/inactive-users/executions", headers: authorization(), payload: { options: {} } });
    expect(response.statusCode).toBe(202);
    const { executionId } = response.json<{ executionId: string }>();
    await waitForCondition(() => manager.get(executionId, authenticatedA.principal.ownerKey)?.status === "COMPLETED");
    expect(runtime.calls[0]?.assessment.timeoutMs).toBe(55 * 60_000);
    expect(runtime.calls[0]?.context.auth).toMatchObject({ provider: "microsoft-graph", accessToken: "synthetic-graph-inventory-token" });
    const status = await app.inject({ method: "GET", url: `/api/v1/executions/${executionId}`, headers: authorization() });
    expect(status.body).not.toContain("synthetic-graph-inventory-token");
    expect((await app.inject({ method: "GET", url: `/api/v1/executions/${executionId}/artifact`, headers: authorization(tokenB) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/v1/executions/${executionId}/artifact`, headers: authorization() })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/v1/executions/${executionId}/artifact`, headers: authorization() })).statusCode).toBe(410);
  });
  it("keeps health public and protects every other API route", async () => {
    const { app } = await testApp();

    const health = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({
      status: "ok",
      runtime: { powershell: true },
    });
    expect(health.headers["cache-control"]).toBe("no-store");

    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/v1/assessments",
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.headers["www-authenticate"]).toBe(
      'Bearer error="invalid_token"',
    );
    expect(unauthenticated.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });

    const catalog = await app.inject({
      method: "GET",
      url: "/api/v1/assessments",
      headers: authorization(),
    });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json()).toEqual([
      {
        id: "hello-world",
        name: "Hello World Assessment",
        description: "Validates the in-memory CloudOps execution and report pipeline.",
        enabled: true,
        provider: "azure",
        domain: "devops",
        moduleId: "runtime-validation",
        moduleName: "Validação de runtime",
        moduleDescription: "Testes de desenvolvimento do pipeline efêmero de execução e relatórios.",
        moduleOrder: 1,
        assessmentOrder: 1,
        visibility: "development",
        requiredAuthProvider: "none",
        requiredPermissions: [],
        adminConsentRequired: false,
        display: { icon: "code", tags: ["Runtime", "Development"], source: "Validação de runtime · desenvolvimento" },
      },
    ]);
    expect(catalog.json()[0]).not.toHaveProperty("scriptPath");

    const unknownWithoutAuth = await app.inject({
      method: "GET",
      url: "/api/v1/not-a-route",
    });
    expect(unknownWithoutAuth.statusCode).toBe(401);
  });

  it("rejects malformed and cryptographically invalid bearer tokens", async () => {
    const { app } = await testApp();

    for (const header of [
      "Basic credentials",
      "Bearer",
      "Bearer abc.def.ghi extra",
      "Bearer abc.def.ghi",
    ]) {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/assessments",
        headers: { authorization: header },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: { code: "INVALID_API_TOKEN" },
      });
    }
  });

  it("maps invalid JWT claims and missing delegated scope at the HTTP boundary", async () => {
    const { app } = await testApp();
    const cases = [
      { token: await authHarness.issueToken({ authorizedParty: TEST_TENANT_B }), statusCode: 401, code: "INVALID_API_TOKEN" },
      { token: await authHarness.issueToken({ authorizedParty: null }), statusCode: 401, code: "INVALID_API_TOKEN" },
      {
        token: await authHarness.issueToken({
          audience: "00000003-0000-0000-c000-000000000000",
        }),
        statusCode: 401,
        code: "INVALID_API_TOKEN",
      },
      {
        token: await authHarness.issueToken({
          expirationTime: Math.floor(Date.now() / 1_000) - 60,
        }),
        statusCode: 401,
        code: "INVALID_API_TOKEN",
      },
      {
        token: await authHarness.issueToken({
          issuer: "https://login.microsoftonline.com/common/v2.0",
        }),
        statusCode: 401,
        code: "INVALID_API_TOKEN",
      },
      {
        token: await authHarness.issueToken({ scope: "openid profile" }),
        statusCode: 403,
        code: "INSUFFICIENT_API_SCOPE",
      },
    ];

    for (const testCase of cases) {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/assessments",
        headers: authorization(testCase.token),
      });
      expect(response.statusCode).toBe(testCase.statusCode);
      expect(response.json()).toMatchObject({
        error: { code: testCase.code },
      });
    }
  });

  it("runs an execution and serves a download-once artifact", async () => {
    const { app, manager, runtime } = await testApp();
    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/v1/assessments/hello-world/executions",
      headers: authorization(),
      payload: { options: {} },
    });
    expect(createdResponse.statusCode).toBe(202);
    const created = createdResponse.json<{
      executionId: string;
      status: string;
    }>();
    expect(created.status).toBe("STARTING");
    await waitForCondition(
      () =>
        manager.get(created.executionId, authenticatedA.principal.ownerKey)
          ?.status === "COMPLETED",
    );

    const download = await app.inject({
      method: "GET",
      url: `/api/v1/executions/${created.executionId}/artifact`,
      headers: authorization(),
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toBe("application/zip");
    expect(download.headers["content-disposition"]).toContain("attachment;");
    expect(download.headers["cache-control"]).toBe(
      "no-store, no-cache, must-revalidate",
    );
    expect(download.headers.pragma).toBe("no-cache");
    expect(download.headers.expires).toBe("0");
    expect(download.rawPayload.subarray(0, 4)).toEqual(
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    );

    const status = await app.inject({
      method: "GET",
      url: `/api/v1/executions/${created.executionId}`,
      headers: authorization(),
    });
    expect(status.json()).toMatchObject({
      artifactAvailable: false,
      publicMetrics: { findings: 0, objectsAnalyzed: 1 },
    });
    expect(runtime.artifacts[0]?.every((byte) => byte === 0)).toBe(true);

    const secondDownload = await app.inject({
      method: "GET",
      url: `/api/v1/executions/${created.executionId}/artifact`,
      headers: authorization(),
    });
    expect(secondDownload.statusCode).toBe(410);
    expect(secondDownload.json()).toMatchObject({
      error: { code: "ARTIFACT_UNAVAILABLE" },
    });
  });

  it("hides an execution from a different authenticated principal", async () => {
    const { app } = await testApp();
    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/v1/assessments/hello-world/executions",
      headers: authorization(tokenA),
      payload: { options: {} },
    });
    const { executionId } = createdResponse.json<{ executionId: string }>();

    for (const request of [
      { method: "GET" as const, url: `/api/v1/executions/${executionId}` },
      {
        method: "GET" as const,
        url: `/api/v1/executions/${executionId}/artifact`,
      },
      { method: "DELETE" as const, url: `/api/v1/executions/${executionId}` },
    ]) {
      const response = await app.inject({
        ...request,
        headers: authorization(tokenB),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: { code: "EXECUTION_NOT_FOUND" },
      });
    }

    const ownerResponse = await app.inject({
      method: "GET",
      url: `/api/v1/executions/${executionId}`,
      headers: authorization(tokenA),
    });
    expect(ownerResponse.statusCode).toBe(200);
    expect(ownerResponse.body).not.toContain(TEST_TENANT_B);
    expect(ownerResponse.body).not.toContain(TEST_OBJECT_B);
  });

  it("rejects unknown assessments and all request-controlled trust inputs", async () => {
    const { app } = await testApp();

    const unknown = await app.inject({
      method: "POST",
      url: "/api/v1/assessments/not-registered/executions",
      headers: authorization(),
      payload: { options: {} },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({
      error: { code: "ASSESSMENT_NOT_FOUND" },
    });

    for (const payload of [
      { options: {}, scriptPath: "/tmp/untrusted.ps1" },
      { options: { tenantId: TEST_TENANT_B } },
      { options: { nested: { scopes: ["Directory.ReadWrite.All"] } } },
      { options: { auth: { accessToken: "attacker-token" } } },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/assessments/hello-world/executions",
        headers: authorization(),
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: { code: "INVALID_REQUEST" },
      });
    }
  });

  it("enables exact-origin CORS in production, including preflight", async () => {
    const webOrigin = "https://cloudops.example.com";
    const { app } = await testApp({
      nodeEnv: "production",
      config: { webOrigin },
    });

    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/assessments",
      headers: {
        origin: webOrigin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe(webOrigin);
    expect(preflight.headers["access-control-allow-headers"]?.toLowerCase()).toContain(
      "authorization",
    );
    expect(preflight.headers["access-control-allow-origin"]).not.toBe("*");

    const allowed = await app.inject({
      method: "GET",
      url: "/api/v1/assessments",
      headers: { ...authorization(), origin: webOrigin },
    });
    expect(allowed.headers["access-control-allow-origin"]).toBe(webOrigin);
    expect(allowed.headers["access-control-expose-headers"]?.toLowerCase()).toContain(
      "www-authenticate",
    );

    const denied = await app.inject({
      method: "GET",
      url: "/api/v1/assessments",
      headers: {
        ...authorization(),
        origin: "https://attacker.invalid",
      },
    });
    expect(denied.headers).not.toHaveProperty("access-control-allow-origin");
  });

  it("propagates a safe OBO claims challenge without returning token data", async () => {
    const challenge = Buffer.from('{"access_token":{"essential":true}}')
      .toString("base64url");
    const authenticateHeader =
      `Bearer authorization_uri="https://login.microsoftonline.com/${TEST_TENANT_B}/oauth2/v2.0/authorize", ` +
      `error="insufficient_claims", claims="${challenge}"`;
    const { app } = await testApp({
      assessmentRegistry: graphRegistry(),
      graphTokenBroker: {
        async acquireToken() {
          throw errors.authInteractionRequired(authenticateHeader);
        },
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/assessments/microsoft-graph-connectivity/executions",
      headers: authorization(tokenB),
      payload: { options: {} },
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toBe(authenticateHeader);
    expect(response.json()).toEqual({
      error: {
        code: "AUTH_INTERACTION_REQUIRED",
        message: "Additional Microsoft authentication is required.",
      },
    });
    expect(response.body).not.toContain(tokenB);
  });

  it("applies security headers and prioritizes payload-too-large handling", async () => {
    const { app } = await testApp({ config: { bodyLimitBytes: 1_024 } });

    const health = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(health.headers["x-content-type-options"]).toBe("nosniff");
    expect(health.headers["x-frame-options"]).toBe("SAMEORIGIN");

    const oversized = await app.inject({
      method: "POST",
      url: "/api/v1/assessments/hello-world/executions",
      headers: authorization(),
      payload: { options: { padding: "x".repeat(2_048) } },
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.headers["cache-control"]).toBe("no-store");
    expect(oversized.json()).toEqual({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "The request payload is too large.",
      },
    });
  });

  it("sanitizes malformed JSON parser errors as invalid requests", async () => {
    const { app } = await testApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/assessments/hello-world/executions",
      headers: {
        ...authorization(),
        "content-type": "application/json",
      },
      payload: '{"options":',
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "The request is invalid.",
      },
    });
  });
});
