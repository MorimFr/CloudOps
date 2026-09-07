import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createAuthenticatedPrincipal } from "../src/auth/principal.js";
import type { GraphTokenBroker } from "../src/auth/obo-service.js";
import type { ValidatedApiToken } from "../src/auth/token-validator.js";
import { CloudOpsError } from "../src/errors.js";
import { AssessmentRegistry } from "../src/services/assessment-registry.js";
import { ExecutionManager } from "../src/services/execution-manager.js";
import type {
  AssessmentRuntime,
  RuntimeExecutionInput,
  RuntimeExecutionResult,
} from "../src/services/powershell-runtime.js";
import {
  TEST_OBJECT_A,
  TEST_OBJECT_B,
  TEST_TENANT_A,
  TEST_TENANT_B,
} from "./auth-helpers.js";
import { ImmediateRuntime, waitForCondition } from "./helpers.js";

const authenticatedA: ValidatedApiToken = Object.freeze({
  accessToken: "incoming-api-token-a",
  principal: createAuthenticatedPrincipal(TEST_TENANT_A, TEST_OBJECT_A),
});
const authenticatedB: ValidatedApiToken = Object.freeze({
  accessToken: "incoming-api-token-b",
  principal: createAuthenticatedPrincipal(TEST_TENANT_B, TEST_OBJECT_B),
});

function registration() {
  return {
    id: "hello-world" as const,
    name: "Hello World Assessment",
    scriptRelativePath: path.join(
      "hello-world",
      "Invoke-Assessment.ps1",
    ),
    enabled: true,
    timeoutMs: 30_000,
    provider: "azure" as const,
    domain: "devops" as const,
    visibility: "development" as const,
    requiredAuthProvider: "none" as const,
    requiredPermissions: [] as const,
    adminConsentRequired: false,
  };
}

function registry(): AssessmentRegistry {
  return new AssessmentRegistry(path.resolve("engine"), [registration()]);
}

function graphRegistry(): AssessmentRegistry {
  return new AssessmentRegistry(path.resolve("engine"), [
    {
      ...registration(),
      id: "microsoft-graph-connectivity",
      name: "Microsoft Graph Connectivity",
      scriptRelativePath: path.join(
        "microsoft-graph-connectivity",
        "Invoke-Assessment.ps1",
      ),
      domain: "secops",
      visibility: "public",
      requiredAuthProvider: "microsoft-graph",
      requiredPermissions: ["User.Read"],
    },
  ]);
}

const managers: ExecutionManager[] = [];

function track(manager: ExecutionManager): ExecutionManager {
  managers.push(manager);
  return manager;
}

afterEach(() => {
  for (const manager of managers.splice(0)) {
    manager.dispose();
  }
  vi.useRealTimers();
});

describe("ExecutionManager", () => {
  it("generates non-predictable unique execution IDs", async () => {
    const manager = track(new ExecutionManager({
      registry: registry(),
      runtime: new ImmediateRuntime(),
      maxConcurrentExecutions: 50,
    }));

    const executions = await Promise.all(
      Array.from({ length: 50 }, async () =>
        await manager.create(
          { assessmentId: "hello-world", options: {} },
          authenticatedA,
        ),
      ),
    );
    const ids = new Set(executions.map(({ executionId }) => executionId));

    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(id).toMatch(/^EXE-[0-9a-f-]{36}$/i);
    }
  });

  it("rejects confused-deputy option keys recursively", async () => {
    const runtime = new ImmediateRuntime();
    const manager = track(new ExecutionManager({
      registry: registry(),
      runtime,
    }));

    for (const options of [
      { scriptPath: "/tmp/untrusted.ps1" },
      { nested: { tenant_id: TEST_TENANT_B } },
      { nested: [{ accessToken: "attacker-token" }] },
      { scopes: ["Directory.ReadWrite.All"] },
      { auth: { provider: "attacker" } },
      { authority: "https://attacker.invalid" },
      { requiredPermissions: ["User.ReadWrite.All"] },
    ]) {
      await expect(
        manager.create(
          { assessmentId: "hello-world", options },
          authenticatedA,
        ),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    }

    await manager.create(
      { assessmentId: "hello-world", options: { harmless: true } },
      authenticatedA,
    );
    await waitForCondition(() => runtime.calls.length === 1);
    expect(runtime.calls[0]?.assessment.scriptPath).toBe(
      path.resolve("engine", "hello-world", "Invoke-Assessment.ps1"),
    );
  });

  it("enforces the in-memory concurrency limit", async () => {
    class PendingRuntime implements AssessmentRuntime {
      public execute(): Promise<RuntimeExecutionResult> {
        return new Promise(() => undefined);
      }

      public async isAvailable(): Promise<boolean> {
        return true;
      }
    }

    const manager = track(new ExecutionManager({
      registry: registry(),
      runtime: new PendingRuntime(),
      maxConcurrentExecutions: 1,
    }));
    await manager.create(
      { assessmentId: "hello-world", options: {} },
      authenticatedA,
    );

    await expect(
      manager.create(
        { assessmentId: "hello-world", options: {} },
        authenticatedA,
      ),
    ).rejects.toMatchObject({ code: "EXECUTION_CAPACITY_REACHED" });
  });

  it("does not publish STARTING state when options cannot be cloned", async () => {
    const manager = track(new ExecutionManager({
      registry: registry(),
      runtime: new ImmediateRuntime(),
      maxConcurrentExecutions: 1,
    }));

    await expect(
      manager.create(
        {
          assessmentId: "hello-world",
          options: { invalid: () => undefined },
        },
        authenticatedA,
      ),
    ).rejects.toBeInstanceOf(CloudOpsError);

    await expect(
      manager.create(
        { assessmentId: "hello-world", options: {} },
        authenticatedA,
      ),
    ).resolves.toMatchObject({ status: "STARTING" });
  });

  it("enforces ownership for status, cancellation, and artifact leases", async () => {
    const runtime = new ImmediateRuntime();
    const manager = track(new ExecutionManager({ registry: registry(), runtime }));
    const created = await manager.create(
      { assessmentId: "hello-world", options: {} },
      authenticatedA,
    );
    await waitForCondition(
      () =>
        manager.get(created.executionId, authenticatedA.principal.ownerKey)
          ?.status === "COMPLETED",
    );

    expect(
      manager.get(created.executionId, authenticatedB.principal.ownerKey),
    ).toBeUndefined();
    expect(() =>
      manager.require(created.executionId, authenticatedB.principal.ownerKey),
    ).toThrowError(CloudOpsError);
    expect(() =>
      manager.checkoutArtifact(
        created.executionId,
        authenticatedB.principal.ownerKey,
      ),
    ).toThrowError(CloudOpsError);
    expect(
      manager.cancel(created.executionId, authenticatedB.principal.ownerKey),
    ).toBe(false);

    const lease = manager.checkoutArtifact(
      created.executionId,
      authenticatedA.principal.ownerKey,
    );
    expect(
      manager.require(created.executionId, authenticatedA.principal.ownerKey)
        .artifactAvailable,
    ).toBe(false);
    expect(() =>
      manager.checkoutArtifact(
        created.executionId,
        authenticatedA.principal.ownerKey,
      ),
    ).toThrowError(CloudOpsError);

    lease.dispose();
    expect([...lease.buffer]).toEqual(
      Array.from({ length: lease.buffer.length }, () => 0),
    );
  });

  it("derives OBO tenant and scopes only from identity and registry", async () => {
    const brokerRequests: Parameters<GraphTokenBroker["acquireToken"]>[0][] = [];
    const graphTokenBroker: GraphTokenBroker = {
      async acquireToken(request) {
        brokerRequests.push(request);
        return { accessToken: "internal-graph-token" };
      },
    };
    let runtimeContext: RuntimeExecutionInput["context"] | undefined;
    const runtime: AssessmentRuntime = {
      async execute(input) {
        runtimeContext = input.context;
        input.onStarted();
        return {
          artifact: Buffer.from("PK\u0003\u0004graph", "binary"),
          publicMetrics: { graphReachable: true, requestsCompleted: 1 },
          exitCode: 0,
        };
      },
      async isAvailable() {
        return true;
      },
    };
    const lifecycleEvents: unknown[] = [];
    const manager = track(new ExecutionManager({
      registry: graphRegistry(),
      runtime,
      graphTokenBroker,
      onLifecycleEvent: (event) => lifecycleEvents.push(event),
    }));

    const created = await manager.create(
      { assessmentId: "microsoft-graph-connectivity", options: {} },
      authenticatedA,
    );
    expect(brokerRequests).toEqual([
      {
        incomingApiAccessToken: authenticatedA.accessToken,
        tenantId: TEST_TENANT_A,
        requiredPermissions: ["User.Read"],
        signal: expect.any(AbortSignal),
      },
    ]);
    await waitForCondition(
      () =>
        manager.get(created.executionId, authenticatedA.principal.ownerKey)
          ?.status === "COMPLETED",
    );
    expect(runtimeContext).toMatchObject({
      auth: {
        provider: "microsoft-graph",
        tenantId: TEST_TENANT_A,
        accessToken: "internal-graph-token",
      },
    });

    const publicState = manager.require(
      created.executionId,
      authenticatedA.principal.ownerKey,
    );
    const exposed = JSON.stringify({ publicState, lifecycleEvents });
    expect(exposed).not.toContain("internal-graph-token");
    expect(exposed).not.toContain(TEST_TENANT_A);
    expect(publicState.publicMetrics).toEqual({
      graphReachable: true,
      requestsCompleted: 1,
    });
  });

  it("reserves capacity before OBO", async () => {
    let resolveToken!: (value: { accessToken: string }) => void;
    const token = new Promise<{ accessToken: string }>((resolve) => {
      resolveToken = resolve;
    });
    let calls = 0;
    const manager = track(new ExecutionManager({
      registry: graphRegistry(),
      runtime: new ImmediateRuntime(),
      maxConcurrentExecutions: 1,
      graphTokenBroker: {
        async acquireToken() {
          calls += 1;
          return await token;
        },
      },
    }));

    const first = manager.create(
      { assessmentId: "microsoft-graph-connectivity", options: {} },
      authenticatedA,
    );
    await waitForCondition(() => calls === 1);
    await expect(
      manager.create(
        { assessmentId: "microsoft-graph-connectivity", options: {} },
        authenticatedB,
      ),
    ).rejects.toMatchObject({ code: "EXECUTION_CAPACITY_REACHED" });
    expect(calls).toBe(1);
    resolveToken({ accessToken: "first-graph-token" });
    await first;
  });

  it("rolls reserved state back when OBO fails", async () => {
    let calls = 0;
    const manager = track(new ExecutionManager({
      registry: graphRegistry(),
      runtime: new ImmediateRuntime(),
      maxConcurrentExecutions: 1,
      graphTokenBroker: {
        async acquireToken() {
          calls += 1;
          if (calls === 1) {
            throw new CloudOpsError(
              "GRAPH_AUTHENTICATION_FAILED",
              "safe",
              401,
            );
          }
          return { accessToken: "graph-token-after-rollback" };
        },
      },
    }));

    await expect(
      manager.create(
        { assessmentId: "microsoft-graph-connectivity", options: {} },
        authenticatedA,
      ),
    ).rejects.toMatchObject({ code: "GRAPH_AUTHENTICATION_FAILED" });
    await expect(
      manager.create(
        { assessmentId: "microsoft-graph-connectivity", options: {} },
        authenticatedA,
      ),
    ).resolves.toMatchObject({ status: "STARTING" });
  });

  it("releases reserved capacity when the OBO broker misses its deadline", async () => {
    let calls = 0;
    const manager = track(new ExecutionManager({
      registry: graphRegistry(),
      runtime: new ImmediateRuntime(),
      maxConcurrentExecutions: 1,
      graphTokenTimeoutMs: 10,
      graphTokenBroker: {
        async acquireToken() {
          calls += 1;
          if (calls === 1) {
            return await new Promise<never>(() => undefined);
          }
          return { accessToken: "graph-token-after-timeout" };
        },
      },
    }));

    await expect(
      manager.create(
        { assessmentId: "microsoft-graph-connectivity", options: {} },
        authenticatedA,
      ),
    ).rejects.toMatchObject({ code: "GRAPH_UNAVAILABLE" });
    await expect(
      manager.create(
        { assessmentId: "microsoft-graph-connectivity", options: {} },
        authenticatedA,
      ),
    ).resolves.toMatchObject({ status: "STARTING" });
  });

  it("ignores a late OBO result after timeout and aborts the broker signal", async () => {
    const runtime = new ImmediateRuntime();
    const execute = vi.spyOn(runtime, "execute");
    let resolveToken!: (value: { accessToken: string }) => void;
    let signal: AbortSignal | undefined;
    const manager = track(new ExecutionManager({
      registry: graphRegistry(),
      runtime,
      graphTokenTimeoutMs: 10,
      graphTokenBroker: {
        acquireToken(request) {
          signal = request.signal;
          return new Promise((resolve) => { resolveToken = resolve; });
        },
      },
    }));
    await expect(manager.create(
      { assessmentId: "microsoft-graph-connectivity", options: {} },
      authenticatedA,
    )).rejects.toMatchObject({ code: "GRAPH_UNAVAILABLE" });
    expect(signal?.aborted).toBe(true);
    resolveToken({ accessToken: "late-result-must-not-run" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects non-contract public metrics and wipes the artifact", async () => {
    const artifact = Buffer.from("PK\u0003\u0004sensitive", "binary");
    const runtime: AssessmentRuntime = {
      async execute(input) {
        input.onStarted();
        return {
          artifact,
          publicMetrics: {
            findings: 1,
            userPrincipalName: "person@example.com",
          },
          exitCode: 0,
        } as RuntimeExecutionResult;
      },
      async isAvailable() {
        return true;
      },
    };
    const manager = track(new ExecutionManager({ registry: registry(), runtime }));
    const created = await manager.create(
      { assessmentId: "hello-world", options: {} },
      authenticatedA,
    );
    await waitForCondition(
      () =>
        manager.get(created.executionId, authenticatedA.principal.ownerKey)
          ?.status === "FAILED",
    );

    expect(
      manager.require(created.executionId, authenticatedA.principal.ownerKey),
    ).toMatchObject({ status: "FAILED", stage: "INVALID_CONTROL_OUTPUT" });
    expect(artifact.every((byte) => byte === 0)).toBe(true);
  });

  it("expires RAM-only state after TTL and wipes its artifact", async () => {
    vi.useFakeTimers();
    const runtime = new ImmediateRuntime();
    const manager = track(new ExecutionManager({
      registry: registry(),
      runtime,
      artifactTtlMs: 5_000,
    }));
    const created = await manager.create(
      { assessmentId: "hello-world", options: {} },
      authenticatedA,
    );

    await vi.runAllTicks();
    await Promise.resolve();
    await Promise.resolve();
    expect(
      manager.require(created.executionId, authenticatedA.principal.ownerKey)
        .artifactAvailable,
    ).toBe(true);

    vi.advanceTimersByTime(5_000);
    expect(
      manager.get(created.executionId, authenticatedA.principal.ownerKey),
    ).toBeUndefined();
    expect(runtime.artifacts[0]?.every((byte) => byte === 0)).toBe(true);
  });
});
