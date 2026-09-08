import { useEffect, useRef } from "react";
import type { AuthIssue } from "../auth/consent";

interface ConsentRequiredPanelProps {
  readonly issue: AuthIssue;
  readonly assessmentName?: string;
  readonly returnFocusId?: string;
  readonly permissions: readonly string[];
  readonly busy: boolean;
  readonly retryAvailable: boolean;
  readonly onConsent: () => void;
  readonly onSwitchAccount: () => void;
  readonly onClose: () => void;
}

const TITLES = {
  CONSENT_REQUIRED: "Permissões adicionais necessárias",
  ADMIN_APPROVAL_REQUIRED: "Aprovação administrativa necessária",
  INTERACTION_REQUIRED: "Interação Microsoft necessária",
} as const;

export function ConsentRequiredPanel(props: ConsentRequiredPanelProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previousFocus = (props.returnFocusId ? document.getElementById(props.returnFocusId) : null) ?? document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [props.returnFocusId]);

  const admin = props.issue.state === "ADMIN_APPROVAL_REQUIRED";
  return (
    <dialog ref={dialog} className="consent-dialog" aria-labelledby="consent-title" aria-describedby="consent-description"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const first = buttons[0];
        const last = buttons.at(-1);
        if (!first || !last) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}
      onCancel={(event) => { event.preventDefault(); if (!props.busy) props.onClose(); }}>
      <p className="eyebrow">Microsoft · consentimento delegado</p>
      <h2 id="consent-title">{TITLES[props.issue.state]}</h2>
      {props.assessmentName && <p className="consent-assessment">{props.assessmentName}</p>}
      <p id="consent-description">{props.issue.message}</p>
      {props.permissions.length > 0 && <div className="consent-requirements">
        <h3>Permissões necessárias</h3>
        <ul>{props.permissions.map((permission) => <li key={permission}><code>{permission}</code></li>)}</ul>
      </div>}
      <p className="consent-note">O popup pode listar todas as permissões estáticas configuradas na API, não apenas as deste assessment. Nenhum token Microsoft Graph é enviado ao navegador.</p>
      {!props.retryAvailable && <p className="notice" role="status">A repetição única já foi utilizada. Nenhuma execução será repetida automaticamente. Após resolver a aprovação ou autenticação, feche este painel e escolha Executar novamente.</p>}
      <div className="consent-actions">
        {admin ? <button type="button" className="button button-primary" disabled={props.busy} onClick={props.onSwitchAccount}>Tentar com uma conta administrativa</button>
          : props.retryAvailable && <button type="button" className="button button-primary" disabled={props.busy} onClick={props.onConsent}>
            {props.busy ? "Aguardando Microsoft…" : props.issue.state === "INTERACTION_REQUIRED" ? "Concluir autenticação" : "Conceder permissões"}
          </button>}
        <button type="button" className="button button-secondary" disabled={props.busy} onClick={props.onClose}>Fechar</button>
      </div>
      {admin && <p className="consent-note">A troca de conta não concede aprovação automaticamente. Um administrador autorizado deve aprovar no fluxo Microsoft do tenant; a próxima execução pertencerá à conta conectada.</p>}
    </dialog>
  );
}
