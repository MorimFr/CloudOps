import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExecutionPanel, type ExecutionPanelModel } from "./ExecutionPanel";

const execution: ExecutionPanelModel = {
  executionId: "EXE-550e8400-e29b-41d4-a716-446655440000", assessmentId: "test-tool", status: "RUNNING", stage: "AUTHENTICATING", progress: 25,
  artifactAvailable: false, expiresAt: null,
};

describe("approved ExecutionPanel regression", () => {
  it.each(["Hello World Assessment", "Microsoft Graph Connectivity", "Mapear Usuários Inativos", "Future registry tool"])("preserves the drawer, timeline and metrics for %s", (name) => {
    const props = { execution, assessmentName: name, downloading: false, downloadComplete: false, error: null, onDownload: vi.fn(), onClose: vi.fn() };
    const view = render(<ExecutionPanel {...props} />);
    const panel = screen.getByRole("complementary", { name });
    expect(panel).toHaveClass("execution-panel");
    expect(screen.getByText("Execução em memória")).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    const steps = screen.getByRole("list", { name: "Etapas da execução" });
    expect(within(steps).getAllByRole("listitem")).toHaveLength(5);
    for (const label of ["Iniciando", "Autenticando", "Processando", "Gerando relatório", "Concluído"]) expect(within(steps).getByText(label)).toBeVisible();
    expect(screen.getByRole("button", { name: "Fechar painel da execução" })).toBeDisabled();
    view.rerender(<ExecutionPanel {...props} execution={{ ...execution, status: "COMPLETED", stage: "COMPLETED", progress: 100, publicMetrics: { graphReachable: true, requestsCompleted: 1 }, artifactAvailable: true }} />);
    expect(screen.getByText("Relatório concluído")).toBeVisible();
    expect(screen.getByText("Acessível")).toBeVisible();
    expect(screen.getByText("Requisições")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Baixar relatório" }));
    expect(props.onDownload).toHaveBeenCalledOnce();
    view.rerender(<ExecutionPanel {...props} execution={{ ...execution, status: "COMPLETED", artifactAvailable: false }} downloadComplete />);
    expect(screen.getByText("Download iniciado.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Baixar relatório" })).not.toBeInTheDocument();
  });
  it("keeps failure and expiry presentation without adding consent UI inside the drawer", () => {
    const props = { assessmentName: "Test", downloading: false, downloadComplete: false, error: null, onDownload: vi.fn(), onClose: vi.fn() };
    const view = render(<ExecutionPanel {...props} execution={{ ...execution, status: "FAILED", stage: "GRAPH_CONSENT_REQUIRED" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Nenhum artefato foi mantido");
    expect(screen.queryByRole("button", { name: "Conceder permissões" })).not.toBeInTheDocument();
    view.rerender(<ExecutionPanel {...props} execution={{ ...execution, status: "EXPIRED" }} />);
    expect(screen.getByText("Execução expirada.")).toBeVisible();
  });
});
