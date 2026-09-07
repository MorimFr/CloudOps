import { NavLink, useNavigate } from "react-router-dom";

import type { CloudOpsAuthState } from "../auth/types";
import {
  CLOUD_PROVIDERS,
  OPERATIONAL_DOMAINS,
  type CloudProvider,
} from "../config/providers";

interface ProviderSidebarProps {
  readonly provider: CloudProvider;
  readonly auth: CloudOpsAuthState;
}

export function ProviderSidebar({ provider, auth }: ProviderSidebarProps) {
  const navigate = useNavigate();
  const isMicrosoft = provider.integration === "microsoft-entra";

  return (
    <aside className="provider-sidebar" aria-label="Navegação CloudOps">
      <NavLink className="brand sidebar-brand" to="/" aria-label="CloudOps — trocar cloud">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" focusable="false">
            <path d="M16 3 27 7.8V15c0 7-4.5 12.1-11 14C9.5 27.1 5 22 5 15V7.8L16 3Z" />
            <path d="m11 16 3.2 3.2L21.5 12" />
          </svg>
        </span>
        <span>CloudOps</span>
      </NavLink>

      <label className="provider-select-label" htmlFor="provider-select">
        Ambiente cloud
      </label>
      <select
        id="provider-select"
        className="provider-select"
        value={provider.id}
        onChange={(event) => navigate(`/${event.target.value}/dashboard`)}
      >
        {CLOUD_PROVIDERS.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>

      <nav className="domain-navigation" aria-label={`Áreas ${provider.name}`}>
        {OPERATIONAL_DOMAINS.map((domain) => (
          <NavLink
            key={domain.id}
            to={`/${provider.id}/${domain.id}`}
            className={({ isActive }) => (isActive ? "active" : undefined)}
          >
            <span aria-hidden="true" className={`nav-icon nav-${domain.id}`} />
            {domain.label}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-account">
        <p className="provider-select-label">Conta conectada</p>
        {isMicrosoft && auth.account ? (
          <>
            <strong>{auth.account.displayName}</strong>
            <span title={auth.account.username}>{auth.account.username}</span>
            <span title={auth.account.tenantId}>
              Tenant {auth.account.tenantId}
            </span>
            <div className="sidebar-actions">
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
          <span>
            {isMicrosoft
              ? "Nenhuma conta Microsoft conectada."
              : `Integração ${provider.shortName} ainda não implementada.`}
          </span>
        )}
      </div>

      <NavLink className="change-cloud-link" to="/">
        ← Trocar cloud
      </NavLink>
    </aside>
  );
}
