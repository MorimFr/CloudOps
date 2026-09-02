import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ApiConfig } from "../src/config.js";
import { AssessmentRegistry } from "../src/services/assessment-registry.js";
import { ExecutionManager } from "../src/services/execution-manager.js";
import { ImmediateRuntime, waitForCondition } from "./helpers.js";

const openApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

function registry(): AssessmentRegistry {
  return new AssessmentRegistry(path.resolve("engine"), [
    {
      id: "hello-world",
      name: "Hello World Assessment",
      description: "Runtime validation card",
      scriptRelativePath: path.join(
        "hello-world",
        "Invoke-Assessment.ps1",
      ),
      enabled: true,
      timeoutMs: 30_000,
    },
  ]);
}

async function testApp(
  nodeEnv: "test" | "development" = "test",
  config: Partial<ApiConfig> = {},
) {
  const runtime = new ImmediateRuntime();
  const assessmentRegistry = registry();
  const manager = new ExecutionManager({
    registry: assessmentRegistry,
    runtime,
    artifactTtlMs: 60_000,
  });
  const app = await buildApp({
    logger: false,
    config: { nodeEnv, ...config },
    registry: assessmentRegistry,
    runtime,
    executionManager: manager,
  });
  openApps.push(app);
  return { app, runtime, manager };
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => await app.close()));
});

describe("CloudOps API", () => {
  it("returns safe health and public registry responses with no-store", async () => {
    const { app } = await testApp();

    const health = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({
      status: "ok",
      runtime: { powershell: true },
    });
    expect(health.headers["cache-control"]).toBe("no-store");

    const catalog = await app.inject({
      method: "GET",
      url: "/api/v1/assessments",
    });
    expect(catalog.json()[0]).not.toHaveProperty("scriptPath");
  });

  it("runs an execution and serves a download-once artifact with secure headers", async () => {
    const { app, manager, runtime } = await testApp();
    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/v1/assessments/hello-world/executions",
      payload: { options: {} },
    });
    expect(createdResponse.statusCode).toBe(202);
    const created = createdResponse.json<{
      executionId: string;
      status: string;
    }>();
    expect(created.status).toBe("STARTING");
    await waitForCondition(
      () => manager.get(created.executionId)?.status === "COMPLETED",
    );

    const download = await app.inject({
      method: "GET",
      url: `/api/v1/executions/${created.executionId}/artifact`,
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
    });
    expect(status.json()).toMatchObject({ artifactAvailable: false });
    expect(runtime.artifacts[0]?.every((byte) => byte === 0)).toBe(true);

    const secondDownload = await app.inject({
      method: "GET",
      url: `/api/v1/executions/${created.executionId}/artifact`,
    });
    expect(secondDownload.statusCode).toBe(410);
    expect(secondDownload.json()).toEqual({
      error: {
        code: "ARTIFACT_UNAVAILABLE",
        message: "The assessment artifact is no longer available.",
      },
    });
  });

  it("rejects unknown assessments and arbitrary top-level script paths", async () => {
    const { app } = await testApp();

    const unknown = await app.inject({
      method: "POST",
      url: "/api/v1/assessments/not-registered/executions",
      payload: { options: {} },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({
      error: { code: "ASSESSMENT_NOT_FOUND" },
    });

    const injectedPath = await app.inject({
      method: "POST",
      url: "/api/v1/assessments/hello-world/executions",
      payload: { options: {}, scriptPath: "/tmp/untrusted.ps1" },
    });
    expect(injectedPath.statusCode).toBe(400);
    expect(injectedPath.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
  });

  it("allows only the configured development CORS origin", async () => {
    const { app } = await testApp("development");

    const allowed = await app.inject({
      method: "GET",
      url: "/api/v1/assessments",
      headers: { origin: "http://localhost:5173" },
    });
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173",
    );

    const denied = await app.inject({
      method: "GET",
      url: "/api/v1/assessments",
      headers: { origin: "https://attacker.invalid" },
    });
    expect(denied.headers).not.toHaveProperty("access-control-allow-origin");
  });

  it("applies security headers and rejects bodies above the configured limit", async () => {
    const { app } = await testApp("test", { bodyLimitBytes: 1_024 });

    const health = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(health.headers["x-content-type-options"]).toBe("nosniff");
    expect(health.headers["x-frame-options"]).toBe("SAMEORIGIN");

    const oversized = await app.inject({
      method: "POST",
      url: "/api/v1/assessments/hello-world/executions",
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
      headers: { "content-type": "application/json" },
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
