import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import {
  createExecution,
  downloadExecutionArtifact,
  getExecution,
  listAssessments,
} from "./api/cloudops";
import { CloudOpsAuthContext } from "./auth/useCloudOpsAuth";
import type { CloudOpsAuthState } from "./auth/types";

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
const getToken = vi.fn(async () => `api-${"a".repeat(48)}`);

const graphAssessment = {
  id: "microsoft-graph-connectivity",
  name: "Microsoft Graph Connectivity",
  description:
    "Validates delegated Microsoft Graph access for the connected tenant.",
  enabled: true,
  provider: "azure",
  domain: "secops",
  visibility: "public",
  requiredAuthProvider: "microsoft-graph",
  requiredPermissions: ["User.Read"],
  adminConsentRequired: false,
} as const;

const helloAssessment = {
  id: "hello-world",
  name: "Hello World Assessment",
  description: "Validates the ephemeral runtime.",
  enabled: true,
  provider: "azure",
  domain: "devops",
  visibility: "development",
  requiredAuthProvider: "none",
  requiredPermissions: [],
  adminConsentRequired: false,
} as const;

function authState(
  overrides: Partial<CloudOpsAuthState> = {},
): CloudOpsAuthState {
  return {
    configured: true,
    authenticated: true,
    busy: false,
    account: {
      displayName: "Ada Lovelace",
      username: "ada@example.test",
      tenantId: "11111111-1111-4111-8111-111111111111",
    },
    error: null,
    sessionEpoch: 1,
    login: vi.fn(async () => undefined),
    switchAccount: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    clearError: vi.fn(),
    getApiAccessToken: getToken,
    ...overrides,
  };
}

function renderApp(path: string, auth = authState()) {
  return render(
    <CloudOpsAuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </CloudOpsAuthContext.Provider>,
  );
}

describe("CloudOps multicloud application", () => {
  beforeEach(() => {
    mockedListAssessments.mockResolvedValue([
      graphAssessment,
      helloAssessment,
    ]);
    mockedCreateExecution.mockResolvedValue({
      executionId: "EXE-550e8400-e29b-41d4-a716-446655440000",
      status: "STARTING",
    });
    mockedGetExecution.mockResolvedValue({
      executionId: "EXE-550e8400-e29b-41d4-a716-446655440000",
      assessmentId: "microsoft-graph-connectivity",
      status: "COMPLETED",
      stage: "COMPLETED",
      progress: 100,
      createdAt: "2026-09-02T12:00:00.000Z",
      startedAt: "2026-09-02T12:00:00.050Z",
      completedAt: "2026-09-02T12:00:00.200Z",
      publicMetrics: { graphReachable: true, requestsCompleted: 1 },
      artifactAvailable: true,
      expiresAt: "2026-09-02T12:05:00.000Z",
    });
    mockedDownload.mockResolvedValue(undefined);
  });

  it("uses the URL as provider state and exposes all five areas for AWS", async () => {
    renderApp("/");

    expect(
      screen.getByRole("heading", { name: "Selecione um ambiente" }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Acessar Amazon Web Services",
      }),
    );

    expect(
      (await screen.findAllByText("Integração AWS ainda não implementada."))
        .length,
    ).toBeGreaterThan(0);
    for (const area of ["Dashboard", "GovOps", "SecOps", "FinOps", "DevOps"]) {
      expect(screen.getByRole("link", { name: area })).toBeVisible();
    }
    fireEvent.click(screen.getByRole("link", { name: "SecOps" }));
    expect(
      screen.getByRole("heading", { name: "SecOps", level: 1 }),
    ).toBeVisible();
    expect(mockedListAssessments).not.toHaveBeenCalled();
  });

  it("gates Azure catalog calls and execution behind Microsoft login", () => {
    const login = vi.fn(async () => undefined);
    renderApp(
      "/azure/secops",
      authState({
        authenticated: false,
        account: null,
        login,
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Conecte sua conta Microsoft" }),
    ).toBeVisible();
    expect(mockedListAssessments).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Entrar com Microsoft" }),
    );
    expect(login).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("heading", { name: "Assessments" }),
    ).not.toBeInTheDocument();
  });

  it("renders the authenticated Azure connection from volatile session state", () => {
    renderApp("/azure/dashboard");

    expect(
      screen.getByRole("heading", { name: "Microsoft connection" }),
    ).toBeVisible();
    expect(screen.getByText("Authenticated")).toBeVisible();
    expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("11111111-1111-4111-8111-111111111111").length,
    ).toBeGreaterThan(0);
  });

  it("filters the dynamic catalog, polls, and removes a downloaded artifact from UI state", async () => {
    renderApp("/azure/secops");

    expect(
      await screen.findByRole("heading", {
        name: "Microsoft Graph Connectivity",
      }),
    ).toBeVisible();
    expect(screen.getByText("User.Read")).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Hello World Assessment" }),
    ).not.toBeInTheDocument();
    expect(mockedListAssessments).toHaveBeenCalledWith(getToken);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Executar Microsoft Graph Connectivity",
      }),
    );

    expect(await screen.findByText("Iniciando")).toBeVisible();
    expect(mockedCreateExecution).toHaveBeenCalledWith(
      {
        assessmentId: "microsoft-graph-connectivity",
        options: {},
      },
      getToken,
    );

    const download = await screen.findByRole(
      "button",
      { name: "Baixar relatório" },
      { timeout: 2_000 },
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    expect(screen.getByText("Acessível")).toBeVisible();
    expect(screen.getByText("Requisições")).toBeVisible();

    fireEvent.click(download);
    await waitFor(() =>
      expect(mockedDownload).toHaveBeenCalledWith(
        "EXE-550e8400-e29b-41d4-a716-446655440000",
        getToken,
      ),
    );
    expect(await screen.findByText("Download iniciado.")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Baixar relatório" }),
    ).not.toBeInTheDocument();
  });

  it("clears an in-memory execution when the account session epoch changes", async () => {
    const initialAuth = authState({ sessionEpoch: 8 });
    const view = renderApp("/azure/secops", initialAuth);
    await screen.findByRole("heading", { name: "Microsoft Graph Connectivity" });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Executar Microsoft Graph Connectivity",
      }),
    );
    expect(await screen.findByText("Iniciando")).toBeVisible();

    const nextAuth = authState({ sessionEpoch: 9 });
    view.rerender(
      <CloudOpsAuthContext.Provider value={nextAuth}>
        <MemoryRouter initialEntries={["/azure/secops"]}>
          <App />
        </MemoryRouter>
      </CloudOpsAuthContext.Provider>,
    );

    expect(
      screen.queryByRole("complementary", {
        name: "Microsoft Graph Connectivity",
      }),
    ).not.toBeInTheDocument();
  });
});
