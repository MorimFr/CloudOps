import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { StringDecoder } from "node:string_decoder";

import {
  PowerShellControlEventSchema,
  type AssessmentExecutionRequest,
} from "@cloudops/contracts";

import type { RegisteredAssessment } from "./assessment-registry.js";

export const RUNTIME_ERROR_CODES = [
  "POWERSHELL_UNAVAILABLE",
  "ASSESSMENT_TIMEOUT",
  "ASSESSMENT_CANCELLED",
  "ASSESSMENT_EXECUTION_FAILED",
  "INVALID_CONTROL_OUTPUT",
  "ARTIFACT_TOO_LARGE",
  "INVALID_ARTIFACT",
  "INVALID_EXECUTION_CONTEXT",
] as const;

export type RuntimeErrorCode = (typeof RUNTIME_ERROR_CODES)[number];

export class PowerShellRuntimeError extends Error {
  public readonly code: RuntimeErrorCode;
  public readonly exitCode?: number;

  public constructor(code: RuntimeErrorCode, exitCode?: number) {
    super("The PowerShell assessment runtime failed safely.");
    this.name = "PowerShellRuntimeError";
    this.code = code;
    if (exitCode !== undefined) {
      this.exitCode = exitCode;
    }
  }
}

export interface RuntimeExecutionContext extends AssessmentExecutionRequest {
  readonly executionId: string;
}

export interface RuntimeExecutionInput {
  readonly assessment: RegisteredAssessment;
  readonly context: RuntimeExecutionContext;
  readonly signal: AbortSignal;
  readonly onStarted: () => void;
  readonly onProgress: (stage: string, progress: number) => void;
}

export interface RuntimeExecutionResult {
  readonly artifact: Buffer;
  readonly summary?: Record<string, unknown>;
  readonly exitCode: number;
}

export interface AssessmentRuntime {
  execute(input: RuntimeExecutionInput): Promise<RuntimeExecutionResult>;
  isAvailable(): Promise<boolean>;
}

type SpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

export interface PowerShellRuntimeOptions {
  readonly executable?: string;
  readonly maxArtifactBytes?: number;
  readonly maxControlLineBytes?: number;
  readonly maxContextBytes?: number;
  readonly healthCacheMs?: number;
  readonly healthTimeoutMs?: number;
  readonly spawnProcess?: SpawnProcess;
  readonly environment?: NodeJS.ProcessEnv;
}

function defaultSpawnProcess(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
): ChildProcessWithoutNullStreams {
  return spawn(command, args, options);
}

function childEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowedNames = [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "LANG",
    "LC_ALL",
    "HOME",
    "USERPROFILE",
    "TMP",
    "TEMP",
  ] as const;
  const environment: NodeJS.ProcessEnv = {
    POWERSHELL_TELEMETRY_OPTOUT: "1",
    POWERSHELL_UPDATECHECK: "Off",
    DOTNET_CLI_TELEMETRY_OPTOUT: "1",
    PSModuleAnalysisCachePath: process.platform === "win32" ? "NUL" : "/dev/null",
  };

  for (const name of allowedNames) {
    const value = source[name];
    if (value !== undefined) {
      environment[name] = value;
    }
  }

  return environment;
}

function wipeBuffers(buffers: readonly Buffer[]): void {
  for (const buffer of buffers) {
    buffer.fill(0);
  }
}

function hasZipLocalFileHeader(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  );
}

export class PowerShellRuntime implements AssessmentRuntime {
  readonly #executable: string;
  readonly #maxArtifactBytes: number;
  readonly #maxControlLineBytes: number;
  readonly #maxContextBytes: number;
  readonly #healthCacheMs: number;
  readonly #healthTimeoutMs: number;
  readonly #spawnProcess: SpawnProcess;
  readonly #environment: NodeJS.ProcessEnv;

  #healthCache?: { readonly value: boolean; readonly expiresAt: number };
  #healthCheck?: Promise<boolean>;

  public constructor(options: PowerShellRuntimeOptions = {}) {
    this.#executable = options.executable ?? "pwsh";
    this.#maxArtifactBytes = options.maxArtifactBytes ?? 25 * 1_024 * 1_024;
    this.#maxControlLineBytes = options.maxControlLineBytes ?? 64 * 1_024;
    this.#maxContextBytes = options.maxContextBytes ?? 64 * 1_024;
    this.#healthCacheMs = options.healthCacheMs ?? 60_000;
    this.#healthTimeoutMs = options.healthTimeoutMs ?? 3_000;
    this.#spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
    this.#environment = childEnvironment(options.environment ?? process.env);
  }

  public async execute(
    input: RuntimeExecutionInput,
  ): Promise<RuntimeExecutionResult> {
    let serializedContext: string;
    try {
      serializedContext = JSON.stringify(input.context);
    } catch {
      throw new PowerShellRuntimeError("INVALID_EXECUTION_CONTEXT");
    }

    if (
      serializedContext === undefined ||
      Buffer.byteLength(serializedContext, "utf8") > this.#maxContextBytes
    ) {
      throw new PowerShellRuntimeError("INVALID_EXECUTION_CONTEXT");
    }

    if (input.signal.aborted) {
      throw new PowerShellRuntimeError("ASSESSMENT_CANCELLED");
    }

    return await new Promise<RuntimeExecutionResult>((resolve, reject) => {
      const stdoutChunks: Buffer[] = [];
      const stderrDecoder = new StringDecoder("utf8");
      let stdoutBytes = 0;
      let stderrBuffer = "";
      let summary: Record<string, unknown> | undefined;
      let fatalError: PowerShellRuntimeError | undefined;
      let spawned = false;
      let settled = false;

      const child = this.#spawnProcess(
        this.#executable,
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          input.assessment.scriptPath,
        ],
        {
          shell: false,
          windowsHide: true,
          stdio: "pipe",
          env: this.#environment,
        },
      );

      const terminate = (): void => {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            child.kill("SIGKILL");
          } catch {
            // The close/error handlers complete cleanup without exposing details.
          }
        }
      };

      const fail = (error: PowerShellRuntimeError): void => {
        if (!fatalError) {
          fatalError = error;
          terminate();
        }
      };

      const processControlLine = (line: string): void => {
        if (line.trim() === "" || fatalError) {
          return;
        }

        if (Buffer.byteLength(line, "utf8") > this.#maxControlLineBytes) {
          fail(new PowerShellRuntimeError("INVALID_CONTROL_OUTPUT"));
          return;
        }

        let rawEvent: unknown;
        try {
          rawEvent = JSON.parse(line);
        } catch {
          fail(new PowerShellRuntimeError("INVALID_CONTROL_OUTPUT"));
          return;
        }

        const parsed = PowerShellControlEventSchema.safeParse(rawEvent);
        if (!parsed.success) {
          fail(new PowerShellRuntimeError("INVALID_CONTROL_OUTPUT"));
          return;
        }

        try {
          if (parsed.data.type === "progress") {
            input.onProgress(parsed.data.stage, parsed.data.progress);
          } else if (parsed.data.type === "summary") {
            summary = parsed.data.summary;
          } else {
            // Assessment-authored details are deliberately discarded. Only the
            // fixed, public runtime failure code crosses this trust boundary.
            fail(new PowerShellRuntimeError("ASSESSMENT_EXECUTION_FAILED"));
          }
        } catch {
          fail(new PowerShellRuntimeError("ASSESSMENT_EXECUTION_FAILED"));
        }
      };

      const drainControlLines = (): void => {
        let newlineIndex = stderrBuffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = stderrBuffer.slice(0, newlineIndex).replace(/\r$/, "");
          stderrBuffer = stderrBuffer.slice(newlineIndex + 1);
          processControlLine(line);
          newlineIndex = stderrBuffer.indexOf("\n");
        }

        if (
          Buffer.byteLength(stderrBuffer, "utf8") >
          this.#maxControlLineBytes
        ) {
          fail(new PowerShellRuntimeError("INVALID_CONTROL_OUTPUT"));
        }
      };

      const abort = (): void => {
        fail(new PowerShellRuntimeError("ASSESSMENT_CANCELLED"));
      };
      input.signal.addEventListener("abort", abort, { once: true });

      const timeout = setTimeout(() => {
        fail(new PowerShellRuntimeError("ASSESSMENT_TIMEOUT"));
      }, input.assessment.timeoutMs);
      timeout.unref();

      const finish = (exitCode: number | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        input.signal.removeEventListener("abort", abort);

        if (!fatalError) {
          stderrBuffer += stderrDecoder.end();
          if (stderrBuffer.trim() !== "") {
            processControlLine(stderrBuffer.replace(/\r$/, ""));
          }
        }

        if (!fatalError && exitCode !== 0) {
          fatalError = new PowerShellRuntimeError(
            "ASSESSMENT_EXECUTION_FAILED",
            exitCode ?? undefined,
          );
        }

        if (!fatalError && stdoutBytes === 0) {
          fatalError = new PowerShellRuntimeError("INVALID_ARTIFACT", 0);
        }

        if (fatalError) {
          stderrBuffer = "";
          wipeBuffers(stdoutChunks);
          stdoutChunks.length = 0;
          reject(fatalError);
          return;
        }

        let artifact: Buffer;
        try {
          artifact = Buffer.allocUnsafe(stdoutBytes);
          let writeOffset = 0;
          for (const chunk of stdoutChunks) {
            chunk.copy(artifact, writeOffset);
            writeOffset += chunk.length;
            chunk.fill(0);
          }
        } catch {
          wipeBuffers(stdoutChunks);
          stdoutChunks.length = 0;
          reject(new PowerShellRuntimeError("ASSESSMENT_EXECUTION_FAILED"));
          return;
        }
        stdoutChunks.length = 0;

        if (!hasZipLocalFileHeader(artifact)) {
          artifact.fill(0);
          reject(new PowerShellRuntimeError("INVALID_ARTIFACT", 0));
          return;
        }

        resolve({
          artifact,
          ...(summary ? { summary } : {}),
          exitCode: 0,
        });
      };

      child.stdout.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (fatalError) {
          buffer.fill(0);
          return;
        }
        stdoutBytes += buffer.length;
        if (stdoutBytes > this.#maxArtifactBytes) {
          buffer.fill(0);
          fail(new PowerShellRuntimeError("ARTIFACT_TOO_LARGE"));
          return;
        }
        stdoutChunks.push(buffer);
      });

      child.stderr.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (fatalError) {
          buffer.fill(0);
          return;
        }
        stderrBuffer += stderrDecoder.write(buffer);
        buffer.fill(0);
        drainControlLines();
      });

      child.stdin.on("error", () => {
        fail(new PowerShellRuntimeError("ASSESSMENT_EXECUTION_FAILED"));
      });
      child.stdout.on("error", () => {
        fail(new PowerShellRuntimeError("ASSESSMENT_EXECUTION_FAILED"));
      });
      child.stderr.on("error", () => {
        fail(new PowerShellRuntimeError("INVALID_CONTROL_OUTPUT"));
      });

      child.once("spawn", () => {
        spawned = true;
        try {
          input.onStarted();
          child.stdin.end(serializedContext, "utf8");
        } catch {
          fail(new PowerShellRuntimeError("ASSESSMENT_EXECUTION_FAILED"));
        }
      });

      child.once("error", () => {
        fail(
          new PowerShellRuntimeError(
            spawned
              ? "ASSESSMENT_EXECUTION_FAILED"
              : "POWERSHELL_UNAVAILABLE",
          ),
        );
      });

      child.once("close", (code) => {
        finish(code);
      });
    });
  }

  public async isAvailable(): Promise<boolean> {
    const now = Date.now();
    if (this.#healthCache && this.#healthCache.expiresAt > now) {
      return this.#healthCache.value;
    }

    if (this.#healthCheck) {
      return await this.#healthCheck;
    }

    this.#healthCheck = this.#checkAvailability();
    try {
      const value = await this.#healthCheck;
      this.#healthCache = {
        value,
        expiresAt: Date.now() + this.#healthCacheMs,
      };
      return value;
    } finally {
      this.#healthCheck = undefined;
    }
  }

  async #checkAvailability(): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const child = this.#spawnProcess(
        this.#executable,
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$null = $PSVersionTable.PSVersion; exit 0",
        ],
        {
          shell: false,
          windowsHide: true,
          stdio: "pipe",
          env: this.#environment,
        },
      );

      child.stdout.resume();
      child.stderr.resume();
      child.stdin.end();

      const settle = (available: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(available);
      };

      const timeout = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // A failed health probe is reported only as unavailable.
        }
        settle(false);
      }, this.#healthTimeoutMs);
      timeout.unref();

      child.once("error", () => settle(false));
      child.once("close", (code) => settle(code === 0));
    });
  }
}
