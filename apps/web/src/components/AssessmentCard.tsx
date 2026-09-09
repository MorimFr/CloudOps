import type { AssessmentSummary } from "@cloudops/contracts";
import type { PermissionState } from "../auth/consent";
import { AssessmentIcon } from "./AssessmentIcon";

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
          <AssessmentIcon icon={assessment.display?.icon} domain={assessment.domain} />
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

        {!!assessment.display?.tags?.length && (
          <div className="assessment-tags" aria-label="Tags da ferramenta">
            {assessment.display.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        )}
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
        <span className="card-source">{assessment.display?.source ?? assessmentKind(assessment)}</span>
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
