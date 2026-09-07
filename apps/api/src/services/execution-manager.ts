import { randomUUID, timingSafeEqual } from "node:crypto";

import {
  AssessmentExecutionRequestSchema,
  PublicMetricsSchema,
  type AssessmentExecutionRequest,
  type CreateExecutionResponse,
  type Execution,
  type ExecutionStatus,
  type PublicMetrics,
} from "@cloudops/contracts";

import { errors } from "../errors.js";
import type { ValidatedApiToken } from "../auth/token-validator.js";
import type { GraphTokenBroker } from "../auth/obo-service.js";
import type {
  AssessmentRegistry,
  RegisteredAssessment,
} from "./assessment-registry.js";
import {
  PowerShellRuntimeError,
  type AssessmentRuntime,
  type RuntimeErrorCode,
  type RuntimeGraphAuthContext,
} from "./powershell-runtime.js";

interface ExecutionState {
  readonly executionId: string;
  readonly assessmentId: string;
  readonly ownerKey: string;
  status: ExecutionStatus;
  stage: string | null;
  progress: number;
  readonly createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  publicMetrics: PublicMetrics | undefined;
  artifact: Buffer | undefined;
  readonly leasedArtifacts: Set<Buffer>;
  expiresAt: string | null;
  cleanupTimer: NodeJS.Timeout | undefined;
  readonly abortController: AbortController;
}

export interface ArtifactLease {
  readonly buffer: Buffer;
  dispose(): void;
}

export interface ExecutionLifecycleEvent {
  readonly executionId: string;
  readonly assessmentId: string;
  readonly status: ExecutionStatus;
  readonly stage: string | null;
  readonly progress: number;
  readonly durationMs?: number;
  readonly exitCode?: number;
  readonly runtimeErrorCode?: RuntimeErrorCode;
}

export interface ExecutionManagerOptions {
  readonly registry: AssessmentRegistry;
  readonly runtime: AssessmentRuntime;
  readonly artifactTtlMs?: number;
  readonly maxConcurrentExecutions?: number;
  readonly graphTokenTimeoutMs?: number;
  readonly idFactory?: () => string;
  readonly now?: () => number;
  readonly onLifecycleEvent?: (event: ExecutionLifecycleEvent) => void;
  readonly graphTokenBroker?: GraphTokenBroker;
}

const ACTIVE_STATUSES = new Set<ExecutionStatus>([
  "CREATED",
  "STARTING",
  "RUNNING",
]);

function safeRuntimeErrorCode(error: unknown): RuntimeErrorCode {
  return error instanceof PowerShellRuntimeError
    ? error.code
    : "ASSESSMENT_EXECUTION_FAILED";
}

function bestEffortWipe(buffer: Buffer | undefined): void {
  buffer?.fill(0);
}

const RESERVED_OPTION_KEYS = new Set([
  "auth",
  "tenantid",
  "accesstoken",
  "scopes",
  "authority",
  "scriptpath",
  "requiredpermissions",
]);

function hasReservedOptionKey(value: unknown, depth = 0): boolean {
  if (depth > 32) {
    return true;
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasReservedOptionKey(entry, depth + 1));
  }
  return Object.entries(value).some(
    ([key, entry]) =>
      RESERVED_OPTION_KEYS.has(key.toLowerCase().replaceAll(/[-_.]/g, "")) ||
      hasReservedOptionKey(entry, depth + 1),
  );
}

function sameOwner(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(actual, "utf8");
  return (
    expectedBytes.length === actualBytes.length &&
    timingSafeEqual(expectedBytes, actualBytes)
  );
}

export class ExecutionManager {
  readonly #executions = new Map<string, ExecutionState>();
  readonly #registry: AssessmentRegistry;
  readonly #runtime: AssessmentRuntime;
  readonly #artifactTtlMs: number;
  readonly #maxConcurrentExecutions: number;
  readonly #graphTokenTimeoutMs: number;
  readonly #idFactory: () => string;
  readonly #now: () => number;
  readonly #onLifecycleEvent?: (event: ExecutionLifecycleEvent) => void;
  readonly #graphTokenBroker?: GraphTokenBroker;
  #disposed = false;

  public constructor(options: ExecutionManagerOptions) {
    this.#registry = options.registry;
    this.#runtime = options.runtime;
    this.#artifactTtlMs = options.artifactTtlMs ?? 5 * 60_000;
    this.#maxConcurrentExecutions = options.maxConcurrentExecutions ?? 2;
    this.#graphTokenTimeoutMs = options.graphTokenTimeoutMs ?? 15_000;
    this.#idFactory = options.idFactory ?? (() => `EXE-${randomUUID()}`);
    this.#now = options.now ?? Date.now;
    this.#onLifecycleEvent = options.onLifecycleEvent;
    this.#graphTokenBroker = options.graphTokenBroker;

    if (
      !Number.isSafeInteger(this.#artifactTtlMs) ||
      this.#artifactTtlMs < 1
    ) {
      throw new Error("Artifact TTL must be a positive integer");
    }
    if (
      !Number.isSafeInteger(this.#maxConcurrentExecutions) ||
      this.#maxConcurrentExecutions < 1
    ) {
      throw new Error("Maximum concurrency must be a positive integer");
    }
    if (
      !Number.isSafeInteger(this.#graphTokenTimeoutMs) ||
      this.#graphTokenTimeoutMs < 1 ||
      this.#graphTokenTimeoutMs > 120_000
    ) {
      throw new Error("Graph token timeout is outside the allowed range");
    }
  }

  public async create(
    request: AssessmentExecutionRequest,
    authenticated: ValidatedApiToken,
  ): Promise<CreateExecutionResponse> {
    if (this.#disposed) {
      throw new Error("Execution manager has been disposed");
    }

    const parsed = AssessmentExecutionRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw errors.invalidRequest();
    }

    const assessment = this.#registry.resolve(parsed.data.assessmentId);
    if (this.#activeExecutionCount() >= this.#maxConcurrentExecutions) {
      throw errors.capacityReached();
    }

    if (
      !/^[A-Za-z0-9_-]{43}$/.test(authenticated.principal.ownerKey) ||
      hasReservedOptionKey(parsed.data.options)
    ) {
      throw errors.invalidRequest();
    }

    let executionOptions: Record<string, unknown>;
    try {
      // Clone before publishing STARTING state. A non-cloneable value can only
      // arise through an internal caller (HTTP JSON itself is cloneable), but it
      // must never leave behind a capacity-consuming orphan execution.
      executionOptions = structuredClone(parsed.data.options);
    } catch {
      throw errors.invalidRequest();
    }

    const executionId = this.#createUniqueExecutionId();
    const createdAtMs = this.#now();
    const state: ExecutionState = {
      executionId,
      assessmentId: assessment.id,
      ownerKey: authenticated.principal.ownerKey,
      status: "STARTING",
      stage: "STARTING",
      progress: 0,
      createdAt: new Date(createdAtMs).toISOString(),
      startedAt: null,
      completedAt: null,
      publicMetrics: undefined,
      artifact: undefined,
      leasedArtifacts: new Set(),
      expiresAt: null,
      cleanupTimer: undefined,
      abortController: new AbortController(),
    };
    this.#executions.set(executionId, state);

    let runtimeAuth: RuntimeGraphAuthContext | undefined;
    try {
      if (assessment.requiredAuthProvider === "microsoft-graph") {
        if (!this.#graphTokenBroker) {
          throw errors.graphAuthenticationFailed();
        }
        const graphToken = await this.#acquireGraphToken({
          incomingApiAccessToken: authenticated.accessToken,
          tenantId: authenticated.principal.tenantId,
          requiredPermissions: assessment.requiredPermissions,
          signal: state.abortController.signal,
        });
        runtimeAuth = {
          provider: "microsoft-graph",
          tenantId: authenticated.principal.tenantId,
          accessToken: graphToken.accessToken,
        };
      }
    } catch (error) {
      this.#destroyState(state);
      this.#executions.delete(executionId);
      throw error;
    }

    if (this.#disposed || this.#executions.get(executionId) !== state) {
      this.#destroyState(state);
      throw new Error("Execution manager stopped before execution start");
    }

    this.#emitLifecycle(state);
    queueMicrotask(() => {
      void this.#runExecution(
        state,
        assessment,
        executionOptions,
        runtimeAuth,
      );
    });

    return { executionId, status: "STARTING" };
  }

  public get(executionId: string, ownerKey: string): Execution | undefined {
    const state = this.#executions.get(executionId);
    return state && sameOwner(state.ownerKey, ownerKey)
      ? this.#snapshot(state)
      : undefined;
  }

  public require(executionId: string, ownerKey: string): Execution {
    const execution = this.get(executionId, ownerKey);
    if (!execution) {
      throw errors.executionNotFound();
    }
    return execution;
  }

  public checkoutArtifact(
    executionId: string,
    ownerKey: string,
  ): ArtifactLease {
    const state = this.#executions.get(executionId);
    if (!state || !sameOwner(state.ownerKey, ownerKey)) {
      throw errors.executionNotFound();
    }
    if (state.status !== "COMPLETED") {
      throw errors.artifactNotReady();
    }
    if (!state.artifact) {
      throw errors.artifactUnavailable();
    }

    const buffer = state.artifact;
    state.artifact = undefined;
    state.leasedArtifacts.add(buffer);
    let disposed = false;

    return {
      buffer,
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        buffer.fill(0);
        state.leasedArtifacts.delete(buffer);
      },
    };
  }

  public cancel(executionId: string, ownerKey: string): boolean {
    const state = this.#executions.get(executionId);
    if (!state || !sameOwner(state.ownerKey, ownerKey)) {
      return false;
    }

    state.abortController.abort();
    this.#destroyState(state);
    this.#executions.delete(executionId);
    return true;
  }

  public dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;

    for (const state of this.#executions.values()) {
      state.abortController.abort();
      this.#destroyState(state);
    }
    this.#executions.clear();
  }

  #activeExecutionCount(): number {
    let active = 0;
    for (const state of this.#executions.values()) {
      if (ACTIVE_STATUSES.has(state.status)) {
        active += 1;
      }
    }
    return active;
  }

  async #acquireGraphToken(
    request: Parameters<GraphTokenBroker["acquireToken"]>[0],
  ): Promise<Awaited<ReturnType<GraphTokenBroker["acquireToken"]>>> {
    if (!this.#graphTokenBroker) {
      throw errors.graphAuthenticationFailed();
    }

    let timeout: NodeJS.Timeout | undefined;
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal?.addEventListener("abort", abort, { once: true });
    if (request.signal?.aborted) controller.abort();
    let rejectDeadline: (() => void) | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      rejectDeadline = () => reject(errors.graphUnavailable());
      controller.signal.addEventListener("abort", rejectDeadline, { once: true });
      timeout = setTimeout(
        () => controller.abort(),
        this.#graphTokenTimeoutMs,
      );
      timeout.unref();
    });

    try {
      if (controller.signal.aborted) throw errors.graphUnavailable();
      // The injected MSAL transport aborts the HTTP operation on deadline or
      // shutdown. The race also bounds adapters that ignore the signal.
      return await Promise.race([
        this.#graphTokenBroker.acquireToken({ ...request, signal: controller.signal }),
        deadline,
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      request.signal?.removeEventListener("abort", abort);
      if (rejectDeadline) controller.signal.removeEventListener("abort", rejectDeadline);
    }
  }

  #createUniqueExecutionId(): string {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const candidate = this.#idFactory();
      if (
        /^EXE-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          candidate,
        ) &&
        !this.#executions.has(candidate)
      ) {
        return candidate;
      }
    }

    throw new Error("Unable to generate a unique execution identifier");
  }

  async #runExecution(
    initialState: ExecutionState,
    assessment: RegisteredAssessment,
    options: Record<string, unknown>,
    runtimeAuth: RuntimeGraphAuthContext | undefined,
  ): Promise<void> {
    if (
      this.#disposed ||
      this.#executions.get(initialState.executionId) !== initialState ||
      !ACTIVE_STATUSES.has(initialState.status)
    ) {
      return;
    }

    try {
      let runtimeContext: import("./powershell-runtime.js").RuntimeExecutionContext | undefined = {
        executionId: initialState.executionId,
        assessmentId: assessment.id,
        options,
        ...(runtimeAuth ? { auth: runtimeAuth } : {}),
      };
      const operation = this.#runtime.execute({
        assessment,
        context: runtimeContext,
        signal: initialState.abortController.signal,
        onStarted: () => {
          const state = this.#executions.get(initialState.executionId);
          if (!state || state.status !== "STARTING") {
            return;
          }
          state.status = "RUNNING";
          state.stage = "INITIALIZING";
          state.startedAt = new Date(this.#now()).toISOString();
          this.#emitLifecycle(state);
        },
        onProgress: (stage, progress) => {
          const state = this.#executions.get(initialState.executionId);
          if (!state || !ACTIVE_STATUSES.has(state.status)) {
            return;
          }
          if (state.status === "STARTING") {
            state.status = "RUNNING";
            state.startedAt ??= new Date(this.#now()).toISOString();
          }
          state.stage = stage;
          state.progress = Math.max(state.progress, progress);
          this.#emitLifecycle(state);
        },
      });
      runtimeContext = undefined;
      runtimeAuth = undefined;
      const result = await operation;

      const state = this.#executions.get(initialState.executionId);
      if (!state || !ACTIVE_STATUSES.has(state.status)) {
        bestEffortWipe(result.artifact);
        return;
      }

      const parsedPublicMetrics = PublicMetricsSchema.safeParse(
        result.publicMetrics,
      );
      if (result.publicMetrics !== undefined && !parsedPublicMetrics.success) {
        bestEffortWipe(result.artifact);
        throw new PowerShellRuntimeError("INVALID_CONTROL_OUTPUT");
      }

      const completedAtMs = this.#now();
      state.startedAt ??= new Date(completedAtMs).toISOString();
      state.status = "COMPLETED";
      state.stage = "COMPLETED";
      state.progress = 100;
      state.completedAt = new Date(completedAtMs).toISOString();
      state.publicMetrics = parsedPublicMetrics.success
        ? structuredClone(parsedPublicMetrics.data)
        : undefined;
      state.artifact = result.artifact;
      this.#scheduleExpiry(state, completedAtMs);
      this.#emitLifecycle(state, {
        durationMs:
          completedAtMs - new Date(state.startedAt).getTime(),
        exitCode: result.exitCode,
      });
    } catch (error) {
      const state = this.#executions.get(initialState.executionId);
      if (!state || !ACTIVE_STATUSES.has(state.status)) {
        return;
      }

      const completedAtMs = this.#now();
      const runtimeErrorCode = safeRuntimeErrorCode(error);
      state.startedAt ??= new Date(completedAtMs).toISOString();
      state.status = "FAILED";
      state.stage = runtimeErrorCode;
      state.completedAt = new Date(completedAtMs).toISOString();
      state.publicMetrics = undefined;
      bestEffortWipe(state.artifact);
      state.artifact = undefined;
      this.#scheduleExpiry(state, completedAtMs);
      this.#emitLifecycle(state, {
        durationMs:
          completedAtMs - new Date(state.startedAt).getTime(),
        ...(error instanceof PowerShellRuntimeError &&
        error.exitCode !== undefined
          ? { exitCode: error.exitCode }
          : {}),
        runtimeErrorCode,
      });
    }
  }

  #scheduleExpiry(state: ExecutionState, terminalAtMs: number): void {
    if (state.cleanupTimer) {
      clearTimeout(state.cleanupTimer);
    }
    const expiresAtMs = terminalAtMs + this.#artifactTtlMs;
    state.expiresAt = new Date(expiresAtMs).toISOString();
    state.cleanupTimer = setTimeout(() => {
      const current = this.#executions.get(state.executionId);
      if (current !== state) {
        return;
      }
      current.status = "EXPIRED";
      current.stage = "EXPIRED";
      this.#emitLifecycle(current);
      this.#destroyState(current);
      this.#executions.delete(current.executionId);
    }, this.#artifactTtlMs);
    state.cleanupTimer.unref();
  }

  #snapshot(state: ExecutionState): Execution {
    return {
      executionId: state.executionId,
      assessmentId: state.assessmentId,
      status: state.status,
      stage: state.stage,
      progress: state.progress,
      createdAt: state.createdAt,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      ...(state.publicMetrics
        ? { publicMetrics: structuredClone(state.publicMetrics) }
        : {}),
      artifactAvailable: state.artifact !== undefined,
      expiresAt: state.expiresAt,
    };
  }

  #destroyState(state: ExecutionState): void {
    if (state.cleanupTimer) {
      clearTimeout(state.cleanupTimer);
      state.cleanupTimer = undefined;
    }
    bestEffortWipe(state.artifact);
    state.artifact = undefined;
    for (const leasedArtifact of state.leasedArtifacts) {
      leasedArtifact.fill(0);
    }
    state.leasedArtifacts.clear();
    state.publicMetrics = undefined;
  }

  #emitLifecycle(
    state: ExecutionState,
    additional: Pick<
      ExecutionLifecycleEvent,
      "durationMs" | "exitCode" | "runtimeErrorCode"
    > = {},
  ): void {
    try {
      this.#onLifecycleEvent?.({
        executionId: state.executionId,
        assessmentId: state.assessmentId,
        status: state.status,
        stage: state.stage,
        progress: state.progress,
        ...additional,
      });
    } catch {
      // Logging/telemetry callbacks cannot change assessment execution state.
    }
  }
}
