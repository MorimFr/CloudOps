# Desenvolvimento local

## Requisitos

- Docker Desktop/Engine com Compose v2;
- dois App Registrations conforme [entra-setup.md](entra-setup.md);
- opcionalmente Node.js 24 e npm;
- opcionalmente PowerShell 7.2+.

Não é necessário banco, Redis, storage ou emulador Azure.

## Configurar

```powershell
Copy-Item .env.example .env
```

Preencha:

```dotenv
NODE_ENV=development
PORT=3000
WEB_ORIGIN=http://localhost:5173
VITE_CLOUDOPS_API_URL=http://localhost:3000

VITE_ENTRA_WEB_CLIENT_ID=<WEB_CLIENT_ID>
VITE_ENTRA_API_SCOPE=api://<API_CLIENT_ID>/Assessment.Run
CLOUDOPS_ENTRA_API_CLIENT_ID=<API_CLIENT_ID>
CLOUDOPS_ENTRA_WEB_CLIENT_ID=<WEB_CLIENT_ID>
CLOUDOPS_ENTRA_API_CLIENT_SECRET=<API_CLIENT_SECRET_VALUE>

ARTIFACT_TTL_SECONDS=300
MAX_CONCURRENT_EXECUTIONS=2
OBO_TIMEOUT_SECONDS=15
MAX_ARTIFACT_BYTES=26214400
VITE_SHOW_DEV_ASSESSMENTS=false
```

Não use tenant ID fixo. O client secret é somente local e nunca deve usar prefixo `VITE_`.

Se `.env` já existir, não o sobrescreva: adicione apenas a variável backend Web, com o mesmo valor do ID Web público. O backend não lê `VITE_*`. Confirme o manifest `knownClientApplications` conforme [Entra setup](entra-setup.md). Isso é migração da aplicação, não configuração por tenant.

## Executar

```powershell
docker compose up --build
```

- Web: `http://localhost:5173`
- API: `http://localhost:3000`
- Health: `http://localhost:3000/api/v1/health`

O Compose passa o secret apenas ao runtime/API. A API usa filesystem read-only, tmpfs pequeno, capabilities removidas e nenhum volume de dados.

## Validar a UI e Graph real

1. Abra o Web e confirme o Cloud Selector.
2. Entre em Azure; confirme as cinco áreas na sidebar.
3. Selecione **Entrar com Microsoft** e uma conta organizacional.
4. No Dashboard, confirme `Authenticated`, Account e Tenant.
5. Navegue para **SecOps**.
6. Execute **Microsoft Graph Connectivity**.
7. Aguarde `COMPLETED` e baixe o ZIP uma vez.
8. Confirme `report.html` e `summary.json`.
9. Confirme que novo download não está disponível.
10. Em DevTools, inspecione Local Storage, Session Storage e IndexedDB durante e após o login: nenhum token, metadado OAuth, dado Graph, resultado de execution ou artifact deve ser gravado pelo CloudOps.
11. Inspecione o filesystem do container: não deve existir Graph response, token cache, report, JSON ou ZIP temporário.
12. Selecione AWS e GCP e confirme as cinco áreas e seus estados indisponíveis, sem conteúdo Azure residual.

Se houver duas contas de tenants diferentes, repita após **Sair/Trocar conta**. Isso só funciona onde o app é permitido, as delegated permissions estão consentidas e o usuário é autorizado.

## Hello World

Para exibir o card de regressão durante desenvolvimento:

```dotenv
VITE_SHOW_DEV_ASSESSMENTS=true
```

Ele aparece em **Azure → DevOps** apenas no modo development.

O E2E HTTP requer um access token válido para a CloudOps API:

```powershell
$e2eToken = Read-Host 'CloudOps API access token (Assessment.Run)' -AsSecureString
try {
    $env:CLOUDOPS_E2E_API_TOKEN = [System.Net.NetworkCredential]::new('', $e2eToken).Password
    npm run test:e2e
} finally {
    Remove-Item Env:CLOUDOPS_E2E_API_TOKEN -ErrorAction SilentlyContinue
    $e2eToken.Dispose()
}
```

O prompt evita colocar o token no histórico de comandos. Não cole tokens em comandos literais, `.env`, arquivos ou sessões com transcrição/diagnóstico de payload. Esse token é da CloudOps API, nunca do Graph; a variável de ambiente temporária existe somente para o cliente de teste e não é repassada ao engine. O script remove sua cópia da variável ao iniciar e não imprime nem grava o token ou o ZIP.

## Testes locais

```powershell
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:ui
```

O teste de navegador usa Edge instalado no Windows e Chromium em Linux/macOS (`npx playwright install chromium`). A porta isolada é 5174; a API e a identidade são interceptadas com fixtures sintéticas, sem login real ou bypass no bundle de produção. Os cards extras existem apenas nas fixtures para provar o grid. Não habilite traces, vídeos ou screenshots com dados reais; estão desligados por padrão. Em CI, Chromium é instalado antes desses testes.

Para testar combined consent real e revogação opcional de grants de laboratório, siga [o procedimento exato](entra-setup.md#9-testar-tenant-novo-ou-revogar-consentimento-antigo). Não conceda `User.Read` manualmente antes do aceite.

Sem `pwsh` no host:

```powershell
docker build --file docker/runtime.Dockerfile --target development --tag cloudops-development:local .
docker run --rm --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,nodev,size=32m --env HOME=/tmp/cloudops-home cloudops-development:local pwsh -NoLogo -NoProfile -NonInteractive -File engine/tests/Validate-GraphModule.ps1
docker run --rm --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,nodev,size=32m --env HOME=/tmp/cloudops-home cloudops-development:local pwsh -NoLogo -NoProfile -NonInteractive -File engine/tests/Validate-HelloWorld.ps1
```

## Mapear Usuários Inativos

Veja [permissões, critérios e coleta de 200 mil usuários](inactive-users.md). O ZIP contém HTML executivo e CSV somente de inativos. Sem login registrado, a criação precisa ter completado 90 dias. Teste sintético em PowerShell 7: `pwsh -NoLogo -NoProfile -NonInteractive -File engine/tests/Validate-InactiveUsers.ps1 -ScaleUsers 200000`.

Para validar HTML em desktop/mobile/impressão: `npm run test:reports` (Docker e imagem `cloudops-runtime:local`; override `CLOUDOPS_TEST_IMAGE`). Não usa Graph real. Não habilite screenshots/traces/HAR com uma sessão real.

## Inspecionar containers

```powershell
docker compose ps
docker compose exec cloudops-runtime node --version
docker compose exec cloudops-runtime pwsh --version
docker compose exec cloudops-runtime id -u
```

Esperado: Node `v24.20.0`, PowerShell `7.6.5`, UID diferente de zero e runtime `healthy`.

## Encerrar

```powershell
docker compose down
```

Sem volumes, restart/down perde todas as executions em memória por design.
