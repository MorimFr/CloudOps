# CloudOps v2

CloudOps é uma fundação multicloud para security assessments com processamento efêmero. A aplicação combina React, Fastify, Microsoft Entra multitenant e PowerShell 7 sem banco, storage, Redis, fila persistente ou arquivos temporários de assessment.

Esta etapa entrega:

- Cloud Selector para Microsoft Azure, AWS e GCP;
- shell com Dashboard, GovOps, SecOps, FinOps e DevOps em todas as clouds;
- autenticação Microsoft Entra para contas de qualquer diretório organizacional;
- onboarding/reconsentimento combinado, separado do token normal `Assessment.Run`;
- validação criptográfica do access token da CloudOps API, incluindo `azp` do Web autorizado;
- catálogo `provider → domain → module → assessment`, cards compactos e temas Azure/AWS/GCP;
- assessments autodescritivos: `engine/<id>/assessment.json`, schema estrito e descoberta no startup, sem lista duplicada no backend;
- diálogo de consentimento separado, com repetição única e estado de aprovação administrativa;
- On-Behalf-Of (OBO) para Microsoft Graph;
- assessment real `microsoft-graph-connectivity`, com delegated `User.Read`;
- **Mapear Usuários Inativos**: relatório executivo HTML offline e CSV de inativos, com paginação dimensionada para ambientes de aproximadamente 200 mil usuários;
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

Abra `http://localhost:5173`, escolha **Microsoft Azure**, faça login e navegue até **SecOps → Conectividade e diagnóstico → Microsoft Graph Connectivity**. O drawer de execução aprovado foi preservado.

Para a nova ferramenta, abra **SecOps → Visibilidade de segurança de identidade → Mapear Usuários Inativos**. Configure antes as permissões administrativas de leitura descritas em [Usuários inativos](docs/inactive-users.md). Contas sem sucesso registrado aguardam 90 dias desde a criação; o CSV exclui contas recentes e indeterminadas.

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
CLOUDOPS_ENTRA_WEB_CLIENT_ID=<mesmo client ID do Web acima>
CLOUDOPS_ENTRA_API_CLIENT_SECRET=<secret apenas para desenvolvimento local>
```

Não use um tenant ID fixo. A authority do browser é `organizations`; a API deriva e valida o tenant a partir do token assinado. Toda variável `VITE_*` é pública e jamais deve conter secret.

O `CLOUDOPS_ENTRA_API_CLIENT_SECRET` é aceitável somente no desenvolvimento local. Produção deve usar certificado ou outra credencial de confidential client mais forte.

Migração da autenticação: acrescente `CLOUDOPS_ENTRA_WEB_CLIENT_ID` no `.env` existente, sem sobrescrevê-lo. É configuração backend não secreta e independente de `VITE_*`. Confirme `api.knownClientApplications` e Graph delegado somente na API. A ferramenta de inativos acrescenta `User.Read.All`, `AuditLog.Read.All` e `LicenseAssignment.Read.All` ao `User.Read` existente; exige reconsentimento administrativo, não novas variáveis por tenant.

Login/troca de conta solicitam o consentimento estático combinado; chamadas HTTP continuam adquirindo `Assessment.Run`. Se faltar consentimento, **Conceder permissões** abre o popup Microsoft, renova o token normal e repete a operação uma vez. Políticas administrativas continuam soberanas. Novas permissões estáticas na API podem exigir reconsentimento; veja [Autenticação](docs/authentication.md) e [teste com tenant limpo](docs/entra-setup.md#9-testar-tenant-novo-ou-revogar-consentimento-antigo).

## Validação

```powershell
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
npm run assessments:validate
npm run assessments:list
npm run test:ui
```

Testes do engine no PowerShell 7:

```powershell
pwsh -NoLogo -NoProfile -NonInteractive -File ./engine/tests/Validate-GraphModule.ps1
pwsh -NoLogo -NoProfile -NonInteractive -File ./engine/tests/Validate-HelloWorld.ps1
pwsh -NoLogo -NoProfile -NonInteractive -File ./engine/tests/Validate-InactiveUsers.ps1 -ScaleUsers 200000
npm run test:reports
```

O E2E HTTP do Hello World agora também é autenticado. Com os containers ativos, forneça um token válido da CloudOps API usando o prompt protegido descrito em [Desenvolvimento local — Hello World](docs/local-development.md#hello-world). Não cole o token em um comando literal que possa entrar no histórico do shell.

Os testes visuais usam Edge instalado no Windows; em Linux/macOS, instale Chromium com `npx playwright install chromium`. Usam dados sintéticos, não credenciais; screenshots, traces e vídeo estão desligados por padrão. O CI executa também essas regressões de UI. O Graph E2E real é deliberadamente manual.

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

Os manifests são configuração estática e confiável do produto, não dados de cliente. Sua leitura não muda o tratamento efêmero de tokens, respostas Graph ou artefatos.

## Adicionar uma ferramenta

Antes: criar PowerShell e editar o registry manualmente. Agora: criar `engine/<id>/assessment.json`, `Invoke-Assessment.ps1`, README e testes; validar e reiniciar/reimplantar. O card é gerado no módulo declarado, **sem editar o registry, App.tsx ou JSX de catálogo**. Em Docker, os arquivos precisam entrar na nova imagem.

```powershell
npm run assessments:validate
npm run assessments:list
npm run test
```

O startup examina somente pastas imediatamente abaixo de `engine/`. Pastas sem manifest são ignoradas; manifest inválido impede a API de iniciar, com diagnóstico sanitizado. Módulos continuam centralizados. Não há watcher, upload ou instalação de código em runtime. Veja o [fluxo e exemplo completo](docs/assessment-development.md) e o [template somente documental](docs/examples/assessment.json).

Os três assessments mantêm suas permissões, scripts e limites anteriores. Esta migração **não exige mudanças nos App Registrations ou novo consentimento**. `npm run test:e2e:local` valida Hello World com identidade sintética em memória e PowerShell real, sem Entra/Graph; exige `pwsh` no host ou imagem development.

## Estrutura

```text
apps/
|-- api/                         # Fastify, Entra, OBO e executions em RAM
`-- web/                         # React, Router, MSAL e shell multicloud
packages/contracts/              # schemas HTTP e protocolo interno
engine/
|-- shared/CloudOps.Graph.psm1   # Graph REST, retry, paginação e host pinning
|-- microsoft-graph-connectivity/
|-- inactive-users/             # inventário incremental, HTML offline e CSV
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
- [Mapear Usuários Inativos: regras, permissões e escala](docs/inactive-users.md)
- [Zero Retention](docs/zero-retention.md)
- [Contrato de assessments](docs/assessment-contract.md)
- [Desenvolvimento de assessments](docs/assessment-development.md)
- [Desenvolvimento local](docs/local-development.md)
- [Resultados da validação local](docs/validation-report.md)

## Limitações atuais

AWS e GCP possuem shell/navegação, sem autenticação ou APIs. Não estão implementados Privileged Role Auditor, Secure Score, Conditional Access Assessment, deployment Azure, Bicep, Key Vault, database, storage ou n8n. Graph Connectivity e Mapear Usuários Inativos usam apenas leitura delegated. A coleta de inativos tem timeout de 55 minutos e depende da validade da autenticação; não oferece checkpoint ou retomada persistente.

O caminho Entra → OBO → Graph → ZIP da foundation anterior já foi validado em tenant real pelo usuário. O novo onboarding combinado ainda requer o aceite em tenant de laboratório sem grants prévios; testes sintéticos não substituem essa evidência.
