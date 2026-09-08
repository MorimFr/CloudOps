import { classifyIdentityFailure } from "@cloudops/contracts";

export type PermissionState = "READY" | "CONSENT_REQUIRED" | "ADMIN_APPROVAL_REQUIRED" | "INTERACTION_REQUIRED";
export interface AuthIssue {
  readonly state: Exclude<PermissionState, "READY">;
  readonly message: string;
}

export class ConsentInteractionError extends Error {
  constructor(readonly issue: AuthIssue, readonly cancelled = false) {
    super(issue.message);
    this.name = "ConsentInteractionError";
  }
}

export function safeConsentError(error: unknown): ConsentInteractionError {
  if (error instanceof ConsentInteractionError) return error;
  const failure = classifyIdentityFailure(error);
  if (failure === "admin") return new ConsentInteractionError({
    state: "ADMIN_APPROVAL_REQUIRED",
    message: "A política deste tenant exige que um administrador aprove as permissões. A aprovação não concede à conta acesso além de suas próprias autorizações.",
  });
  if (failure === "cancelled") return new ConsentInteractionError({
    state: "CONSENT_REQUIRED",
    message: "Consentimento cancelado. Nenhuma nova execução foi iniciada. Se a Microsoft exibiu uma exigência de aprovação administrativa, solicite essa aprovação ao administrador do tenant.",
  }, true);
  return new ConsentInteractionError({
    state: failure === "consent" ? "CONSENT_REQUIRED" : "INTERACTION_REQUIRED",
    message: "Não foi possível concluir a interação Microsoft. As políticas de consentimento e Conditional Access do tenant continuam sendo respeitadas.",
  });
}
