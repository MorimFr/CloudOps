import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CloudOpsError } from "../src/errors.js";
import { AssessmentRegistry } from "../src/services/assessment-registry.js";
import { ExecutionManager } from "../src/services/execution-manager.js";
import type {
  AssessmentRuntime,
  RuntimeExecutionResult,
} from "../src/services/powershell-runtime.js";
import { ImmediateRuntime, waitForCondition } from "./helpers.js";

function registry(): AssessmentRegistry {
  return new AssessmentRegistry(path.resolve("engine"), [
    {
      id: "hello-world",
      name: "Hello World Assessment",
      scriptRelativePath: path.join(
        "hello-world",
        "Invoke-Assessment.ps1",
      ),
      enabled: true,
      timeoutMs: 30_000,
    },
  ]);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ExecutionManager", () => {
  it("generates non-predictable unique execution IDs", () => {
    const manager = new ExecutionManager({
      registry: registry(),
      runtime: new ImmediateRuntime(),
      maxConcurrentExecutions: 50,
    });

    const ids = new Set(
      Array.from({ length: 50 }, () =>
        manager.create({ assessmentId: "hello-world", options: {} }),
      ).map((execution) => execution.executionId),
    );

    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(id).toMatch(/^EXE-[0-9a-f-]{36}$/i);
    }
    manager.dispose();
  });

  it("keeps request data out of script selection", async () => {
    const runtime = new ImmediateRuntime();
    const manager = new ExecutionManager({ registry: registry(), runtime });

    manager.create({
      assessmentId: "hello-world",
      options: { scriptPath: "/tmp/untrusted.ps1" },
    });
    await waitForCondition(() => runtime.calls.length === 1);

    expect(runtime.calls[0]?.assessment.scriptPath).toBe(
      path.resolve("engine", "hello-world", "Invoke-Assessment.ps1"),
    );
    expect(runtime.calls[0]?.assessment.scriptPath).not.toContain(
      "untrusted.ps1",
    );
    manager.dispose();
  });

  it("enforces the in-memory concurrency limit", () => {
    class PendingRuntime implements AssessmentRuntime {
      public execute(): Promise<RuntimeExecutionResult> {
        return new Promise(() => undefined);
      }

      public async isAvailable(): Promise<boolean> {
        return true;
      }
    }

    const manager = new ExecutionManager({
      registry: registry(),
      runtime: new PendingRuntime(),
      maxConcurrentExecutions: 1,
    });
    manager.create({ assessmentId: "hello-world", options: {} });

    expect(() =>
      manager.create({ assessmentId: "hello-world", options: {} }),
    ).toThrowError(CloudOpsError);
    try {
      manager.create({ assessmentId: "hello-world", options: {} });
    } catch (error) {
      expect(error).toMatchObject({ code: "EXECUTION_CAPACITY_REACHED" });
    }
    manager.dispose();
  });

  it("does not publish STARTING state when execution options cannot be cloned", () => {
    const manager = new ExecutionManager({
      registry: registry(),
      runtime: new ImmediateRuntime(),
      maxConcurrentExecutions: 1,
    });

    expect(() =>
      manager.create({
        assessmentId: "hello-world",
        options: { invalid: () => undefined },
      }),
    ).toThrowError(CloudOpsError);

    expect(() =>
      manager.create({ assessmentId: "hello-world", options: {} }),
    ).not.toThrow();
    manager.dispose();
  });

  it("makes downloads single-use and wipes the leased buffer", async () => {
    const runtime = new ImmediateRuntime();
    const manager = new ExecutionManager({ registry: registry(), runtime });
    const created = manager.create({
      assessmentId: "hello-world",
      options: {},
    });
    await waitForCondition(
      () => manager.get(created.executionId)?.status === "COMPLETED",
    );

    const lease = manager.checkoutArtifact(created.executionId);
    expect(manager.require(created.executionId).artifactAvailable).toBe(false);
    expect(() => manager.checkoutArtifact(created.executionId)).toThrowError(
      CloudOpsError,
    );

    lease.dispose();
    expect([...lease.buffer]).toEqual(
      Array.from({ length: lease.buffer.length }, () => 0),
    );
    manager.dispose();
  });

  it("expires RAM-only state after TTL and wipes its artifact", async () => {
    vi.useFakeTimers();
    const runtime = new ImmediateRuntime();
    const manager = new ExecutionManager({
      registry: registry(),
      runtime,
      artifactTtlMs: 5_000,
    });
    const created = manager.create({
      assessmentId: "hello-world",
      options: {},
    });

    await vi.runAllTicks();
    await Promise.resolve();
    await Promise.resolve();
    expect(manager.require(created.executionId).artifactAvailable).toBe(true);

    vi.advanceTimersByTime(5_000);
    expect(manager.get(created.executionId)).toBeUndefined();
    expect(runtime.artifacts[0]?.every((byte) => byte === 0)).toBe(true);
    manager.dispose();
  });
});
