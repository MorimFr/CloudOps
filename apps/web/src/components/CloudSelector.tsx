import { useNavigate } from "react-router-dom";

import { CLOUD_PROVIDERS } from "../config/providers";

export function CloudSelector() {
  const navigate = useNavigate();

  return (
    <div className="selector-shell">
      <a className="skip-link" href="#cloud-providers">
        Ir para ambientes
      </a>

      <header className="site-header">
        <a className="brand" href="/" aria-label="CloudOps — página inicial">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" focusable="false">
              <path d="M16 3 27 7.8V15c0 7-4.5 12.1-11 14C9.5 27.1 5 22 5 15V7.8L16 3Z" />
              <path d="m11 16 3.2 3.2L21.5 12" />
            </svg>
          </span>
          <span>CloudOps</span>
        </a>
        <div className="header-status" aria-label="Arquitetura com retenção zero">
          <span aria-hidden="true" />
          Zero Retention
        </div>
      </header>

      <main className="selector-main">
        <section className="selector-hero" aria-labelledby="selector-title">
          <p className="eyebrow">Cloud Security Operations Platform</p>
          <h1 id="selector-title">
            Escolha seu <span>ambiente cloud.</span>
          </h1>
          <p>
            Navegue por operações, governança, segurança, custos e engenharia
            com uma arquitetura efêmera e orientada ao provider.
          </p>
        </section>

        <section id="cloud-providers" aria-labelledby="providers-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Multicloud</p>
              <h2 id="providers-title">Selecione um ambiente</h2>
            </div>
            <span className="catalog-count">3 providers</span>
          </div>

          <div className="provider-grid">
            {CLOUD_PROVIDERS.map((provider) => (
              <article className="provider-card" key={provider.id}>
                <div className={`provider-monogram provider-${provider.id}`}>
                  {provider.monogram}
                </div>
                <div className="provider-copy">
                  <p className="assessment-kind">{provider.services}</p>
                  <h3>{provider.name}</h3>
                  <p>
                    {provider.available
                      ? "Identity e operações Microsoft integradas ao CloudOps."
                      : "Shell operacional disponível; integração será adicionada em etapa futura."}
                  </p>
                </div>
                <button
                  type="button"
                  className="button button-secondary button-full"
                  onClick={() => navigate(`/${provider.id}/dashboard`)}
                  aria-label={`Acessar ${provider.name}`}
                >
                  Acessar <span aria-hidden="true">→</span>
                </button>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer>
        <span>CloudOps Multicloud Foundation</span>
        <span>Processamento efêmero · Zero Retention</span>
      </footer>
    </div>
  );
}
