import { useEffect, useRef, useState } from "react";
import { classifyIdentityFailure, type AssessmentSummary, type CreateExecutionResponse, type AssessmentExecutionRequest } from "@cloudops/contracts";
import { CloudOpsApiError, createExecution, type AuthenticationRetryBudget } from "../api/cloudops";
import { safeConsentError, type AuthIssue } from "./consent";
import type { ApiAccessTokenProvider, CloudOpsAuthState } from "./types";

export interface PendingConsent extends AuthIssue {
  readonly assessment: AssessmentSummary;
  readonly options: AssessmentExecutionRequest["options"];
  readonly retryAvailable: boolean;
}

function permissionIssue(error: unknown): AuthIssue | null {
  if (!(error instanceof CloudOpsApiError)) {
    // Normal token acquisition can also surface an explicit Microsoft consent
    // signal, e.g. after the tenant changes its policy between requests.
    return classifyIdentityFailure(error) ? safeConsentError(error).issue : null;
  }
  if (error.code === "GRAPH_CONSENT_REQUIRED") return {
    state: "CONSENT_REQUIRED",
    message: "O tenant ainda não concedeu todas as permissões deste assessment. Revise o consentimento Microsoft para continuar.",
  };
  if (error.code === "ADMIN_APPROVAL_REQUIRED") return {
    state: "ADMIN_APPROVAL_REQUIRED",
    message: "Este assessment depende de permissões que a política deste tenant exige que um administrador aprove.",
  };
  if (error.code === "AUTH_INTERACTION_REQUIRED") return {
    state: "INTERACTION_REQUIRED",
    message: "A Microsoft exige interação adicional. Conclua a autenticação antes de iniciar uma nova tentativa.",
  };
  return null;
}

export function useAssessmentLaunch(
  auth: CloudOpsAuthState,
  onCreated: (created: CreateExecutionResponse, assessmentId: string) => void,
  onError: (error: unknown) => void,
) {
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [consent, setConsent] = useState<PendingConsent | null>(null);
  const [consenting, setConsenting] = useState(false);
  const mounted = useRef(true);
  const locked = useRef(false);
  const budget = useRef<AuthenticationRetryBudget>({ remaining: 1 });
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const attempt = async (assessment: AssessmentSummary, options: AssessmentExecutionRequest["options"], tokenProvider: ApiAccessTokenProvider) => {
    setCreatingId(assessment.id);
    try {
      const created = await createExecution({ assessmentId: assessment.id, options }, tokenProvider, budget.current);
      if (mounted.current) {
        setConsent(null);
        onCreated(created, assessment.id);
      }
    } catch (error) {
      if (!mounted.current) return;
      const issue = permissionIssue(error);
      if (issue) {
        setConsent({ ...issue, assessment, options, retryAvailable: budget.current.remaining > 0 });
      } else {
        onError(error);
      }
    } finally {
      if (mounted.current) setCreatingId(null);
    }
  };

  const launch = async (assessment: AssessmentSummary, options: AssessmentExecutionRequest["options"] = {}) => {
    if (locked.current || !auth.authenticated || !assessment.enabled) return;
    locked.current = true;
    budget.current = { remaining: 1 };
    setConsent(null);
    try { await attempt(assessment, structuredClone(options), auth.getApiAccessToken); }
    finally { locked.current = false; }
  };

  const recover = async () => {
    if (!consent || locked.current || budget.current.remaining === 0) return;
    locked.current = true;
    setConsenting(true);
    try {
      if (consent.state === "INTERACTION_REQUIRED") {
        // No blind operation retry after an exhausted Conditional Access challenge.
        // A subsequent explicit execution starts a new logical attempt.
        await auth.getApiAccessToken({ interactive: true, forceRefresh: true });
      } else {
        await auth.requestCombinedConsent();
      }
      if (!mounted.current) return;
      budget.current.remaining = 0;
      setConsent((current) => current ? { ...current, retryAvailable: false } : null);
      await attempt(consent.assessment, consent.options, (request) => auth.getApiAccessToken({ ...request, forceRefresh: true }));
    } catch (reason) {
      if (!mounted.current) return;
      const safe = safeConsentError(reason);
      setConsent({ ...safe.issue, assessment: consent.assessment, options: consent.options, retryAvailable: budget.current.remaining > 0 });
    } finally {
      locked.current = false;
      if (mounted.current) setConsenting(false);
    }
  };

  return {
    creatingId, consent, consenting, launch, recover,
    dismissConsent: () => { if (!locked.current) setConsent(null); },
  };
}
