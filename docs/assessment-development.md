# Desenvolvimento de assessments

## Estrutura

```text
engine/<assessment-id>/
|-- Invoke-Assessment.ps1
|-- README.md
|-- knowledge/
`-- tests/
```

Um diretório só pode ser executado após entrada explícita no Assessment Registry. Nunca derive path ou comando do cliente.

## Metadata obrigatória

Registre:

```text
id
name
description
scriptPath interno
enabled
timeoutMs
provider
domain
visibility
requiredAuthProvider
requiredPermissions
adminConsentRequired
```

Novos providers/domínios/permissões exigem expansão revisada dos schemas compartilhados. O frontend gera cards a partir desses metadados.

Hello World deve permanecer `azure/devops`, `development`, auth `none`. Microsoft Graph Connectivity é `azure/secops`, `public`, auth `microsoft-graph`, permission `User.Read`.

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

Permissões vêm do registry e devem seguir least privilege. Não adicione permissões futuras ao App Registration antes do assessment correspondente.

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
```

Unit tests não chamam Graph real. O E2E Graph real é manual e exige conta/consentimento válidos.
