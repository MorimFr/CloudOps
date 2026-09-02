import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import {
  createExecution,
  downloadExecutionArtifact,
  getExecution,
  listAssessments,
} from "./api/cloudops";

vi.mock("./api/cloudops", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api/cloudops")>();
  return {
    ...original,
    listAssessments: vi.fn(),
    createExecution: vi.fn(),
    getExecution: vi.fn(),
    downloadExecutionArtifact: vi.fn(),
  };
});

const mockedListAssessments = vi.mocked(listAssessments);
const mockedCreateExecution = vi.mocked(createExecution);
const mockedGetExecution = vi.mocked(getExecution);
const mockedDownload = vi.mocked(downloadExecutionArtifact);

describe("CloudOps application", () => {
  beforeEach(() => {
    mockedListAssessments.mockResolvedValue([
      {
        id: "hello-world",
        name: "Hello World Assessment",
        enabled: true,
      },
    ]);
    mockedCreateExecution.mockResolvedValue({
      executionId: "EXE-550e8400-e29b-41d4-a716-446655440000",
      status: "STARTING",
    });
    mockedGetExecution.mockResolvedValue({
      executionId: "EXE-550e8400-e29b-41d4-a716-446655440000",
      assessmentId: "hello-world",
      status: "COMPLETED",
      stage: "COMPLETED",
      progress: 100,
      createdAt: "2026-09-02T12:00:00.000Z",
      startedAt: "2026-09-02T12:00:00.050Z",
      completedAt: "2026-09-02T12:00:00.200Z",
      summary: { message: "Assessment completed" },
      artifactAvailable: true,
      expiresAt: "2026-09-02T12:05:00.000Z",
    });
    mockedDownload.mockResolvedValue(undefined);
  });

  it("loads the catalog, polls an execution and removes the downloaded artifact from UI state", async () => {
    render(<App />);

    expect(await screen.findByText("Hello World Assessment")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Executar Hello World Assessment" }),
    );

    expect(await screen.findByText("Iniciando")).toBeVisible();
    expect(mockedCreateExecution).toHaveBeenCalledWith({
      assessmentId: "hello-world",
      options: {},
    });

    const download = await screen.findByRole(
      "button",
      { name: "Baixar relatório" },
      { timeout: 2_000 },
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );

    fireEvent.click(download);
    await waitFor(() =>
      expect(mockedDownload).toHaveBeenCalledWith(
        "EXE-550e8400-e29b-41d4-a716-446655440000",
      ),
    );
    expect(await screen.findByText("Download iniciado.")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Baixar relatório" }),
    ).not.toBeInTheDocument();
  });

  it("offers a retry when the catalog is unavailable", async () => {
    mockedListAssessments
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([
        {
          id: "hello-world",
          name: "Hello World Assessment",
          enabled: true,
        },
      ]);

    render(<App />);

    expect(
      await screen.findByText("Não foi possível carregar o catálogo."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));

    expect(await screen.findByText("Hello World Assessment")).toBeVisible();
    expect(mockedListAssessments).toHaveBeenCalledTimes(2);
  });
});
