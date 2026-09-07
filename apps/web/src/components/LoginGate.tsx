import type { CloudOpsAuthState } from "../auth/types";

export function LoginGate({ auth }: { readonly auth: CloudOpsAuthState }) {
  return (
    <section className="login-gate" aria-labelledby="login-gate-title">
      <div className="trust-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M12 2.8 20 6v5.2c0 5.1-3.3 8.9-8 10.3-4.7-1.4-8-5.2-8-10.3V6l8-3.2Z" />
          <path d="M8.5 12h7M12 8.5V15.5" />
        </svg>
      </div>
      <div>
        <p className="eyebrow">Microsoft connection</p>
        <h2 id="login-gate-title">Conecte sua conta Microsoft</h2>
        <p>
          Autentique uma conta organizacional para executar assessments neste
          ambiente. O navegador solicita somente um token destinado à CloudOps
          API.
        </p>
        <button
          type="button"
          className="button button-primary"
          disabled={auth.busy}
          onClick={() => void auth.login()}
        >
          {auth.busy ? "Conectando…" : "Entrar com Microsoft"}
        </button>
        {!auth.configured && (
          <small>
            Configure VITE_ENTRA_WEB_CLIENT_ID e VITE_ENTRA_API_SCOPE para
            habilitar o login.
          </small>
        )}
        {auth.error && (
          <div className="notice notice-error" role="alert">
            <strong>Autenticação não concluída.</strong>
            <span>{auth.error}</span>
          </div>
        )}
      </div>
    </section>
  );
}
