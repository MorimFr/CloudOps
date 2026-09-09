# Desenvolvimento de assessments

## Estrutura

```text
engine/<assessment-id>/
|-- assessment.json
|-- Invoke-Assessment.ps1
|-- README.md
|-- knowledge/
`-- tests/
```

Antes era necessário criar o script e editar uma lista no Assessment Registry. Agora o manifest é a declaração oficial: criar a pasta, o JSON e o entrypoint basta para registrar a ferramenta após um novo startup. Nunca derive path ou comando do cliente. Não edite `assessment-registry.ts`, `App.tsx` ou componentes de catálogo para adicionar um assessment.

## Metadata obrigatória

Declare em `assessment.json`:

```text
schemaVersion: cloudops.assessment.v1
id / name / description
provider / domain / moduleId / assessmentOrder
enabled / visibility
engine: runtime / entrypoint / timeoutSeconds / maxConcurrentExecutions?
auth: provider / permissions / adminConsentRequired
display?: icon? / tags? / source?
```

Novos providers/domínios/permissões exigem expansão revisada dos schemas compartilhados. O frontend gera cards a partir desses metadados.

Todos os campos e limites estão no [contrato](assessment-contract.md#manifest-estático-v1). O [template completo](examples/assessment.json) fica em `docs/`, fora do discovery: não copie um `assessment.json` válido para `engine/_template/`. Os campos com `?` são opcionais; o limite global de concorrência permanece quando não há override. `display` aceita somente chaves de ícones aprovados e texto, nunca SVG/HTML/React ou URL.

Hello World deve permanecer `azure/devops/runtime-validation`, `development`, auth `none`. Microsoft Graph Connectivity é `azure/secops/connectivity-diagnostics`, `public`, auth `microsoft-graph`, permission `User.Read`.

## Escolher o módulo sem editar JSX

1. Escolha um `moduleId` do `ModuleRegistry`, ou registre um módulo central com `id`, `name`, `description`, `order`, `provider` e `domain`.
2. Declare `moduleId` e `assessmentOrder` no manifest. Não duplique nome/descrição/ordem do módulo nele.
3. O registry exige que provider/domain do módulo correspondam aos do assessment. Ele projeta `moduleName`, `moduleDescription` e `moduleOrder` no catálogo público.
4. Adicione testes de metadata/engine. O Web agrupa e ordena automaticamente; nenhum JSX novo é necessário para criar o card.

Ordens inteiras de 1 a 999, com desempate por ID. Módulos vazios e assessments desabilitados não aparecem. `adminConsentRequired=true` adiciona badge compacto, mas a autorização efetiva continua responsabilidade Entra/API; não infira aprovação apenas pela metadata.

O módulo `identity-visibility` contém `inactive-users` (Mapear Usuários Inativos), com HTML/CSV e permissões de leitura administrativas. `security-assessments` e `protection-response` continuam preparados e vazios. Identity Assessment permanece futuro. Veja [regras e limites do inventário](inactive-users.md).

## Fluxo de desenvolvimento

1. Crie `engine/my-assessment/` (nome igual ao ID, lowercase com hífens simples).
2. Crie `assessment.json` com versão suportada, módulo existente e permissões mínimas já admitidas pelo contrato.
3. Crie `Invoke-Assessment.ps1`, README e testes. Revise o código: manifest não torna código externo confiável.
4. Execute `npm run assessments:validate` e `npm run assessments:list`. A validação não executa PowerShell nem exige credenciais Microsoft.
5. Execute `npm run test`, os validadores PowerShell aplicáveis e `npm run test:ui`.
6. Reinicie o CloudOps. Em Compose, faça build/deploy da nova imagem. O card aparece automaticamente em provider/domain/module declarados. Para `visibility=development`, habilite `VITE_SHOW_DEV_ASSESSMENTS=true` no Web de desenvolvimento.

Discovery é somente no startup e não é recursivo. Diretórios sem manifest são ignorados; qualquer manifest inválido (inclusive desabilitado) impede startup, sem catálogo parcial. IDs duplicados, módulo incompatível, entrypoint ausente e links falham fechados. Ao remover a pasta e reiniciar, o card desaparece. Não existe watcher, upload, marketplace ou endpoint de instalação. Mantenha o engine imutável durante a execução; restart descarta executions em RAM, portanto use uma janela sem assessments ativos.

## Exemplo mínimo completo, somente documental

O exemplo abaixo não é criado no engine do produto. Ele gera um ZIP de demonstração sem Graph, sem novos scopes e sem mudar UI/registry. O [template completo alternativo](examples/assessment.json) demonstra auth Graph `User.Read` e display; para esse template, implemente leitura Graph conforme as regras abaixo, sem inventar sucesso de coleta.

```text
engine/example-security-check/
├── assessment.json
└── Invoke-Assessment.ps1
```

`assessment.json`:

```json
{
  "schemaVersion": "cloudops.assessment.v1",
  "id": "example-security-check",
  "name": "Example Security Check",
  "description": "Example only. No tenant assessment is performed.",
  "provider": "azure",
  "domain": "secops",
  "moduleId": "security-assessments",
  "assessmentOrder": 50,
  "enabled": true,
  "visibility": "development",
  "engine": {
    "runtime": "powershell",
    "entrypoint": "Invoke-Assessment.ps1",
    "timeoutSeconds": 60
  },
  "auth": {
    "provider": "none",
    "permissions": [],
    "adminConsentRequired": false
  }
}
```

`Invoke-Assessment.ps1` (ZIP de conteúdo estático, todo em RAM):

```powershell
#requires -Version 7.2
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$sharedDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'shared'
Import-Module (Join-Path $sharedDirectory 'CloudOps.Execution.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $sharedDirectory 'CloudOps.Security.psm1') -Force -DisableNameChecking
$archiveStream = $null
$artifactBuffer = $null
$reportBytes = $null
try {
    $context = Read-CloudOpsExecutionContext
    $null = Assert-CloudOpsIdentifier -Value ([string] $context.executionId) -Name 'executionId'
    if ($context.assessmentId -cne 'example-security-check' -or
        $null -ne $context.PSObject.Properties['auth']) {
        throw [ArgumentException]::new('Invalid example context.')
    }
    Write-CloudOpsProgress -Stage 'INITIALIZING' -Progress 10
    $reportBytes = [Text.Encoding]::UTF8.GetBytes('<!doctype html><html lang="en"><meta charset="utf-8"><title>Example only</title><h1>Example only</h1><p>No tenant assessment performed.</p></html>')
    $archiveStream = [IO.MemoryStream]::new()
    $archive = [IO.Compression.ZipArchive]::new($archiveStream, [IO.Compression.ZipArchiveMode]::Create, $true)
    try {
        $entryStream = $archive.CreateEntry('report.html').Open()
        try { $entryStream.Write($reportBytes, 0, $reportBytes.Length) }
        finally { $entryStream.Dispose() }
    } finally { $archive.Dispose() }
    Write-CloudOpsProgress -Stage 'COMPLETED' -Progress 100
    $artifactBuffer = $archiveStream.GetBuffer()
    Write-CloudOpsArtifact -Bytes $artifactBuffer -Count ([int] $archiveStream.Length)
} catch {
    Write-CloudOpsFailure -Code 'ASSESSMENT_FAILED'
    exit 1
} finally {
    if ($null -ne $artifactBuffer) { [Array]::Clear($artifactBuffer, 0, $artifactBuffer.Length) }
    if ($null -ne $reportBytes) { [Array]::Clear($reportBytes, 0, $reportBytes.Length) }
    if ($null -ne $archiveStream) {
        $internalBuffer = $archiveStream.GetBuffer()
        [Array]::Clear($internalBuffer, 0, $internalBuffer.Length)
        $archiveStream.Dispose()
    }
    $context = $null
}
```

Adicione testes antes de promover qualquer implementação. O exemplo não é assessment de segurança real e permanece `development`; somente resultados obtidos pelo script real podem ser apresentados como findings.

## Regras obrigatórias

1. Use PowerShell 7 cross-platform.
2. Leia um único contexto com `Read-CloudOpsExecutionContext`.
3. Valide `assessmentId` e somente leia `auth` quando o registry exigir Graph.
4. Emita progresso e métricas públicas por NDJSON em `stderr`.
5. Reserve `stdout` exclusivamente ao ZIP.
6. Construa ZIP/entries em `MemoryStream`/`ZipArchive`; nunca use filesystem, inclusive `/tmp`.
7. Não escreva log, transcript, cache, history, checkpoint ou telemetria de assessment.
8. Não exponha token, tenant, Graph response, PII ou finding detalhado em evento público.
9. Faça HTML encoding de dados dinâmicos.
10. Em falha, use somente códigos/mensagens sanitizados e exit code não zero.
11. Limpe byte arrays/buffers controlados em `finally` e libere referências a tokens cedo.

Evite `Write-Host`, `Write-Output`, `Write-Warning`, `Write-Verbose` e saída implícita. Mesmo um texto em `stdout` corrompe o ZIP.

## Graph

Use `engine/shared/CloudOps.Graph.psm1`, nunca instale Microsoft.Graph PowerShell SDK. Não aceite host, access token, tenant ou scopes de options.

Prefira:

```text
Graph page
  -> agregação/stream de report
  -> descarte da página
```

`Get-CloudOpsGraphCollection` valida `@odata.nextLink`; `Invoke-CloudOpsGraphRequest` já aplica host fixo, response limit, retry e erros seguros. Não registre request/response.

Permissões são declaradas no manifest, validadas contra o enum Graph e resolvidas pelo registry; devem seguir least privilege. Não adicione permissões futuras ao App Registration antes do assessment correspondente. A migração dos três manifests atuais não altera permissions/grants nem exige reconfiguração Entra.

Ao ampliar permissões, revise também o consentimento estático `.default`: o popup pode solicitar todo o conjunto configurado na API e tenants existentes podem precisar reconsentir. Nunca acrescente Graph permission ao SPA. Preserve a recuperação limitada, admin approval e o drawer aprovado.

## publicMetrics

Use apenas:

```text
findings
objectsAnalyzed
requestsCompleted
graphReachable
```

Os contadores são inteiros agregados. Tudo que identifica conta, objeto, tenant, grupo, aplicação, política ou evidência pertence exclusivamente ao ZIP.

## Testes

Obrigatório cobrir, conforme aplicável:

- contexto ausente/inválido e auth incompatível;
- NDJSON/schema/progresso;
- ZIP e entries esperadas em memória;
- HTML/JSON seguros;
- nenhum arquivo alterado;
- sucesso, timeout, abort e buffer cleanup;
- Graph 200, 401, 403, 429/Retry-After, 5xx/retry e limites;
- paginação, ciclo e nextLink host inválido;
- ausência de dado detalhado em publicMetrics.

```powershell
pwsh -NoLogo -NoProfile -NonInteractive -File ./engine/tests/Validate-GraphModule.ps1
pwsh -NoLogo -NoProfile -NonInteractive -File ./engine/tests/Validate-HelloWorld.ps1
pwsh -NoLogo -NoProfile -NonInteractive -File ./engine/tests/Validate-InactiveUsers.ps1 -ScaleUsers 10000
npm run assessments:validate
npm run assessments:list
npm run test:e2e:local
```

Unit tests não chamam Graph real. O E2E Graph real é manual e exige conta/consentimento válidos.
