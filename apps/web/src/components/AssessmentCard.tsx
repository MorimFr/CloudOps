import { useState } from "react";
import { CisProfileSchema, type AssessmentSummary, type AssessmentExecutionRequest } from "@cloudops/contracts";
import type { PermissionState } from "../auth/consent";
import { AssessmentIcon } from "./AssessmentIcon";

interface AssessmentCardProps {
  readonly assessment: AssessmentSummary;
  readonly busy?: boolean;
  readonly permissionState?: PermissionState;
  readonly onExecute: (assessmentId: string, options?: AssessmentExecutionRequest["options"]) => void;
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
  const [cisProfile, setCisProfile] = useState("");
  const needsCisProfile = assessment.id === "identity-assessment";
  const selectedProfile = CisProfileSchema.safeParse(cisProfile);
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
        {needsCisProfile && (
          <div className="assessment-options">
            <label htmlFor={`profile-${assessment.id}`}>Perfil CIS</label>
            <select id={`profile-${assessment.id}`} value={cisProfile} required disabled={busy || unavailable}
              aria-describedby={`profile-note-${assessment.id}`} onChange={(event) => setCisProfile(event.target.value)}>
              <option value="">Selecione o perfil</option>
              <option value="E3_L1">E3 · Level 1 — 7 controles</option>
              <option value="E3_L2">E3 · Level 2 — 10 controles</option>
              <option value="E5_L1">E5 · Level 1 — 7 controles</option>
              <option value="E5_L2">E5 · Level 2 — 10 controles</option>
            </select>
            <p id={`profile-note-${assessment.id}`}>Wave 1 · cobertura parcial. Escolha o perfil aplicável ao ambiente; as licenças não são detectadas automaticamente.</p>
          </div>
        )}
      </div>

      <div className="card-footer">
        <span className="card-source">{assessment.display?.source ?? assessmentKind(assessment)}</span>
        <button
          id={`execute-${assessment.id}`}
          className="button button-secondary"
          type="button"
          disabled={unavailable || busy || (needsCisProfile && !selectedProfile.success)}
          aria-label={`Executar ${assessment.name}`}
          onClick={() => {
            if (needsCisProfile) {
              if (selectedProfile.success) onExecute(assessment.id, { cisProfile: selectedProfile.data });
            } else onExecute(assessment.id);
          }}
        >
          Executar
          {!busy && <span aria-hidden="true">→</span>}
        </button>
      </div>
    </article>
  );
}
