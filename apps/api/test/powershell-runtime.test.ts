import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough } from "node:stream";
import type {
  ChildProcessWithoutNullStreams,
  SpawnOptionsWithoutStdio,
} from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { RegisteredAssessment } from "../src/services/assessment-registry.js";
import {
  PowerShellRuntime,
  PowerShellRuntimeError,
} from "../src/services/powershell-runtime.js";

class FakeChild extends EventEmitter {
  public readonly stdin = new PassThrough();
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public exitCode: number | null = null;
  public signalCode: NodeJS.Signals | null = null;
  public killed = false;

  public kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    if (this.killed) {
      return false;
    }
    this.killed = true;
    this.signalCode = signal;
    queueMicrotask(() => this.emit("close", null, signal));
    return true;
  }
}

const assessment: RegisteredAssessment = {
  id: "hello-world",
  name: "Hello World Assessment",
  enabled: true,
  scriptPath: path.resolve("engine/hello-world/Invoke-Assessment.ps1"),
  timeoutMs: 250,
};

function asChild(child: FakeChild): ChildProcessWithoutNullStreams {
  return child as unknown as ChildProcessWithoutNullStreams;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("PowerShellRuntime", () => {
  it("uses fixed pwsh arguments, no shell, NDJSON control, and binary stdout", async () => {
    const child = new FakeChild();
    const invocations: Array<{
      command: string;
      args: string[];
      options: SpawnOptionsWithoutStdio;
    }> = [];
    let stdin = "";
    child.stdin.on("data", (chunk: Buffer) => {
      stdin += chunk.toString("utf8");
    });

    const runtime = new PowerShellRuntime({
      spawnProcess: (command, args, options) => {
        invocations.push({ command, args, options });
        queueMicrotask(() => {
          child.emit("spawn");
          child.stderr.write(
            '{"type":"progress","stage":"PROCESSING","progress":50}\n',
          );
          child.stderr.write(
            '{"type":"summary","summary":{"message":"done"}}\n',
          );
          child.stdout.write(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
          child.exitCode = 0;
          child.emit("close", 0, null);
        });
        return asChild(child);
      },
    });
    const onProgress = vi.fn();

    const result = await runtime.execute({
      assessment,
      context: {
        executionId: "EXE-f5ba1dac-d546-47a7-b9e5-7ef9ad22cfb3",
        assessmentId: "hello-world",
        options: { harmless: true },
      },
      signal: new AbortController().signal,
      onStarted: vi.fn(),
      onProgress,
    });

    expect(invocations[0]).toMatchObject({
      command: "pwsh",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        assessment.scriptPath,
      ],
      options: { shell: false, stdio: "pipe" },
    });
    expect(stdin).toContain('"assessmentId":"hello-world"');
    expect(onProgress).toHaveBeenCalledWith("PROCESSING", 50);
    expect(result.artifact).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(result.summary).toEqual({ message: "done" });
  });

  it("fails safely on invalid stderr without reflecting its content", async () => {
    const child = new FakeChild();
    const invalidControl = Buffer.from(
      "invalid tenant-secret control output\n",
    );
    const ignoredArtifact = Buffer.from("ignored-sensitive-artifact");
    const runtime = new PowerShellRuntime({
      spawnProcess: () => {
        queueMicrotask(() => {
          child.emit("spawn");
          child.stderr.write(invalidControl);
          child.stdout.write(ignoredArtifact);
        });
        return asChild(child);
      },
    });

    const operation = runtime.execute({
      assessment,
      context: {
        executionId: "EXE-f5ba1dac-d546-47a7-b9e5-7ef9ad22cfb3",
        assessmentId: "hello-world",
        options: {},
      },
      signal: new AbortController().signal,
      onStarted: vi.fn(),
      onProgress: vi.fn(),
    });
    const error = await operation.catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "INVALID_CONTROL_OUTPUT" });
    expect(error).toBeInstanceOf(PowerShellRuntimeError);
    expect((error as Error).message).not.toContain("tenant-secret");
    expect(child.killed).toBe(true);
    expect(invalidControl.every((byte) => byte === 0)).toBe(true);
    expect(ignoredArtifact.every((byte) => byte === 0)).toBe(true);
  });

  it("rejects stdout that is not a ZIP and wipes source chunks", async () => {
    const child = new FakeChild();
    const invalidArtifact = Buffer.from("not-a-zip");
    const runtime = new PowerShellRuntime({
      spawnProcess: () => {
        queueMicrotask(() => {
          child.emit("spawn");
          child.stdout.write(invalidArtifact);
          child.exitCode = 0;
          child.emit("close", 0, null);
        });
        return asChild(child);
      },
    });

    await expect(
      runtime.execute({
        assessment,
        context: {
          executionId: "EXE-f5ba1dac-d546-47a7-b9e5-7ef9ad22cfb3",
          assessmentId: "hello-world",
          options: {},
        },
        signal: new AbortController().signal,
        onStarted: vi.fn(),
        onProgress: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARTIFACT" });
    expect(invalidArtifact.every((byte) => byte === 0)).toBe(true);
  });

  it("accepts a sanitized error event but exposes only a fixed runtime failure", async () => {
    const child = new FakeChild();
    const runtime = new PowerShellRuntime({
      spawnProcess: () => {
        queueMicrotask(() => {
          child.emit("spawn");
          child.stderr.write(
            '{"type":"error","code":"ASSESSMENT_FAILED","message":"The assessment could not be completed."}\n',
          );
        });
        return asChild(child);
      },
    });

    await expect(
      runtime.execute({
        assessment,
        context: {
          executionId: "EXE-f5ba1dac-d546-47a7-b9e5-7ef9ad22cfb3",
          assessmentId: "hello-world",
          options: {},
        },
        signal: new AbortController().signal,
        onStarted: vi.fn(),
        onProgress: vi.fn(),
      }),
    ).rejects.toMatchObject({
      code: "ASSESSMENT_EXECUTION_FAILED",
      message: "The PowerShell assessment runtime failed safely.",
    });
    expect(child.killed).toBe(true);
  });

  it("kills the child when the assessment timeout is exceeded", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const runtime = new PowerShellRuntime({
      spawnProcess: () => {
        queueMicrotask(() => child.emit("spawn"));
        return asChild(child);
      },
    });
    const operation = runtime.execute({
      assessment: { ...assessment, timeoutMs: 100 },
      context: {
        executionId: "EXE-f5ba1dac-d546-47a7-b9e5-7ef9ad22cfb3",
        assessmentId: "hello-world",
        options: {},
      },
      signal: new AbortController().signal,
      onStarted: vi.fn(),
      onProgress: vi.fn(),
    });
    const rejected = operation.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(100);

    const error = await rejected;
    expect(error).toBeInstanceOf(PowerShellRuntimeError);
    expect(error).toMatchObject({ code: "ASSESSMENT_TIMEOUT" });
    expect(child.killed).toBe(true);
  });

  it("caches the non-sensitive PowerShell availability probe", async () => {
    let spawnCount = 0;
    const runtime = new PowerShellRuntime({
      healthCacheMs: 60_000,
      spawnProcess: () => {
        spawnCount += 1;
        const child = new FakeChild();
        queueMicrotask(() => {
          child.exitCode = 0;
          child.emit("close", 0, null);
        });
        return asChild(child);
      },
    });

    await expect(runtime.isAvailable()).resolves.toBe(true);
    await expect(runtime.isAvailable()).resolves.toBe(true);
    expect(spawnCount).toBe(1);
  });
});
