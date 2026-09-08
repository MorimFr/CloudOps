import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import {
  CloudOpsApiError,
  createExecution,
  downloadExecutionArtifact,
  getExecution,
  listAssessments,
} from "./api/cloudops";
import { CloudOpsAuthContext } from "./auth/useCloudOpsAuth";
import type { CloudOpsAuthState } from "./auth/types";
import { safeConsentError } from "./auth/consent";
import { CLOUD_PROVIDERS } from "./config/providers";

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
  moduleId: "connectivity-diagnostics",
  moduleName: "Conectividade e diagnóstico",
  moduleDescription: "Validação técnica.",
  moduleOrder: 4,
  assessmentOrder: 1,
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
  moduleId: "runtime-validation",
  moduleName: "Validação de runtime",
  moduleDescription: "Testes de desenvolvimento.",
  moduleOrder: 1,
  assessmentOrder: 1,
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
    authIssue: null,
    sessionEpoch: 1,
    login: vi.fn(async () => undefined),
    switchAccount: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    clearError: vi.fn(),
    getApiAccessToken: getToken,
    requestCombinedConsent: vi.fn(async () => undefined),
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
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    mockedCreateExecution.mockReset();
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

  it.each(CLOUD_PROVIDERS)("applies $id theme variables without changing the five areas", (provider) => {
    const { container } = renderApp(`/${provider.id}/dashboard`);
    const layout = container.querySelector<HTMLElement>(".provider-layout")!;
    expect(layout.style.getPropertyValue("--provider-primary")).toBe(provider.theme.primary);
    expect(layout.style.getPropertyValue("--provider-secondary")).toBe(provider.theme.secondary);
    expect(layout.style.getPropertyValue("--provider-tertiary")).toBe(provider.theme.tertiary);
    expect(layout.style.getPropertyValue("--provider-quaternary")).toBe(provider.theme.quaternary);
    expect(screen.getByRole("navigation", { name: `Áreas ${provider.name}` }).querySelectorAll("a")).toHaveLength(5);
  });

  it("keeps development tools opt-in and filters provider/domain and disabled tools", async () => {
    vi.stubEnv("VITE_SHOW_DEV_ASSESSMENTS", "false");
    const view = renderApp("/azure/devops");
    await screen.findByText("Nenhum assessment disponível nesta categoria ainda.");
    expect(screen.queryByRole("heading", { name: helloAssessment.name })).not.toBeInTheDocument();
    view.unmount();
    vi.stubEnv("VITE_SHOW_DEV_ASSESSMENTS", "true");
    mockedListAssessments.mockResolvedValueOnce([helloAssessment, graphAssessment, { ...helloAssessment, id: "disabled-tool", name: "Disabled tool", enabled: false }, { ...helloAssessment, id: "aws-tool", name: "AWS tool", provider: "aws" }]);
    renderApp("/azure/devops");
    await screen.findByRole("heading", { name: helloAssessment.name });
    expect(screen.getByRole("heading", { name: "Validação de runtime" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Disabled tool" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "AWS tool" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: graphAssessment.name })).not.toBeInTheDocument();
  });

  it("groups arbitrary registry cards by module and hides absent modules", async () => {
    mockedListAssessments.mockResolvedValueOnce([
      { ...graphAssessment, id: "later", name: "Later", assessmentOrder: 2 },
      { ...graphAssessment, id: "earlier", name: "Earlier", assessmentOrder: 1 },
      { ...graphAssessment, id: "first-module-tool", name: "First module tool", moduleId: "custom-module", moduleName: "Custom registry module", moduleOrder: 1 },
    ]);
    const { container } = renderApp("/azure/secops");
    await screen.findByRole("heading", { name: "Custom registry module" });
    expect([...container.querySelectorAll(".module-header h2")].map((item) => item.textContent)).toEqual(["Custom registry module", "Conectividade e diagnóstico"]);
    expect([...container.querySelectorAll(".assessment-card h3")].map((item) => item.textContent)).toEqual(["First module tool", "Earlier", "Later"]);
    expect(screen.queryByRole("heading", { name: "Proteção e resposta" })).not.toBeInTheDocument();
  });

  it("offers separate consent recovery and refreshes the API token before a single retry", async () => {
    const requestConsent = vi.fn(async () => undefined);
    mockedCreateExecution.mockRejectedValueOnce(new CloudOpsApiError("safe", 403, "GRAPH_CONSENT_REQUIRED"));
    mockedCreateExecution.mockImplementationOnce(async (_request, provider) => {
      await provider();
      return { executionId: "EXE-550e8400-e29b-41d4-a716-446655440000", status: "STARTING" };
    });
    renderApp("/azure/secops", authState({ requestCombinedConsent: requestConsent }));
    fireEvent.click(await screen.findByRole("button", { name: `Executar ${graphAssessment.name}` }));
    const dialog = await screen.findByRole("dialog", { name: "Permissões adicionais necessárias" });
    expect(dialog).toHaveTextContent("User.Read");
    expect(screen.queryByRole("complementary", { name: graphAssessment.name })).not.toBeInTheDocument();
    expect(requestConsent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Conceder permissões" }));
    await waitFor(() => expect(mockedCreateExecution).toHaveBeenCalledTimes(2));
    expect(requestConsent).toHaveBeenCalledOnce();
    expect(getToken).toHaveBeenCalledWith({ forceRefresh: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not loop after consent succeeds but the single retry is still denied", async () => {
    mockedCreateExecution.mockRejectedValue(new CloudOpsApiError("safe", 403, "GRAPH_CONSENT_REQUIRED"));
    const requestConsent = vi.fn(async () => undefined);
    renderApp("/azure/secops", authState({ requestCombinedConsent: requestConsent }));
    fireEvent.click(await screen.findByRole("button", { name: `Executar ${graphAssessment.name}` }));
    fireEvent.click(await screen.findByRole("button", { name: "Conceder permissões" }));
    await waitFor(() => expect(mockedCreateExecution).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/A repetição única já foi utilizada/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Conceder permissões" })).not.toBeInTheDocument();
    expect(requestConsent).toHaveBeenCalledOnce();
  });

  it.each(["user_cancelled", "network_error"])("keeps %s safe without automatically repeating the operation", async (errorCode) => {
    mockedCreateExecution.mockRejectedValueOnce(new CloudOpsApiError("safe", 403, "GRAPH_CONSENT_REQUIRED"));
    const requestConsent = vi.fn(async () => { throw safeConsentError({ errorCode, message: "raw-sensitive-auth-detail" }); });
    renderApp("/azure/secops", authState({ requestCombinedConsent: requestConsent }));
    fireEvent.click(await screen.findByRole("button", { name: `Executar ${graphAssessment.name}` }));
    fireEvent.click(await screen.findByRole("button", { name: "Conceder permissões" }));
    await waitFor(() => expect(requestConsent).toHaveBeenCalledOnce());
    await screen.findByText(errorCode === "user_cancelled" ? /Consentimento cancelado/ : /Não foi possível concluir a interação/);
    expect(mockedCreateExecution).toHaveBeenCalledOnce();
    expect(document.body).not.toHaveTextContent("raw-sensitive-auth-detail");
    expect(screen.queryByRole("complementary", { name: graphAssessment.name })).not.toBeInTheDocument();
  });

  it("presents explicit administrative approval without granting anything or replaying as another account", async () => {
    const auth = authState();
    mockedCreateExecution.mockRejectedValueOnce(new CloudOpsApiError("safe", 403, "ADMIN_APPROVAL_REQUIRED"));
    renderApp("/azure/secops", auth);
    fireEvent.click(await screen.findByRole("button", { name: `Executar ${graphAssessment.name}` }));
    expect(await screen.findByRole("dialog", { name: "Aprovação administrativa necessária" })).toHaveTextContent("User.Read");
    fireEvent.click(screen.getByRole("button", { name: "Tentar com uma conta administrativa" }));
    expect(auth.switchAccount).toHaveBeenCalledOnce();
    expect(auth.requestCombinedConsent).not.toHaveBeenCalled();
    expect(mockedCreateExecution).toHaveBeenCalledOnce();
  });

  it("recognizes administrative approval from normal MSAL token acquisition too", async () => {
    mockedCreateExecution.mockRejectedValueOnce({ errorCode: "invalid_grant", errorMessage: "AADSTS90094: raw-sensitive-auth-detail" });
    renderApp("/azure/secops");
    fireEvent.click(await screen.findByRole("button", { name: `Executar ${graphAssessment.name}` }));
    expect(await screen.findByRole("dialog", { name: "Aprovação administrativa necessária" })).toBeVisible();
    expect(document.body).not.toHaveTextContent("raw-sensitive-auth-detail");
    expect(mockedCreateExecution).toHaveBeenCalledOnce();
  });

  it("does not allocate another consent retry after Conditional Access consumes the shared budget", async () => {
    mockedCreateExecution.mockImplementationOnce(async (_request, _provider, budget) => {
      if (budget) budget.remaining = 0;
      throw new CloudOpsApiError("safe", 403, "GRAPH_CONSENT_REQUIRED");
    });
    renderApp("/azure/secops");
    fireEvent.click(await screen.findByRole("button", { name: `Executar ${graphAssessment.name}` }));
    expect(await screen.findByText(/A repetição única já foi utilizada/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Conceder permissões" })).not.toBeInTheDocument();
  });

  it("does not replay a pending recovery after the owning workspace unmounts", async () => {
    let resolveConsent!: () => void;
    const requestConsent = vi.fn(() => new Promise<void>((resolve) => { resolveConsent = resolve; }));
    mockedCreateExecution.mockRejectedValueOnce(new CloudOpsApiError("safe", 403, "GRAPH_CONSENT_REQUIRED"));
    const view = renderApp("/azure/secops", authState({ requestCombinedConsent: requestConsent }));
    fireEvent.click(await screen.findByRole("button", { name: `Executar ${graphAssessment.name}` }));
    fireEvent.click(await screen.findByRole("button", { name: "Conceder permissões" }));
    expect(requestConsent).toHaveBeenCalledOnce();
    view.unmount();
    resolveConsent();
    await Promise.resolve();
    expect(mockedCreateExecution).toHaveBeenCalledOnce();
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
      expect.objectContaining({ remaining: 1 }),
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
