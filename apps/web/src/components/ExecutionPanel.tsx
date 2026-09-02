import type { Execution, ExecutionStatus } from "@cloudops/contracts";
import { ProgressBar } from "./ProgressBar";
import { StatusBadge } from "./StatusBadge";

export type ExecutionPanelModel = Pick<
  Execution,
  | "executionId"
  | "assessmentId"
  | "status"
  | "stage"
  | "progress"
  | "summary"
  | "artifactAvailable"
  | "expiresAt"
>;

interface ExecutionPanelProps {
  execution: ExecutionPanelModel;
  assessmentName: string;
  downloading: boolean;
  downloadComplete: boolean;
  error: string | null;
  onDownload: () => void;
  onClose: () => void;
}

const STAGE_LABELS: Record<string, string> = {
  INITIALIZING: "Preparando ambiente",
  PROCESSING: "Processando avaliação",
  GENERATING_REPORT: "Gerando relatório",
  COMPLETED: "Relatório concluído",
};

const TERMINAL_STATUSES: ReadonlySet<ExecutionStatus> = new Set([
  "COMPLETED",
  "FAILED",
  "EXPIRED",
]);

const EXECUTION_STEPS = [
  { key: "INITIALIZING", label: "Iniciando" },
  { key: "PROCESSING", label: "Processando" },
  { key: "GENERATING_REPORT", label: "Gerando relatório" },
  { key: "COMPLETED", label: "Concluído" },
] as const;

function currentStepIndex(execution: ExecutionPanelModel): number {
  if (execution.status === "COMPLETED") {
    return EXECUTION_STEPS.length;
  }

  const stageIndex = EXECUTION_STEPS.findIndex(
    (step) => step.key === execution.stage,
  );
  return stageIndex >= 0 ? stageIndex : 0;
}

function displayStage(stage: string | null, status: ExecutionStatus): string {
  if (stage && STAGE_LABELS[stage]) {
    return STAGE_LABELS[stage];
  }

  if (stage) {
    return stage
      .toLowerCase()
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  if (status === "CREATED" || status === "STARTING") {
    return "Iniciando execução";
  }

  if (status === "FAILED") {
    return "A execução foi interrompida";
  }

  if (status === "EXPIRED") {
    return "O artefato expirou";
  }

  return status === "COMPLETED" ? "Relatório concluído" : "Processando avaliação";
}

function summaryMessage(summary: Record<string, unknown> | undefined): string | null {
  return typeof summary?.message === "string" ? summary.message : null;
}

function expiryText(expiresAt: string | null): string | null {
  if (!expiresAt) {
    return null;
  }

  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.valueOf())) {
    return null;
  }

  return expiry.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ExecutionPanel({
  execution,
  assessmentName,
  downloading,
  downloadComplete,
  error,
  onDownload,
  onClose,
}: ExecutionPanelProps) {
  const isTerminal = TERMINAL_STATUSES.has(execution.status);
  const message = summaryMessage(execution.summary);
  const expiresAt = expiryText(execution.expiresAt);
  const canDownload =
    execution.status === "COMPLETED" && execution.artifactAvailable;
  const activeStep = currentStepIndex(execution);

  return (
    <aside
      className="execution-panel"
      aria-labelledby="execution-title"
      aria-busy={!isTerminal}
    >
      <div className="panel-header">
        <div>
          <p className="eyebrow">Execução em memória</p>
          <h2 id="execution-title">{assessmentName}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Fechar painel da execução"
          title={
            isTerminal
              ? "Fechar painel"
              : "Fechar e parar de acompanhar nesta página"
          }
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <div className="execution-meta">
        <StatusBadge status={execution.status} />
        <span className="execution-id" title={execution.executionId}>
          {execution.executionId}
        </span>
      </div>

      <div className="current-stage" aria-live="polite" aria-atomic="true">
        <span className="stage-pulse" aria-hidden="true" />
        <div>
          <span>Etapa atual</span>
          <strong>{displayStage(execution.stage, execution.status)}</strong>
        </div>
      </div>

      <ProgressBar value={execution.progress} />

      <ol className="execution-steps" aria-label="Etapas da execução">
        {EXECUTION_STEPS.map((step, index) => {
          const completed = index < activeStep;
          const current = index === activeStep;
          const stepState = completed
            ? "Concluída"
            : current
              ? "Etapa atual"
              : "Pendente";

          return (
            <li
              key={step.key}
              className={
                completed ? "step-completed" : current ? "step-current" : ""
              }
              aria-current={current ? "step" : undefined}
            >
              <span className="step-marker" aria-hidden="true">
                {completed ? "✓" : index + 1}
              </span>
              <span className="step-copy">
                <strong>{step.label}</strong>
                <small>{stepState}</small>
              </span>
            </li>
          );
        })}
      </ol>

      {message && <p className="summary-message">{message}</p>}

      {error && (
        <div className="notice notice-error" role="alert">
          <strong>Não foi possível atualizar a execução.</strong>
          <span>{error}</span>
        </div>
      )}

      {execution.status === "FAILED" && !error && (
        <div className="notice notice-error" role="alert">
          <strong>A avaliação não pôde ser concluída.</strong>
          <span>Nenhum artefato foi mantido.</span>
        </div>
      )}

      {execution.status === "EXPIRED" && (
        <div className="notice" role="status">
          <strong>Execução expirada.</strong>
          <span>O relatório foi removido da memória do servidor.</span>
        </div>
      )}

      {downloadComplete && (
        <div className="notice notice-success" role="status">
          <strong>Download iniciado.</strong>
          <span>O artefato não permanece armazenado no CloudOps.</span>
        </div>
      )}

      {canDownload && !downloadComplete && (
        <div className="download-block">
          <div>
            <strong>Relatório pronto</strong>
            <span>
              {expiresAt
                ? `Disponível em memória até ${expiresAt}.`
                : "Disponível temporariamente em memória."}
            </span>
          </div>
          <button
            type="button"
            className="button button-primary button-full"
            onClick={onDownload}
            disabled={downloading}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" />
            </svg>
            {downloading ? "Preparando download" : "Baixar relatório"}
          </button>
          <small>Download único · arquivo ZIP · sem cache</small>
        </div>
      )}

      {!isTerminal && (
        <p className="retention-note">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 3 5 6v5c0 4.4 2.8 7.7 7 9 4.2-1.3 7-4.6 7-9V6l-7-3Z" />
            <path d="M9.5 12.2 11.2 14l3.7-4" />
          </svg>
          O progresso existe apenas na memória desta sessão.
        </p>
      )}
    </aside>
  );
}
