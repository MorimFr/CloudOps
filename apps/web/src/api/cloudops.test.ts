import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CloudOpsApiError,
  createExecution,
  downloadExecutionArtifact,
  listAssessments,
} from "./cloudops";

const fetchMock = vi.fn<typeof fetch>();

describe("CloudOps API client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("loads assessments without allowing an HTTP cache", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { id: "hello-world", name: "Hello World Assessment", enabled: true },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(listAssessments()).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/api/v1/assessments",
      expect.objectContaining({ cache: "no-store", credentials: "omit" }),
    );
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

    await createExecution({
      assessmentId: "hello world/validated",
      options: { mode: "foundation" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/api/v1/assessments/hello%20world%2Fvalidated/executions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ options: { mode: "foundation" } }),
      }),
    );
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

    const error = await listAssessments().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(CloudOpsApiError);
    expect(error).toMatchObject({
      code: "EXECUTION_CAPACITY_REACHED",
      status: 429,
      message: "Capacidade temporariamente atingida.",
    });
    expect(String(error)).not.toContain("internalDetails");
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

    await downloadExecutionArtifact("EXE-123");

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download="cloudops-report.zip"]')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:cloudops-ephemeral");
  });
});
