import { describe, expect, expectTypeOf, it } from "vitest";

import {
  AssessmentExecutionRequestSchema,
  EXECUTION_STATUSES,
  ExecutionSchema,
  PowerShellControlEventSchema,
  type AssessmentExecutionRequest,
  type ExecutionStatus,
} from "../src/index.js";

describe("shared contracts", () => {
  it("exposes exactly the supported execution statuses", () => {
    expect(EXECUTION_STATUSES).toEqual([
      "CREATED",
      "STARTING",
      "RUNNING",
      "COMPLETED",
      "FAILED",
      "EXPIRED",
    ]);
    expectTypeOf<ExecutionStatus>().toEqualTypeOf<
      | "CREATED"
      | "STARTING"
      | "RUNNING"
      | "COMPLETED"
      | "FAILED"
      | "EXPIRED"
    >();
  });

  it("validates an execution request and rejects additional input", () => {
    const request = AssessmentExecutionRequestSchema.parse({
      assessmentId: "hello-world",
      options: {},
    });

    expectTypeOf(request).toEqualTypeOf<AssessmentExecutionRequest>();
    expect(() =>
      AssessmentExecutionRequestSchema.parse({
        assessmentId: "hello-world",
        options: {},
        scriptPath: "/tmp/untrusted.ps1",
      }),
    ).toThrow();
  });

  it("keeps sensitive artifact bytes out of the status contract", () => {
    const parsed = ExecutionSchema.safeParse({
      executionId: "EXE-3d6f0a67-2572-4f70-bd8d-3dd785c1f7e7",
      assessmentId: "hello-world",
      status: "COMPLETED",
      stage: "COMPLETED",
      progress: 100,
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.001Z",
      completedAt: "2026-01-01T00:00:00.002Z",
      artifactAvailable: true,
      expiresAt: "2026-01-01T00:05:00.002Z",
      artifact: "not-allowed",
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts only sanitized PowerShell failure events", () => {
    expect(
      PowerShellControlEventSchema.parse({
        type: "error",
        code: "ASSESSMENT_FAILED",
        message: "The assessment could not be completed.",
      }),
    ).toMatchObject({ type: "error", code: "ASSESSMENT_FAILED" });

    expect(
      PowerShellControlEventSchema.safeParse({
        type: "error",
        code: "ASSESSMENT_FAILED",
        message: "The assessment could not be completed.",
        details: { tenantPayload: "not-allowed" },
      }).success,
    ).toBe(false);
  });
});
