import type { AssessmentSummary } from "@cloudops/contracts";
import type { PermissionState } from "../auth/consent";

interface AssessmentCardProps {
  readonly assessment: AssessmentSummary;
  readonly busy?: boolean;
  readonly permissionState?: PermissionState;
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
  permissionState = "READY",
  onExecute,
}: AssessmentCardProps) {
  const unavailable = !assessment.enabled;
  const status = unavailable ? "Indisponível" : permissionState === "ADMIN_APPROVAL_REQUIRED" ? "Admin approval" : permissionState === "CONSENT_REQUIRED" ? "Permissões necessárias" : permissionState === "INTERACTION_REQUIRED" ? "Interação necessária" : "Disponível";

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
          {status}
        </span>
      </div>

      <div className="card-content">
        <h3 id={`assessment-${assessment.id}`}>{assessment.name}</h3>
        <p className="assessment-description">
          {assessment.description ??
            "Execute esta avaliação pelo pipeline seguro e efêmero do CloudOps."}
        </p>

        {assessment.requiredPermissions.length > 0 && (
          <div className="permission-list" aria-label="Permissões necessárias">
              {assessment.requiredPermissions.map((permission) => (
                <code key={permission}>{permission}</code>
              ))}
          </div>
        )}
        {assessment.adminConsentRequired && <span className="admin-approval-badge">Admin approval</span>}
      </div>

      <div className="card-footer">
        <span className="card-source">{assessmentKind(assessment)}</span>
        <button
          id={`execute-${assessment.id}`}
          className="button button-secondary"
          type="button"
          disabled={unavailable || busy}
          aria-label={`Executar ${assessment.name}`}
          onClick={() => onExecute(assessment.id)}
        >
          Executar
          {!busy && <span aria-hidden="true">→</span>}
        </button>
      </div>
    </article>
  );
}
