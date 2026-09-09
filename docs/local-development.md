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
npm run assessments:validate
npm run assessments:list
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

### Hello World HTTP sem credenciais reais

`npm run test:e2e:local` cria uma API local com chaves RSA e identidade sintéticas somente em RAM, usa a validação JWT real com JWKS local de teste, descobre os manifests e executa Hello World com PowerShell real. Confere autenticação, catálogo, progresso, ZIP e download-once. Não chama Entra/Graph; o harness não é incluído no build de produção. Não substitui o aceite Entra/OBO em tenant real.

```powershell
docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /tmp:rw,noexec,nosuid,nodev,size=32m --env PSModuleAnalysisCachePath=/dev/null cloudops-development:local npm run test:e2e:local
```

Essa imagem de testes permite escrever os arquivos de compilação TypeScript estáticos. O Compose da aplicação continua read-only; os validadores PowerShell acima também usam read-only e verificam ausência de gravações de assessment.

### Validar Compose sem usar `.env` ou imagens do ambiente real

Para validar somente build/startup/health, existe `docker/compose.validation.yml`, overlay de testes com nomes de imagens próprios e portas loopback 3011/5181. Exige Compose com suporte a `!override` (2.24.4+). Abra um terminal descartável na raiz do repositório e configure **somente esses valores sintéticos**:

```powershell
$env:CLOUDOPS_ENTRA_API_CLIENT_ID = '11111111-1111-4111-8111-111111111111'
$env:CLOUDOPS_ENTRA_WEB_CLIENT_ID = '22222222-2222-4222-8222-222222222222'
$env:CLOUDOPS_ENTRA_API_CLIENT_SECRET = 'synthetic-validation-not-a-credential'
$env:VITE_ENTRA_WEB_CLIENT_ID = '22222222-2222-4222-8222-222222222222'
$env:VITE_ENTRA_API_SCOPE = 'api://11111111-1111-4111-8111-111111111111/Assessment.Run'
$validationCompose = @('--project-name', 'cloudops-plugin-validation', '--env-file', '.env.example', '-f', 'docker-compose.yml', '-f', 'docker/compose.validation.yml')
docker compose @validationCompose build
docker compose @validationCompose up -d --wait --wait-timeout 60
docker compose @validationCompose ps
docker compose @validationCompose down
```

Não faça login nesse ambiente: IDs/secret são fictícios. Use `http://localhost:3011/api/v1/health` e `http://localhost:5181` apenas para conferir disponibilidade; catálogo sem autenticação deve responder 401. O `down` acima remove somente containers/rede desse projeto isolado; as imagens de validação permanecem locais. O `.env` real e as imagens `cloudops-runtime:local`/`cloudops-development:local` não são substituídos. Para login real, use o Compose normal com sua configuração existente, após rebuild em janela sem execução ativa.

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
