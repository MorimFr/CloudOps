import { useEffect, useMemo, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useParams,
} from "react-router-dom";
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
import { useCloudOpsAuth } from "./auth/useCloudOpsAuth";
import type { CloudOpsAuthState } from "./auth/types";
import { AssessmentCard } from "./components/AssessmentCard";
import { CloudSelector } from "./components/CloudSelector";
import {
  ExecutionPanel,
  type ExecutionPanelModel,
} from "./components/ExecutionPanel";
import { LoginGate } from "./components/LoginGate";
import { ProviderSidebar } from "./components/ProviderSidebar";
import {
  cloudProviderById,
  isCloudProviderId,
  isOperationalDomainId,
  operationalDomainById,
  type CloudProvider,
  type OperationalDomainId,
} from "./config/providers";

const POLL_INTERVAL_MS = 350;
const MAX_POLL_FAILURES = 3;
const TERMINAL_STATUSES: ReadonlySet<ExecutionStatus> = new Set([
  "COMPLETED",
  "FAILED",
  "EXPIRED",
]);

const SAFE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  AUTHENTICATION_REQUIRED:
    "Conecte novamente sua conta Microsoft para continuar.",
  INVALID_API_TOKEN:
    "A sessão da CloudOps API não é mais válida. Entre novamente.",
  INSUFFICIENT_API_SCOPE:
    "O token não possui a permissão Assessment.Run exigida pela CloudOps API.",
  AUTH_INTERACTION_REQUIRED:
    "A política do tenant exige interação adicional. Conclua o login e tente novamente.",
  GRAPH_CONSENT_REQUIRED:
    "O tenant ainda não concedeu uma ou mais permissões exigidas por este assessment.",
  GRAPH_INSUFFICIENT_PRIVILEGES:
    "O Microsoft Graph recusou a operação. Pode faltar permissão delegada, consentimento ou autorização da conta.",
  GRAPH_AUTHENTICATION_FAILED:
    "Não foi possível obter acesso delegado ao Microsoft Graph.",
  GRAPH_THROTTLED:
    "O Microsoft Graph limitou temporariamente as requisições. Aguarde e tente novamente.",
  GRAPH_UNAVAILABLE:
    "O Microsoft Graph está temporariamente indisponível. Tente novamente.",
};

type CatalogState =
  | { readonly status: "loading"; readonly assessments: AssessmentSummary[] }
  | { readonly status: "ready"; readonly assessments: AssessmentSummary[] }
  | {
      readonly status: "error";
      readonly assessments: AssessmentSummary[];
      readonly message: string;
    };

function humanError(error: unknown): string {
  if (error instanceof CloudOpsApiError) {
    return SAFE_ERROR_MESSAGES[error.code] ?? error.message;
  }

  return "Verifique se a API CloudOps está disponível e tente novamente.";
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
    publicMetrics: undefined,
    artifactAvailable: false,
    expiresAt: null,
  };
}

function showDevelopmentAssessments(): boolean {
  return (
    import.meta.env.DEV &&
    import.meta.env.VITE_SHOW_DEV_ASSESSMENTS?.trim().toLowerCase() === "true"
  );
}

function MicrosoftConnection({ auth }: { readonly auth: CloudOpsAuthState }) {
  return (
    <section
      className="connection-card"
      aria-labelledby="microsoft-connection-title"
    >
      <div className="connection-heading">
        <div>
          <p className="eyebrow">Identity plane</p>
          <h2 id="microsoft-connection-title">Microsoft connection</h2>
        </div>
        <span
          className={`availability ${auth.authenticated ? "available" : "unavailable"}`}
        >
          {auth.authenticated ? "Authenticated" : "Not authenticated"}
        </span>
      </div>

      {auth.account ? (
        <>
          <dl className="connection-details">
            <div>
              <dt>Account</dt>
              <dd>{auth.account.displayName}</dd>
              <dd className="muted-value">{auth.account.username}</dd>
            </div>
            <div>
              <dt>Tenant</dt>
              <dd>{auth.account.tenantId}</dd>
            </div>
          </dl>
          <div className="connection-actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={auth.busy}
              onClick={() => void auth.switchAccount()}
            >
              Trocar conta
            </button>
            <button
              type="button"
              className="button button-quiet"
              disabled={auth.busy}
              onClick={() => void auth.logout()}
            >
              Sair
            </button>
          </div>
        </>
      ) : (
        <p className="connection-description">
          Nenhuma informação de conta ou tenant é persistida pelo CloudOps.
        </p>
      )}
    </section>
  );
}

interface ProviderWorkspaceProps {
  readonly provider: CloudProvider;
  readonly domainId: OperationalDomainId;
  readonly auth: CloudOpsAuthState;
}

function ProviderWorkspace({
  provider,
  domainId,
  auth,
}: ProviderWorkspaceProps) {
  const domain = operationalDomainById(domainId);
  const requiresMicrosoft = provider.integration === "microsoft-entra";
  const [catalog, setCatalog] = useState<CatalogState>({
    status: "loading",
    assessments: [],
  });
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [execution, setExecution] = useState<ExecutionPanelModel | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [creatingAssessmentId, setCreatingAssessmentId] = useState<
    string | null
  >(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadComplete, setDownloadComplete] = useState(false);

  useEffect(() => {
    if (!requiresMicrosoft || !auth.authenticated) {
      return;
    }

    let current = true;

    void listAssessments(auth.getApiAccessToken)
      .then((assessments) => {
        if (current) {
          setCatalog({ status: "ready", assessments });
        }
      })
      .catch((error: unknown) => {
        if (current) {
          setCatalog({
            status: "error",
            assessments: [],
            message: humanError(error),
          });
        }
      });

    return () => {
      current = false;
    };
  }, [
    auth.authenticated,
    auth.getApiAccessToken,
    catalogAttempt,
    requiresMicrosoft,
  ]);

  useEffect(() => {
    const executionId = execution?.executionId;
    if (
      !executionId ||
      TERMINAL_STATUSES.has(execution.status) ||
      !auth.authenticated
    ) {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    let consecutiveFailures = 0;

    const poll = async () => {
      try {
        const latest: Execution = await getExecution(
          executionId,
          auth.getApiAccessToken,
        );
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
  }, [
    auth.authenticated,
    auth.getApiAccessToken,
    execution?.executionId,
    execution?.status,
  ]);

  const visibleAssessments = useMemo(
    () =>
      catalog.assessments.filter(
        (assessment) =>
          assessment.provider === provider.id &&
          assessment.domain === domainId &&
          (assessment.visibility === "public" ||
            (assessment.visibility === "development" &&
              showDevelopmentAssessments())),
      ),
    [catalog.assessments, domainId, provider.id],
  );

  const activeAssessment = useMemo(
    () =>
      catalog.assessments.find(
        (assessment) => assessment.id === execution?.assessmentId,
      ) ?? null,
    [catalog.assessments, execution?.assessmentId],
  );

  const hasActiveExecution =
    execution !== null && !TERMINAL_STATUSES.has(execution.status);

  const runAssessment = async (assessmentId: string) => {
    if (!auth.authenticated) {
      setExecutionError(
        "Conecte sua conta Microsoft antes de iniciar a avaliação.",
      );
      return;
    }

    setCreatingAssessmentId(assessmentId);
    setExecutionError(null);
    setDownloadComplete(false);

    try {
      const created = await createExecution(
        { assessmentId, options: {} },
        auth.getApiAccessToken,
      );
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
    if (!execution?.artifactAvailable || !auth.authenticated) {
      return;
    }

    setDownloading(true);
    setExecutionError(null);

    try {
      await downloadExecutionArtifact(
        execution.executionId,
        auth.getApiAccessToken,
      );
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
    <div className="provider-layout">
      <ProviderSidebar provider={provider} auth={auth} />

      <div className="provider-workspace">
        <a className="skip-link" href="#workspace-content">
          Ir para conteúdo
        </a>

        <header className="workspace-header">
          <div>
            <p className="workspace-context">{provider.name}</p>
            <strong>{domain.label}</strong>
          </div>
          <div className="header-status" aria-label="Arquitetura com retenção zero">
            <span aria-hidden="true" />
            Zero Retention
          </div>
        </header>

        <main id="workspace-content" className="workspace-main">
          <section className="workspace-hero" aria-labelledby="workspace-title">
            <p className="eyebrow">{provider.services}</p>
            <h1 id="workspace-title">{domain.label}</h1>
            <p>{domain.description}</p>
          </section>

          {requiresMicrosoft && domainId === "dashboard" && (
            <MicrosoftConnection auth={auth} />
          )}

          {!provider.available && (
            <div className="integration-notice" role="status">
              <strong>
                Integração {provider.shortName} ainda não implementada.
              </strong>
              <span>
                A navegação multicloud está pronta; autenticação e APIs deste
                provider serão conectadas em uma etapa futura.
              </span>
            </div>
          )}

          {requiresMicrosoft && !auth.authenticated && <LoginGate auth={auth} />}

          {(!requiresMicrosoft || auth.authenticated) && (
            <section
              className="assessments-section workspace-assessments"
              aria-labelledby="assessments-title"
            >
            <div className="section-heading">
              <div>
                <p className="eyebrow">Catálogo dinâmico</p>
                <h2 id="assessments-title">Assessments</h2>
              </div>
              {requiresMicrosoft &&
                auth.authenticated &&
                catalog.status === "ready" && (
                  <span className="catalog-count">
                    {visibleAssessments.length}{" "}
                    {visibleAssessments.length === 1
                      ? "assessment"
                      : "assessments"}
                  </span>
                )}
            </div>

            {requiresMicrosoft &&
              auth.authenticated &&
              catalog.status === "error" && (
                <div className="catalog-error" role="alert">
                  <div>
                    <strong>Não foi possível carregar o catálogo.</strong>
                    <span>{catalog.message}</span>
                  </div>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => {
                      setCatalog({ status: "loading", assessments: [] });
                      setCatalogAttempt((attempt) => attempt + 1);
                    }}
                  >
                    Tentar novamente
                  </button>
                </div>
              )}

            {requiresMicrosoft &&
            auth.authenticated &&
            catalog.status === "loading" ? (
              <div
                className="assessment-grid"
                aria-label="Carregando assessments"
                aria-busy="true"
              >
                <div className="assessment-skeleton" />
                <div className="assessment-skeleton" />
              </div>
            ) : (
              requiresMicrosoft &&
              auth.authenticated &&
              catalog.status === "ready" &&
              visibleAssessments.length > 0 && (
                <div className="assessment-grid">
                  {visibleAssessments.map((assessment) => (
                    <AssessmentCard
                      key={assessment.id}
                      assessment={assessment}
                      busy={creatingAssessmentId !== null || hasActiveExecution}
                      onExecute={(id) => void runAssessment(id)}
                    />
                  ))}
                </div>
              )
            )}

            {(!requiresMicrosoft ||
              (catalog.status === "ready" &&
                visibleAssessments.length === 0)) && (
              <div className="empty-state">
                <strong>
                  Nenhum assessment disponível nesta categoria ainda.
                </strong>
                <span>
                  Novos assessments aparecem aqui a partir do registry da API.
                </span>
              </div>
            )}
            </section>
          )}
        </main>

        <footer className="workspace-footer">
          <span>CloudOps Multicloud Foundation</span>
          <span>PowerShell 7 · processamento efêmero</span>
        </footer>
      </div>

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
          <button
            type="button"
            onClick={() => setExecutionError(null)}
            aria-label="Fechar aviso"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function ProviderRoute() {
  const { providerId = "", domainId = "" } = useParams();
  const auth = useCloudOpsAuth();

  if (
    !isCloudProviderId(providerId) ||
    !isOperationalDomainId(domainId)
  ) {
    return <Navigate replace to="/" />;
  }

  const provider = cloudProviderById(providerId);
  return (
    <ProviderWorkspace
      key={`${provider.id}:${auth.sessionEpoch}:${auth.authenticated}`}
      provider={provider}
      domainId={domainId}
      auth={auth}
    />
  );
}

function ProviderDashboardRedirect() {
  const { providerId = "" } = useParams();
  return isCloudProviderId(providerId) ? (
    <Navigate replace to={`/${providerId}/dashboard`} />
  ) : (
    <Navigate replace to="/" />
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<CloudSelector />} />
      <Route path="/:providerId" element={<ProviderDashboardRedirect />} />
      <Route path="/:providerId/:domainId" element={<ProviderRoute />} />
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  );
}
