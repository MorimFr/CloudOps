import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AssessmentSummary,
  Execution,
  ExecutionStatus,
} from "@cloudops/contracts";
import {
  CloudOpsApiError,
  createExecution,
  downloadExecutionArtifact,
  getExecution,
  listAssessments,
} from "./api/cloudops";
import { AssessmentCard } from "./components/AssessmentCard";
import {
  ExecutionPanel,
  type ExecutionPanelModel,
} from "./components/ExecutionPanel";

const POLL_INTERVAL_MS = 350;
const MAX_POLL_FAILURES = 3;
const TERMINAL_STATUSES: ReadonlySet<ExecutionStatus> = new Set([
  "COMPLETED",
  "FAILED",
  "EXPIRED",
]);

type CatalogAssessment = AssessmentSummary & {
  description?: string;
};

function humanError(error: unknown): string {
  if (error instanceof CloudOpsApiError) {
    return error.message;
  }

  return "Verifique se a API CloudOps está disponível e tente novamente.";
}

function assessmentDescription(assessment: CatalogAssessment): string {
  if (assessment.description?.trim()) {
    return assessment.description;
  }

  if (assessment.id === "hello-world") {
    return "Valide o fluxo seguro entre navegador, API e PowerShell 7 com um relatório fictício.";
  }

  return "Execute esta avaliação usando o pipeline seguro e efêmero do CloudOps.";
}

function initialExecution(
  executionId: string,
  assessmentId: string,
  status: ExecutionStatus,
): ExecutionPanelModel {
  return {
    executionId,
    assessmentId,
    status,
    stage: null,
    progress: 0,
    summary: undefined,
    artifactAvailable: false,
    expiresAt: null,
  };
}

export function App() {
  const [assessments, setAssessments] = useState<CatalogAssessment[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [execution, setExecution] = useState<ExecutionPanelModel | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [creatingAssessmentId, setCreatingAssessmentId] = useState<string | null>(
    null,
  );
  const [downloading, setDownloading] = useState(false);
  const [downloadComplete, setDownloadComplete] = useState(false);

  const loadCatalog = useCallback(async () => {
    try {
      setAssessments(await listAssessments());
    } catch (error) {
      setCatalogError(humanError(error));
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  const retryCatalog = () => {
    setCatalogLoading(true);
    setCatalogError(null);
    void loadCatalog();
  };

  useEffect(() => {
    // The effect intentionally synchronizes the initial view with the API catalog.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    const executionId = execution?.executionId;
    if (!executionId || TERMINAL_STATUSES.has(execution.status)) {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    let consecutiveFailures = 0;

    const poll = async () => {
      try {
        const latest: Execution = await getExecution(executionId);
        if (cancelled) {
          return;
        }

        consecutiveFailures = 0;
        setExecutionError(null);
        setExecution(latest);

        if (!TERMINAL_STATUSES.has(latest.status)) {
          timer = window.setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        consecutiveFailures += 1;
        if (consecutiveFailures < MAX_POLL_FAILURES) {
          timer = window.setTimeout(poll, POLL_INTERVAL_MS * 2);
          return;
        }

        setExecutionError(humanError(error));
      }
    };

    timer = window.setTimeout(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
    // A single polling loop owns an execution until it reaches a terminal state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execution?.executionId]);

  const activeAssessment = useMemo(
    () =>
      assessments.find((item) => item.id === execution?.assessmentId) ?? null,
    [assessments, execution?.assessmentId],
  );

  const hasActiveExecution =
    execution !== null && !TERMINAL_STATUSES.has(execution.status);

  const runAssessment = async (assessmentId: string) => {
    setCreatingAssessmentId(assessmentId);
    setExecutionError(null);
    setDownloadComplete(false);

    try {
      const created = await createExecution({ assessmentId, options: {} });
      setExecution(
        initialExecution(created.executionId, assessmentId, created.status),
      );
    } catch (error) {
      setExecutionError(humanError(error));
    } finally {
      setCreatingAssessmentId(null);
    }
  };

  const downloadArtifact = async () => {
    if (!execution?.artifactAvailable) {
      return;
    }

    setDownloading(true);
    setExecutionError(null);

    try {
      await downloadExecutionArtifact(execution.executionId);
      setExecution((current) =>
        current ? { ...current, artifactAvailable: false } : current,
      );
      setDownloadComplete(true);
    } catch (error) {
      setExecutionError(humanError(error));
    } finally {
      setDownloading(false);
    }
  };

  const closeExecution = () => {
    setExecution(null);
    setExecutionError(null);
    setDownloadComplete(false);
    setDownloading(false);
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#assessments">
        Ir para avaliações
      </a>

      <header className="site-header">
        <a className="brand" href="/" aria-label="CloudOps — página inicial">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" focusable="false">
              <path d="M16 3 27 7.8V15c0 7-4.5 12.1-11 14C9.5 27.1 5 22 5 15V7.8L16 3Z" />
              <path d="m11 16 3.2 3.2L21.5 12" />
            </svg>
          </span>
          <span>CloudOps</span>
        </a>
        <div className="header-status" aria-label="Arquitetura com retenção zero">
          <span aria-hidden="true" />
          Zero Retention
        </div>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">Security Assessment Platform</p>
            <h1 id="hero-title">
              Segurança em nuvem,
              <span> evidência sob controle.</span>
            </h1>
            <p className="hero-description">
              Execute avaliações de postura com uma arquitetura efêmera. Os dados
              existem apenas durante o processamento e o download escolhido por
              você.
            </p>
          </div>

          <div className="trust-card" aria-label="Princípios de privacidade">
            <div className="trust-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M12 2.8 20 6v5.2c0 5.1-3.3 8.9-8 10.3-4.7-1.4-8-5.2-8-10.3V6l8-3.2Z" />
                <path d="M9 12.3 11 14l4-4.5" />
              </svg>
            </div>
            <div>
              <strong>RAM only</strong>
              <span>Sem banco, storage ou cache persistente</span>
            </div>
          </div>
        </section>

        <section className="assessments-section" id="assessments" aria-labelledby="assessments-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Catálogo</p>
              <h2 id="assessments-title">Avaliações</h2>
            </div>
            {!catalogLoading && !catalogError && (
              <span className="catalog-count">
                {assessments.length} {assessments.length === 1 ? "avaliação" : "avaliações"}
              </span>
            )}
          </div>

          {catalogError && (
            <div className="catalog-error" role="alert">
              <div>
                <strong>Não foi possível carregar o catálogo.</strong>
                <span>{catalogError}</span>
              </div>
              <button className="button button-secondary" type="button" onClick={retryCatalog}>
                Tentar novamente
              </button>
            </div>
          )}

          {catalogLoading ? (
            <div className="assessment-grid" aria-label="Carregando avaliações" aria-busy="true">
              <div className="assessment-skeleton" />
              <div className="assessment-skeleton" />
            </div>
          ) : (
            <div className="assessment-grid">
              {assessments.map((assessment) => (
                <AssessmentCard
                  key={assessment.id}
                  id={assessment.id}
                  name={assessment.name}
                  description={assessmentDescription(assessment)}
                  enabled={assessment.enabled}
                  busy={
                    creatingAssessmentId === assessment.id ||
                    (hasActiveExecution && execution?.assessmentId === assessment.id)
                  }
                  onExecute={(id) => void runAssessment(id)}
                />
              ))}
            </div>
          )}

          {!catalogLoading && !catalogError && assessments.length === 0 && (
            <div className="empty-state">
              <strong>Nenhuma avaliação disponível.</strong>
              <span>O catálogo da API está vazio no momento.</span>
            </div>
          )}
        </section>
      </main>

      <footer>
        <span>CloudOps Foundation</span>
        <span>Processamento efêmero · PowerShell 7</span>
      </footer>

      {execution && (
        <ExecutionPanel
          execution={execution}
          assessmentName={activeAssessment?.name ?? execution.assessmentId}
          downloading={downloading}
          downloadComplete={downloadComplete}
          error={executionError}
          onDownload={() => void downloadArtifact()}
          onClose={closeExecution}
        />
      )}

      {!execution && executionError && (
        <div className="toast-error" role="alert">
          <div>
            <strong>Não foi possível iniciar a avaliação.</strong>
            <span>{executionError}</span>
          </div>
          <button type="button" onClick={() => setExecutionError(null)} aria-label="Fechar aviso">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
