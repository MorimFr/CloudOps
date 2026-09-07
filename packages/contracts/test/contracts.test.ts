import { describe, expect, expectTypeOf, it } from "vitest";

import {
  AssessmentExecutionRequestSchema,
  AssessmentSummarySchema,
  ASSESSMENT_AUTH_PROVIDERS,
  ASSESSMENT_VISIBILITIES,
  CLOUD_PROVIDERS,
  EXECUTION_STATUSES,
  GRAPH_PERMISSIONS,
  OPERATIONAL_DOMAINS,
  ExecutionSchema,
  PublicMetricsSchema,
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

  it("requires strict multicloud assessment metadata", () => {
    expect(CLOUD_PROVIDERS).toEqual(["azure", "aws", "gcp"]);
    expect(OPERATIONAL_DOMAINS).toEqual([
      "dashboard",
      "govops",
      "secops",
      "finops",
      "devops",
    ]);
    expect(ASSESSMENT_VISIBILITIES).toEqual(["public", "development"]);
    expect(ASSESSMENT_AUTH_PROVIDERS).toEqual(["none", "microsoft-graph"]);
    expect(GRAPH_PERMISSIONS).toEqual(["User.Read"]);

    expect(
      AssessmentSummarySchema.parse({
        id: "microsoft-graph-connectivity",
        name: "Microsoft Graph Connectivity",
        enabled: true,
        provider: "azure",
        domain: "secops",
        visibility: "public",
        requiredAuthProvider: "microsoft-graph",
        requiredPermissions: ["User.Read"],
        adminConsentRequired: false,
      }),
    ).toMatchObject({ provider: "azure", domain: "secops" });

    expect(
      AssessmentSummarySchema.safeParse({
        id: "unsafe",
        name: "Unsafe",
        enabled: true,
        provider: "other",
        domain: "secops",
        visibility: "public",
        requiredAuthProvider: "microsoft-graph",
        requiredPermissions: ["Directory.ReadWrite.All"],
        adminConsentRequired: false,
      }).success,
    ).toBe(false);
  });

  it("allows only aggregate public metrics without PII or nesting", () => {
    expect(
      PublicMetricsSchema.parse({
        findings: 2,
        objectsAnalyzed: 100,
        requestsCompleted: 1,
        graphReachable: true,
      }),
    ).toEqual({
      findings: 2,
      objectsAnalyzed: 100,
      requestsCompleted: 1,
      graphReachable: true,
    });

    for (const invalid of [
      { userPrincipalName: "person@example.com" },
      { tenantId: "00000000-0000-4000-8000-000000000000" },
      { findings: "2" },
      { findings: { critical: 2 } },
      { findings: -1 },
      { findings: 1.5 },
    ]) {
      expect(PublicMetricsSchema.safeParse(invalid).success).toBe(false);
    }
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
      PowerShellControlEventSchema.parse({
        type: "publicMetrics",
        publicMetrics: { graphReachable: true, requestsCompleted: 1 },
      }),
    ).toMatchObject({ type: "publicMetrics" });

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
