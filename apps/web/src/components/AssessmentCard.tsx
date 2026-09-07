import type { AssessmentSummary } from "@cloudops/contracts";

interface AssessmentCardProps {
  readonly assessment: AssessmentSummary;
  readonly busy?: boolean;
  readonly onExecute: (assessmentId: string) => void;
}

function assessmentKind(assessment: AssessmentSummary): string {
  if (assessment.requiredAuthProvider === "microsoft-graph") {
    return "Microsoft Graph · delegated";
  }

  return assessment.visibility === "development"
    ? "Validação de runtime · desenvolvimento"
    : "Cloud security assessment";
}

export function AssessmentCard({
  assessment,
  busy = false,
  onExecute,
}: AssessmentCardProps) {
  const unavailable = !assessment.enabled;

  return (
    <article
      className="assessment-card"
      aria-labelledby={`assessment-${assessment.id}`}
    >
      <div className="card-topline">
        <span className="assessment-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M12 2.5 20 6v5.2c0 5.1-3.3 8.9-8 10.3-4.7-1.4-8-5.2-8-10.3V6l8-3.5Z" />
            <path d="m8.5 12 2.2 2.2 4.8-5" />
          </svg>
        </span>
        <span
          className={`availability ${assessment.enabled ? "available" : "unavailable"}`}
        >
          {assessment.enabled ? "Disponível" : "Indisponível"}
        </span>
      </div>

      <div className="card-content">
        <p className="assessment-kind">{assessmentKind(assessment)}</p>
        <h3 id={`assessment-${assessment.id}`}>{assessment.name}</h3>
        <p>
          {assessment.description ??
            "Execute esta avaliação pelo pipeline seguro e efêmero do CloudOps."}
        </p>

        {assessment.requiredPermissions.length > 0 && (
          <div className="permission-block">
            <span>Permissões necessárias</span>
            <div className="permission-list">
              {assessment.requiredPermissions.map((permission) => (
                <code key={permission}>{permission}</code>
              ))}
            </div>
            {assessment.adminConsentRequired && (
              <small>Admin consent may be required</small>
            )}
          </div>
        )}
      </div>

      <div className="card-footer">
        <code>{assessment.id}</code>
        <button
          className="button button-secondary"
          type="button"
          disabled={unavailable || busy}
          aria-label={`Executar ${assessment.name}`}
          onClick={() => onExecute(assessment.id)}
        >
          {busy ? "Em execução" : "Executar"}
          {!busy && <span aria-hidden="true">→</span>}
        </button>
      </div>
    </article>
  );
}
