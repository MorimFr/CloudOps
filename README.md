# CloudOps v2

CloudOps é uma fundação multicloud para security assessments com processamento efêmero. A aplicação combina React, Fastify, Microsoft Entra multitenant e PowerShell 7 sem banco, storage, Redis, fila persistente ou arquivos temporários de assessment.

Esta etapa entrega:

- Cloud Selector para Microsoft Azure, AWS e GCP;
- shell com Dashboard, GovOps, SecOps, FinOps e DevOps em todas as clouds;
- autenticação Microsoft Entra para contas de qualquer diretório organizacional;
- validação criptográfica do access token da CloudOps API;
- On-Behalf-Of (OBO) para Microsoft Graph;
- assessment real `microsoft-graph-connectivity`, com delegated `User.Read`;
- `hello-world` preservado como assessment de desenvolvimento e regressão;
- ZIP em RAM, download único, TTL e limpeza best-effort de buffers.

## Fluxo

```text
Browser
  -> MSAL (CloudOps API token, memoryStorage)
  -> CloudOps API (Bearer validation + execution ownership)
  -> Entra OBO (tenant validado + scopes do registry)
  -> Microsoft Graph token
  -> pwsh via stdin
  -> Microsoft Graph REST /v1.0
  -> ZIP em RAM
  -> browser
  -> download único
```

O navegador nunca recebe um token do Microsoft Graph. O processo PowerShell nunca faz login interativo. O token Graph segue somente pelo `stdin` do processo filho e perde suas referências ativas assim que possível.

## Início rápido

Requisitos:

- Docker com Compose v2;
- dois App Registrations Microsoft Entra configurados conforme [docs/entra-setup.md](docs/entra-setup.md).

```powershell
Copy-Item .env.example .env
```

Preencha no `.env` os IDs dos apps, o scope da API e o client secret local. Depois:

```powershell
docker compose up --build
```

Abra `http://localhost:5173`, escolha **Microsoft Azure**, faça login e navegue até **SecOps → Microsoft Graph Connectivity**.

Endpoints locais:

- Web: `http://localhost:5173`
- API: `http://localhost:3000`
- Health público: `http://localhost:3000/api/v1/health`

Todas as rotas de catálogo e execução exigem um token destinado à CloudOps API.

## Configuração

```dotenv
VITE_ENTRA_WEB_CLIENT_ID=<CloudOps Web Dev client ID>
VITE_ENTRA_API_SCOPE=api://<CloudOps API Dev client ID>/Assessment.Run
CLOUDOPS_ENTRA_API_CLIENT_ID=<CloudOps API Dev client ID>
CLOUDOPS_ENTRA_API_CLIENT_SECRET=<secret apenas para desenvolvimento local>
```

Não use um tenant ID fixo. A authority do browser é `organizations`; a API deriva e valida o tenant a partir do token assinado. Toda variável `VITE_*` é pública e jamais deve conter secret.

O `CLOUDOPS_ENTRA_API_CLIENT_SECRET` é aceitável somente no desenvolvimento local. Produção deve usar certificado ou outra credencial de confidential client mais forte.

## Validação

```powershell
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
```

Testes do engine no PowerShell 7:

```powershell
pwsh -NoLogo -NoProfile -NonInteractive -File ./engine/tests/Validate-GraphModule.ps1
pwsh -NoLogo -NoProfile -NonInteractive -File ./engine/tests/Validate-HelloWorld.ps1
```

O E2E HTTP do Hello World agora também é autenticado. Com os containers ativos, forneça um token válido da CloudOps API usando o prompt protegido descrito em [Desenvolvimento local — Hello World](docs/local-development.md#hello-world). Não cole o token em um comando literal que possa entrar no histórico do shell.

O CI não recebe credenciais: executa testes criptográficos locais de auth/OBO, build da imagem e os testes PowerShell sem rede. O Graph E2E real é deliberadamente manual.

## Zero Retention

- tokens MSAL, token da API, token OBO/Graph e dados Graph permanecem somente em RAM;
- MSAL Browser LTS usa `memoryStorage` para tokens e cache temporário OAuth, sem cookies ou migração de cache;
- cada troca OBO cria um confidential client efêmero, usa `skipCache`, limpa seu cache e não mantém Graph token entre requests;
- a aquisição OBO tem deadline configurável e libera a capacidade reservada em timeout;
- estado e ownership de executions vivem em um `Map`;
- Graph responses são processadas em memória e não entram em `publicMetrics`;
- o ZIP é consumido no primeiro download ou eliminado pelo TTL;
- buffers controlados são sobrescritos em best-effort;
- o Compose não possui volume de dados e o runtime usa filesystem read-only.

O arquivo que o usuário escolhe baixar é a única persistência intencional.

## Estrutura

```text
apps/
|-- api/                         # Fastify, Entra, OBO e executions em RAM
`-- web/                         # React, Router, MSAL e shell multicloud
packages/contracts/              # schemas HTTP e protocolo interno
engine/
|-- shared/CloudOps.Graph.psm1   # Graph REST, retry, paginação e host pinning
|-- microsoft-graph-connectivity/
|-- hello-world/
`-- tests/
docker/runtime.Dockerfile        # Node 24.20.0 + PowerShell 7.6.5
docs/
```

## Documentação

- [Arquitetura](docs/architecture.md)
- [Arquitetura multicloud](docs/multicloud-architecture.md)
- [Microsoft Entra — configuração exata](docs/entra-setup.md)
- [Autenticação e OBO](docs/authentication.md)
- [Microsoft Graph](docs/microsoft-graph.md)
- [Zero Retention](docs/zero-retention.md)
- [Contrato de assessments](docs/assessment-contract.md)
- [Desenvolvimento de assessments](docs/assessment-development.md)
- [Desenvolvimento local](docs/local-development.md)
- [Resultados da validação local](docs/validation-report.md)

## Limitações atuais

AWS e GCP possuem shell/navegação, sem autenticação ou APIs. Não estão implementados Inactive Users, Privileged Role Auditor, Secure Score, Conditional Access Assessment, deployment Azure, Bicep, Key Vault, database, storage ou n8n. O único acesso Graph atual é delegated `User.Read`, usado para validar `/me`.
