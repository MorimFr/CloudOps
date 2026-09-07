import type {
  Execution,
  ExecutionStatus,
  PublicMetrics,
} from "@cloudops/contracts";
import { ProgressBar } from "./ProgressBar";
import { StatusBadge } from "./StatusBadge";

export type ExecutionPanelModel = Pick<
  Execution,
  | "executionId"
  | "assessmentId"
  | "status"
  | "stage"
  | "progress"
  | "publicMetrics"
  | "artifactAvailable"
  | "expiresAt"
>;

interface ExecutionPanelProps {
  readonly execution: ExecutionPanelModel;
  readonly assessmentName: string;
  readonly downloading: boolean;
  readonly downloadComplete: boolean;
  readonly error: string | null;
  readonly onDownload: () => void;
  readonly onClose: () => void;
}

const STAGE_LABELS: Record<string, string> = {
  INITIALIZING: "Preparando ambiente",
  AUTHENTICATING: "Validando acesso delegado",
  PROCESSING: "Processando avaliação",
  QUERYING_GRAPH: "Consultando Microsoft Graph",
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
  { key: "AUTHENTICATING", label: "Autenticando" },
  { key: "PROCESSING", label: "Processando" },
  { key: "GENERATING_REPORT", label: "Gerando relatório" },
  { key: "COMPLETED", label: "Concluído" },
] as const;

const STAGE_STEP: Record<string, number> = {
  INITIALIZING: 0,
  AUTHENTICATING: 1,
  PROCESSING: 2,
  QUERYING_GRAPH: 2,
  GENERATING_REPORT: 3,
  COMPLETED: 4,
};

const FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  GRAPH_CONSENT_REQUIRED:
    "O tenant ainda não concedeu uma ou mais permissões exigidas por este assessment.",
  GRAPH_INSUFFICIENT_PRIVILEGES:
    "A operação pode exigir delegated permission, consentimento ou autorização adicional da conta.",
  GRAPH_AUTHENTICATION_FAILED:
    "Não foi possível validar o acesso delegado ao Microsoft Graph.",
  GRAPH_THROTTLED:
    "O Microsoft Graph limitou as requisições. Aguarde antes de tentar novamente.",
  GRAPH_UNAVAILABLE:
    "O Microsoft Graph está temporariamente indisponível.",
};

function currentStepIndex(execution: ExecutionPanelModel): number {
  if (execution.status === "COMPLETED") {
    return EXECUTION_STEPS.length;
  }

  return execution.stage ? (STAGE_STEP[execution.stage] ?? 0) : 0;
}

function displayStage(stage: string | null, status: ExecutionStatus): string {
  if (stage && STAGE_LABELS[stage]) {
    return STAGE_LABELS[stage];
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

  return status === "COMPLETED"
    ? "Relatório concluído"
    : "Processando avaliação";
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

function PublicMetricsView({ metrics }: { readonly metrics: PublicMetrics }) {
  const entries = [
    metrics.graphReachable === undefined
      ? null
      : {
          key: "graphReachable",
          label: "Microsoft Graph",
          value: metrics.graphReachable ? "Acessível" : "Indisponível",
        },
    metrics.requestsCompleted === undefined
      ? null
      : {
          key: "requestsCompleted",
          label: "Requisições",
          value: metrics.requestsCompleted.toLocaleString("pt-BR"),
        },
    metrics.objectsAnalyzed === undefined
      ? null
      : {
          key: "objectsAnalyzed",
          label: "Objetos analisados",
          value: metrics.objectsAnalyzed.toLocaleString("pt-BR"),
        },
    metrics.findings === undefined
      ? null
      : {
          key: "findings",
          label: "Findings",
          value: metrics.findings.toLocaleString("pt-BR"),
        },
  ].filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  if (entries.length === 0) {
    return null;
  }

  return (
    <dl className="public-metrics" aria-label="Métricas públicas agregadas">
      {entries.map((entry) => (
        <div key={entry.key}>
          <dt>{entry.label}</dt>
          <dd>{entry.value}</dd>
        </div>
      ))}
    </dl>
  );
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
  const expiresAt = expiryText(execution.expiresAt);
  const canDownload =
    execution.status === "COMPLETED" && execution.artifactAvailable;
  const activeStep = currentStepIndex(execution);
  const failureMessage =
    execution.status === "FAILED" && execution.stage
      ? FAILURE_MESSAGES[execution.stage]
      : undefined;

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
          disabled={!isTerminal}
          aria-label="Fechar painel da execução"
          title={isTerminal ? "Fechar painel" : "A execução ainda está ativa"}
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

      {execution.publicMetrics && (
        <PublicMetricsView metrics={execution.publicMetrics} />
      )}

      {error && (
        <div className="notice notice-error" role="alert">
          <strong>Não foi possível atualizar a execução.</strong>
          <span>{error}</span>
        </div>
      )}

      {execution.status === "FAILED" && !error && (
        <div className="notice notice-error" role="alert">
          <strong>A avaliação não pôde ser concluída.</strong>
          <span>
            {failureMessage
              ? `${failureMessage} Nenhum artefato foi mantido.`
              : "Nenhum artefato foi mantido."}
          </span>
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
